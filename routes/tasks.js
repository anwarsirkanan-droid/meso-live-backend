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

async function getHostReward(userId) {
  const reward = await HostReward.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId, lastResetDate: new Date() } },
    { upsert: true, new: true }
  );
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
    const user = await User.findById(req.user.id).select('coins role');
    if (!user) return res.status(404).json({ message: 'User not found.' });
    const tasks = await ensureDefaultTasks();
    const progress = await UserTaskProgress.find({ userId: user._id, taskId: { $in: tasks.map((task) => task._id) } });
    const progressByTask = new Map(progress.map((item) => [String(item.taskId), item]));
    const response = {
      coins: user.coins,
      role: user.role,
      dailyTasks: tasks.filter((task) => task.type === 'daily').map((task) => serializeTask(task, progressByTask.get(String(task._id)))),
      weeklyTasks: tasks.filter((task) => task.type === 'weekly').map((task) => serializeTask(task, progressByTask.get(String(task._id))))
    };
    if (user.role === 'HOST' || user.role === 'AGENT') {
      const hostRewards = await getHostReward(user._id);
      response.hostRewards = hostRewards.toObject();
      response.hostRewards.welcomeReward = WELCOME_REWARD_COINS;
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
  if (req.user.role !== 'HOST' && req.user.role !== 'AGENT') return res.status(403).json({ message: 'Host rewards are available to hosts only.' });
  const requirement = kind === 'mic' ? { micSeconds: { $gte: MIC_TARGET_SECONDS }, micClaimed: false } : { crownSeconds: { $gte: MIC_TARGET_SECONDS }, crownClaimed: false };
  const update = kind === 'mic' ? { $set: { micClaimed: true } } : { $set: { crownClaimed: true } };
  const reward = await HostReward.findOneAndUpdate({ userId: req.user.id, ...requirement }, update, { new: true });
  if (!reward) return res.status(400).json({ message: 'Reward is not available yet or has already been claimed.' });
  if (kind === 'crown') await User.findByIdAndUpdate(req.user.id, { $inc: { diamonds: 3000 } });
  return res.json({ reward: kind === 'mic' ? 0.9 : 3000, hostRewards: reward });
}

router.post('/claim-mic', auth, async (req, res) => {
  try { return await claimHostReward(req, res, 'mic'); } catch (error) { return res.status(500).json({ message: 'Could not claim mic reward.' }); }
});

router.post('/claim-crown', auth, async (req, res) => {
  try { return await claimHostReward(req, res, 'crown'); } catch (error) { return res.status(500).json({ message: 'Could not claim crown reward.' }); }
});

router.post('/claim-welcome', auth, async (req, res) => {
  try {
    if (req.user.role !== 'HOST' && req.user.role !== 'AGENT') return res.status(403).json({ message: 'Host rewards are available to hosts only.' });
    const reward = await HostReward.findOneAndUpdate({ userId: req.user.id, welcomeClaimed: false }, { $set: { welcomeClaimed: true } }, { new: true });
    if (!reward) return res.status(400).json({ message: 'Welcome reward has already been claimed.' });
    const user = await User.findByIdAndUpdate(req.user.id, { $inc: { coins: WELCOME_REWARD_COINS } }, { new: true }).select('coins');
    return res.json({ reward: WELCOME_REWARD_COINS, coins: user.coins, hostRewards: reward });
  } catch (error) {
    return res.status(500).json({ message: 'Could not claim welcome reward.' });
  }
});

module.exports = router;
