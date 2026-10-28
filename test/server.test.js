const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const mongoose = require('mongoose');

process.env.JWT_SECRET ||= 'test-jwt-secret-that-is-long-enough-for-production';
process.env.GOOGLE_CLIENT_ID ||= 'test-google-client-id.apps.googleusercontent.com';

const User = require('../models/User');
const Room = require('../models/Room');
const Withdrawal = require('../models/Withdrawal');
const Transaction = require('../models/Transaction');
const RevokedToken = require('../models/RevokedToken');
const { app } = require('../server');

const originalRevokedTokenExists = RevokedToken.exists;
RevokedToken.exists = async () => null;
test.after(() => {
  RevokedToken.exists = originalRevokedTokenExists;
});

test('GET /health responds with server and database status', async (context) => {
  const server = app.listen(0);
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await new Promise((resolve) => server.once('listening', resolve));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', database: 'disconnected' });
});

test('POST /api/auth/login is mounted, accepts email, and returns a token', async (context) => {
  const password = 'test-password';
  const passwordHash = await bcrypt.hash(password, 4);
  const user = {
    _id: '507f1f77bcf86cd799439011',
    username: 'test-user',
    email: 'test@example.com',
    password: passwordHash,
    role: 'USER',
  };
  const originalFindOne = User.findOne;
  let lookup;
  User.findOne = async (query) => {
    lookup = query;
    return user;
  };

  const server = app.listen(0);
  context.after(async () => {
    User.findOne = originalFindOne;
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });
  await new Promise((resolve) => server.once('listening', resolve));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ' Test@Example.com ', password }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(lookup, { email: 'test@example.com' });
  assert.equal(typeof body.token, 'string');
  assert.equal(body.user.username, 'test-user');
  assert.equal(body.user.profileComplete, false);
});

test('GET /api/auth/me returns a valid public profile and reports lookup failures', async (context) => {
  const originalFindById = User.findById;
  const user = {
    _id: '507f1f77bcf86cd799439011',
    username: 'new-user',
    email: 'new-user@example.com',
    publicId: null,
    password: 'must-not-be-returned',
    profileComplete: false,
    phoneNumber: '',
    country: '',
    gender: '',
    role: 'USER',
    async save(options) {
      assert.deepEqual(options, { validateModifiedOnly: true });
      this.publicId = 8849302;
    },
    toObject() {
      return { ...this };
    },
  };
  let lookupMode = 'found';
  User.findById = (id) => ({
    select: async (fields) => {
      assert.equal(id, user._id);
      assert.equal(fields, '-password');
      if (lookupMode === 'failed') throw new Error('database details must not reach the client');
      return lookupMode === 'missing' ? null : user;
    },
  });

  const server = app.listen(0);
  context.after(async () => {
    User.findById = originalFindById;
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });
  await new Promise((resolve) => server.once('listening', resolve));

  const url = `http://127.0.0.1:${server.address().port}/api/auth/me`;
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
  const headers = { Authorization: 'Bearer ' + token };

  const unauthenticated = await fetch(url);
  assert.equal(unauthenticated.status, 401);

  const response = await fetch(url, { headers });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.user.username, user.username);
  assert.equal(body.user.publicId, null);
  assert.equal(body.user.profileComplete, false);
  assert.equal(body.user.id, user._id);
  assert.equal(Object.hasOwn(body.user, 'password'), false);
  assert.equal(body.user.wealthLevel.level, 1);
  assert.equal(body.user.charmLevel.level, 1);

  lookupMode = 'missing';
  const missingResponse = await fetch(url, { headers });
  assert.equal(missingResponse.status, 404);

  lookupMode = 'failed';
  const failedResponse = await fetch(url, { headers });
  assert.equal(failedResponse.status, 500);
  assert.deepEqual(await failedResponse.json(), {
    error: 'Could not load your profile. Please try again.',
  });
});

