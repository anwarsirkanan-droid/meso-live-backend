const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const router = express.Router();
const Agency = require('../models/Agency');
const AgencyInvitation = require('../models/AgencyInvitation');
const AgencyApplication = require('../models/AgencyApplication');
const AgencyAgentApplication = require('../models/AgencyAgentApplication');
const User = require('../models/User');
const HostTarget = require('../models/HostTarget');
const HostDailyProgress = require('../models/HostDailyProgress');
const Transaction = require('../models/Transaction');
const auth = require('../middleware/auth');
const commissionConfig = require('../config/commission');
const {
  getAgencyCenter,
  getAgencyGiftRevenue,
  getDayStartInAgencyTimeZone,
  getOrCreateInviteCodes,
} = require('../services/agencyCenterService');
const { approveAgencyAgentApplication } = require('../services/agencyAgentApprovalService');
const { releaseHostFromAgency } = require('../services/agencyReleaseService');

const uploadAgentProof = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return callback(new Error('Proof must be a JPEG, PNG, or WebP image.'));
    }
    return callback(null, true);
  },
});

function parseAgentProof(req, res, next) {
  uploadAgentProof.single('proof')(req, res, (error) => {
    if (error) return res.status(400).json({ message: error.message || 'Could not upload proof image.' });
    return next();
  });
}

async function requireAdmin(req, res, next) {
  try {
    const user = await User.findById(req.user.id).select('role');
    if (!user || user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Only MESO LIVE admins can review these applications.' });
    }
    return next();
  } catch (error) {
    return res.status(500).json({ message: 'Could not verify admin access.' });
  }
}

async function currentAgentAgency(userId) {
  const agent = await User.findById(userId).select('agencyId');
  return agent?.agencyId
    ? Agency.findById(agent.agencyId)
    : Agency.findOne({ ownerId: userId });
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function getUserAgency(userId) {
  const user = await User.findById(userId).select('agencyId');
  if (!user || !user.agencyId) return null;
  return Agency.findById(user.agencyId);
}

function getRevenueStart(period) {
  const now = new Date();
  if (period === 'today') return getDayStartInAgencyTimeZone(now);
  if (period === '30d') return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return null;
}

function validateApplicationMessage(message) {
  return message === undefined ||
    (typeof message === 'string' && message.trim().length <= 1000);
}

function currentMonth(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function monthStart(month) {
  return new Date(`${month}-01T00:00:00.000Z`);
}

function targetStatus(target) {
  return target.liveHoursCompleted >= target.liveHoursTarget &&
    target.diamondsEarned >= target.diamondTarget ? 'completed' : target.targetStatus;
}

async function getHostTargetProgress(hostId, agencyId, month = currentMonth()) {
  const target = await HostTarget.findOneAndUpdate(
    { hostId, month },
    { $setOnInsert: { hostId, agencyId, month } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  const start = monthStart(month);
  const [timeResult] = await HostDailyProgress.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(hostId), date: { $gte: month } } },
    { $group: { _id: null, seconds: { $sum: '$onMicSeconds' } } },
  ]);
  const [diamondResult] = await Transaction.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(hostId), type: 'GIFT_RECEIVED', status: 'COMPLETED', createdAt: { $gte: start } } },
    { $group: { _id: null, diamonds: { $sum: '$amountDiamonds' } } },
  ]);
  target.liveHoursCompleted = Number(((timeResult?.seconds || 0) / 3600).toFixed(2));
  target.diamondsEarned = diamondResult?.diamonds || 0;
  target.targetStatus = targetStatus(target);
  await target.save();
  return target;
}

function requireRole(role) {
  return async (req, res, next) => {
    const user = await User.findById(req.user.id).select('role isHost isAgent');
    const hasRole = role === 'HOST'
      ? user?.role === 'HOST' || user?.isHost === true
      : role === 'AGENT'
        ? user?.role === 'AGENT' || user?.isAgent === true
        : user?.role === role;
    if (!hasRole) return res.status(403).json({ message: `Only ${role} users can access this endpoint.` });
    return next();
  };
}

async function requireApprovedAgent(req, res, next) {
  try {
    const user = await User.findById(req.user.id).select('role isAgent');
    if (!user || (user.isAgent !== true && user.role !== 'AGENT')) {
      return res.status(403).json({ message: 'Access restricted to approved Agents only' });
    }
    return next();
  } catch (error) {
    return res.status(500).json({ message: 'Could not verify Agency Center access.' });
  }
}

router.post('/create', auth, requireRole('AGENT'), async (req, res) => {
  try {
    const agencyName = typeof req.body?.agencyName === 'string' ? req.body.agencyName.trim() : '';
    const agencyCode = typeof req.body?.agencyCode === 'string' ? req.body.agencyCode.trim().toUpperCase() : '';
    if (!agencyName || !agencyCode) return res.status(400).json({ message: 'agencyName and agencyCode are required.' });
    if (!/^[A-Z0-9_-]{4,24}$/.test(agencyCode)) return res.status(400).json({ message: 'agencyCode must contain 4 to 24 letters, numbers, underscores, or hyphens.' });
    if (await Agency.exists({ $or: [{ agencyName }, { agencyCode }] })) return res.status(409).json({ message: 'Agency name or agency code is already in use.' });
    const owner = await User.findById(req.user.id);
    if (!owner) return res.status(404).json({ message: 'User not found.' });
    if (owner.agencyId || await Agency.exists({ ownerId: owner._id })) return res.status(409).json({ message: 'You already belong to or own an agency.' });
    const agency = await Agency.create({ agencyName, agencyCode, name: agencyName, ownerId: owner._id, members: [owner._id], hostsCount: 0 });
    owner.agencyId = agency._id;
    await owner.save();
    return res.status(201).json({ message: 'Agency created successfully.', agency });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'Agency name or agency code is already in use.' });
    return res.status(500).json({ message: 'Could not create the agency.' });
  }
});

