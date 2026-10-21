const test = require('node:test');
const assert = require('node:assert/strict');
const AgencyAgentApplication = require('../models/AgencyAgentApplication');
const AgencyApplication = require('../models/AgencyApplication');
const agencyRoutes = require('../routes/agencyRoutes');
const auth = require('../middleware/auth');
const { runAgencyScheduler, startAgencyScheduler } = require('../services/agencyScheduler');

const applicantId = '507f1f77bcf86cd799439011';
const agencyId = '507f1f77bcf86cd799439012';

test('agent applications require proof only for admin review and retain pending status', async () => {
  const agentReview = new AgencyAgentApplication({
    applicantId,
    currentAgencyId: agencyId,
    agencyName: 'Agent Review Agency',
    phoneNumber: '123456789',
    description: 'Agency proposal for the current Agent',
    approvalType: 'AGENT',
  });
  await agentReview.validate();
  assert.equal(agentReview.status, 'PENDING');
  assert.equal(agentReview.experience, '');

  const adminReview = new AgencyAgentApplication({
    applicantId,
    agencyName: 'Admin Review Agency',
    phoneNumber: '123456789',
    experience: 'Experienced agent',
    approvalType: 'ADMIN',
  });
  await assert.rejects(adminReview.validate(), /proofImage|proofMimeType/);
  adminReview.proofImage = Buffer.from('image');
  adminReview.proofMimeType = 'image/png';
  await adminReview.validate();

  assert.equal(AgencyApplication.schema.path('agencyId').isRequired, true);
  assert.deepEqual(AgencyApplication.schema.path('applicationType').enumValues, ['HOST', 'SUB_AGENCY', 'EXIT']);
});

test('agency workflow endpoints are registered behind authentication', () => {
  const expectedRoutes = [
    ['post', '/join'],
    ['post', '/apply'],
    ['post', '/leave-request'],
    ['get', '/agent-applications'],
    ['post', '/agent-applications/approve'],
    ['get', '/admin/agent-applications'],
    ['post', '/admin/agent-applications/approve'],
  ];

  for (const [method, path] of expectedRoutes) {
    const route = agencyRoutes.stack.find((layer) =>
      layer.route && layer.route.path === path && layer.route.methods[method]
    );
    assert.ok(route, `Expected ${method.toUpperCase()} ${path}`);
    assert.equal(route.route.stack[0].handle, auth);
  }
});

test('agency scheduler exposes daily processing and startup entry points', () => {
  assert.equal(typeof runAgencyScheduler, 'function');
  assert.equal(typeof startAgencyScheduler, 'function');
});
