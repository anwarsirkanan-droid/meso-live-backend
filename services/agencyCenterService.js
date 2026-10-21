const crypto = require('crypto');
const Agency = require('../models/Agency');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { AGENCY_TIERS, AGENCY_TIME_ZONE } = require('../config/commission');
const { checkSPlus, getLevel } = require('./commissionService');

function getDayStartInAgencyTimeZone(date = new Date()) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - 8 * 60 * 60 * 1000);
}

async function getRevenueForUsers(userIds, startDate) {
  if (!userIds.length) return 0;
  const match = {
    userId: { $in: userIds },
    type: 'GIFT_RECEIVED',
    status: 'COMPLETED',
    amountCoins: { $gt: 0 },
  };
  if (startDate) match.createdAt = { $gte: startDate };
  const [result] = await Transaction.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: '$amountCoins' } } },
  ]);
  return result?.total || 0;
}

async function getAgencyHostUsers(agencyId) {
  return User.find({ agencyId, role: 'HOST' }).select('_id username');
}

async function getAgencyGiftRevenue(agencyId, startDate) {
  const hosts = await getAgencyHostUsers(agencyId);
  return getRevenueForUsers(hosts.map((host) => host._id), startDate);
}

function getNextTier(tier) {
  const index = AGENCY_TIERS.findIndex((entry) => entry.tier === tier);
  return index >= 0 ? AGENCY_TIERS[index + 1] || null : AGENCY_TIERS[0];
}

async function getAgencyCenter(agency) {
  const now = new Date();
  const todayStart = getDayStartInAgencyTimeZone(now);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [hosts, subAgencies] = await Promise.all([
    getAgencyHostUsers(agency._id),
    Agency.find({
      $or: [{ parentAgentId: agency._id }, { invitedByAgencyId: agency._id }],
    }).select('_id name tier members'),
  ]);
  const hostIds = hosts.map((host) => host._id);
  const subAgencyHostUsers = subAgencies.length
    ? await User.find({
      agencyId: { $in: subAgencies.map((subAgency) => subAgency._id) },
      role: 'HOST',
    }).select('_id username agencyId')
    : [];
  const subHostIds = subAgencyHostUsers.map((host) => host._id);
  const [todayGiftRevenue, thirtyDayGiftRevenue, todaySubRevenue, thirtyDaySubRevenue] = await Promise.all([
    getRevenueForUsers(hostIds, todayStart),
    getRevenueForUsers(hostIds, thirtyDaysAgo),
    getRevenueForUsers(subHostIds, todayStart),
    getRevenueForUsers(subHostIds, thirtyDaysAgo),
  ]);
  const thirtyDayTeamRevenue = thirtyDayGiftRevenue + thirtyDaySubRevenue;
  const calculatedTier = getLevel(thirtyDayTeamRevenue);
  const sPlus = checkSPlus(agency.sLevelInvitesCount || 0);
  const nextTier = getNextTier(calculatedTier.tier);

  return {
    agency: {
      id: agency._id,
      name: agency.name,
      ownerId: agency.ownerId,
      parentAgentId: agency.parentAgentId || agency.invitedByAgencyId,
      tier: calculatedTier.tier,
      timeZone: 'GMT+8',
      timeZoneId: AGENCY_TIME_ZONE,
    },
    yesterdayTotalCommission: agency.yesterdayCommission || 0,
    commission: {
      tier: calculatedTier.tier,
      rate: sPlus ? 0.18 : calculatedTier.rate,
      rules: AGENCY_TIERS,
      protectionBonus: sPlus ? 0.01 : agency.protectionBonus || 0,
      sPlus,
    },
    giftRevenue: {
      last30Days: thirtyDayTeamRevenue,
      today: todayGiftRevenue + todaySubRevenue,
    nextTier: nextTier ? {
        tier: nextTier.tier,
        minimumTeamIncome: nextTier.minimumTeamIncome,
        remaining: nextTier.minimumTeamIncome === null
          ? null
          : Math.max(0, nextTier.minimumTeamIncome - thirtyDayTeamRevenue),
        requiredSLevelAgencies: nextTier.requiredSLevelAgencies || null,
        remainingSLevelAgencies: nextTier.requiredSLevelAgencies
          ? Math.max(0, nextTier.requiredSLevelAgencies - (agency.sLevelInvitesCount || 0))
          : null,
      } : null,
    },
    myHostGiftRevenue: { last30Days: thirtyDayGiftRevenue, today: todayGiftRevenue },
    subAgencyGiftRevenue: { last30Days: thirtyDaySubRevenue, today: todaySubRevenue },
    protectionT1: {
      hosts: hosts.length,
      subAgencies: subAgencies.length,
      subAgencyHosts: subAgencyHostUsers.length,
    },
    adminWhatsAppUrl: process.env.ADMIN_WHATSAPP_URL || null,
  };
}

async function getOrCreateInviteCodes(agency) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (!agency.hostInviteCode) {
      agency.hostInviteCode = crypto.randomBytes(18).toString('base64url');
    }
    if (!agency.agencyInviteCode) {
      agency.agencyInviteCode = crypto.randomBytes(18).toString('base64url');
    }
    try {
      await agency.save();
      const frontendUrl = (process.env.FRONTEND_URL || 'https://meso-live-frontend.onrender.com').replace(/\/+$/, '');
      return {
        hostInviteLink: `${frontendUrl}/register?hostInvite=${encodeURIComponent(agency.hostInviteCode)}`,
        agencyInviteLink: `${frontendUrl}/register?agencyInvite=${encodeURIComponent(agency.agencyInviteCode)}`,
      };
    } catch (error) {
      if (error.code !== 11000) throw error;
      if (error.keyPattern?.hostInviteCode) agency.hostInviteCode = undefined;
      if (error.keyPattern?.agencyInviteCode) agency.agencyInviteCode = undefined;
      if (!error.keyPattern) {
        agency.hostInviteCode = undefined;
        agency.agencyInviteCode = undefined;
      }
    }
  }
  throw new Error('Could not create unique agency invite links.');
}

module.exports = {
  getAgencyCenter,
  getAgencyGiftRevenue,
  getDayStartInAgencyTimeZone,
  getOrCreateInviteCodes,
};