router.post('/join', auth, async (req, res) => {
  try {
    const agencyInput = typeof req.body?.agencyId === 'string' ? req.body.agencyId.trim() :
      typeof req.body?.agencyCode === 'string' ? req.body.agencyCode.trim() : '';
    if (!agencyInput) return res.status(400).json({ message: 'Agency ID or agency code is required.' });
    const agencyLookup = [{ agencyCode: agencyInput.toUpperCase() }, { code: agencyInput }];
    if (mongoose.Types.ObjectId.isValid(agencyInput)) agencyLookup.push({ _id: agencyInput });
    if (/^\d+$/.test(agencyInput)) {
      const owner = await User.findOne({ publicId: Number(agencyInput) }).select('_id');
      if (owner) agencyLookup.push({ ownerId: owner._id });
    }
    const [agency, host] = await Promise.all([
      Agency.findOne({ $or: agencyLookup }),
      User.findById(req.user.id)
    ]);
    if (!agency) return res.status(404).json({ message: 'Agency not found.' });
    if (!host) return res.status(404).json({ message: 'User not found.' });
    if (host.role === 'AGENT' || host.isAgent) return res.status(403).json({ message: 'Agents cannot join another agency as a host.' });
    if (host.agencyId) return res.status(409).json({ message: 'You already belong to an agency.' });
    host.agencyId = agency._id;
    host.isHost = true;
    if (!host.hostStartDate) host.hostStartDate = new Date();
    if (host.role === 'USER') host.role = 'HOST';
    await host.save();
    await Agency.findByIdAndUpdate(agency._id, { $addToSet: { members: host._id }, $inc: { hostsCount: 1 } });
    return res.json({ message: 'Successfully joined the agency.', agencyId: agency._id, user: { role: host.role, isHost: host.isHost, agencyId: host.agencyId, hostStartDate: host.hostStartDate } });
  } catch (error) {
    return res.status(500).json({ message: 'Could not join the agency.' });
  }
});

function agencyLookupForInput(value) {
  const input = typeof value === 'string' ? value.trim() : '';
  const lookup = [{ agencyCode: input.toUpperCase() }, { code: input }, { agencyName: input }, { name: input }];
  if (mongoose.Types.ObjectId.isValid(input)) lookup.push({ _id: input });
  return lookup;
}

