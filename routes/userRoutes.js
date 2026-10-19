const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');

const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.publicId == null) await user.save({ validateModifiedOnly: true });
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

router.put('/avatar', auth, async (req, res) => {
  const avatar = req.body?.avatar;
  const match = typeof avatar === 'string'
    ? avatar.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/)
    : null;
  if (!match) {
    return res.status(400).json({ message: 'Avatar must be a JPEG, PNG, or WebP image.' });
  }

  const image = Buffer.from(match[2], 'base64');
  if (image.length > 600 * 1024 || image.toString('base64') !== match[2]) {
    return res.status(400).json({ message: 'Avatar image must be smaller than 600 KB.' });
  }

  const isJpeg = match[1] === 'jpeg' && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
  const isPng = match[1] === 'png' &&
    image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = match[1] === 'webp' &&
    image.toString('ascii', 0, 4) === 'RIFF' &&
    image.toString('ascii', 8, 12) === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) {
    return res.status(400).json({ message: 'Avatar image data is invalid.' });
  }

  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    user.avatar = avatar;
    user.profilePicture = avatar;
    await user.save({ validateModifiedOnly: true });

    const profile = user.toJSON();
    delete profile.password;
    return res.json({ message: 'Profile picture updated successfully.', user: profile });
  } catch (err) {
    console.error('Could not update the profile picture:', err);
    return res.status(500).json({ message: 'Could not update the profile picture.' });
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
