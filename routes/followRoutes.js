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
  if (!isValidObjectId(userId)) {
    return res.status(400).json({ message: 'A valid userId is required' });
  }
  if (new mongoose.Types.ObjectId(userId).equals(req.user.id)) {
    return res.status(400).json({ message: 'You cannot follow yourself' });
  }

  let session;
  try {
    session = await mongoose.startSession();
    let follower;
    let notification;
    await session.withTransaction(async () => {
      const following = await User.findById(userId).select('_id username');
      if (!following) {
        const error = new Error('User not found');
        error.status = 404;
        throw error;
      }

      await Follow.create([{
        followerId: req.user.id,
        followingId: userId
      }], { session });

      follower = await User.findByIdAndUpdate(
        req.user.id,
        { $inc: { followingCount: 1 } },
        { new: true, session }
      ).select('username');
      if (!follower) {
        const error = new Error('Authenticated user not found');
        error.status = 404;
        throw error;
      }

      const updatedFollowing = await User.findByIdAndUpdate(
        userId,
        { $inc: { followersCount: 1 } },
        { new: true, session }
      );
      if (!updatedFollowing) {
        const error = new Error('User not found');
        error.status = 404;
        throw error;
      }

      [notification] = await Notification.create([{
        userId,
        type: 'FOLLOW',
        title: 'New follower',
        message: `${follower.username} started following you.`
      }], { session });
    });

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
  if (!isValidObjectId(userId)) {
    return res.status(400).json({ message: 'A valid userId is required' });
  }
  if (new mongoose.Types.ObjectId(userId).equals(req.user.id)) {
    return res.status(400).json({ message: 'You cannot unfollow yourself' });
  }

  let session;
  try {
    session = await mongoose.startSession();
    let unfollowed = false;
    await session.withTransaction(async () => {
      const follow = await Follow.findOneAndDelete(
        { followerId: req.user.id, followingId: userId },
        { session }
      );
      if (!follow) return;

      const follower = await User.findByIdAndUpdate(
        req.user.id,
        { $inc: { followingCount: -1 } },
        { session }
      );
      const following = await User.findByIdAndUpdate(
        userId,
        { $inc: { followersCount: -1 } },
        { session }
      );
      if (!follower || !following) {
        throw new Error('Could not update follow counts because a user no longer exists');
      }
      unfollowed = true;
    });

    if (!unfollowed) return res.status(404).json({ message: 'You do not follow this user' });
    return res.json({ message: 'User unfollowed successfully' });
  } catch (err) {
    return res.status(500).json({ message: err.message });
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
