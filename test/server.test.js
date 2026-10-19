const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const mongoose = require('mongoose');

process.env.JWT_SECRET ||= 'test-jwt-secret-that-is-long-enough-for-production';
process.env.GOOGLE_CLIENT_ID ||= 'test-google-client-id.apps.googleusercontent.com';

const User = require('../models/User');
const Withdrawal = require('../models/Withdrawal');
const Transaction = require('../models/Transaction');
const { app } = require('../server');

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

test('CORS allows the deployed frontend origin', async (context) => {
  const server = app.listen(0);
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await new Promise((resolve) => server.once('listening', resolve));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://meso-live-frontend.onrender.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });

  assert.equal(response.headers.get('access-control-allow-origin'), 'https://meso-live-frontend.onrender.com');
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
  const headers = { Authorization: `Bearer ${token}` };
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
