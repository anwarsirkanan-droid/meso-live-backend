const mongoose = require('mongoose');
const Agency = require('../models/Agency');
const AgencyApplication = require('../models/AgencyApplication');
const User = require('../models/User');

async function releaseHostFromAgency(applicationId, reviewerId = null, reviewedAt = new Date()) {
  const session = await mongoose.startSession();
  let released = false;

  try {
    await session.withTransaction(async () => {
      const application = await AgencyApplication.findOne({
        _id: applicationId,
        applicationType: 'EXIT',
        status: 'PENDING',
      }).session(session);
      if (!application) {
        const error = new Error('Pending agency release request not found.');
        error.status = 404;
        throw error;
      }

      const host = await User.findOneAndUpdate({
        _id: application.applicantId,
        agencyId: application.agencyId,
        role: { $ne: 'AGENT' },
        isAgent: { $ne: true },
      }, {
        $set: { agencyId: null, agencyName: '' },
      }, { new: true, session });

      if (!host) {
        application.status = 'REJECTED';
        application.reviewedBy = reviewerId;
        application.reviewedAt = reviewedAt;
        await application.save({ session });
        return;
      }

      const agency = await Agency.findById(application.agencyId).session(session);
      if (!agency) throw new Error('The host agency could not be found.');
      agency.members.pull(host._id);
      agency.hostsCount = Math.max(0, (agency.hostsCount || 0) - 1);
      await agency.save({ session });

      application.status = 'APPROVED';
      application.reviewedBy = reviewerId;
      application.reviewedAt = reviewedAt;
      await application.save({ session });
      released = true;
    });
  } finally {
    await session.endSession();
  }

  return released;
}

module.exports = { releaseHostFromAgency };