router.post('/apply', auth, parseAgentProof, async (req, res) => {
  const agencyName = typeof req.body?.agencyName === 'string' ? req.body.agencyName.trim() : '';
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
  const experience = typeof req.body?.experience === 'string' ? req.body.experience.trim() : '';
  if (agencyName) {
    const phoneNumber = typeof req.body?.phoneNumber === 'string' ? req.body.phoneNumber.trim() : '';
    if (agencyName.length > 100) return res.status(400).json({ message: 'Agency name must be at most 100 characters.' });
    if (phoneNumber.length < 7 || phoneNumber.length > 40) return res.status(400).json({ message: 'A valid phone number or contact is required.' });

    try {
      const applicant = await User.findById(req.user.id).select('role isHost isAgent agencyId');
      if (!applicant) return res.status(404).json({ message: 'Applicant not found.' });
      if (applicant.role === 'AGENT' || applicant.isAgent) return res.status(409).json({ message: 'You are already an Agent.' });

      const isExistingHost = Boolean(applicant.agencyId);
      const applicationDescription = isExistingHost ? description : experience;
      if (!applicationDescription || applicationDescription.length > 2000) {
        return res.status(400).json({
          message: isExistingHost
            ? 'Agency description is required and must be at most 2000 characters.'
            : 'Experience description is required and must be at most 2000 characters.',
        });
      }
      if (!isExistingHost && !req.file) {
        return res.status(400).json({ message: 'Attach a screenshot proving your Agent experience.' });
      }

      const agencyNameExists = await Agency.exists({
        $or: [
          { agencyName: { $regex: `^${escapeRegex(agencyName)}$`, $options: 'i' } },
          { name: { $regex: `^${escapeRegex(agencyName)}$`, $options: 'i' } },
        ],
      });
      if (agencyNameExists) return res.status(409).json({ message: 'Agency name is already in use.' });
      const pendingNameExists = await AgencyAgentApplication.exists({
        agencyName: { $regex: `^${escapeRegex(agencyName)}$`, $options: 'i' },
        status: 'PENDING',
      });
      if (pendingNameExists) return res.status(409).json({ message: 'An application for this agency name is already pending.' });

      const application = await AgencyAgentApplication.create({
        applicantId: applicant._id,
        currentAgencyId: isExistingHost ? applicant.agencyId : null,
        agencyName,
        phoneNumber,
        description: applicationDescription,
        experience: isExistingHost ? '' : experience,
        approvalType: isExistingHost ? 'AGENT' : 'ADMIN',
        ...(req.file ? { proofImage: req.file.buffer, proofMimeType: req.file.mimetype } : {}),
      });
      return res.status(201).json({
        message: isExistingHost
          ? 'Agent application submitted to your current Agent.'
          : 'Agent application submitted to MESO LIVE Admin for review.',
        application: { _id: application._id, status: application.status, approvalType: application.approvalType },
      });
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ message: 'You already have a pending agent application.' });
      return res.status(500).json({ message: 'Could not submit the Agent application.' });
    }
  }

  const agencyInput = req.body?.agencyId || req.body?.agencyCode;
  const phoneNumber = typeof req.body?.phoneNumber === 'string' ? req.body.phoneNumber.trim() : '';
  if (typeof agencyInput !== 'string' || !agencyInput.trim()) return res.status(400).json({ message: 'Agent Name, Agency ID, or agency code is required.' });
  if (!phoneNumber || phoneNumber.length < 7) return res.status(400).json({ message: 'A valid host phone number or contact is required.' });
  try {
    const agencyLookup = agencyLookupForInput(agencyInput);
    if (/^\d+$/.test(agencyInput.trim())) {
      const agent = await User.findOne({ publicId: Number(agencyInput.trim()) }).select('_id');
      if (agent) agencyLookup.push({ ownerId: agent._id });
    }
    const [agency, host] = await Promise.all([
      Agency.findOne({ $or: agencyLookup }),
      User.findById(req.user.id).select('agencyId role isAgent isHost')
    ]);
    if (!agency) return res.status(404).json({ message: 'Agency not found.' });
    if (!host) return res.status(404).json({ message: 'Host not found.' });
    if (host.role === 'AGENT' || host.isAgent) return res.status(403).json({ message: 'Agents cannot join another agency as a host.' });
    if (host.agencyId) return res.status(409).json({ message: 'You already belong to an agency.' });
    const pendingApplication = await AgencyApplication.exists({
      applicantId: host._id,
      agencyId: agency._id,
      applicationType: 'HOST',
      status: 'PENDING',
    });
    if (pendingApplication) return res.status(409).json({ message: 'You already have a pending application for this agency.' });
    const application = await AgencyApplication.create({
      applicantId: host._id,
      agencyId: agency._id,
      applicationType: 'HOST',
      phoneNumber,
      status: 'PENDING',
    });
    return res.status(201).json({ message: 'Agency application submitted.', application });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'You already have a pending application for this agency.' });
    return res.status(500).json({ message: 'Could not submit the agency application.' });
  }
});

router.get('/requests', auth, requireRole('AGENT'), async (req, res) => {
  try {
    const agent = await User.findById(req.user.id).select('agencyId');
    const agency = agent?.agencyId ? await Agency.findById(agent.agencyId).select('_id') : await Agency.findOne({ ownerId: req.user.id }).select('_id');
    if (!agency) return res.status(404).json({ message: 'Agency not found.' });
    const applications = await AgencyApplication.find({ agencyId: agency._id, applicationType: { $in: ['HOST', 'EXIT'] }, status: 'PENDING' })
      .populate('applicantId', 'publicId username name avatar profilePicture phoneNumber')
      .sort({ createdAt: -1 });
    return res.json({ applications });
  } catch (error) {
    return res.status(500).json({ message: 'Could not load agency applications.' });
  }
});

router.post('/approve', auth, requireRole('AGENT'), async (req, res) => {
  const applicationId = typeof req.body?.applicationId === 'string' ? req.body.applicationId.trim() : '';
  if (!mongoose.Types.ObjectId.isValid(applicationId)) return res.status(400).json({ message: 'A valid application ID is required.' });
  try {
    const agent = await User.findById(req.user.id).select('agencyId');
    const agency = agent?.agencyId ? await Agency.findById(agent.agencyId) : await Agency.findOne({ ownerId: req.user.id });
    if (!agency) return res.status(404).json({ message: 'Agency not found.' });
    const application = await AgencyApplication.findOne({
      _id: applicationId,
      agencyId: agency._id,
      applicationType: { $in: ['HOST', 'EXIT'] },
      status: 'PENDING',
    });
    if (!application) return res.status(404).json({ message: 'Pending host application not found.' });
    if (application.applicationType === 'EXIT') {
      const released = await releaseHostFromAgency(application._id, req.user.id);
      if (!released) return res.status(409).json({ message: 'The host is no longer a member of your agency.' });
      return res.json({ message: 'Host release approved.', application: { _id: application._id, status: 'APPROVED' } });
    }
    const host = await User.findById(application.applicantId);
    if (!host) return res.status(404).json({ message: 'Applicant not found.' });
    if (host.agencyId && !host.agencyId.equals(agency._id)) return res.status(409).json({ message: 'This host already belongs to another agency.' });
    host.agencyId = agency._id;
    host.isHost = true;
    if (host.role === 'USER') host.role = 'HOST';
    if (!host.hostStartDate) host.hostStartDate = new Date();
    await host.save();
    application.status = 'APPROVED';
    application.reviewedBy = req.user.id;
    application.reviewedAt = new Date();
    await application.save();
    await Agency.findByIdAndUpdate(agency._id, { $addToSet: { members: host._id }, $inc: { hostsCount: 1 } });
    return res.json({ message: 'Host application approved.', application, user: { _id: host._id, agencyId: host.agencyId, role: host.role, isHost: host.isHost } });
  } catch (error) {
    return res.status(500).json({ message: 'Could not approve the host application.' });
  }
});

