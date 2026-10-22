import express from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import auth from '../middleware/authMiddleware.js';

const router = express.Router();

// Helper function to normalize userId (Supports MongoDB ObjectId or numeric publicId)
const normalizeUserId = (id) => {
  if (!id) return null;
  return id.trim();
};

// ==========================================
// FOLLOW — atomic ($addToSet & $inc)
// ==========================================
router.post('/:userId/follow', auth, async (req, res) => {
  const targetUserId = normalizeUserId(req.params.userId);
  if (!targetUserId) {
    return res.status(400).json({ message: 'A valid userId is required.' });
  }

  try {
    const targetQuery = mongoose.Types.ObjectId.isValid(targetUserId)
      ? User.findById(targetUserId)
      : User.findOne({ publicId: Number(targetUserId) });

    const targetUser = await targetQuery.select('_id username followers');
    if (!targetUser) return res.status(404).json({ message: 'User not found.' });

    if (targetUser._id.equals(req.user.id)) {
      return res.status(400).json({ message: 'You cannot follow yourself.' });
    }

    // Atomic update to prevent race conditions
    const [me, target] = await Promise.all([
      User.updateOne(
        { _id: req.user.id, following: { $ne: targetUser._id } },
        { $addToSet: { following: targetUser._id }, $inc: { followingCount: 1 } }
      ),
      User.updateOne(
        { _id: targetUser._id, followers: { $ne: req.user.id } },
        { $addToSet: { followers: req.user.id }, $inc: { followersCount: 1 } }
      ),
    ]);

    if (me.modifiedCount === 0) {
      return res.status(409).json({ message: 'You already follow this user' });
    }

    // Create Notification for target user
    await Notification.create({
      userId: targetUser._id,
      type: 'FOLLOW',
      title: 'New follower',
      message: `${req.user.username || 'Someone'} started following you.`
    });

    return res.status(201).json({ message: 'User followed successfully' });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Could not follow user.' });
  }
});

// ==========================================
// UNFOLLOW — atomic ($pull & $inc)
// FIX: Stub route HAQAME — kun qofa jira
// ==========================================
router.post('/:userId/unfollow', auth, async (req, res) => {
  const targetUserId = normalizeUserId(req.params.userId);
  if (!targetUserId) {
    return res.status(400).json({ message: 'A valid userId is required.' });
  }

  try {
    const targetQuery = mongoose.Types.ObjectId.isValid(targetUserId)
      ? User.findById(targetUserId)
      : User.findOne({ publicId: Number(targetUserId) });

    const targetUser = await targetQuery.select('_id followers');
    if (!targetUser) return res.status(404).json({ message: 'User not found.' });

    // Atomic update to remove follow relationship
    const [me, target] = await Promise.all([
      User.updateOne(
        { _id: req.user.id, following: targetUser._id },
        { $pull: { following: targetUser._id }, $inc: { followingCount: -1 } }
      ),
      User.updateOne(
        { _id: targetUser._id, followers: req.user.id },
        { $pull: { followers: req.user.id }, $inc: { followersCount: -1 } }
      ),
    ]);

    if (me.modifiedCount === 0) {
      return res.status(404).json({ message: 'You do not follow this user' });
    }

    return res.json({ message: 'User unfollowed successfully' });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Could not unfollow user.' });
  }
});

export default router;