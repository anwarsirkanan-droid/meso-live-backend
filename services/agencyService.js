/**
 * Agency Tier & Commission Calculation Engine
 */
function getAgencyTierAndRate(monthlyRevenueCoins) {
  if (monthlyRevenueCoins >= 10000000) {
    return { tier: 'DIAMOND', rate: 0.20 };
  } else if (monthlyRevenueCoins >= 5000000) {
    return { tier: 'PLATINUM', rate: 0.18 };
  } else if (monthlyRevenueCoins >= 1000000) {
    return { tier: 'GOLD', rate: 0.15 };
  } else if (monthlyRevenueCoins >= 200000) {
    return { tier: 'SILVER', rate: 0.12 };
  } else {
    return { tier: 'BRONZE', rate: 0.10 };
  }
}

function calculateReferralCommission(agencyCommission, subAgencyCommission) {
  const masterAgencyShare = agencyCommission - subAgencyCommission;
  return Math.max(0, masterAgencyShare);
}

module.exports = {
  getAgencyTierAndRate,
  calculateReferralCommission
};