const test = require('node:test');
const assert = require('node:assert/strict');

const Room = require('../models/Room');
const Message = require('../models/Message');
const Agency = require('../models/Agency');
const AgencyApplication = require('../models/AgencyApplication');
const User = require('../models/User');
const UserIdCounter = require('../models/UserIdCounter');
const { allocatePublicUserId } = require('../services/userIdService');
const Host = require('../models/Host');
const Follow = require('../models/Follow');
const Notification = require('../models/Notification');
const DailyCheckIn = require('../models/DailyCheckIn');
const Payment = require('../models/Payment');
const Transaction = require('../models/Transaction');
const ThemeSettings = require('../models/ThemeSettings');
const AppSettings = require('../models/AppSettings');
const FaceVerification = require('../models/FaceVerification');
const Invitation = require('../models/Invitation');
const Withdrawal = require('../models/Withdrawal');
const authRoutes = require('../routes/authRoutes');
const auth = require('../middleware/auth');
const walletRoutes = require('../routes/walletRoutes');
const giftRoutes = require('../routes/giftRoutes');
const gameRoutes = require('../routes/gameRoutes');
const followRoutes = require('../routes/followRoutes');
const notificationRoutes = require('../routes/notificationRoutes');
const checkInRoutes = require('../routes/checkInRoutes');
const liveStatusRoutes = require('../routes/liveStatusRoutes');
const paymentRoutes = require('../routes/paymentRoutes');
const themeRoutes = require('../routes/themeRoutes');
const appSettingsRoutes = require('../routes/appSettingsRoutes');
const faceVerificationRoutes = require('../routes/faceVerificationRoutes');
const invitationRoutes = require('../routes/invitationRoutes');
const agencyRoutes = require('../routes/agencyRoutes');
const withdrawRoutes = require('../routes/withdrawRoutes');
const { AGENCY_TIERS, HOST_WITHDRAWAL_MINIMUM_DIAMONDS } = require('../config/commission');
const { calculateLuckyGiftMultiplier, processGiftDistribution } = require('../services/giftService');
const { playMiniGame } = require('../services/gameService');
const paymentService = require('../services/paymentService');

const userId = '507f1f77bcf86cd799439011';
const roomId = '507f1f77bcf86cd799439012';

test('room model accepts the supported categories and 25 indexed seats', async () => {
  const room = new Room({
    title: 'Test room',
    ownerId: userId,
    category: 'Party',
    seats: Array.from({ length: 25 }, (_, seatIndex) => ({ seatIndex }))
  });
  await room.validate();
  assert.equal(room.seats[24].seatIndex, 24);

  const invalidRoom = new Room({ title: 'Invalid category', ownerId: userId, category: 'Music' });
  await assert.rejects(invalidRoom.validate(), /`Music` is not a valid enum value/);
});

test('messages require an allowed type and either a receiver or a room', async () => {
  const roomMessage = new Message({
    senderId: userId,
    roomId,
    type: 'USER',
    content: 'Hello'
  });
  await roomMessage.validate();

  const missingDestination = new Message({ senderId: userId, type: 'USER', content: 'Hello' });
  await assert.rejects(missingDestination.validate(), /A message must have a receiver or room/);

  const invalidType = new Message({ senderId: userId, receiverId: userId, type: 'TEXT', content: 'Hello' });
  await assert.rejects(invalidType.validate(), /`TEXT` is not a valid enum value/);
});