test('GET /api/users/me and /api/users/:id return profile details and linked agency names', async (context) => {
  const originalFindById = User.findById;
  const originalRoomFindOne = Room.findOne;
  const user = {
    _id: '507f1f77bcf86cd799439011',
    publicId: 8849302,
    username: 'profile-user',
    profileComplete: false,
    gender: 'Female',
    country: 'Ethiopia',
    agencyName: 'Old Agency Name',
    agencyId: { _id: '507f1f77bcf86cd799439013', agencyName: 'Primary Agency', name: 'Primary Agency' },
    wealthLevel: 3,
    charmLevel: 4,
    role: 'HOST',
    isHost: true,
    toObject() {
      return { ...this };
    },
  };
  User.findById = (id) => {
    assert.equal(id, user._id);
    return {
      select(fields) {
        assert.ok(['-password', '-password -googleId'].includes(fields));
        return this;
      },
      populate(path, fields) {
        assert.equal(path, 'agencyId');
        assert.equal(fields, 'name agencyName');
        return Promise.resolve(user);
      },
    };
  };
  Room.findOne = () => ({
    sort() {
      return this;
    },
    select: async () => null,
  });

  const server = app.listen(0);
  context.after(async () => {
    User.findById = originalFindById;
    Room.findOne = originalRoomFindOne;
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });
  await new Promise((resolve) => server.once('listening', resolve));

  const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET);
  const headers = { Authorization: `Bearer ${token}` };
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/users`;

  for (const path of ['/me', `/${user._id}`]) {
    const response = await fetch(`${baseUrl}${path}`, { headers });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.gender, 'Female');
    assert.equal(body.country, 'Ethiopia');
    assert.equal(body.agencyName, 'Primary Agency');
    assert.equal(body.agencyId._id, '507f1f77bcf86cd799439013');
    assert.equal(body.agencyStatus, 'APPROVED');
    assert.equal(body.isHost, true);
    assert.equal(body.role, 'HOST');
    assert.equal(body.wealthLevel, 3);
    assert.equal(body.charmLevel, 4);
  }
});

test('CORS allows the deployed frontend origin', async (context) => {
  const server = app.listen(0);
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await new Promise((resolve) => server.once('listening', resolve));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://meso-live-v2.onrender.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });

  assert.equal(response.headers.get('access-control-allow-origin'), 'https://meso-live-v2.onrender.com');
});

test('Agency Center endpoints require authentication', async (context) => {
  const server = app.listen(0);
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await new Promise((resolve) => server.once('listening', resolve));

  for (const path of [
    '/api/agency/center',
    '/api/agency/commission',
    '/api/agency/host-revenue',
    '/api/agency/sub-revenue',
    '/api/agency/invite-links',
  ]) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
    assert.equal(response.status, 401, `${path} should require a bearer token`);
  }
});

test('POST /api/withdraw/request validates inputs and reserves diamonds atomically', async (context) => {
  const originalStartSession = mongoose.startSession;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const originalCreateWithdrawal = Withdrawal.create;
  const originalCreateTransaction = Transaction.create;
  const user = {
    _id: '507f1f77bcf86cd799439011',
    role: 'HOST',
    diamonds: 1_000_000,
  };
  let filter;
  let update;
  let createdWithdrawal;
  mongoose.startSession = async () => ({
    withTransaction: async (callback) => callback(),
    endSession: async () => {},
  });
  User.findOneAndUpdate = async (query, changes) => {
    filter = query;
    update = changes;
    return user;
  };
  Withdrawal.create = async ([data]) => [{
    ...data,
    _id: '507f1f77bcf86cd799439013',
    status: 'PENDING',
  }];
  Transaction.create = async (data) => {
    createdWithdrawal = data;
    return data;
  };

  const server = app.listen(0);
  context.after(async () => {
    mongoose.startSession = originalStartSession;
    User.findOneAndUpdate = originalFindOneAndUpdate;
    Withdrawal.create = originalCreateWithdrawal;
    Transaction.create = originalCreateTransaction;
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });
  await new Promise((resolve) => server.once('listening', resolve));

  const token = jwt.sign({ id: user._id, role: 'HOST' }, process.env.JWT_SECRET);
  const url = `http://127.0.0.1:${server.address().port}/api/withdraw/request`;
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const belowMinimum = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      amountDiamonds: 999_999,
      method: 'CBE',
      accountDetails: 'CBE account',
    }),
  });
  assert.equal(belowMinimum.status, 400);

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      amountDiamonds: 1_000_000,
      method: 'TELEBIRR',
      accountDetails: ' +251900000000 ',
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.deepEqual(filter, { _id: user._id, role: 'HOST', diamonds: { $gte: 1_000_000 } });
  assert.deepEqual(update, { $inc: { diamonds: -1_000_000 } });
  assert.equal(body.withdrawal.amountUsd, 10);
  assert.equal(body.withdrawal.method, 'TELEBIRR');
  assert.equal(body.withdrawal.accountDetails, '+251900000000');
  assert.equal(body.withdrawal.status, 'PENDING');
  assert.equal(createdWithdrawal[0].status, 'PENDING');
});

