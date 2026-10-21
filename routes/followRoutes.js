const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Follow = require('../models/Follow');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { verifyToken } = require('../middleware/authMiddleware');

const isValidObjectId = (value) =>
  typeof value === 'string' && mongoose.Types.ObjectId.isValid(value);

router.post('/follow', verifyToken, async (req, res) => {
  const { userId } = req.body || {};
  const targetObjectId = userId && String(userId).trim();

  if (!isValidObjectId(targetObjectId)) {
    return res.status(400).json({ message: 'A valid userId is required' });
  }

  const currentUserId = req.user.id;
  if (new mongoose.Types.ObjectId(targetObjectId).equals(currentUserId)) {
    return res.status(400).json({ message: 'You cannot follow yourself' });
  }

  let session;
  try {
    session = await mongoose.startSession();
    let follower;
    let notification;
    let alreadyFollowing = false;

    await session.withTransaction(async () => {
      const targetUser = await User.findById(targetObjectId).select('_id username followers following');
      if (!targetUser) {
        const error = new Error('User not found');
        error.status = 404;
        throw error;
      }

      const currentUser = await User.findById(currentUserId).select('_id username followers following');
      if (!currentUser) {
        const error = new Error('Authenticated user not found');
        error.status = 404;
        throw error;
      }

      const alreadyFollowingTarget = currentUser.following.some((id) => id && id.toString() === targetObjectId);
      if (alreadyFollowingTarget) {
        alreadyFollowing = true;
        return;
      }

      currentUser.following.addToSet(targetObjectId);
      targetUser.followers.addToSet(currentUserId);

      await currentUser.save({ session, validateModifiedOnly: true });
      await targetUser.save({ session, validateModifiedOnly: true });

      currentUser.followingCount = currentUser.following.length;
      targetUser.followersCount = targetUser.followers.length;
      await currentUser.save({ session, validateModifiedOnly: true });
      await targetUser.save({ session, validateModifiedOnly: true });

      follower = currentUser;
      [notification] = await Notification.create([{
        userId: targetObjectId,
        type: 'FOLLOW',
        title: 'New follower',
        message: `${follower.username} started following you.`
      }], { session });
    });

    if (alreadyFollowing) {
      return res.status(409).json({ message: 'You already follow this user' });
    }

    return res.status(201).json({ message: 'User followed successfully', notification });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'You already follow this user' });
    }
    return res.status(err.status || 500).json({ message: err.message });
  } finally {
    if (session) await session.endSession();
  }
});

router.post('/unfollow', verifyToken, async (req, res) => {
  const { userId } = req.body || {};
  const targetObjectId = userId && String(userId).trim();

  if (!isValidObjectId(targetObjectId)) {
    return res.status(400).json({ message: 'A valid userId is required' });
  }
  if (new mongoose.Types.ObjectId(targetObjectId).equals(req.user.id)) {
    return res.status(400).json({ message: 'You cannot unfollow yourself' });
  }

  let session;
  try {
    session = await mongoose.startSession();
    let unfollowed = false;

    await session.withTransaction(async () => {
      const currentUser = await User.findById(req.user.id).select('_id following followers');
      const targetUser = await User.findById(targetObjectId).select('_id followers following');

      if (!currentUser || !targetUser) {
        const error = new Error('User not found');
        error.status = 404;
        throw error;
      }

      const wasFollowing = currentUser.following.some((id) => id && id.toString() === targetObjectId);
      if (!wasFollowing) {
        return;
      }

      currentUser.following = currentUser.following.filter((id) => id && id.toString() !== targetObjectId);
      targetUser.followers = targetUser.followers.filter((id) => id && id.toString() !== req.user.id);

      currentUser.followingCount = currentUser.following.length;
      targetUser.followersCount = targetUser.followers.length;

      await currentUser.save({ session, validateModifiedOnly: true });
      await targetUser.save({ session, validateModifiedOnly: true });
      unfollowed = true;
    });

    if (!unfollowed) return res.status(404).json({ message: 'You do not follow this user' });
    return res.json({ message: 'User unfollowed successfully' });
  } catch (err) {
    return res.status(err.status || 500).json({ message: err.message });
  } finally {
    if (session) await session.endSession();
  }
});

const listFollowUsers = (queryField, userField) => async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isValidObjectId(userId)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }
    const follows = await Follow.find({ [queryField]: userId })
      .sort({ createdAt: -1 })
      .limit(500)
      .populate(userField, 'username avatar isOnline')
      .select(`${userField} createdAt`);
    return res.json(follows.map((follow) => ({
      user: follow[userField],
      createdAt: follow.createdAt
    })));
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

router.get('/followers/:userId', verifyToken, listFollowUsers('followingId', 'followerId'));
router.get('/following/:userId', verifyToken, listFollowUsers('followerId', 'followingId'));

router.get('/check/:userId', verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isValidObjectId(userId)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }
    const isFollowing = await Follow.exists({
      followerId: req.user.id,
      followingId: userId
    });
    return res.json({ isFollowing: Boolean(isFollowing) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
