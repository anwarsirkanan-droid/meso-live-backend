/**
 * RNG Math Engine for Lucky & Super Lucky Gifts
 * Multiplier probabilities based on Master Spec
 */
function calculateLuckyGiftMultiplier(category) {
  const rand = Math.random() * 100; // 0.00 - 99.99

  if (category === 'LUCKY') {
    if (rand < 0.1) return 500;   // 0.1% chance for 500x
    if (rand < 1.0) return 100;   // 0.9% chance for 100x
    if (rand < 5.0) return 20;    // 4.0% chance for 20x
    if (rand < 20.0) return 5;    // 15.0% chance for 5x
    if (rand < 50.0) return 2;    // 30.0% chance for 2x
    return 0;                     // 50.0% chance no win
  }

  if (category === 'SUPER_LUCKY') {
    if (rand < 0.05) return 1000; // 0.05% chance for 1000x
    if (rand < 0.5) return 200;   // 0.45% chance for 200x
    if (rand < 3.0) return 50;    // 2.5% chance for 50x
    if (rand < 15.0) return 10;   // 12.0% chance for 10x
    if (rand < 40.0) return 3;    // 25.0% chance for 3x
    return 0;                     // 60.0% chance no win
  }

  return 0; // LUXURY gifts do not have RNG multipliers
}

/**
 * Gift distribution shallaguu: Host Diamonds & User Charm Points
 */
function processGiftDistribution(gift, coinAmount) {
  const hostDiamonds = Math.floor(coinAmount * gift.hostShareRate);
  const charmPoints = Math.floor(coinAmount * gift.charmRate);

  return {
    hostDiamonds,
    charmPoints
  };
}

module.exports = {
  calculateLuckyGiftMultiplier,
  processGiftDistribution
};