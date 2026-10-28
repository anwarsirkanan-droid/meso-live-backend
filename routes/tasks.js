const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Task = require('../models/Task');
const UserTaskProgress = require('../models/UserTaskProgress');
const HostReward = require('../models/HostReward');
const Transaction = require('../models/Transaction');
const auth = require('../middleware/auth');

const router = express.Router();
const MIC_TARGET_SECONDS = 60 * 60;
const WELCOME_REWARD_COINS = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_TASKS = [
  { title: 'Daily Login', description: 'Open Meso Live today.', reward: 50, type: 'daily', requirementTarget: 1 },
  { title: 'Send a Gift', description: 'Send one gift in a live room.', reward: 100, type: 'daily', requirementTarget: 1 },
  { title: 'Join Live Rooms', description: 'Join five live rooms this week.', reward: 500, type: 'weekly', requirementTarget: 5 }
];

const HOST_LEVELS = [
  { level: 'S', qualifyingPoints: 500000000, rewardPerHour: 2000000, maxHours: 3 },
  { level: 'A', qualifyingPoints: 200000000, rewardPerHour: 1000000, maxHours: 3 },
  { level: 'B', qualifyingPoints: 100000000, rewardPerHour: 500000, maxHours: 3 },
  { level: 'C', qualifyingPoints: 70000000, rewardPerHour: 350000, maxHours: 3 },
  { level: 'D', qualifyingPoints: 40000000, rewardPerHour: 300000, maxHours: 3 },
  { level: 'E', qualifyingPoints: 20000000, rewardPerHour: 150000, maxHours: 3 },
  { level: 'F', qualifyingPoints: 12000000, rewardPerHour: 120000, maxHours: 3 },
  { level: 'G', qualifyingPoints: 9000000, rewardPerHour: 90000, maxHours: 3 },
  { level: 'H', qualifyingPoints: 3000000, rewardPerHour: 45000, maxHours: 2 },
  { level: 'I', qualifyingPoints: 1500000, rewardPerHour: 30000, maxHours: 2 },
  { level: 'J', qualifyingPoints: 1000000, rewardPerHour: 20000, maxHours: 2 },
  { level: 'K', qualifyingPoints: 500000, rewardPerHour: 12000, maxHours: 2 },
  { level: 'L', qualifyingPoints: 0, rewardPerHour: 6000, maxHours: 1 },
];

async function ensureDefaultTasks() {
  const count = await Task.countDocuments({ active: true });
  if (count > 0) return Task.find({ active: true }).sort({ type: 1, _id: 1 });
  await Task.insertMany(DEFAULT_TASKS);
  return Task.find({ active: true }).sort({ type: 1, _id: 1 });
}

function isSameUtcDay(firstDate, secondDate) {
  return firstDate && firstDate.toISOString().slice(0, 10) === secondDate.toISOString().slice(0, 10);
}

function getDaysAsHost(hostStartDate) {
  return Math.floor((Date.now() - new Date(hostStartDate).getTime()) / DAY_MS) + 1;
}

function getRewardDetails(hostReward) {
  const daysAsHost = getDaysAsHost(hostReward.hostStartDate);
  const micRewardAmount = daysAsHost <= 7 ? 0.90 : 8000;
  const micRewardType = daysAsHost <= 7 ? 'USD' : 'DIAMONDS';
  const micRewardLabel = daysAsHost <= 7 ? '$0.90/day' : '8,000/day';
  return {
    daysAsHost,
    micRewardAmount,
    micRewardType,
    micRewardLabel,
    micBtnText: daysAsHost <= 7 ? 'Claim $0.90' : 'Claim 8,000',
    crownRewardAmount: 3000,
    crownRewardType: 'DIAMONDS',
    crownRewardLabel: '3,000 Diamonds/day',
    crownBtnText: 'Claim 3,000',
    welcomeRewardAmount: WELCOME_REWARD_COINS,
    welcomeRewardType: 'COINS',
    welcomeRewardLabel: `${WELCOME_REWARD_COINS.toLocaleString()} coins`,
    welcomeBtnText: `Claim ${WELCOME_REWARD_COINS.toLocaleString()}`
  };
}

async function getHostReward(userId, options = {}) {
  const query = HostReward.findOne({ userId });
  if (options.session) query.session(options.session);
  const reward = await query;
  if (!reward) {
    const created = new HostReward({ userId, lastResetDate: new Date() });
    await created.save(options.session ? { session: options.session } : undefined);
    return created;
  }
  if (!reward.hostStartDate) {
    reward.hostStartDate = new Date();
  }
  if (!isSameUtcDay(reward.lastResetDate, new Date())) {
    reward.micSeconds = 0;
    reward.crownSeconds = 0;
    reward.micClaimed = false;
    reward.crownClaimed = false;
    reward.lastResetDate = new Date();
  }
  await reward.save(options.session ? { session: options.session } : undefined);
  return reward;
}

