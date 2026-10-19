/**
 * Game RNG Logic & Multiplier Calculation
 */
function playMiniGame(gameType, betAmount) {
  const rand = Math.random() * 100; // 0.00 - 99.99
  let multiplier = 0;

  switch (gameType) {
    case 'MegaJackpot':
      if (rand < 0.01) multiplier = 500;  // 0.01% chance
      else if (rand < 0.1) multiplier = 100;
      else if (rand < 2.0) multiplier = 10;
      else if (rand < 15.0) multiplier = 2;
      break;

    case '777':
      if (rand < 0.05) multiplier = 200; // Jackpot 777
      else if (rand < 1.0) multiplier = 50;
      else if (rand < 5.0) multiplier = 10;
      else if (rand < 25.0) multiplier = 2;
      break;

    case 'Keno':
      if (rand < 0.2) multiplier = 100;
      else if (rand < 2.0) multiplier = 20;
      else if (rand < 10.0) multiplier = 5;
      else if (rand < 35.0) multiplier = 1.5;
      break;

    case 'Jungle Hunt':
    case 'Fish Hunter':
      if (rand < 0.1) multiplier = 150;
      else if (rand < 1.5) multiplier = 30;
      else if (rand < 8.0) multiplier = 6;
      else if (rand < 30.0) multiplier = 2;
      break;

    default:
      multiplier = 0;
  }

  const winAmount = Math.floor(betAmount * multiplier);
  const isWin = winAmount > 0;

  return {
    isWin,
    multiplier,
    winAmount,
    rngRoll: rand.toFixed(4)
  };
}

module.exports = {
  playMiniGame
};