test('POST /api/auth/google verifies an ID token and issues a backend JWT', async (context) => {
  const originalVerifyIdToken = OAuth2Client.prototype.verifyIdToken;
  const originalFindOne = User.findOne;
  const user = {
    _id: '507f1f77bcf86cd799439011',
    username: 'google-user',
    email: 'google@example.com',
    googleId: 'google-subject',
    password: 'unused',
    role: 'HOST',
    avatar: '',
    isVerified: false,
    isFaceVerified: false,
    save: async () => {},
  };
  let audience;
  OAuth2Client.prototype.verifyIdToken = async ({ audience: actualAudience }) => {
    audience = actualAudience;
    return {
      getPayload: () => ({
        sub: 'google-subject',
        email: 'Google@Example.com',
        email_verified: true,
        name: 'Google User',
      }),
    };
  };
  User.findOne = async () => user;

  const server = app.listen(0);
  context.after(async () => {
    OAuth2Client.prototype.verifyIdToken = originalVerifyIdToken;
    User.findOne = originalFindOne;
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });
  await new Promise((resolve) => server.once('listening', resolve));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: 'mock-google-id-token' }),
  });
  const body = await response.json();
  const decodedToken = jwt.verify(body.token, process.env.JWT_SECRET);

  assert.equal(response.status, 200);
  assert.equal(audience, process.env.GOOGLE_CLIENT_ID);
  assert.equal(decodedToken.id, user._id);
  assert.equal(decodedToken.username, user.username);
  assert.equal(body.user.email, user.email);
  assert.equal(user.isVerified, false);
  assert.equal(user.isFaceVerified, false);
});

test('POST /api/auth/google creates a passwordless user for a new verified Google identity', async (context) => {
  const originalVerifyIdToken = OAuth2Client.prototype.verifyIdToken;
  const originalFindOne = User.findOne;
  const originalCreate = User.create;
  let createdUser;
  OAuth2Client.prototype.verifyIdToken = async () => ({
    getPayload: () => ({
      sub: 'new-google-subject',
      email: 'New.User@example.com',
      email_verified: true,
      name: 'New User',
      picture: 'https://example.com/google-picture.png',
    }),
  });
  User.findOne = async () => null;
  User.create = async (data) => {
    createdUser = { _id: '507f1f77bcf86cd799439014', ...data };
    return createdUser;
  };

  const server = app.listen(0);
  context.after(async () => {
    OAuth2Client.prototype.verifyIdToken = originalVerifyIdToken;
    User.findOne = originalFindOne;
    User.create = originalCreate;
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });
  await new Promise((resolve) => server.once('listening', resolve));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: 'mock-new-google-id-token' }),
  });
  const body = await response.json();
  const decodedToken = jwt.verify(body.token, process.env.JWT_SECRET);

  assert.equal(response.status, 200);
  assert.equal(decodedToken.id, createdUser._id);
  assert.equal(createdUser.googleId, 'new-google-subject');
  assert.equal(createdUser.email, 'new.user@example.com');
  assert.equal(createdUser.name, 'New User');
  assert.equal(createdUser.profilePicture, 'https://example.com/google-picture.png');
  assert.equal(createdUser.role, 'USER');
  assert.equal(createdUser.profileComplete, false);
  assert.equal(createdUser.password, undefined);
  assert.equal(body.user.profilePicture, 'https://example.com/google-picture.png');
});

