const crypto = require('crypto');
const mongoose = require('mongoose');
const Agency = require('../models/Agency');
const AgencyAgentApplication = require('../models/AgencyAgentApplication');
const User = require('../models/User');

async function approveAgencyAgentApplication(applicationId, reviewerId = null) {
  const session = await mongoose.startSession();
  let approvedApplication;

  try {
    await session.withTransaction(async () => {
      const application = await AgencyAgentApplication.findOne({
        _id: applicationId,
        status: 'PENDING',
      }).session(session);
      if (!application) {
        const error = new Error('Pending agent application not found.');
        error.status = 404;
        throw error;
      }

      const user = await User.findById(application.applicantId).session(session);
      if (!user) {
        const error = new Error('Applicant not found.');
        error.status = 404;
        throw error;
      }
      if (user.role === 'AGENT' || user.isAgent) {
        const error = new Error('This user is already an Agent.');
        error.status = 409;
        throw error;
      }
      if (application.currentAgencyId &&
          (!user.agencyId || !user.agencyId.equals(application.currentAgencyId))) {
        const error = new Error('The applicant is no longer a member of the requesting agency.');
        error.status = 409;
        throw error;
      }
      if (!application.currentAgencyId && user.agencyId) {
        const error = new Error('The applicant already belongs to an agency.');
        error.status = 409;
        throw error;
      }
      if (await Agency.exists({ ownerId: user._id }).session(session)) {
        const error = new Error('The applicant already owns an agency.');
        error.status = 409;
        throw error;
      }

      const escapedName = application.agencyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const existingAgency = await Agency.findOne({
        $or: [
          { agencyName: { $regex: `^${escapedName}$`, $options: 'i' } },
          { name: { $regex: `^${escapedName}$`, $options: 'i' } },
        ],
      }).session(session);
      if (existingAgency) {
        const error = new Error('Agency name is already in use.');
        error.status = 409;
        throw error;
      }

      const agencyCode = `AG${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
      const [agency] = await Agency.create([{
        ownerId: user._id,
        agencyName: application.agencyName,
        agencyCode,
        name: application.agencyName,
        parentAgentId: application.currentAgencyId || null,
        members: [user._id],
      }], { session });

      if (application.currentAgencyId) {
        const currentAgency = await Agency.findById(application.currentAgencyId).session(session);
        if (!currentAgency) {
          const error = new Error('The applicant’s current agency no longer exists.');
          error.status = 409;
          throw error;
        }
        currentAgency.members.pull(user._id);
        currentAgency.hostsCount = Math.max(0, (currentAgency.hostsCount || 0) - 1);
        await currentAgency.save({ session });
      }

      user.agencyId = agency._id;
      user.agencyName = agency.name;
      user.role = 'AGENT';
      user.isAgent = true;
      user.isHost = false;
      await user.save({ session });

      application.status = 'APPROVED';
      application.reviewedBy = reviewerId;
      application.reviewedAt = new Date();
      await application.save({ session });
      approvedApplication = application;
    });
  } finally {
    await session.endSession();
  }

  return approvedApplication;
}

module.exports = { approveAgencyAgentApplication };
