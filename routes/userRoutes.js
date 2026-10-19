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

router.get('/username-availability', auth, async (req, res) => {
  const username = typeof req.query.username === 'string' ? req.query.username.trim() : '';
  if (!username) return res.status(400).json({ message: 'Username is required.' });

  try {
    const existingUser = await User.findOne({
      username,
      _id: { $ne: req.user.id }
    }).select('_id');
    return res.json({ available: !existingUser });
  } catch (err) {
    return res.status(500).json({ message: 'Could not check username availability.' });
  }
});

router.put('/profile', auth, async (req, res) => {
  const { username, phoneNumber, country, gender, bio, profilePicture } = req.body || {};
  const requiredFields = { username, phoneNumber, country, gender };
  if (Object.values(requiredFields).some((value) => typeof value !== 'string' || !value.trim())) {
    return res.status(400).json({ message: 'Username, phone number, country, and gender are required.' });
  }
  if (!['Male', 'Female', 'Other'].includes(gender)) {
    return res.status(400).json({ message: 'Gender must be Male, Female, or Other.' });
  }
  if (username.trim().length < 3 || username.trim().length > 24) {
    return res.status(400).json({ message: 'Username must be between 3 and 24 characters.' });
  }
  if (bio !== undefined && typeof bio !== 'string') {
    return res.status(400).json({ message: 'Bio must be a string.' });
  }
  if (profilePicture !== undefined && typeof profilePicture !== 'string') {
    return res.status(400).json({ message: 'Profile picture must be a valid image value.' });
  }

  try {
    const usernameValue = username.trim();
    const existingUser = await User.findOne({
      username: usernameValue,
      _id: { $ne: req.user.id }
    }).select('_id');
    if (existingUser) return res.status(400).json({ message: 'That username is already taken.' });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    user.username = usernameValue;
    user.phoneNumber = phoneNumber.trim();
    user.country = country.trim();
    user.gender = gender;
    user.bio = typeof bio === 'string' ? bio.trim() : '';
    user.profilePicture = profilePicture ?? user.profilePicture ?? user.avatar ?? '';
    user.avatar = user.profilePicture;
    user.profileComplete = true;
    await user.save({ validateModifiedOnly: true });

    const profile = user.toJSON();
    delete profile.password;
    return res.json({ message: 'Profile setup complete.', user: profile });
  } catch (err) {
    if (err.code === 11000 && err.keyPattern?.username) {
      return res.status(400).json({ message: 'That username is already taken.' });
    }
    if (err.name === 'ValidationError') {
      return res.status(400).json({ message: err.message });
    }
    return res.status(500).json({ message: 'Could not save your profile.' });
  }
});

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