test('agency owner/member fields and uppercase user roles validate', async () => {
  const agency = new Agency({ ownerId: userId, members: [userId], name: 'Test agency' });
  await agency.validate();

  const agent = new User({ username: 'test-agent', email: 'agent@example.com', password: 'hashed', role: 'AGENT' });
  await agent.validate();
  assert.equal(agent.profileComplete, false);
  assert.equal(agent.profilePicture, '');
  assert.equal(agent.isVerified, false);
  assert.equal(agent.isFaceVerified, false);
  assert.equal(agency.tier, 'D');
  assert.equal(agency.commissionRate, 0.08);

  const host = new Host({ userId, agencyId: roomId });
  assert.equal(host.faceVerified, false);

  const incompleteProfile = new User({
    username: 'incomplete-profile',
    email: 'incomplete@example.com',
    password: 'hashed',
    profileComplete: true
  });

  test('agency commission tiers match the master-spec thresholds and rates', () => {
    assert.deepEqual(AGENCY_TIERS, [
      { tier: 'D', minimumTeamIncome: 0, rate: 0.08 },
      { tier: 'C', minimumTeamIncome: 20_000_000, rate: 0.12 },
      { tier: 'B', minimumTeamIncome: 100_000_000, rate: 0.16 },
      { tier: 'A', minimumTeamIncome: 500_000_000, rate: 0.18 },
      { tier: 'S', minimumTeamIncome: 1_500_000_000, rate: 0.2 },
      { tier: 'S+', minimumTeamIncome: null, rate: 0.21, requiredSLevelAgencies: 2 },
    ]);
  });

  test('withdrawal model enforces minimum, whole diamonds, methods, and admin status', async () => {
    const valid = new Withdrawal({
      userId,
      amountDiamonds: HOST_WITHDRAWAL_MINIMUM_DIAMONDS,
      amountUsd: 10,
      method: 'CBE',
      accountDetails: 'CBE account',
    });
    await valid.validate();
    assert.equal(valid.status, 'PENDING');

    const belowMinimum = new Withdrawal({
      userId,
      amountDiamonds: HOST_WITHDRAWAL_MINIMUM_DIAMONDS - 1,
      amountUsd: 9.99,
      method: 'BANK',
      accountDetails: 'Account',
    });
    await assert.rejects(belowMinimum.validate());
  });
  await assert.rejects(incompleteProfile.validate(), /Phone number is required/);

  const completeProfile = new User({
    username: 'complete-profile',
    email: 'complete@example.com',
    password: 'hashed',
    phoneNumber: '+12025550123',
    country: 'United States',
    gender: 'Other',
    profileComplete: true
  });
  await completeProfile.validate();
  assert.equal(User.schema.path('username').options.unique, true);

  const invalidRole = new User({
    username: 'bad-role',
    email: 'bad-role@example.com',
    password: 'hashed',
    role: 'agency'
  });
  await assert.rejects(invalidRole.validate(), /`agency` is not a valid enum value/);
});

test('gift and game calculations preserve integer currency amounts', () => {
  assert.deepEqual(
    processGiftDistribution({ hostShareRate: 0.7, charmRate: 0.2 }, 99),
    { hostDiamonds: 69, charmPoints: 19 }
  );

  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    assert.equal(calculateLuckyGiftMultiplier('LUCKY'), 500);
    assert.deepEqual(playMiniGame('MegaJackpot', 10), {
      isWin: true,
      multiplier: 500,
      winAmount: 5000,
      rngRoll: '0.0000'
    });
  } finally {
    Math.random = originalRandom;
  }
});

test('wallet recharge, gift, and game routes require authentication', () => {
  for (const [router, path] of [
    [walletRoutes, '/recharge'],
    [giftRoutes, '/catalog'],
    [giftRoutes, '/send'],
    [gameRoutes, '/play']
  ]) {
    const route = router.stack.find((layer) => layer.route && layer.route.path === path);
    assert.ok(route, `Expected ${path} route to be registered`);
    assert.equal(route.route.stack[0].handle, auth);
  }
});

test('Agency Center and withdrawal routes are registered behind authentication', () => {
  const agencyPaths = ['/center', '/commission', '/host-revenue', '/sub-revenue', '/invite-links', '/sub-apply', '/exit-apply'];
  for (const path of agencyPaths) {
    const route = agencyRoutes.stack.find((layer) => layer.route && layer.route.path === path);
    assert.ok(route, `Expected agency route ${path}`);
    assert.equal(route.route.stack[0].handle, auth);
  }

  const requestRoute = withdrawRoutes.stack.find((layer) => layer.route && layer.route.path === '/request');
  assert.ok(requestRoute);
  assert.equal(requestRoute.route.stack[0].handle, auth);
  assert.ok(AgencyApplication.schema.indexes().some(([index, options]) =>
    index.applicantId === 1 && index.status === 1 && options.unique
  ));
});

test('follow, notification, and daily check-in schemas validate with requested defaults', async () => {
  const follow = new Follow({ followerId: userId, followingId: roomId });
  await follow.validate();
  assert.ok(Follow.schema.indexes().some(([index, options]) =>
    index.followerId === 1 && index.followingId === 1 && options.unique
  ));

  const notification = new Notification({
    userId,
    title: 'New follower',
    message: 'Someone followed you'
  });
  await notification.validate();
  assert.equal(notification.type, 'SYSTEM');
  assert.equal(notification.isRead, false);

  const checkIn = new DailyCheckIn({ userId, date: '2026-10-19' });
  await checkIn.validate();
  assert.equal(checkIn.coinsEarned, 0);
  assert.equal(checkIn.streak, 1);
  assert.ok(DailyCheckIn.schema.indexes().some(([index, options]) =>
    index.userId === 1 && index.date === 1 && options.unique
  ));
  await assert.rejects(
    new DailyCheckIn({ userId, date: '19-10-2026' }).validate(),
    /Date must use YYYY-MM-DD format/
  );
});