test('POST /api/auth/link-google links a verified Google identity to the current account', async (context) => {
  const originalVerifyIdToken = OAuth2Client.prototype.verifyIdToken;
  const originalFindById = User.findById;
  const originalFindOne = User.findOne;
  const user = {
    _id: '507f1f77bcf86cd799439011',
    username: 'existing-host',
    email: 'host@example.com',
    googleId: null,
    role: 'HOST',
    profileComplete: true,
    save: async () => {},
  };
  OAuth2Client.prototype.verifyIdToken = async () => ({
    getPayload: () => ({
      sub: 'host-google-subject',
      email: 'host@example.com',
      email_verified: true,
      name: 'Existing Host',
      picture: 'https://example.com/host-picture.png',
    }),
  });
  User.findById = async () => user;
  User.findOne = async () => null;

  const server = app.listen(0);
  context.after(async () => {
    OAuth2Client.prototype.verifyIdToken = originalVerifyIdToken;
    User.findById = originalFindById;
    User.findOne = originalFindOne;
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });
  await new Promise((resolve) => server.once('listening', resolve));

  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/link-google`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ credential: 'mock-host-google-id-token' }),
  });
  const body = await response.json();
  const decodedToken = jwt.verify(body.token, process.env.JWT_SECRET);

  assert.equal(response.status, 200);
  assert.equal(user.googleId, 'host-google-subject');
  assert.equal(user.profilePicture, 'https://example.com/host-picture.png');
  assert.equal(body.user.role, 'HOST');
  assert.equal(body.user.profileComplete, true);
  assert.equal(decodedToken.id, user._id);
});

test('PUT /api/users/profile validates, checks uniqueness, and completes a profile', async (context) => {
  const originalFindOne = User.findOne;
  const originalFindById = User.findById;
  const user = {
    _id: '507f1f77bcf86cd799439011',
    username: 'google-user',
    password: 'do-not-return-this',
    avatar: 'https://example.com/google-picture.png',
    profilePicture: 'https://example.com/google-picture.png',
    profileComplete: false,
    role: 'HOST',
    isVerified: false,
    isFaceVerified: false,
    save: async () => {},
    toJSON() {
      return {
        _id: this._id,
        username: this.username,
        phoneNumber: this.phoneNumber,
        country: this.country,
        gender: this.gender,
        bio: this.bio,
        avatar: this.avatar,
        profilePicture: this.profilePicture,
        profileComplete: this.profileComplete,
        isVerified: this.isVerified,
        isFaceVerified: this.isFaceVerified,
        password: this.password,
      };
    },
  };
  let lookup;
  User.findOne = (query) => ({
    select: async () => {
      lookup = query;
      return null;
    },
  });
  User.findById = async () => user;

  const server = app.listen(0);
  context.after(async () => {
    User.findOne = originalFindOne;
    User.findById = originalFindById;
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });
  await new Promise((resolve) => server.once('listening', resolve));

  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
  const url = `http://127.0.0.1:${server.address().port}/api/users/profile`;
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const availabilityResponse = await fetch(
    `http://127.0.0.1:${server.address().port}/api/users/username-availability?username=new-user`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  assert.equal(availabilityResponse.status, 200);
  assert.deepEqual(await availabilityResponse.json(), { available: true });
  assert.deepEqual(lookup, { username: 'new-user', _id: { $ne: user._id } });

  const profile = {
    username: ' new-user ',
    phoneNumber: ' +12025550123 ',
    country: ' United States ',
    gender: 'Other',
    bio: ' A short bio ',
    isVerified: true,
    isFaceVerified: true,
  };

  const missingFieldResponse = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ username: 'new-user' }),
  });
  assert.equal(missingFieldResponse.status, 400);

  const successResponse = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify(profile),
  });
  const successBody = await successResponse.json();

  assert.equal(successResponse.status, 200);
  assert.deepEqual(lookup, { username: 'new-user', _id: { $ne: user._id } });
  assert.equal(user.username, 'new-user');
  assert.equal(user.phoneNumber, '+12025550123');
  assert.equal(user.country, 'United States');
  assert.equal(user.gender, 'Other');
  assert.equal(user.bio, 'A short bio');
  assert.equal(user.profilePicture, 'https://example.com/google-picture.png');
  assert.equal(user.profileComplete, true);
  assert.equal(user.isVerified, false);
  assert.equal(user.isFaceVerified, false);
  assert.equal(successBody.user.isVerified, false);
  assert.equal(successBody.user.isFaceVerified, false);
  assert.equal(successBody.user.profileComplete, true);
  assert.equal('password' in successBody.user, false);
});

