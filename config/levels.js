const WEALTH_LEVELS = [
  { level: 1, points: 0, title: 'Newbie', medal: 'Bronze' },
  { level: 10, points: 5_000, title: 'Bronze Member', medal: 'Bronze' },
  { level: 20, points: 20_000, title: 'Silver Warrior', medal: 'Silver' },
  { level: 30, points: 100_000, title: 'Gold Knight', medal: 'Gold' },
  { level: 40, points: 500_000, title: 'Diamond Lord', medal: 'Diamond' },
  { level: 50, points: 1_000_000, title: 'Crown King', medal: 'Crown' },
];

const CHARM_LEVELS = [
  { level: 1, points: 0, title: 'Newbie', medal: 'Bronze' },
  { level: 2, points: 500_000, title: 'Rising Charm', medal: 'Bronze' },
  { level: 3, points: 1_500_000, title: 'Charming', medal: 'Silver' },
  { level: 5, points: 5_000_000, title: 'Silver Charm', medal: 'Silver' },
  { level: 10, points: 20_000_000, title: 'Gold Charm', medal: 'Gold' },
  { level: 20, points: 80_000_000, title: 'Platinum Charm', medal: 'Platinum' },
  { level: 30, points: 200_000_000, title: 'Diamond Charm', medal: 'Diamond' },
  { level: 40, points: 500_000_000, title: 'Crown Charm', medal: 'Crown' },
  { level: 50, points: 1_000_000_000, title: 'Legendary Charm', medal: 'Legendary' },
];

const HOST_DAILY_TASKS = {
  onMic: {
    id: 'onMic',
    title: 'Daily On Mic',
    targetSeconds: 60 * 60,
    rewardUsd: 0.9,
    rewardDiamonds: 90_000,
    description: 'Stay in your live room for 1 hour. Muted time counts.',
  },
  crownMic: {
    id: 'crownMic',
    title: 'Daily Crown Mic',
    targetSeconds: 60 * 60,
    rewardDiamonds: 3_000,
    description: 'Occupy a Crown Mic seat for 1 hour. Gift earnings are not required.',
  },
};

const HOST_TASK_TIME_ZONE = 'Africa/Addis_Ababa';

function calculateLevel(points, levels) {
  const value = Number.isFinite(points) && points > 0 ? points : 0;
  let current = levels[0];
  let next = null;

  for (let index = 1; index < levels.length; index += 1) {
    if (value < levels[index].points) {
      next = levels[index];
      break;
    }
    current = levels[index];
  }

  const progress = next
    ? Math.min(100, Math.max(0, ((value - current.points) / (next.points - current.points)) * 100))
    : 100;

  return {
    ...current,
    points: value,
    nextLevel: next?.level ?? null,
    nextLevelPoints: next?.points ?? null,
    progress: Math.round(progress),
  };
}

const calculateWealthLevel = (totalRechargedCoins) =>
  calculateLevel(totalRechargedCoins, WEALTH_LEVELS);

const calculateCharmLevel = (charmPoints) =>
  calculateLevel(charmPoints, CHARM_LEVELS);

module.exports = {
  CHARM_LEVELS,
  HOST_DAILY_TASKS,
  HOST_TASK_TIME_ZONE,
  WEALTH_LEVELS,
  calculateCharmLevel,
  calculateWealthLevel,
};
