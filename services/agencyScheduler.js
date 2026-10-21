const AgencyAgentApplication = require('../models/AgencyAgentApplication');
const AgencyApplication = require('../models/AgencyApplication');
const { approveAgencyAgentApplication } = require('./agencyAgentApprovalService');
const { releaseHostFromAgency } = require('./agencyReleaseService');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function runAgencyScheduler(now = new Date()) {
  const cutoff = new Date(now.getTime() - SEVEN_DAYS_MS);
  const agentApplications = await AgencyAgentApplication.find({
    approvalType: 'AGENT',
    status: 'PENDING',
    createdAt: { $lte: cutoff },
  }).select('_id');
  const leaveApplications = await AgencyApplication.find({
    applicationType: 'EXIT',
    status: 'PENDING',
    createdAt: { $lte: cutoff },
  });

  let autoApprovedAgents = 0;
  let autoReleasedHosts = 0;
  for (const application of agentApplications) {
    try {
      await approveAgencyAgentApplication(application._id);
      autoApprovedAgents += 1;
    } catch (error) {
      console.error(`Could not auto-approve stale Agent application ${application._id}:`, error);
    }
  }
  for (const application of leaveApplications) {
    try {
      if (await releaseHostFromAgency(application._id, null, now)) autoReleasedHosts += 1;
    } catch (error) {
      console.error(`Could not auto-release host for stale agency request ${application._id}:`, error);
    }
  }
  return { autoApprovedAgents, autoReleasedHosts };
}

function startAgencyScheduler() {
  const run = () => runAgencyScheduler().catch((error) => {
    console.error('Agency scheduler run failed:', error);
  });
  run();
  const timer = setInterval(run, DAILY_INTERVAL_MS);
  timer.unref();
  return timer;
}

module.exports = { runAgencyScheduler, startAgencyScheduler };
