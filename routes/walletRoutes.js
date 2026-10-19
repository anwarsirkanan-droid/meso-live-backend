const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');

router.get('/balance', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('coins diamonds charmPoints totalRechargedCoins');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/recharge', auth, async (req, res) => {
  const { amount } = req.body;
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return res.status(400).json({ message: 'Recharge amount must be a positive whole number' });
  }

  return res.status(501).json({
    message: 'Coin recharge is unavailable until a payment provider can verify the transaction.'
  });
});

module.exports = router;
