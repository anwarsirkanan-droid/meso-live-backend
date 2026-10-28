const express = require('express');
const router = express.Router();
const Follow = require('../models/Follow');
const User = require('../models/User');
const Notification = require('../models/Notification');
const Room = require('../models/Room');
const auth = require('../middleware/auth');
const mongoose = require('mongoose');
const { withProfileMetadata } = require('../services/profileMetadata');

const publicUserFields = '-password -googleId';
const resolveUser = (userId) => {
  const query = mongoose.Types.ObjectId.isValid(userId)
    ? User.findById(userId)
    : Number.isInteger(Number(userId)) ? User.findOne({ publicId: Number(userId) }) : null;
  return query?.select(publicUserFields).populate('agencyId', 'name agencyName');
};

const normalizeUserId = (rawValue) => {
  if (!rawValue) return null;
  const value = String(rawValue).trim();
  if (!value) return null;
  if (mongoose.Types.ObjectId.isValid(value)) return value;
  const numericId = Number(value);
  return Number.isInteger(numericId) ? value : null;
};

const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password').populate('agencyId', 'name agencyName');
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.publicId == null) await user.save({ validateModifiedOnly: true });
    const profile = withProfileMetadata(user);
    // Ensure roles and publicId are included
    profile.role = user.role;
    profile.publicId = user.publicId;
    return res.json(profile);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

router.get('/me', auth, getProfile);
router.get('/profile', auth, getProfile);

router.get('/search', auth, async (req, res) => {
  const rawQuery = typeof req.query.q === 'string' ? req.query.q : req.query.id;
  const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';
  if (!query) return res.json([]);
  if (query.length > 80) return res.status(400).json({ message: 'Search query is too long.' });

  try {
    const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const numericId = Number(query);
    const users = await User.find({
      $or: [
        { username: expression },
        { name: expression },
        ...(Number.isInteger(numericId) ? [{ publicId: numericId }, { customId: query }] : []),
      ],
    }).select('publicId username name avatar profilePicture country isOnline lastSeen role').limit(50).lean();
    return res.json(users);
  } catch (err) {
    return res.status(500).json({ message: 'Could not search users.' });
  }
});

const getUserProfile = async (req, res) => {
  try {
    const user = await resolveUser(req.params.userId);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const activeRoom = await Room.findOne({ ownerId: user._id, isLive: true })
      .sort({ updatedAt: -1 })
      .select('_id title coverPhoto banner');
    const lastSeenAt = user.lastSeen ? new Date(user.lastSeen).getTime() : 0;
    const isOnline = user.isOnline === true || (lastSeenAt > Date.now() - 5 * 60 * 1000);
    const status = activeRoom ? 'LIVE' : isOnline ? 'ONLINE' : 'OFFLINE';
    const profile = withProfileMetadata(user);
    delete profile.password;
    return res.json({
      ...profile,
      isOnline,
      status,
      roomId: activeRoom?._id || null,
      roomTitle: activeRoom?.title || '',
      roomName: activeRoom?.title || '',
      roomAvatar: activeRoom?.coverPhoto || activeRoom?.banner || profile.avatar || profile.profilePicture || '',
    });
  } catch (err) {
    return res.status(500).json({ message: 'Could not load this profile.' });
  }
};

router.get('/:userId/profile', auth, getUserProfile);

