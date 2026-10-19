/**
 * Dynamic VIP & Level Calculation Engine
 * Calculates user level based on total recharged coins
 */
function calculateUserLevel(totalRechargedCoins = 0) {
  if (totalRechargedCoins >= 1000000) {
    return { level: 50, title: 'Crown King', badge: 'VIP_5' };
  } else if (totalRechargedCoins >= 500000) {
    return { level: 40, title: 'Diamond Lord', badge: 'VIP_4' };
  } else if (totalRechargedCoins >= 100000) {
    return { level: 30, title: 'Gold Knight', badge: 'VIP_3' };
  } else if (totalRechargedCoins >= 20000) {
    return { level: 20, title: 'Silver Warrior', badge: 'VIP_2' };
  } else if (totalRechargedCoins >= 5000) {
    return { level: 10, title: 'Bronze Member', badge: 'VIP_1' };
  } else {
    return { level: 1, title: 'Newbie', badge: 'VIP_0' };
  }
}

module.exports = {
  calculateUserLevel
};