router.post('/reject', auth, requireRole('AGENT'), async (req, res) => {
  const applicationId = typeof req.body?.applicationId === 'string' ? req.body.applicationId.trim() : '';
  if (!mongoose.Types.ObjectId.isValid(applicationId)) return res.status(400).json({ message: 'A valid application ID is required.' });
  try {
    const agent = await User.findById(req.user.id).select('agencyId');
    const agency = agent?.agencyId ? await Agency.findById(agent.agencyId).select('_id') : await Agency.findOne({ ownerId: req.user.id }).select('_id');
    const application = agency && await AgencyApplication.findOneAndUpdate(
      { _id: applicationId, agencyId: agency._id, applicationType: { $in: ['HOST', 'EXIT'] }, status: 'PENDING' },
      { $set: { status: 'REJECTED', reviewedBy: req.user.id, reviewedAt: new Date() } },
      { new: true }
    );
    if (!application) return res.status(404).json({ message: 'Pending host application not found.' });
    return res.json({
      message: application.applicationType === 'EXIT' ? 'Host release request declined.' : 'Host application rejected.',
      application,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Could not reject the host application.' });
  }
});

router.post('/leave-request', auth, async (req, res) => {
  try {
    const host = await User.findById(req.user.id).select('agencyId role isAgent');
    if (!host || !host.agencyId) return res.status(400).json({ message: 'You are not currently in an agency.' });
    if (host.role === 'AGENT' || host.isAgent) return res.status(403).json({ message: 'Agents cannot submit a host release request.' });
    const agency = await Agency.findById(host.agencyId);
    if (!agency) return res.status(404).json({ message: 'Your agency could not be found.' });
    if (agency.ownerId.equals(host._id)) return res.status(403).json({ message: 'Agency owners must transfer ownership before leaving.' });

    const application = await AgencyApplication.create({
      applicantId: host._id,
      agencyId: agency._id,
      applicationType: 'EXIT',
      status: 'PENDING',
    });
    return res.status(201).json({
      message: 'Agency release request submitted for Agent approval.',
      application,
    });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'A release request is already pending.' });
    return res.status(500).json({ message: 'Could not submit the agency release request.' });
  }
});

router.get('/agent-applications', auth, requireRole('AGENT'), async (req, res) => {
  try {
    const agency = await currentAgentAgency(req.user.id);
    if (!agency) return res.status(404).json({ message: 'Agency not found.' });
    const applications = await AgencyAgentApplication.find({
      currentAgencyId: agency._id,
      approvalType: 'AGENT',
      status: 'PENDING',
    }).populate('applicantId', 'publicId username name avatar profilePicture phoneNumber')
      .sort({ createdAt: -1 });
    return res.json({ applications });
  } catch (error) {
    return res.status(500).json({ message: 'Could not load agent applications.' });
  }
});

router.post('/agent-applications/approve', auth, requireRole('AGENT'), async (req, res) => {
  const applicationId = typeof req.body?.applicationId === 'string' ? req.body.applicationId.trim() : '';
  if (!mongoose.Types.ObjectId.isValid(applicationId)) return res.status(400).json({ message: 'A valid application ID is required.' });
  try {
    const agency = await currentAgentAgency(req.user.id);
    if (!agency) return res.status(404).json({ message: 'Agency not found.' });
    const application = await AgencyAgentApplication.findOne({
      _id: applicationId,
      currentAgencyId: agency._id,
      approvalType: 'AGENT',
      status: 'PENDING',
    });
    if (!application) return res.status(404).json({ message: 'Pending agent application not found.' });
    await approveAgencyAgentApplication(application._id, req.user.id);
    return res.json({ message: 'Agent application approved.' });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.status ? error.message : 'Could not approve the agent application.' });
  }
});

router.post('/agent-applications/reject', auth, requireRole('AGENT'), async (req, res) => {
  const applicationId = typeof req.body?.applicationId === 'string' ? req.body.applicationId.trim() : '';
  if (!mongoose.Types.ObjectId.isValid(applicationId)) return res.status(400).json({ message: 'A valid application ID is required.' });
  try {
    const agency = await currentAgentAgency(req.user.id);
    if (!agency) return res.status(404).json({ message: 'Agency not found.' });
    const application = await AgencyAgentApplication.findOneAndUpdate({
      _id: applicationId,
      currentAgencyId: agency._id,
      approvalType: 'AGENT',
      status: 'PENDING',
    }, {
      $set: { status: 'REJECTED', reviewedBy: req.user.id, reviewedAt: new Date() },
    }, { new: true });
    if (!application) return res.status(404).json({ message: 'Pending agent application not found.' });
    return res.json({ message: 'Agent application rejected.' });
  } catch (error) {
    return res.status(500).json({ message: 'Could not reject the agent application.' });
  }
});

