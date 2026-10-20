const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Agency = require('../models/Agency');
const AgencyApplication = require('../models/AgencyApplication');
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
    const user = await User.findById(req.user.id).select('role');
    if (!user || user.role !== role) return res.status(403).json({ message: `Only ${role} users can access this endpoint.` });
    return next();
  };
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

router.post('/join', auth, requireRole('HOST'), async (req, res) => {
  try {
    const agencyCode = typeof req.body?.agencyCode === 'string' ? req.body.agencyCode.trim().toUpperCase() : '';
    if (!agencyCode) return res.status(400).json({ message: 'agencyCode is required.' });
    const [agency, host] = await Promise.all([Agency.findOne({ agencyCode }), User.findById(req.user.id)]);
    if (!agency) return res.status(404).json({ message: 'Agency not found for this agency code.' });
    if (!host) return res.status(404).json({ message: 'User not found.' });
    if (host.agencyId) return res.status(409).json({ message: 'You already belong to an agency.' });
    host.agencyId = agency._id;
    await host.save();
    await Agency.findByIdAndUpdate(agency._id, { $addToSet: { members: host._id }, $inc: { hostsCount: 1 } });
    return res.json({ message: 'Successfully joined the agency.', agencyId: agency._id });
  } catch (error) {
    return res.status(500).json({ message: 'Could not join the agency.' });
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

router.get('/center', auth, async (req, res) => {
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

router.get('/commission', auth, async (req, res) => {
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

router.get('/sub-revenue', auth, async (req, res) => {
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

module.exports = router;