function serializeTask(task, progress) {
  return {
    id: String(task._id),
    title: task.title,
    description: task.description,
    reward: task.reward,
    type: task.type,
    requirementTarget: task.requirementTarget,
    progress: progress?.progress || 0,
    completed: progress?.completed || false,
    claimed: progress?.claimed || false,
    claimedAt: progress?.claimedAt || null
  };
}

router.get('/', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('coins role isHost hostVerificationStatus publicId');
    if (!user) return res.status(404).json({ message: 'User not found.' });
    const tasks = await ensureDefaultTasks();
    const progress = await UserTaskProgress.find({ userId: user._id, taskId: { $in: tasks.map((task) => task._id) } });
    const progressByTask = new Map(progress.map((item) => [String(item.taskId), item]));
    const response = {
      coins: user.coins,
      role: user.role,
      hostVerificationStatus: user.hostVerificationStatus || 'NOT_SUBMITTED',
      dailyTasks: tasks.filter((task) => task.type === 'daily').map((task) => serializeTask(task, progressByTask.get(String(task._id)))),
      weeklyTasks: tasks.filter((task) => task.type === 'weekly').map((task) => serializeTask(task, progressByTask.get(String(task._id))))
    };
    const isTrustedHost = user.role === 'HOST' || user.role === 'AGENT' || user.isHost === true || user.role === 'ADMIN' || Number(user.publicId) === 1000000;
    if (isTrustedHost && (user.hostVerificationStatus === 'APPROVED' || Number(user.publicId) === 1000000 || user.role === 'ADMIN')) {
      const hostRewards = await getHostReward(user._id);
      response.hostRewards = { ...hostRewards.toObject(), ...getRewardDetails(hostRewards) };
      response.hostLevels = HOST_LEVELS;
      response.hostRewardsUnlocked = true;
      // Eligible Gift Points for Host Task Levels: sum of GIFT_RECEIVED transaction amountCoins in the last 7 days.
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const giftAgg = await Transaction.aggregate([
        { $match: { userId: user._id, type: 'GIFT_RECEIVED', createdAt: { $gte: sevenDaysAgo } } },
        { $group: { _id: null, total: { $sum: '$amountCoins' } } },
      ]);
      const weeklyGiftPoints = (giftAgg[0] && Number.isFinite(giftAgg[0].total)) ? giftAgg[0].total : 0;
      response.weeklyGiftPoints = weeklyGiftPoints;
      // Determine current level from the verified HOST_LEVELS table (sorted descending by qualifyingPoints).
      let currentIndex = HOST_LEVELS.length - 1;
      for (let i = 0; i < HOST_LEVELS.length; i++) {
        if (weeklyGiftPoints >= HOST_LEVELS[i].qualifyingPoints) { currentIndex = i; break; }
      }
      const currentLevel = HOST_LEVELS[currentIndex];
      const nextLevel = currentIndex > 0 ? HOST_LEVELS[currentIndex - 1] : null;
      let progress = 0;
      if (nextLevel) {
        const span = nextLevel.qualifyingPoints - currentLevel.qualifyingPoints;
        progress = span > 0 ? Math.min(100, Math.max(0, ((weeklyGiftPoints - currentLevel.qualifyingPoints) / span) * 100)) : 100;
      } else {
        progress = 100;
      }
      response.currentLevel = currentLevel.level;
      response.currentGiftPoints = weeklyGiftPoints;
      response.nextLevel = nextLevel ? nextLevel.level : null;
      response.nextThreshold = nextLevel ? nextLevel.qualifyingPoints : null;
      response.levelProgress = Math.round(progress);
      response.levelRewardPerHour = currentLevel.rewardPerHour;
      response.levelMaxHours = currentLevel.maxHours;
    }
    return res.json(response);
  } catch (error) {
    return res.status(500).json({ message: 'Could not load task center.' });
  }
});