test('new authenticated feature routes apply verifyToken to protected endpoints', () => {
  const verifyToken = require('../middleware/authMiddleware').verifyToken;
  const expectedRoutes = [
    [followRoutes, 'POST', '/follow'],
    [followRoutes, 'POST', '/unfollow'],
    [followRoutes, 'GET', '/followers/:userId'],
    [followRoutes, 'GET', '/following/:userId'],
    [followRoutes, 'GET', '/check/:userId'],
    [notificationRoutes, 'GET', '/'],
    [notificationRoutes, 'PUT', '/read/:id'],
    [notificationRoutes, 'PUT', '/read-all'],
    [notificationRoutes, 'GET', '/unread-count'],
    [checkInRoutes, 'POST', '/'],
    [checkInRoutes, 'GET', '/status'],
    [liveStatusRoutes, 'PUT', '/status']
  ];

  for (const [router, method, path] of expectedRoutes) {
    const route = router.stack.find((layer) =>
      layer.route && layer.route.path === path && layer.route.methods[method.toLowerCase()]
    );
    assert.ok(route, `Expected ${method} ${path} route to be registered`);
    assert.equal(route.route.stack[0].handle, verifyToken);
  }

  for (const [router, path] of [
    [liveStatusRoutes, '/online'],
    [liveStatusRoutes, '/:userId']
  ]) {
    const route = router.stack.find((layer) => layer.route && layer.route.path === path);
    assert.ok(route, `Expected public ${path} route to be registered`);
    assert.notEqual(route.route.stack[0].handle, verifyToken);
  }
});

test('payment records require explicit coin conversion and unique transaction references', async () => {
  const payment = new Payment({
    userId,
    provider: 'chapa',
    transactionRef: 'meso-test-ref',
    amount: 100,
    currency: 'ETB',
    coinsToCredit: 1000,
    description: 'Coin package'
  });
  await payment.validate();
  assert.equal(payment.status, 'PENDING');
  assert.ok(Payment.schema.indexes().some(([index, options]) =>
    index.transactionRef === 1 && options.unique
  ));
  assert.ok(Transaction.schema.indexes().some(([index, options]) =>
    index.type === 1 && index.referenceId === 1 &&
    options.unique && options.partialFilterExpression.type === 'RECHARGE'
  ));

  const missingCoinConversion = new Payment({
    userId,
    provider: 'chapa',
    transactionRef: 'meso-no-coins',
    amount: 100,
    currency: 'ETB',
    description: 'Missing coin package'
  });
  await assert.rejects(missingCoinConversion.validate(), /coinsToCredit/);
});

test('payment routes protect initialization and verification but leave webhook public', () => {
  const verifyToken = require('../middleware/authMiddleware').verifyToken;
  for (const [method, path] of [
    ['post', '/initialize'],
    ['get', '/verify/:txRef']
  ]) {
    const route = paymentRoutes.stack.find((layer) =>
      layer.route && layer.route.path === path && layer.route.methods[method]
    );
    assert.ok(route, `Expected ${method.toUpperCase()} ${path} payment route`);
    assert.equal(route.route.stack[0].handle, verifyToken);
  }

  const webhook = paymentRoutes.stack.find((layer) =>
    layer.route && layer.route.path === '/webhook' && layer.route.methods.post
  );
  assert.ok(webhook, 'Expected public POST /webhook payment route');
  assert.notEqual(webhook.route.stack[0].handle, verifyToken);
});

test('Chapa webhook signatures require the configured secret and match timing-safe digests', () => {
  const originalSecret = process.env.CHAPA_WEBHOOK_SECRET;
  const body = Buffer.from(JSON.stringify({ tx_ref: 'meso-webhook-ref' }));
  try {
    delete process.env.CHAPA_WEBHOOK_SECRET;
    assert.equal(
      paymentService.verifyWebhookSignature({}, { 'x-chapa-signature': 'secret' }, body),
      false
    );

    process.env.CHAPA_WEBHOOK_SECRET = 'webhook-test-secret';
    assert.equal(
      paymentService.verifyWebhookSignature(
        {},
        { 'x-chapa-signature': 'webhook-test-secret' },
        body
      ),
      true
    );

    const signature = require('node:crypto')
      .createHmac('sha256', process.env.CHAPA_WEBHOOK_SECRET)
      .update(body)
      .digest('hex');
    assert.equal(
      paymentService.verifyWebhookSignature({}, { 'chapa-signature': signature }, body),
      true
    );
    assert.equal(
      paymentService.verifyWebhookSignature({}, { 'chapa-signature': 'invalid' }, body),
      false
    );
  } finally {
    if (originalSecret === undefined) delete process.env.CHAPA_WEBHOOK_SECRET;
    else process.env.CHAPA_WEBHOOK_SECRET = originalSecret;
  }
});

