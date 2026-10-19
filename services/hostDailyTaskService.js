const mongoose = require('mongoose');
const HostDailyProgress = require('../models/HostDailyProgress');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const {
  DIAMONDS_PER_USD,
} = require('../config/commission');
const {
  HOST_DAILY_TASKS,
  HOST_TASK_TIME_ZONE,
} = require('../config/levels');

function getDateParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: HOST_TASK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

function getDateKey(date) {
  const { year, month, day } = getDateParts(date);
  return `${year}-${month}-${day}`;
}

function getNextDayStart(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1) - 3 * 60 * 60 * 1000);
}

async function recordHostTime(userId, startTime, endTime, crownMicActive) {
  let cursor = new Date(startTime);
  const end = new Date(endTime);
  if (!Number.isFinite(cursor.getTime()) || !Number.isFinite(end.getTime()) || end <= cursor) return;

  while (cursor < end) {
    const date = getDateKey(cursor);
    const segmentEnd = new Date(Math.min(end.getTime(), getNextDayStart(date).getTime()));
    const seconds = Math.floor((segmentEnd.getTime() - cursor.getTime()) / 1000);
    if (seconds > 0) {
      const increment = { onMicSeconds: seconds };
      if (crownMicActive) increment.crownMicSeconds = seconds;
      await HostDailyProgress.updateOne(
        { userId, date },
        { $inc: increment, $setOnInsert: { userId, date } },
        { upsert: true },
      );
    }
    cursor = segmentEnd;
  }
}

function getTaskState(task, progress, secondsKey, claimedKey) {
  const seconds = progress?.[secondsKey] || 0;
  const complete = seconds >= task.targetSeconds;
  return {
    ...task,
    progressSeconds: seconds,
    complete,
    claimed: progress?.[claimedKey] === true,
    claimable: complete && progress?.[claimedKey] !== true,
  };
}

async function getHostDailyProgress(userId, now = new Date()) {
  const date = getDateKey(now);
  const progress = await HostDailyProgress.findOne({ userId, date }).lean();
  return {
    date,
    timeZone: HOST_TASK_TIME_ZONE,
    resetsAt: '00:00',
    tasks: [
      getTaskState(HOST_DAILY_TASKS.onMic, progress, 'onMicSeconds', 'onMicClaimed'),
      getTaskState(HOST_DAILY_TASKS.crownMic, progress, 'crownMicSeconds', 'crownMicClaimed'),
    ],
  };
}

async function claimHostDailyTask(userId, taskId, now = new Date()) {
  const task = Object.values(HOST_DAILY_TASKS).find((entry) => entry.id === taskId);
  if (!task) {
    const error = new Error('Unknown host daily task.');
    error.status = 404;
    throw error;
  }

  const date = getDateKey(now);
  const claimedField = taskId === 'onMic' ? 'onMicClaimed' : 'crownMicClaimed';
  const secondsField = taskId === 'onMic' ? 'onMicSeconds' : 'crownMicSeconds';
  const rewardDiamonds = task.rewardDiamonds;
  let session;
  try {
    session = await mongoose.startSession();
    let user;
    let progress;
    await session.withTransaction(async () => {
      progress = await HostDailyProgress.findOneAndUpdate(
        {
          userId,
          date,
          [secondsField]: { $gte: task.targetSeconds },
          [claimedField]: { $ne: true },
        },
        { $set: { [claimedField]: true } },
        { new: true, session },
      );
      if (!progress) {
        const error = new Error('This task is not complete or its reward has already been claimed.');
        error.status = 409;
        throw error;
      }

      user = await User.findByIdAndUpdate(
        userId,
        { $inc: { diamonds: rewardDiamonds } },
        { new: true, session },
      ).select('diamonds');
      if (!user) {
        const error = new Error('User not found.');
        error.status = 404;
        throw error;
      }

      await Transaction.create([{
        userId,
        type: 'COMMISSION',
        amountDiamonds: rewardDiamonds,
        amountUsd: rewardDiamonds / DIAMONDS_PER_USD,
        referenceId: `host-daily:${date}:${taskId}`,
        status: 'COMPLETED',
      }], { session });
    });
    return {
      taskId,
      rewardDiamonds,
      diamonds: user.diamonds,
      progress: await getHostDailyProgress(userId, now),
    };
  } finally {
    if (session) await session.endSession();
  }
}

module.exports = {
  claimHostDailyTask,
  getDateKey,
  getHostDailyProgress,
  recordHostTime,
};
