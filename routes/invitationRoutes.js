const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Invitation = require('../models/Invitation');
const User = require('../models/User');
const { verifyToken } = require('../middleware/authMiddleware');

const createInviteCode = () => crypto.randomBytes(6).toString('base64url').toUpperCase();

router.post('/generate', verifyToken, async (req, res) => {
  try {
    const existing = await Invitation.findOne({ inviterId: req.user.id });
    if (existing) return res.json({ inviteCode: existing.inviteCode, invitation: existing });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const invitation = await Invitation.create({
          inviterId: req.user.id,
          inviteCode: createInviteCode()
        });
        return res.status(201).json({
          inviteCode: invitation.inviteCode,
          invitation
        });
      } catch (err) {
        if (err.code !== 11000) throw err;
        const concurrent = await Invitation.findOne({ inviterId: req.user.id });
        if (concurrent) {
          return res.json({ inviteCode: concurrent.inviteCode, invitation: concurrent });
        }
      }
    }
    return res.status(503).json({ message: 'Could not generate a unique invite code; please try again' });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.post('/accept', verifyToken, async (req, res) => {
  const { inviteCode } = req.body || {};
  if (typeof inviteCode !== 'string' || !inviteCode.trim()) {
    return res.status(400).json({ message: 'inviteCode is required' });
  }

  let session;
  try {
    session = await mongoose.startSession();
    let acceptedInvitation;
    let inviter;
    await session.withTransaction(async () => {
      const invitation = await Invitation.findOne({ inviteCode: inviteCode.trim().toUpperCase() })
        .session(session);
      if (!invitation || invitation.status !== 'PENDING' || invitation.inviteeId) {
        const error = new Error('Pending invitation not found');
        error.status = 404;
        throw error;
      }
      if (invitation.inviterId.equals(req.user.id)) {
        const error = new Error('You cannot accept your own invitation');
        error.status = 400;
        throw error;
      }

      const alreadyInvited = await Invitation.exists({
        inviteeId: req.user.id,
        status: 'ACCEPTED'
      }).session(session);
      if (alreadyInvited) {
        const error = new Error('You have already accepted an invitation');
        error.status = 409;
        throw error;
      }

      acceptedInvitation = await Invitation.findOneAndUpdate(
        { _id: invitation._id, status: 'PENDING', inviteeId: null },
        {
          $set: {
            inviteeId: req.user.id,
            status: 'ACCEPTED',
            acceptedAt: new Date()
          }
        },
        { new: true, session }
      );
      if (!acceptedInvitation) {
        const error = new Error('Invitation has already been accepted');
        error.status = 409;
        throw error;
      }

      inviter = await User.findByIdAndUpdate(
        invitation.inviterId,
        { $inc: { coins: invitation.rewardCoins, rewardCoins: invitation.rewardCoins } },
        { new: true, session }
      ).select('coins rewardCoins');
      if (!inviter) throw new Error('Invitation owner not found');
    });

    return res.json({
      message: 'Invitation accepted successfully',
      rewardCoins: acceptedInvitation.rewardCoins
    });
  } catch (err) {
    return res.status(err.status || 500).json({ message: err.message });
  } finally {
    if (session) await session.endSession();
  }
});

router.get('/my-invitees', verifyToken, async (req, res) => {
  try {
    const invitations = await Invitation.find({ inviterId: req.user.id })
      .populate('inviteeId', 'username avatar')
      .sort({ createdAt: -1 });
    return res.json(invitations);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.get('/stats', verifyToken, async (req, res) => {
  try {
    const [stats] = await Invitation.aggregate([
      { $match: { inviterId: new mongoose.Types.ObjectId(req.user.id), status: 'ACCEPTED' } },
      {
        $group: {
          _id: null,
          acceptedInvitations: { $sum: 1 },
          rewardCoinsEarned: { $sum: '$rewardCoins' }
        }
      }
    ]);
    return res.json({
      acceptedInvitations: stats ? stats.acceptedInvitations : 0,
      rewardCoinsEarned: stats ? stats.rewardCoinsEarned : 0
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
