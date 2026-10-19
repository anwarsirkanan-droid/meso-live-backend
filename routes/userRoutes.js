const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');

const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    return res.json(user);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

router.get('/me', auth, getProfile);
router.get('/profile', auth, getProfile);

router.put('/update', auth, async (req, res) => {
  try {
    const { avatar, cover, bio } = req.body;
    const updates = {};
    if (avatar !== undefined) updates.avatar = avatar;
    if (cover !== undefined) updates.cover = cover;
    if (bio !== undefined) updates.bio = bio;
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'At least one profile field is required' });
    }
    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-password');
    if (!updatedUser) return res.status(404).json({ message: 'User not found' });
    return res.json({ message: 'Profile updated successfully', user: updatedUser });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