test('PUT /api/users/avatar requires authentication and persists a validated image', async (context) => {
  const originalFindById = User.findById;
  const user = {
    _id: '507f1f77bcf86cd799439011',
    username: 'avatar-user',
    avatar: '',
    profilePicture: '',
    password: 'must-not-be-returned',
    save: async () => {},
    toJSON() {
      return { ...this };
    },
  };
  let lookupCount = 0;
  User.findById = async (id) => {
    lookupCount += 1;
    assert.equal(id, user._id);
    return user;
  };

  const server = app.listen(0);
  context.after(async () => {
    User.findById = originalFindById;
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });
  await new Promise((resolve) => server.once('listening', resolve));

  const url = `http://127.0.0.1:${server.address().port}/api/users/avatar`;
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const unauthenticated = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ avatar: 'data:image/jpeg;base64,/9j/AA==' }),
  });
  assert.equal(unauthenticated.status, 401);
  assert.equal(lookupCount, 0);

  const invalid = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ avatar: 'data:image/svg+xml;base64,PHN2Zz4=' }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(lookupCount, 0);

  const avatar = 'data:image/jpeg;base64,/9j/AA==';
  const response = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ avatar }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(user.avatar, avatar);
  assert.equal(user.profilePicture, avatar);
  assert.equal(body.user.avatar, avatar);
  assert.equal('password' in body.user, false);
});

test('PUT /api/users/profile rejects a username already owned by another account', async (context) => {
  const originalFindOne = User.findOne;
  const originalFindById = User.findById;
  User.findOne = () => ({
    select: async () => ({ _id: '507f1f77bcf86cd799439012' }),
  });
  User.findById = async () => {
    throw new Error('Profile must not be modified when the username is taken.');
  };

  const server = app.listen(0);
  context.after(async () => {
    User.findOne = originalFindOne;
    User.findById = originalFindById;
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });
  await new Promise((resolve) => server.once('listening', resolve));

  const token = jwt.sign({ id: '507f1f77bcf86cd799439011' }, process.env.JWT_SECRET);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/users`;
  const headers = { Authorization: 'Bearer ' + token };
  const availabilityResponse = await fetch(
    `${baseUrl}/username-availability?username=taken-name`,
    { headers }
  );
  assert.equal(availabilityResponse.status, 200);
  assert.deepEqual(await availabilityResponse.json(), { available: false });

  const response = await fetch(`${baseUrl}/profile`, {
    method: 'PUT',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username: 'taken-name',
      phoneNumber: '+12025550123',
      country: 'United States',
      gender: 'Female',
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.message, 'That username is already taken.');
});

