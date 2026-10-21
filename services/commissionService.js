const Agency = require('../models/Agency');
const { AGENCY_TIERS } = require('../config/commission');

function normalizeRate(rate) {
  const numericRate = Number(rate) || 0;
  return numericRate > 1 ? numericRate / 100 : numericRate;
}

function calculateCommission(hostEarnings, rate) {
  return Number((Math.max(0, Number(hostEarnings) || 0) * normalizeRate(rate)).toFixed(2));
}

function calculateInviteBonus(parentRate, childRate, childTeamIncome) {
  const rateDifference = Math.max(0, normalizeRate(parentRate) - normalizeRate(childRate));
  return Number((Math.max(0, Number(childTeamIncome) || 0) * rateDifference).toFixed(2));
}

function getLevel(teamIncome) {
  const income = Number(teamIncome) || 0;
  return AGENCY_TIERS.reduce((level, tier) => (
    tier.minimumTeamIncome !== null && income >= tier.minimumTeamIncome ? tier : level
  ), AGENCY_TIERS[0]);
}

function checkSPlus(sLevelAgencyCount) {
  return Number(sLevelAgencyCount) >= 2;
}

function calculateMultiTierBonuses(agencyChain, childTeamIncome) {
  return agencyChain.slice(0, 3).reduce((total, agency, index, chain) => {
    const child = chain[index + 1];
    if (!child) return total;
    return total + calculateInviteBonus(agency.commissionRate, child.commissionRate, childTeamIncome);
  }, 0);
}

async function updateTeamIncome(agencyId, giftIncome, options = {}) {
  if (!agencyId) return [];
  const amount = Number(giftIncome) || 0;
  if (amount <= 0) return [];
  const updated = [];
  let currentId = agencyId;
  let depth = 0;
  while (currentId && depth < 3) {
    const agency = await Agency.findByIdAndUpdate(
      currentId,
      { $inc: { monthlyGiftRevenue: amount, todayGiftRevenue: amount } },
      { new: true, session: options.session },
    );
    if (!agency) break;
    updated.push(agency);
    currentId = agency.parentAgentId || agency.invitedByAgencyId;
    depth += 1;
  }
  return updated;
}

module.exports = {
  calculateCommission,
  calculateInviteBonus,
  calculateMultiTierBonuses,
  updateTeamIncome,
  getLevel,
  checkSPlus,
};