test('real Chapa payments require a server-configured coin conversion rate', async () => {
  const saved = {
    secret: process.env.CHAPA_SECRET_KEY,
    public: process.env.CHAPA_PUBLIC_KEY,
    rate: process.env.CHAPA_COINS_PER_ETB
  };
  try {
    process.env.CHAPA_SECRET_KEY = 'test-chapa-secret';
    delete process.env.CHAPA_PUBLIC_KEY;
    delete process.env.CHAPA_COINS_PER_ETB;
    await assert.rejects(
      paymentService.initializePayment(userId, 100, 'ETB', 'Test package', {
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User'
      }),
      { status: 503, message: 'Configure CHAPA_COINS_PER_ETB before accepting real payments.' }
    );
  } finally {
    if (saved.secret === undefined) delete process.env.CHAPA_SECRET_KEY;
    else process.env.CHAPA_SECRET_KEY = saved.secret;
    if (saved.public === undefined) delete process.env.CHAPA_PUBLIC_KEY;
    else process.env.CHAPA_PUBLIC_KEY = saved.public;
    if (saved.rate === undefined) delete process.env.CHAPA_COINS_PER_ETB;
    else process.env.CHAPA_COINS_PER_ETB = saved.rate;
  }
});

test('theme and app settings models validate defaults and theme enums', async () => {
  const theme = new ThemeSettings({ userId });
  await theme.validate();
  assert.equal(theme.themeMode, 'dark');
  assert.equal(theme.primaryColor, '#7C3AED');
  assert.equal(theme.accentColor, '#F59E0B');
  assert.equal(theme.animationLevel, 'MEDIUM');
  assert.equal(theme.animationsEnabled, true);
  assert.equal(theme.giftAnimationsEnabled, true);
  assert.ok(ThemeSettings.schema.path('userId').options.unique);

  const invalidTheme = new ThemeSettings({ userId, themeMode: 'sepia' });
  await assert.rejects(invalidTheme.validate(), /`sepia` is not a valid enum value/);

  const appSettings = new AppSettings();
  await appSettings.validate();
  assert.equal(appSettings.appName, 'Meso Live');
  assert.equal(appSettings.welcomeMessage, 'Welcome to Meso Live!');
});

test('face verification and invitation models validate status, defaults, and uniqueness', async () => {
  const verification = new FaceVerification({ userId, faceImage: 'https://example.com/face.png' });
  await verification.validate();
  assert.equal(verification.status, 'PENDING');
  assert.equal(verification.adminNote, '');

  const invitation = new Invitation({ inviterId: userId, inviteCode: 'ABC123' });
  await invitation.validate();
  assert.equal(invitation.status, 'PENDING');
  assert.equal(invitation.rewardCoins, 50);
  assert.equal(invitation.inviteeId, null);
  assert.ok(Invitation.schema.indexes().some(([index, options]) =>
    index.inviteCode === 1 && options.unique
  ));

  const inviter = new User({ username: 'reward-user', email: 'reward@example.com', password: 'hashed' });
  await inviter.validate();
  assert.equal(inviter.rewardCoins, 0);
});

test('theme, face verification, and invitation private routes require verifyToken', () => {
  const verifyToken = require('../middleware/authMiddleware').verifyToken;
  const expectedRoutes = [
    [themeRoutes, 'get', '/'],
    [themeRoutes, 'put', '/'],
    [themeRoutes, 'put', '/animation'],
    [faceVerificationRoutes, 'post', '/submit'],
    [faceVerificationRoutes, 'get', '/status'],
    [faceVerificationRoutes, 'put', '/:id/review'],
    [invitationRoutes, 'post', '/generate'],
    [invitationRoutes, 'post', '/accept'],
    [invitationRoutes, 'get', '/my-invitees'],
    [invitationRoutes, 'get', '/stats']
  ];
  for (const [router, method, path] of expectedRoutes) {
    const route = router.stack.find((layer) =>
      layer.route && layer.route.path === path && layer.route.methods[method]
    );
    assert.ok(route, `Expected ${method.toUpperCase()} ${path} route`);
    assert.equal(route.route.stack[0].handle, verifyToken);
  }

  const publicSettings = appSettingsRoutes.stack.find((layer) =>
    layer.route && layer.route.path === '/' && layer.route.methods.get
  );
  const adminSettings = appSettingsRoutes.stack.find((layer) =>
    layer.route && layer.route.path === '/' && layer.route.methods.put
  );
  assert.ok(publicSettings);
  assert.notEqual(publicSettings.route.stack[0].handle, verifyToken);
  assert.equal(adminSettings.route.stack[0].handle, verifyToken);
});

