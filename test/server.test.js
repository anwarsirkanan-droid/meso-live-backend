const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

process.env.JWT_SECRET ||= 'test-jwt-secret-that-is-long-enough-for-production';

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