router.post('/:userId/follow', auth, async (req, res) => {
  const targetUserId = normalizeUserId(req.params.userId);

  if (!targetUserId) {
    return res.status(400).json({ message: 'A valid userId is required.' });
  }

  try {
    const targetQuery = mongoose.Types.ObjectId.isValid(targetUserId)
      ? User.findById(targetUserId)
      : User.findOne({ publicId: Number(targetUserId) });
    const [currentUser, targetUser] = await Promise.all([
      User.findById(req.user.id).select('_id username following followers followingCount followersCount'),
      targetQuery.select('_id username following followers followingCount followersCount')
    ]);

    if (!currentUser || !targetUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    if (targetUser._id.equals(currentUser._id)) {
      return res.status(400).json({ message: 'You cannot follow yourself.' });
    }

    const canonicalTargetId = targetUser._id.toString();
    if (currentUser.following.some((id) => id && id.toString() === canonicalTargetId)) {
      return res.status(409).json({ message: 'You already follow this user' });
    }

    currentUser.following = Array.from(new Set([...(currentUser.following || []).map((id) => id.toString()), canonicalTargetId]));
    currentUser.followingCount = currentUser.following.length;

    targetUser.followers = Array.from(new Set([...(targetUser.followers || []).map((id) => id.toString()), currentUser._id.toString()]));
    targetUser.followersCount = targetUser.followers.length;

    await Promise.all([currentUser.save({ validateModifiedOnly: true }), targetUser.save({ validateModifiedOnly: true })]);

    await Follow.updateOne(
      { followerId: currentUser._id, followingId: targetUser._id },
      { $setOnInsert: { followerId: currentUser._id, followingId: targetUser._id } },
      { upsert: true, session }
    );

    await Notification.create({
      userId: targetUser._id,
      type: 'FOLLOW',
      title: 'New follower',
      message: `${currentUser.username} started following you.`
    });

    return res.status(201).json({ message: 'User followed successfully' });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Could not follow user.' });
  }
});

router.post('/:userId/unfollow', auth, async (req, res) => {
  const targetUserId = normalizeUserId(req.params.userId);

  if (!targetUserId) {
    return res.status(400).json({ message: 'A valid userId is required.' });
  }

  try {
    const targetQuery = mongoose.Types.ObjectId.isValid(targetUserId)
      ? User.findById(targetUserId)
      : User.findOne({ publicId: Number(targetUserId) });
    const [currentUser, targetUser] = await Promise.all([
      User.findById(req.user.id).select('_id following followers followingCount followersCount'),
      targetQuery.select('_id followers followersCount')
    ]);

    if (!currentUser || !targetUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    if (targetUser._id.equals(currentUser._id)) {
      return res.status(400).json({ message: 'You cannot unfollow yourself.' });
    }

    const canonicalTargetId = targetUser._id.toString();
    const currentUserId = currentUser._id.toString();
    const isFollowing = currentUser.following.some((id) => id && id.toString() === canonicalTargetId);
    if (!isFollowing) {
      return res.status(404).json({ message: 'You do not follow this user' });
    }

    currentUser.following = currentUser.following.filter((id) => id && id.toString() !== canonicalTargetId);
    targetUser.followers = targetUser.followers.filter((id) => id && id.toString() !== currentUserId);
    currentUser.followingCount = currentUser.following.length;
    targetUser.followersCount = targetUser.followers.length;

    await Promise.all([currentUser.save({ validateModifiedOnly: true }), targetUser.save({ validateModifiedOnly: true })]);

    await Follow.deleteOne({ followerId: currentUser._id, followingId: targetUser._id }, { session });

    return res.json({ message: 'User unfollowed successfully' });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Could not unfollow user.' });
  }
});

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
  const { username, phoneNumber, country, gender, bio, profilePicture, cover, birthday, album } = req.body || {};
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
  if (cover !== undefined && typeof cover !== 'string') {
    return res.status(400).json({ message: 'Cover image must be a valid image value.' });
  }
  if (birthday !== undefined && birthday !== '' && Number.isNaN(Date.parse(birthday))) {
    return res.status(400).json({ message: 'Birthday must be a valid date.' });
  }
  if (album !== undefined && (!Array.isArray(album) || album.length > 6 || album.some((image) => typeof image !== 'string'))) {
    return res.status(400).json({ message: 'Album must contain up to 6 image values.' });
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
    if (cover !== undefined) user.cover = cover;
    if (birthday !== undefined) user.birthday = birthday || null;
    if (album !== undefined) user.album = album;
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

router.put('/account', auth, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : undefined;
  const phoneNumber = typeof req.body?.phoneNumber === 'string' ? req.body.phoneNumber.trim() : undefined;
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (email !== undefined && !emailPattern.test(email)) {
    return res.status(400).json({ message: 'Please enter a valid email address.' });
  }
  if (phoneNumber !== undefined && phoneNumber && phoneNumber.length < 7) {
    return res.status(400).json({ message: 'Please enter a valid phone number.' });
  }
  if (email === undefined && phoneNumber === undefined) {
    return res.status(400).json({ message: 'An email or phone number is required.' });
  }

  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    if (email !== undefined && email !== user.email) {
      const existingUser = await User.findOne({ email, _id: { $ne: user._id } }).select('_id');
      if (existingUser) return res.status(409).json({ message: 'That email is already linked to another account.' });
      user.email = email;
    }
    if (phoneNumber !== undefined) user.phoneNumber = phoneNumber;
    await user.save({ validateModifiedOnly: true });
    const profile = withProfileMetadata(user);
    delete profile.password;
    return res.json({ message: 'Account details updated successfully.', user: profile });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'That email is already linked to another account.' });
    return res.status(500).json({ message: 'Could not update your account details.' });
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

// Convenience endpoints for the currently authenticated user's follower lists.
router.get('/followers', auth, async (req, res) => {
  try {
    const follows = await Follow.find({ followingId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(500)
      .populate('followerId', 'username avatar isOnline');
    return res.json(follows.map((follow) => ({
      ...(follow.followerId?.toObject?.() || {}),
      createdAt: follow.createdAt,
    })));
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.get('/following', auth, async (req, res) => {
  try {
    const follows = await Follow.find({ followerId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(500)
      .populate('followingId', 'username avatar isOnline');
    return res.json(follows.map((follow) => ({
      ...(follow.followingId?.toObject?.() || {}),
      createdAt: follow.createdAt,
    })));
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});


router.get('/:userId', auth, getUserProfile);

module.exports = router;