router.post('/:id/claim', auth, async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid task ID.' });
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const progress = await UserTaskProgress.findOneAndUpdate(
        { userId: req.user.id, taskId: req.params.id, completed: true, claimed: false },
        { $set: { claimed: true, claimedAt: new Date() } },
        { new: true, session }
      );
      if (!progress) {
        const existing = await UserTaskProgress.findOne({ userId: req.user.id, taskId: req.params.id }).session(session);
        if (!existing) throw Object.assign(new Error('Task progress was not found.'), { status: 404 });
        throw Object.assign(new Error(existing.claimed ? 'Task reward has already been claimed.' : 'Task is not complete yet.'), { status: 400 });
      }
      const task = await Task.findOne({ _id: req.params.id, active: true }).session(session);
      if (!task) throw Object.assign(new Error('Task was not found.'), { status: 404 });
      const user = await User.findByIdAndUpdate(req.user.id, { $inc: { coins: task.reward } }, { new: true, session }).select('coins');
      result = { coins: user.coins, taskId: String(task._id) };
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.status ? error.message : 'Could not claim task reward.' });
  } finally {
    await session.endSession();
  }
});

async function claimHostReward(req, res, kind) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const user = await User.findById(req.user.id).select('role isHost hostVerificationStatus coins diamonds hostEarningsUsd publicId').session(session);
      if (!user || !(user.role === 'HOST' || user.role === 'AGENT' || user.isHost === true || user.role === 'ADMIN' || Number(user.publicId) === 1000000)) throw Object.assign(new Error('Host rewards are available to hosts only.'), { status: 403 });
      if (user.hostVerificationStatus !== 'APPROVED' && !(Number(user.publicId) === 1000000 || user.role === 'ADMIN')) throw Object.assign(new Error('Host verification must be approved before claiming rewards.'), { status: 403 });
      const hostReward = await getHostReward(user._id, { session });
      const rewardDetails = getRewardDetails(hostReward);
      const field = kind === 'mic' ? 'micSeconds' : 'crownSeconds';
      const claimedField = kind === 'mic' ? 'micClaimed' : 'crownClaimed';
      if (hostReward[field] < MIC_TARGET_SECONDS || hostReward[claimedField]) throw Object.assign(new Error('Reward is not available yet or has already been claimed today.'), { status: 400 });
      hostReward[claimedField] = true;
      hostReward.lastResetDate = new Date();
      await hostReward.save({ session });
      const balanceUpdate = kind === 'crown'
        ? { $inc: { diamonds: rewardDetails.crownRewardAmount } }
        : rewardDetails.micRewardType === 'USD'
          ? { $inc: { hostEarningsUsd: rewardDetails.micRewardAmount } }
          : { $inc: { diamonds: rewardDetails.micRewardAmount } };
      const updatedUser = await User.findByIdAndUpdate(user._id, balanceUpdate, { new: true, session }).select('coins diamonds hostEarningsUsd');
      result = { reward: kind === 'crown' ? rewardDetails.crownRewardAmount : rewardDetails.micRewardAmount, rewardType: kind === 'crown' ? rewardDetails.crownRewardType : rewardDetails.micRewardType, hostRewards: { ...hostReward.toObject(), ...getRewardDetails(hostReward) }, balances: updatedUser };
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.status ? error.message : 'Could not claim host reward.' });
  } finally {
    await session.endSession();
  }
}

router.post('/claim-mic', auth, async (req, res) => {
  try { return await claimHostReward(req, res, 'mic'); } catch (error) { return res.status(500).json({ message: 'Could not claim mic reward.' }); }
});

router.post('/claim-crown', auth, async (req, res) => {
  try { return await claimHostReward(req, res, 'crown'); } catch (error) { return res.status(500).json({ message: 'Could not claim crown reward.' }); }
});

router.post('/claim-welcome', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('role isHost hostVerificationStatus publicId');
    if (!user || !(user.role === 'HOST' || user.role === 'AGENT' || user.isHost === true || user.role === 'ADMIN' || Number(user.publicId) === 1000000)) return res.status(403).json({ message: 'Host rewards are available to hosts only.' });
    if (user.hostVerificationStatus !== 'APPROVED' && !(Number(user.publicId) === 1000000 || user.role === 'ADMIN')) return res.status(403).json({ message: 'Host verification must be approved before claiming rewards.' });
    const reward = await HostReward.findOneAndUpdate({ userId: req.user.id, welcomeClaimed: false }, { $set: { welcomeClaimed: true } }, { new: true });
    if (!reward) return res.status(400).json({ message: 'Welcome reward has already been claimed.' });
    const updatedUser = await User.findByIdAndUpdate(req.user.id, { $inc: { coins: WELCOME_REWARD_COINS } }, { new: true }).select('coins');
    return res.json({ reward: WELCOME_REWARD_COINS, coins: updatedUser.coins, hostRewards: { ...reward.toObject(), ...getRewardDetails(reward) } });
  } catch (error) {
    return res.status(500).json({ message: 'Could not claim welcome reward.' });
  }
});

module.exports = router;
