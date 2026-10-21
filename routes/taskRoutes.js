const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');
const {
  claimHostDailyTask,
  getHostDailyProgress,
} = require('../services/hostDailyTaskService');

const DAILY_TASKS = [
  { id: 'daily_login', title: 'Daily Login', rewardCoins: 50 },
  { id: 'send_gift', title: 'Send 1 Gift in Room', rewardCoins: 100 }
];

router.get('/host-daily', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('role isHost hostVerificationStatus');
    if (!user || (user.role !== 'HOST' && user.isHost !== true)) {
      return res.status(403).json({ message: 'Host daily tasks are available to hosts only.' });
    }
    if (user.hostVerificationStatus !== 'APPROVED') {
      return res.status(403).json({ message: 'Host verification must be approved before accessing Host Tasks.' });
    }
    return res.json(await getHostDailyProgress(req.user.id));
  } catch (err) {
    return res.status(500).json({ message: 'Could not load host daily tasks.' });
  }
});

router.post('/host-daily/:taskId/claim', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('role isHost hostVerificationStatus');
    if (!user || (user.role !== 'HOST' && user.isHost !== true)) {
      return res.status(403).json({ message: 'Host daily task rewards are available to hosts only.' });
    }
    if (user.hostVerificationStatus !== 'APPROVED') {
      return res.status(403).json({ message: 'Host verification must be approved before claiming Host Task rewards.' });
    }
    return res.json(await claimHostDailyTask(req.user.id, req.params.taskId));
  } catch (err) {
    return res.status(err.status || 500).json({
      message: err.status ? err.message : 'Could not claim the host daily task reward.',
    });
  }
});

router.get('/', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.json({ tasks: DAILY_TASKS, claimedTasks: user.claimedTasks || [] });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
