const AGENCY_TIERS = [
  { tier: 'D', minimumTeamIncome: 0, rate: 0.08 },
  { tier: 'C', minimumTeamIncome: 20_000_000, rate: 0.12 },
  { tier: 'B', minimumTeamIncome: 100_000_000, rate: 0.16 },
  { tier: 'A', minimumTeamIncome: 500_000_000, rate: 0.18 },
  { tier: 'S', minimumTeamIncome: 1_500_000_000, rate: 0.2 },
  { tier: 'S+', minimumTeamIncome: null, rate: 0.21, requiredSLevelAgencies: 2 },
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