router.get('/invitations/pending', auth, async (req, res) => {
  try {
    const invitations = await AgencyInvitation.find({ inviteeId: req.user.id, status: 'PENDING' })
      .populate('agencyId', 'name agencyName agencyCode')
      .populate('agentId', 'publicId username name avatar profilePicture')
      .sort({ createdAt: -1 });
    return res.json(invitations);
  } catch (error) {
    return res.status(500).json({ message: 'Could not load agency invitations.' });
  }
});

router.post('/invitations/accept', auth, async (req, res) => {
  const invitationId = typeof req.body?.invitationId === 'string' ? req.body.invitationId.trim() : '';
  if (!mongoose.Types.ObjectId.isValid(invitationId)) return res.status(400).json({ message: 'A valid invitation ID is required.' });
  try {
    const invitation = await AgencyInvitation.findOne({ _id: invitationId, inviteeId: req.user.id, status: 'PENDING' });
    if (!invitation) return res.status(404).json({ message: 'Pending agency invitation not found.' });
    const [user, agency] = await Promise.all([User.findById(req.user.id), Agency.findById(invitation.agencyId)]);
    if (!user || !agency) return res.status(404).json({ message: 'User or agency not found.' });
    if (user.agencyId && !user.agencyId.equals(agency._id)) return res.status(409).json({ message: 'You already belong to another agency.' });
    user.agencyId = agency._id;
    user.isHost = true;
    if (!user.hostStartDate) user.hostStartDate = new Date();
    if (user.role === 'USER') user.role = 'HOST';
    await user.save();
    invitation.status = 'ACCEPTED';
    invitation.respondedAt = new Date();
    await invitation.save();
    await Agency.findByIdAndUpdate(agency._id, { $addToSet: { members: user._id }, $inc: { hostsCount: 1 } });
    return res.json({ message: 'Agency invitation accepted.', user: { role: user.role, isHost: user.isHost, agencyId: user.agencyId, hostStartDate: user.hostStartDate } });
  } catch (error) {
    return res.status(500).json({ message: 'Could not accept the agency invitation.' });
  }
});

router.post('/invitations/reject', auth, async (req, res) => {
  const invitationId = typeof req.body?.invitationId === 'string' ? req.body.invitationId.trim() : '';
  if (!mongoose.Types.ObjectId.isValid(invitationId)) return res.status(400).json({ message: 'A valid invitation ID is required.' });
  try {
    const invitation = await AgencyInvitation.findOneAndUpdate(
      { _id: invitationId, inviteeId: req.user.id, status: 'PENDING' },
      { $set: { status: 'REJECTED', respondedAt: new Date() } },
      { new: true }
    );
    if (!invitation) return res.status(404).json({ message: 'Pending agency invitation not found.' });
    return res.json({ message: 'Agency invitation declined.' });
  } catch (error) {
    return res.status(500).json({ message: 'Could not decline the agency invitation.' });
  }
});

router.get('/invitations/search', auth, requireRole('AGENT'), async (req, res) => {
  const publicId = String(req.query.publicId || '').trim();
  if (!/^\d{6,10}$/.test(publicId)) return res.status(400).json({ message: 'A valid user public ID is required.' });
  try {
    const user = await User.findOne({ publicId: Number(publicId) }).select('publicId username name avatar profilePicture agencyId role isHost');
    if (!user) return res.status(404).json({ message: 'User not found.' });
    return res.json({ user });
  } catch (error) {
    return res.status(500).json({ message: 'Could not search for the user.' });
  }
});

router.post('/invitations', auth, requireRole('AGENT'), async (req, res) => {
  const publicId = Number(req.body?.publicId);
  if (!Number.isInteger(publicId)) return res.status(400).json({ message: 'A valid user public ID is required.' });
  try {
    const agent = await User.findById(req.user.id).select('agencyId');
    if (!agent?.agencyId) return res.status(403).json({ message: 'You must belong to an agency before inviting hosts.' });
    const invitee = await User.findOne({ publicId });
    if (!invitee) return res.status(404).json({ message: 'User not found.' });
    if (invitee._id.equals(agent._id)) return res.status(400).json({ message: 'You cannot invite yourself.' });
    if (invitee.agencyId) return res.status(409).json({ message: 'This user already belongs to an agency.' });
    const invitation = await AgencyInvitation.create({ agencyId: agent.agencyId, agentId: agent._id, inviteeId: invitee._id });
    return res.status(201).json({ message: 'Host invitation sent.', invitation });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'A pending invitation already exists for this user.' });
    return res.status(500).json({ message: 'Could not send the host invitation.' });
  }
});

router.get('/search-user', auth, requireRole('AGENT'), async (req, res) => {
  const publicId = String(req.query.publicId || '').trim();
  if (!/^\d{6,10}$/.test(publicId)) return res.status(400).json({ message: 'A valid user public ID is required.' });
  try {
    const user = await User.findOne({ publicId: Number(publicId) })
      .select('publicId username name avatar profilePicture agencyId role isHost');
    if (!user) return res.status(404).json({ message: 'User not found.' });
    return res.json({ user });
  } catch (error) {
    return res.status(500).json({ message: 'Could not search for the user.' });
  }
});

