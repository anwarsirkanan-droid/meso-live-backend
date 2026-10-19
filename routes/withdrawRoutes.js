const express = require('express');
const mongoose = require('mongoose');
const Withdrawal = require('../models/Withdrawal');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const auth = require('../middleware/auth');
const {
  DIAMONDS_PER_USD,
  HOST_WITHDRAWAL_MINIMUM_DIAMONDS,
} = require('../config/commission');

const router = express.Router();
const WITHDRAWAL_METHODS = ['CBE', 'TELEBIRR', 'CRYPTO'];

router.post('/request', auth, async (req, res) => {
  const { amountDiamonds, method, accountDetails } = req.body || {};
  if (!Number.isSafeInteger(amountDiamonds) || amountDiamonds < HOST_WITHDRAWAL_MINIMUM_DIAMONDS) {
    return res.status(400).json({
      message: `amountDiamonds must be a whole number of at least ${HOST_WITHDRAWAL_MINIMUM_DIAMONDS}.`,
    });
  }
  if (!WITHDRAWAL_METHODS.includes(method)) {
    return res.status(400).json({ message: 'method must be CBE, TELEBIRR, or CRYPTO.' });
  }
  if (typeof accountDetails !== 'string' || !accountDetails.trim() || accountDetails.trim().length > 500) {
    return res.status(400).json({ message: 'accountDetails is required and must be at most 500 characters.' });
  }

  let session;
  let insufficientDiamonds = false;
  try {
    session = await mongoose.startSession();
    let withdrawal;
    await session.withTransaction(async () => {
      const user = await User.findOneAndUpdate(
        { _id: req.user.id, role: 'HOST', diamonds: { $gte: amountDiamonds } },
        { $inc: { diamonds: -amountDiamonds } },
        { new: true, session }
      );
      if (!user) {
        const existingUser = await User.findById(req.user.id).select('role diamonds').session(session);
        if (!existingUser || existingUser.role !== 'HOST') {
          const error = new Error('Only hosts can request diamond withdrawals.');
          error.status = 403;
          throw error;
        }
        insufficientDiamonds = true;
        throw new Error('Insufficient diamonds');
      }

      [withdrawal] = await Withdrawal.create([{
        userId: user._id,
        amountDiamonds,
        amountUsd: amountDiamonds / DIAMONDS_PER_USD,
        method,
        accountDetails: accountDetails.trim(),
      }], { session });
      await Transaction.create([{
        userId: user._id,
        type: 'WITHDRAWAL',
        amountDiamonds,
        amountUsd: withdrawal.amountUsd,
        referenceId: withdrawal._id.toString(),
        status: 'PENDING',
      }], { session });
    });
    return res.status(201).json({
      message: 'Withdrawal request submitted.',
      withdrawal,
    });
  } catch (err) {
    if (insufficientDiamonds) {
      return res.status(400).json({ message: 'Insufficient diamonds for this withdrawal.' });
    }
    if (err.status) return res.status(err.status).json({ message: err.message });
    return res.status(500).json({ message: 'Could not submit the withdrawal request.' });
  } finally {
    if (session) await session.endSession();
  }
});

router.get('/mine', auth, async (req, res) => {
  try {
    const withdrawals = await Withdrawal.find({ userId: req.user.id })
      .select('-accountDetails')
      .sort({ createdAt: -1 })
      .limit(100);
    return res.json(withdrawals);
  } catch (err) {
    return res.status(500).json({ message: 'Could not load withdrawal history.' });
  }
});

router.get('/admin/requests', auth, async (req, res) => {
  try {
    const admin = await User.findById(req.user.id).select('role');
    if (!admin || admin.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Admin access required.' });
    }
    const status = req.query.status || 'PENDING';
    if (!['PENDING', 'APPROVED', 'REJECTED', 'PAID'].includes(status)) {
      return res.status(400).json({ message: 'Invalid withdrawal status.' });
    }
    const withdrawals = await Withdrawal.find({ status })
      .populate('userId', 'username email')
      .sort({ createdAt: 1 })
      .limit(100);
    return res.json(withdrawals);
  } catch (err) {
    return res.status(500).json({ message: 'Could not load admin withdrawal requests.' });
  }
});

router.patch('/admin/:withdrawalId', auth, async (req, res) => {
  const { action, adminNote = '' } = req.body || {};
  if (!['APPROVE', 'REJECT', 'PAID'].includes(action)) {
    return res.status(400).json({ message: 'action must be APPROVE, REJECT, or PAID.' });
  }
  if (typeof adminNote !== 'string' || adminNote.length > 1000) {
    return res.status(400).json({ message: 'adminNote must be a string no longer than 1000 characters.' });
  }
  if (!mongoose.Types.ObjectId.isValid(req.params.withdrawalId)) {
    return res.status(400).json({ message: 'Invalid withdrawal ID.' });
  }

  let session;
  try {
    const admin = await User.findById(req.user.id).select('role');
    if (!admin || admin.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Admin access required.' });
    }
    session = await mongoose.startSession();
    let withdrawal;
    await session.withTransaction(async () => {
      const current = await Withdrawal.findById(req.params.withdrawalId).session(session);
      if (!current) {
        const error = new Error('Withdrawal request not found.');
        error.status = 404;
        throw error;
      }
      const allowedStatuses = action === 'APPROVE'
        ? ['PENDING']
        : action === 'REJECT'
          ? ['PENDING', 'APPROVED']
          : ['APPROVED'];
      if (!allowedStatuses.includes(current.status)) {
        const error = new Error(`Cannot ${action.toLowerCase()} a ${current.status.toLowerCase()} withdrawal.`);
        error.status = 409;
        throw error;
      }

      const nextStatus = action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : 'PAID';
      const update = {
        status: nextStatus,
        reviewedBy: req.user.id,
        reviewedAt: new Date(),
        adminNote: adminNote.trim(),
      };
      if (nextStatus === 'PAID') update.paidAt = new Date();
      withdrawal = await Withdrawal.findOneAndUpdate(
        { _id: current._id, status: { $in: allowedStatuses } },
        { $set: update },
        { new: true, runValidators: true, session }
      );
      if (!withdrawal) {
        const error = new Error('Withdrawal request changed while being reviewed.');
        error.status = 409;
        throw error;
      }
      if (action === 'REJECT') {
        const refundedUser = await User.findByIdAndUpdate(
          current.userId,
          { $inc: { diamonds: current.amountDiamonds } },
          { new: true, session }
        );
        if (!refundedUser) throw new Error('Withdrawal owner no longer exists.');
      }
      if (action === 'PAID' || action === 'REJECT') {
        await Transaction.updateOne(
          { userId: current.userId, type: 'WITHDRAWAL', referenceId: current._id.toString() },
          { $set: { status: action === 'PAID' ? 'COMPLETED' : 'FAILED' } },
          { session }
        );
      }
    });
    const statusMessages = {
      APPROVE: 'Withdrawal approved successfully.',
      REJECT: 'Withdrawal rejected and diamonds refunded.',
      PAID: 'Withdrawal marked as paid.',
    };
    return res.json({ message: statusMessages[action], withdrawal });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    return res.status(500).json({ message: 'Could not update the withdrawal request.' });
  } finally {
    if (session) await session.endSession();
  }
});

module.exports = router;
