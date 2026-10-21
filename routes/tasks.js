const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Task = require('../models/Task');
const UserTaskProgress = require('../models/UserTaskProgress');
const HostReward = require('../models/HostReward');
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
  { level: 'S', targetHours: 70, rewardPerHour: 0.9, maxHours: 100, totalReward: 90 },
  { level: 'A', targetHours: 56, rewardPerHour: 0.8, maxHours: 80, totalReward: 64 },
  { level: 'B', targetHours: 42, rewardPerHour: 0.7, maxHours: 60, totalReward: 42 },
  { level: 'C', targetHours: 28, rewardPerHour: 0.6, maxHours: 40, totalReward: 24 },
  { level: 'D', targetHours: 21, rewardPerHour: 0.5, maxHours: 30, totalReward: 15 },
  { level: 'E', targetHours: 14, rewardPerHour: 0.4, maxHours: 20, totalReward: 8 },
  { level: 'F', targetHours: 7, rewardPerHour: 0.3, maxHours: 10, totalReward: 3 },
  { level: 'G', targetHours: 4, rewardPerHour: 0.2, maxHours: 7, totalReward: 1.4 },
  { level: 'H', targetHours: 2, rewardPerHour: 0.1, maxHours: 4, totalReward: 0.4 },
  { level: 'I', targetHours: 1, rewardPerHour: 0.05, maxHours: 2, totalReward: 0.1 }
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
    const user = await User.findById(req.user.id).select('coins role isHost hostVerificationStatus');
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
    if ((user.role === 'HOST' || user.role === 'AGENT' || user.isHost === true) && user.hostVerificationStatus === 'APPROVED') {
      const hostRewards = await getHostReward(user._id);
      response.hostRewards = { ...hostRewards.toObject(), ...getRewardDetails(hostRewards) };
      response.hostLevels = HOST_LEVELS;
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
      const user = await User.findById(req.user.id).select('role isHost hostVerificationStatus coins diamonds hostEarningsUsd').session(session);
      if (!user || (user.role !== 'HOST' && user.role !== 'AGENT' && user.isHost !== true)) throw Object.assign(new Error('Host rewards are available to hosts only.'), { status: 403 });
      if (user.hostVerificationStatus !== 'APPROVED') throw Object.assign(new Error('Host verification must be approved before claiming rewards.'), { status: 403 });
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
    const user = await User.findById(req.user.id).select('role isHost hostVerificationStatus');
    if (!user || (user.role !== 'HOST' && user.role !== 'AGENT' && user.isHost !== true)) return res.status(403).json({ message: 'Host rewards are available to hosts only.' });
    if (user.hostVerificationStatus !== 'APPROVED') return res.status(403).json({ message: 'Host verification must be approved before claiming rewards.' });
    const reward = await HostReward.findOneAndUpdate({ userId: req.user.id, welcomeClaimed: false }, { $set: { welcomeClaimed: true } }, { new: true });
    if (!reward) return res.status(400).json({ message: 'Welcome reward has already been claimed.' });
    const updatedUser = await User.findByIdAndUpdate(req.user.id, { $inc: { coins: WELCOME_REWARD_COINS } }, { new: true }).select('coins');
    return res.json({ reward: WELCOME_REWARD_COINS, coins: updatedUser.coins, hostRewards: { ...reward.toObject(), ...getRewardDetails(reward) } });
  } catch (error) {
    return res.status(500).json({ message: 'Could not claim welcome reward.' });
  }
});

module.exports = router;
