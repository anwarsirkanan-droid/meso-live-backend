const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');

const DAILY_TASKS = [
  { id: 'daily_login', title: 'Daily Login', rewardCoins: 50 },
  { id: 'send_gift', title: 'Send 1 Gift in Room', rewardCoins: 100 }
];

router.get('/', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.json({ tasks: DAILY_TASKS, claimedTasks: user.claimedTasks || [] });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;