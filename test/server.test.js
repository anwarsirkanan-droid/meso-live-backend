const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

process.env.JWT_SECRET ||= 'test-jwt-secret-that-is-long-enough-for-production';
process.env.GOOGLE_CLIENT_ID ||= 'test-google-client-id.apps.googleusercontent.com';

const User = require('../models/User');
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

test('POST /api/auth/google verifies an ID token and issues a backend JWT', async (context) => {
  const originalVerifyIdToken = OAuth2Client.prototype.verifyIdToken;
  const originalFindOne = User.findOne;
  const user = {
    _id: '507f1f77bcf86cd799439011',
    username: 'google-user',
    email: 'google@example.com',
    googleId: 'google-subject',
    password: 'unused',
    role: 'USER',
    avatar: '',
    isVerified: false,
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
});
