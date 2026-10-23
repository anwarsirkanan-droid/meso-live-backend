const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const HostDailyProgress = require('../models/HostDailyProgress');
const HostReward = require('../models/HostReward');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const {
  calculateCharmLevel,
  calculateWealthLevel,
} = require('../config/levels');
const {
  claimHostDailyTask,
  getDateKey,
  getHostDailyProgress,
  recordHostTime,
} = require('../services/hostDailyTaskService');

test('wealth and charm levels expose medal tiers and progress to the next configured level', () => {
  assert.deepEqual(calculateWealthLevel(10_000), {
    level: 10,
    points: 10_000,
    title: 'Bronze Member',
    medal: 'Bronze',
    nextLevel: 20,
    nextLevelPoints: 20_000,
    progress: 33,
  });
  assert.deepEqual(calculateCharmLevel(500_000), {
    level: 2,
    points: 500_000,
    title: 'Rising Charm',
    medal: 'Bronze',
    nextLevel: 3,
    nextLevelPoints: 1_500_000,
    progress: 0,
  });
  assert.equal(calculateCharmLevel(1_000_000_000).level, 50);
});

test('host task time is split at midnight EAT and crowns only the time in the Crown Mic', async (context) => {
  const originalUpdateOne = HostDailyProgress.updateOne;
  const originalRewardFindOne = HostReward.findOne;
  const originalRewardCreate = HostReward.create;
  const updates = [];
  HostDailyProgress.updateOne = async (filter, update) => updates.push({
    date: filter.date,
    increment: update.$inc,
  });
  HostReward.findOne = async () => null;
  HostReward.create = async () => ({});
  context.after(() => {
    HostDailyProgress.updateOne = originalUpdateOne;
    HostReward.findOne = originalRewardFindOne;
    HostReward.create = originalRewardCreate;
  });

  const start = new Date('2026-10-19T20:59:50.000Z');
  const end = new Date('2026-10-19T21:00:20.000Z');
  assert.equal(getDateKey(start), '2026-10-19');
  assert.equal(getDateKey(end), '2026-10-20');

  await recordHostTime('507f1f77bcf86cd799439011', start, end, true);

  assert.deepEqual(updates, [
    { date: '2026-10-19', increment: { onMicSeconds: 10, crownMicSeconds: 10 } },
    { date: '2026-10-20', increment: { onMicSeconds: 20, crownMicSeconds: 20 } },
  ]);
});

test('daily host tasks are claimable only after target duration is recorded', async (context) => {
  const originalFindOne = HostDailyProgress.findOne;
  HostDailyProgress.findOne = () => ({
    lean: async () => ({
      onMicSeconds: 3599,
      crownMicSeconds: 3600,
      crownMicClaimed: true,
    }),
  });
  context.after(() => {
    HostDailyProgress.findOne = originalFindOne;
  });

  const result = await getHostDailyProgress('507f1f77bcf86cd799439011', new Date('2026-10-19T21:00:00.000Z'));
  assert.equal(result.date, '2026-10-20');
  assert.equal(result.timeZone, 'Africa/Addis_Ababa');
  assert.equal(result.tasks[0].complete, false);
  assert.equal(result.tasks[0].claimable, false);
  assert.equal(result.tasks[1].complete, true);
  assert.equal(result.tasks[1].claimed, true);
});

test('claiming a completed host task credits diamonds and records a transaction once', async (context) => {
  const originals = {
    startSession: mongoose.startSession,
    findOneAndUpdate: HostDailyProgress.findOneAndUpdate,
    findOne: HostDailyProgress.findOne,
    findByIdAndUpdate: User.findByIdAndUpdate,
    create: Transaction.create,
  };
  const progress = { onMicClaimed: true, onMicSeconds: 3600 };
  let creditedDiamonds = 0;
  let transaction;
  mongoose.startSession = async () => ({
    withTransaction: async (callback) => callback(),
    endSession: async () => {},
  });
  HostDailyProgress.findOneAndUpdate = async (_filter, update) => {
    Object.assign(progress, update.$set);
    return progress;
  };
  HostDailyProgress.findOne = () => ({ lean: async () => progress });
  User.findByIdAndUpdate = (_id, update) => {
    creditedDiamonds += update.$inc.diamonds;
    return { select: async () => ({ diamonds: creditedDiamonds }) };
  };
  Transaction.create = async ([entry]) => {
    transaction = entry;
  };
  context.after(() => {
    mongoose.startSession = originals.startSession;
    HostDailyProgress.findOneAndUpdate = originals.findOneAndUpdate;
    HostDailyProgress.findOne = originals.findOne;
    User.findByIdAndUpdate = originals.findByIdAndUpdate;
    Transaction.create = originals.create;
  });

  const now = new Date('2026-10-19T21:00:00.000Z');
  const result = await claimHostDailyTask('507f1f77bcf86cd799439011', 'onMic', now);
  assert.equal(result.rewardDiamonds, 90_000);
  assert.equal(result.diamonds, 90_000);
  assert.equal(transaction.amountDiamonds, 90_000);
  assert.equal(transaction.amountUsd, 0.9);
  assert.equal(transaction.referenceId, 'host-daily:2026-10-20:onMic');
  assert.equal(result.progress.tasks[0].claimed, true);
});