router.post('/invite', auth, requireRole('AGENT'), async (req, res) => {
  const publicId = Number(req.body?.publicId);
  if (!Number.isInteger(publicId)) return res.status(400).json({ message: 'A valid user public ID is required.' });
  try {
    const agent = await User.findById(req.user.id).select('agencyId');
    if (!agent?.agencyId) return res.status(403).json({ message: 'You must belong to an agency before inviting hosts.' });
    const invitee = await User.findOne({ publicId });
    if (!invitee) return res.status(404).json({ message: 'User not found.' });
    if (invitee._id.equals(agent._id)) return res.status(400).json({ message: 'You cannot invite yourself.' });
    if (invitee.agencyId) return res.status(409).json({ message: 'This user already belongs to an agency.' });
    const invitation = await AgencyInvitation.create({ agencyId: agent.agencyId, agentId: agent._id, inviteeId: invitee._id });
    return res.status(201).json({ message: 'Host invitation sent.', invitation });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'A pending invitation already exists for this user.' });
    return res.status(500).json({ message: 'Could not send the host invitation.' });
  }
});

router.get('/dashboard', auth, requireRole('AGENT'), async (req, res) => {
  try {
    const agency = await Agency.findOne({ ownerId: req.user.id });
    if (!agency) return res.status(404).json({ message: 'Agency not found.' });
    const hosts = await User.find({ agencyId: agency._id, role: 'HOST' }).select('_id username name avatar profilePicture');
    const progress = await Promise.all(hosts.map((host) => getHostTargetProgress(host._id, agency._id)));
    const hostById = new Map(hosts.map((host) => [host._id.toString(), host]));
    return res.json({
      agency: { id: agency._id, agencyName: agency.agencyName || agency.name, agencyCode: agency.agencyCode, totalEarnings: agency.totalEarnings || 0, hostsCount: hosts.length },
      hosts: progress.map((target) => ({ host: hostById.get(target.hostId.toString()), target })),
      month: currentMonth(),
    });
  } catch (error) {
    return res.status(500).json({ message: 'Could not load the agency dashboard.' });
  }
});

router.get('/host/my-target', auth, requireRole('HOST'), async (req, res) => {
  try {
    const host = await User.findById(req.user.id).select('agencyId');
    if (!host?.agencyId) return res.status(404).json({ message: 'You are not a member of an agency.' });
    const target = await getHostTargetProgress(host._id, host.agencyId);
    return res.json({ month: target.month, target });
  } catch (error) {
    return res.status(500).json({ message: 'Could not load your host target.' });
  }
});

router.post('/commission/calculate', auth, requireRole('AGENT'), async (req, res) => {
  try {
    const agency = await Agency.findOne({ ownerId: req.user.id });
    if (!agency) return res.status(404).json({ message: 'Agency not found.' });
    const hosts = await User.find({ agencyId: agency._id, role: 'HOST' }).select('_id');
    const [result] = await Transaction.aggregate([
      { $match: { userId: { $in: hosts.map((host) => host._id) }, type: 'GIFT_RECEIVED', status: 'COMPLETED' } },
      { $group: { _id: null, totalGifts: { $sum: '$amountDiamonds' } } },
    ]);
    const totalGifts = result?.totalGifts || 0;
    const commissionRate = Number.isFinite(agency.commissionRate) ? (agency.commissionRate > 1 ? agency.commissionRate : agency.commissionRate * 100) : 10;
    const commissionAmount = Number((totalGifts * commissionRate / 100).toFixed(2));
    agency.totalEarnings = commissionAmount;
    await agency.save();
    return res.json({ agencyId: agency._id, totalGifts, commissionRate, commissionAmount, totalEarnings: agency.totalEarnings });
  } catch (error) {
    return res.status(500).json({ message: 'Could not calculate agency commission.' });
  }
});

router.get('/center', auth, requireApprovedAgent, async (req, res) => {
  try {
    const agency = await getUserAgency(req.user.id);
    if (!agency) return res.status(404).json({ message: 'You are not a member of an agency.' });
    const [center, inviteLinks] = await Promise.all([
      getAgencyCenter(agency),
      getOrCreateInviteCodes(agency),
    ]);
    return res.json({ ...center, inviteLinks });
  } catch (err) {
    return res.status(500).json({ message: 'Could not load the agency center.' });
  }
});

router.get('/commission', auth, requireApprovedAgent, async (req, res) => {
  try {
    const agency = await getUserAgency(req.user.id);
    if (!agency) return res.status(404).json({ message: 'You are not a member of an agency.' });
    return res.json({
      agencyId: agency._id,
      tier: agency.tier,
      rate: agency.commissionRate,
      yesterdayCommission: agency.yesterdayCommission || 0,
      protectionBonus: agency.protectionBonus || 0,
      rules: commissionConfig.AGENCY_TIERS,
    });
  } catch (err) {
    return res.status(500).json({ message: 'Could not load agency commission details.' });
  }
});

router.get('/host-revenue', auth, async (req, res) => {
  const period = req.query.period || '30d';
  if (!['today', '30d'].includes(period)) {
    return res.status(400).json({ message: 'period must be today or 30d.' });
  }
  try {
    const agency = await getUserAgency(req.user.id);
    if (!agency) return res.status(404).json({ message: 'You are not a member of an agency.' });
    const hosts = await User.find({ agencyId: agency._id, role: 'HOST' })
      .select('_id username avatar');
    const revenue = await getAgencyGiftRevenue(agency._id, getRevenueStart(period));
    return res.json({
      period,
      totalGiftRevenue: revenue,
      hosts: hosts.map((host) => ({ id: host._id, username: host.username, avatar: host.avatar })),
    });
  } catch (err) {
    return res.status(500).json({ message: 'Could not load host gift revenue.' });
  }
});

