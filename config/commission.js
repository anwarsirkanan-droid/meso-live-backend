const AGENCY_TIERS = [
  { tier: 'E', minimumTeamIncome: 0, rate: 0.03 },
  { tier: 'D', minimumTeamIncome: 5_000_000, rate: 0.05 },
  { tier: 'C', minimumTeamIncome: 10_000_000, rate: 0.08 },
  { tier: 'B', minimumTeamIncome: 30_000_000, rate: 0.10 },
  { tier: 'A', minimumTeamIncome: 100_000_000, rate: 0.13 },
  { tier: 'S', minimumTeamIncome: 500_000_000, rate: 0.16 },
  { tier: 'S+', minimumTeamIncome: null, rate: 0.18, requiredSLevelAgencies: 2, extraSLevelHostBonusRate: 0.01 },
];

const AGENCY_TIME_ZONE = 'Asia/Shanghai';
const HOST_WITHDRAWAL_MINIMUM_DIAMONDS = 1_000_000;
const DIAMONDS_PER_USD = 100_000;

module.exports = {
  AGENCY_TIERS,
  AGENCY_TIME_ZONE,
  DIAMONDS_PER_USD,
  HOST_WITHDRAWAL_MINIMUM_DIAMONDS,
};
