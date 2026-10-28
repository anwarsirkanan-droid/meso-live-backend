const test = require('node:test');
const assert = require('node:assert/strict');

const User = require('../models/User');
const AppSettings = require('../models/AppSettings');
const appSettingsRoutes = require('../routes/appSettingsRoutes');
const faceVerificationRoutes = require('../routes/faceVerificationRoutes');
const { requireAdmin, requireAdminOrAgent } = require('../middleware/adminAuth');

function createResponse() {
  const response = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  return response;
}

test('requireAdmin rejects missing, spoofed, and non-admin users', async (context) => {
  const originalFindById = User.findById;

  const missingResponse = createResponse();
  let nextCalled = false;
  await requireAdmin({ user: undefined }, missingResponse, () => {
    nextCalled = true;
  });
  assert.equal(missingResponse.statusCode, 401);
  assert.equal(nextCalled, false);

  User.findById = () => ({ select: async () => ({ role: 'USER' }) });
  context.after(() => {
    User.findById = originalFindById;
  });

  const spoofedRequest = { user: { id: '507f1f77bcf86cd799439011', role: 'ADMIN' } };
  const spoofedResponse = createResponse();
  nextCalled = false;
  await requireAdmin(spoofedRequest, spoofedResponse, () => {
    nextCalled = true;
  });
  assert.equal(spoofedResponse.statusCode, 403);
  assert.equal(nextCalled, false);

  User.findById = () => ({ select: async () => ({ role: 'USER' }) });
  const nonAdminResponse = createResponse();
  nextCalled = false;
  await requireAdmin({ user: { id: '507f1f77bcf86cd799439011', role: 'USER' } }, nonAdminResponse, () => {
    nextCalled = true;
  });
  assert.equal(nonAdminResponse.statusCode, 403);
  assert.equal(nextCalled, false);
});

test('requireAdmin allows a database-verified administrator', async (context) => {
  const originalFindById = User.findById;
  User.findById = () => ({ select: async () => ({ role: 'ADMIN' }) });
  context.after(() => {
    User.findById = originalFindById;
  });

  const req = { user: { id: '507f1f77bcf86cd799439011', role: 'USER' } };
  const res = createResponse();
  let nextCalled = false;
  await requireAdmin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 200);
  assert.equal(nextCalled, true);
  assert.equal(req.adminUser.role, 'ADMIN');
});

test('requireAdminOrAgent allows agents and admins but rejects ordinary users', async (context) => {
  const originalFindById = User.findById;

  for (const databaseRole of ['USER', null]) {
    User.findById = () => ({ select: async () => (databaseRole ? { role: databaseRole, isAgent: false } : null) });
    const req = { user: { id: '507f1f77bcf86cd799439011', role: 'ADMIN' } };
    const res = createResponse();
    let nextCalled = false;
    await requireAdminOrAgent(req, res, () => {
      nextCalled = true;
    });
    assert.equal(res.statusCode, databaseRole ? 403 : 401);
    assert.equal(nextCalled, false);
  }

  for (const databaseUser of [{ role: 'AGENT', isAgent: true }, { role: 'ADMIN', isAgent: false }]) {
    User.findById = () => ({ select: async () => databaseUser });
    const req = { user: { id: '507f1f77bcf86cd799439011', role: 'USER' } };
    const res = createResponse();
    let nextCalled = false;
    await requireAdminOrAgent(req, res, () => {
      nextCalled = true;
    });
    assert.equal(res.statusCode, 200);
    assert.equal(nextCalled, true);
  }

  User.findById = originalFindById;
});

test('app settings authorization uses the database role, not the JWT role', async (context) => {
  const originalFindById = User.findById;
  const originalFindByIdAndUpdate = AppSettings.findByIdAndUpdate;

  const route = appSettingsRoutes.stack.find((layer) =>
    layer.route && layer.route.path === '/' && layer.route.methods.put
  );
  assert.ok(route);
  assert.equal(route.route.stack.length, 3);

  const unauthorizedReq = {
    user: { id: '507f1f77bcf86cd799439011', role: 'ADMIN' },
    body: { appName: 'Unauthorized' },
  };
  const unauthorizedRes = createResponse();
  User.findById = () => ({ select: async () => ({ role: 'USER' }) });
  await route.route.stack[1].handle(unauthorizedReq, unauthorizedRes, () => {});
  assert.equal(unauthorizedRes.statusCode, 403);

  const authorizedReq = {
    user: { id: '507f1f77bcf86cd799439011', role: 'USER' },
    body: { appName: 'Authorized' },
  };
  const authorizedRes = createResponse();
  User.findById = () => ({ select: async () => ({ role: 'ADMIN' }) });
  AppSettings.findByIdAndUpdate = async () => ({ appName: 'Authorized' });
  context.after(() => {
    User.findById = originalFindById;
    AppSettings.findByIdAndUpdate = originalFindByIdAndUpdate;
  });

  await route.route.stack[1].handle(authorizedReq, authorizedRes, () => {});
  assert.equal(authorizedRes.statusCode, 200);
  await route.route.stack[2].handle(authorizedReq, authorizedRes, () => {});
  assert.equal(authorizedRes.statusCode, 200);
  assert.equal(authorizedRes.body.appName, 'Authorized');
});