router.get('/sub-revenue', auth, requireApprovedAgent, async (req, res) => {
  const period = req.query.period || '30d';
  if (!['today', '30d'].includes(period)) {
    return res.status(400).json({ message: 'period must be today or 30d.' });
  }
  try {
    const agency = await getUserAgency(req.user.id);
    if (!agency) return res.status(404).json({ message: 'You are not a member of an agency.' });
    const subAgencies = await Agency.find({
      $or: [{ parentAgentId: agency._id }, { invitedByAgencyId: agency._id }],
    }).select('_id name tier');
    const startDate = getRevenueStart(period);
    const agencies = await Promise.all(subAgencies.map(async (subAgency) => ({
      id: subAgency._id,
      name: subAgency.name,
      tier: subAgency.tier,
      giftRevenue: await getAgencyGiftRevenue(subAgency._id, startDate),
    })));
    return res.json({
      period,
      totalGiftRevenue: agencies.reduce((total, subAgency) => total + subAgency.giftRevenue, 0),
      agencies,
    });
  } catch (err) {
    return res.status(500).json({ message: 'Could not load sub-agency gift revenue.' });
  }
});

router.get('/invite-links', auth, async (req, res) => {
  try {
    const agency = await getUserAgency(req.user.id);
    if (!agency) return res.status(404).json({ message: 'You are not a member of an agency.' });
    return res.json(await getOrCreateInviteCodes(agency));
  } catch (err) {
    return res.status(500).json({ message: 'Could not create agency invite links.' });
  }
});

router.post('/sub-apply', auth, async (req, res) => {
  const { parentAgencyId, message } = req.body || {};
  if (typeof parentAgencyId !== 'string' || !mongoose.Types.ObjectId.isValid(parentAgencyId)) {
    return res.status(400).json({ message: 'A valid parentAgencyId is required.' });
  }
  if (!validateApplicationMessage(message)) {
    return res.status(400).json({ message: 'message must be a string no longer than 1000 characters.' });
  }
  try {
    const [agency, parentAgency] = await Promise.all([
      Agency.findOne({ ownerId: req.user.id }),
      Agency.findById(parentAgencyId),
    ]);
    if (!agency) return res.status(403).json({ message: 'Only an agency owner can apply as a sub-agency.' });
    if (!parentAgency) return res.status(404).json({ message: 'Parent agency not found.' });
    if (agency._id.equals(parentAgency._id)) {
      return res.status(400).json({ message: 'An agency cannot apply to itself.' });
    }
    if (agency.parentAgentId || agency.invitedByAgencyId) {
      return res.status(409).json({ message: 'This agency already belongs to a parent agency.' });
    }
    const pendingApplication = await AgencyApplication.findOne({
      applicantId: req.user.id,
      agencyId: agency._id,
      applicationType: 'SUB_AGENCY',
      status: 'PENDING',
    });
    if (pendingApplication) {
      return res.status(409).json({ message: 'A sub-agency application is already pending.' });
    }
    const application = await AgencyApplication.create({
      applicantId: req.user.id,
      agencyId: agency._id,
      targetAgencyId: parentAgency._id,
      applicationType: 'SUB_AGENCY',
      message: typeof message === 'string' ? message.trim() : '',
    });
    return res.status(201).json({ message: 'Sub-agency application submitted.', application });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'A sub-agency application is already pending.' });
    }
    return res.status(500).json({ message: 'Could not submit the sub-agency application.' });
  }
});

router.post('/exit-apply', auth, async (req, res) => {
  const { message } = req.body || {};
  if (!validateApplicationMessage(message)) {
    return res.status(400).json({ message: 'message must be a string no longer than 1000 characters.' });
  }
  try {
    const agency = await Agency.findOne({ ownerId: req.user.id });
    if (!agency) return res.status(403).json({ message: 'Only an agency owner can apply to exit an agency.' });
    const pendingApplication = await AgencyApplication.findOne({
      applicantId: req.user.id,
      agencyId: agency._id,
      applicationType: 'EXIT',
      status: 'PENDING',
    });
    if (pendingApplication) {
      return res.status(409).json({ message: 'An agency exit application is already pending.' });
    }
    const application = await AgencyApplication.create({
      applicantId: req.user.id,
      agencyId: agency._id,
      applicationType: 'EXIT',
      message: typeof message === 'string' ? message.trim() : '',
    });
    return res.status(201).json({ message: 'Agency exit application submitted.', application });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'An agency exit application is already pending.' });
    }
    return res.status(500).json({ message: 'Could not submit the agency exit application.' });
  }
});

