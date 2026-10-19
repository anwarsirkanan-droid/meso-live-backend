const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const DailyCheckIn = require('../models/DailyCheckIn');
const User = require('../models/User');
const { verifyToken } = require('../middleware/authMiddleware');

const COINS_PER_CHECK_IN = 10;
const getDateKey = (date) => date.toISOString().slice(0, 10);

router.post('/', verifyToken, async (req, res) => {
  const today = getDateKey(new Date());
  const yesterday = getDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
  let session;

  try {
    session = await mongoose.startSession();
    let checkIn;
    let user;
    await session.withTransaction(async () => {
      const previousCheckIn = await DailyCheckIn.findOne({
        userId: req.user.id,
        date: yesterday
      }).session(session);
      const streak = previousCheckIn ? previousCheckIn.streak + 1 : 1;

      [checkIn] = await DailyCheckIn.create([{
        userId: req.user.id,
        date: today,
        coinsEarned: COINS_PER_CHECK_IN,
        streak
      }], { session });

      user = await User.findByIdAndUpdate(
        req.user.id,
        {
          $inc: { coins: COINS_PER_CHECK_IN },
          $set: { checkInStreak: streak }
        },
        { new: true, session }
      ).select('coins checkInStreak');
      if (!user) {
        const error = new Error('User not found');
        error.status = 404;
        throw error;
      }
    });

    return res.status(201).json({
      message: 'Daily check-in successful',
      coinsEarned: checkIn.coinsEarned,
      streak: checkIn.streak,
      balance: user.coins
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'You have already checked in today' });
    }
    return res.status(err.status || 500).json({ message: err.message });
  } finally {
    if (session) await session.endSession();
  }
});

router.get('/status', verifyToken, async (req, res) => {
  try {
    const today = getDateKey(new Date());
    const yesterday = getDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const [todayCheckIn, yesterdayCheckIn] = await Promise.all([
      DailyCheckIn.findOne({ userId: req.user.id, date: today }).select('streak coinsEarned'),
      DailyCheckIn.findOne({ userId: req.user.id, date: yesterday }).select('streak')
    ]);
    return res.json({
      checkedInToday: Boolean(todayCheckIn),
      currentStreak: todayCheckIn ? todayCheckIn.streak : yesterdayCheckIn ? yesterdayCheckIn.streak : 0,
      coinsEarnedToday: todayCheckIn ? todayCheckIn.coinsEarned : 0
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