test('Google auth route is registered and User supports nullable unique Google identities', async () => {
  const route = authRoutes.stack.find((layer) =>
    layer.route && layer.route.path === '/google' && layer.route.methods.post
  );
  assert.ok(route, 'Expected POST /google authentication route');

  const user = new User({ username: 'google-user', email: 'google@example.com' });
  await user.validate();
  assert.equal(user.googleId, null);
  assert.equal(user.password, undefined);
  assert.equal(user.isVerified, false);
  assert.equal(user.isFaceVerified, false);
  assert.ok(User.schema.indexes().some(([index, options]) =>
    index.googleId === 1 && options.unique &&
    options.partialFilterExpression.googleId.$type === 'string'
  ));
  assert.ok(User.schema.path('email').options.unique);
  assert.equal(User.schema.path('publicId').instance, 'Number');
  assert.ok(User.schema.indexes().some(([index, options]) =>
    index.publicId === 1 && options.unique && options.sparse
  ));
  assert.equal(User.schema.path('email').isRequired, true);
  assert.notEqual(User.schema.path('password').options.required, true);
  const linkRoute = authRoutes.stack.find((layer) =>
    layer.route && layer.route.path === '/link-google' && layer.route.methods.post
  );
  assert.ok(linkRoute, 'Expected POST /link-google account linking route');
  assert.equal(linkRoute.route.stack[0].handle, auth);
});

test('public user IDs are allocated sequentially as seven-digit numbers', async () => {
  const originalFindByIdAndUpdate = UserIdCounter.findByIdAndUpdate;
  const originalCreate = UserIdCounter.create;
  let sequence = null;
  UserIdCounter.findByIdAndUpdate = async (id, update) => {
    assert.equal(id, 'public-user-id');
    if (sequence === null) return null;
    sequence += update.$inc.sequence;
    return { sequence };
  };
  UserIdCounter.create = async (counter) => {
    sequence = counter.sequence;
    return counter;
  };

  try {
    assert.equal(await allocatePublicUserId(), 1_000_000);
    assert.equal(await allocatePublicUserId(), 1_000_001);
  } finally {
    UserIdCounter.findByIdAndUpdate = originalFindByIdAndUpdate;
    UserIdCounter.create = originalCreate;
  }
});

test('face review grants or removes host verification only with the review result', async () => {
  const route = faceVerificationRoutes.stack.find((layer) =>
    layer.route && layer.route.path === '/:id/review' && layer.route.methods.put
  );
  assert.ok(route);

  const originalFindOneAndUpdate = FaceVerification.findOneAndUpdate;
  const originalUserFindOneAndUpdate = User.findOneAndUpdate;
  const originalHostFindOneAndUpdate = Host.findOneAndUpdate;
  const verificationId = '507f1f77bcf86cd799439011';
  const calls = [];
  FaceVerification.findOneAndUpdate = async () => ({ userId });
  User.findOneAndUpdate = async (...args) => calls.push(['user', ...args]);
  Host.findOneAndUpdate = async (...args) => calls.push(['host', ...args]);

  try {
    for (const status of ['VERIFIED', 'REJECTED']) {
      calls.length = 0;
      const res = {
        statusCode: 200,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(body) {
          this.body = body;
          return this;
        }
      };
      await route.route.stack[1].handle({
        params: { id: verificationId },
        body: { status },
        user: { id: userId, role: 'ADMIN' }
      }, res);

      const isVerified = status === 'VERIFIED';
      assert.equal(res.statusCode, 200);
      assert.deepEqual(calls[0], [
        'user',
        { _id: userId, role: 'HOST' },
        { $set: { isVerified, isFaceVerified: isVerified } }
      ]);
      assert.deepEqual(calls[1], [
        'host',
        { userId },
        { $set: { faceVerified: isVerified } }
      ]);
    }
  } finally {
    FaceVerification.findOneAndUpdate = originalFindOneAndUpdate;
    User.findOneAndUpdate = originalUserFindOneAndUpdate;
    Host.findOneAndUpdate = originalHostFindOneAndUpdate;
  }
});