router.post('/create', auth, async (req, res) => {
  let session;
  try {
    session = await mongoose.startSession();
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 100) {
      return res.status(400).json({ message: 'Agency name is required and must be at most 100 characters' });
    }
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.agencyId) return res.status(400).json({ message: 'You are already in an agency' });
    if (await Agency.exists({ ownerId: req.user.id })) {
      return res.status(400).json({ message: 'You already own an agency' });
    }

    let agency;
    await session.withTransaction(async () => {
      [agency] = await Agency.create([{
        name,
        ownerId: user._id,
        members: [user._id]
      }], { session });
      user.agencyId = agency._id;
      user.role = 'AGENT';
      await user.save({ session });
    });
    res.status(201).json({ message: 'Agency created successfully', agency });
  } catch (err) {
    res.status(500).json({ message: err.message });
  } finally {
    if (session) await session.endSession();
  }
});

router.get('/my-agency', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('agencyId');
    if (!user || !user.agencyId) {
      return res.status(404).json({ message: 'You are not in any agency' });
    }
    const agency = await Agency.findById(user.agencyId)
      .populate('ownerId', 'username avatar charmPoints')
      .populate('members', 'username avatar charmPoints role');
    if (!agency) return res.status(404).json({ message: 'Agency not found' });
    res.json(agency);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/join/:agencyId', auth, async (req, res) => {
  let session;
  try {
    session = await mongoose.startSession();
    if (!mongoose.Types.ObjectId.isValid(req.params.agencyId)) {
      return res.status(400).json({ message: 'Invalid agency ID' });
    }
    const [agency, user] = await Promise.all([
      Agency.findById(req.params.agencyId),
      User.findById(req.user.id)
    ]);
    if (!agency) return res.status(404).json({ message: 'Agency not found' });
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.agencyId) {
      return res.status(400).json({
        message: user.agencyId.equals(agency._id) ? 'Already a member of this agency' : 'You are already in another agency'
      });
    }

    await session.withTransaction(async () => {
      agency.members.addToSet(user._id);
      await agency.save({ session });
      user.agencyId = agency._id;
      if (user.role === 'USER') user.role = 'HOST';
      await user.save({ session });
    });
    res.json({ message: 'Successfully joined agency', agency });
  } catch (err) {
    res.status(500).json({ message: err.message });
  } finally {
    if (session) await session.endSession();
  }
});

router.post('/leave', auth, async (req, res) => {
  let session;
  try {
    session = await mongoose.startSession();
    const user = await User.findById(req.user.id);
    if (!user || !user.agencyId) {
      return res.status(400).json({ message: 'You are not in any agency' });
    }
    const agency = await Agency.findById(user.agencyId);
    if (!agency) return res.status(404).json({ message: 'Agency not found' });
    if (agency.ownerId.equals(user._id)) {
      return res.status(400).json({ message: 'Agency owners cannot leave without transferring ownership' });
    }

    await session.withTransaction(async () => {
      agency.members.pull(user._id);
      await agency.save({ session });
      user.agencyId = null;
      await user.save({ session });
    });
    res.json({ message: 'Left agency successfully. Stats preserved.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  } finally {
    if (session) await session.endSession();
  }
});

router.get('/admin/agent-applications', auth, requireAdmin, async (req, res) => {
  try {
    const applications = await AgencyAgentApplication.find({
      approvalType: 'ADMIN',
      status: 'PENDING',
    }).populate('applicantId', 'publicId username name avatar profilePicture phoneNumber')
      .sort({ createdAt: -1 });
    return res.json({
      applications: applications.map((application) => ({
        ...application.toObject(),
        proofDataUrl: `data:${application.proofMimeType};base64,${application.proofImage.toString('base64')}`,
        proofImage: undefined,
      })),
    });
  } catch (error) {
    return res.status(500).json({ message: 'Could not load admin agent applications.' });
  }
});

router.post('/admin/agent-applications/approve', auth, requireAdmin, async (req, res) => {
  const applicationId = typeof req.body?.applicationId === 'string' ? req.body.applicationId.trim() : '';
  if (!mongoose.Types.ObjectId.isValid(applicationId)) return res.status(400).json({ message: 'A valid application ID is required.' });
  try {
    const application = await AgencyAgentApplication.findOne({
      _id: applicationId,
      approvalType: 'ADMIN',
      status: 'PENDING',
    }).select('_id');
    if (!application) return res.status(404).json({ message: 'Pending agent application not found.' });
    await approveAgencyAgentApplication(application._id, req.user.id);
    return res.json({ message: 'Agent application approved.' });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.status ? error.message : 'Could not approve the agent application.' });
  }
});

router.post('/admin/agent-applications/reject', auth, requireAdmin, async (req, res) => {
  const applicationId = typeof req.body?.applicationId === 'string' ? req.body.applicationId.trim() : '';
  if (!mongoose.Types.ObjectId.isValid(applicationId)) return res.status(400).json({ message: 'A valid application ID is required.' });
  try {
    const application = await AgencyAgentApplication.findOneAndUpdate({
      _id: applicationId,
      approvalType: 'ADMIN',
      status: 'PENDING',
    }, {
      $set: { status: 'REJECTED', reviewedBy: req.user.id, reviewedAt: new Date() },
    }, { new: true }).select('_id');
    if (!application) return res.status(404).json({ message: 'Pending agent application not found.' });
    return res.json({ message: 'Agent application rejected.' });
  } catch (error) {
    return res.status(500).json({ message: 'Could not reject the agent application.' });
  }
});

module.exports = router;
