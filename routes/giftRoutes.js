const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const User = require('../models/User');
const Gift = require('../models/Gift');
const Room = require('../models/Room');
const Transaction = require('../models/Transaction');
const auth = require('../middleware/auth');
const { calculateLuckyGiftMultiplier, processGiftDistribution } = require('../services/giftService');

router.post('/send', auth, async (req, res) => {
  const { receiverId, giftId, roomId, count = 1 } = req.body || {};
  if (typeof receiverId !== 'string' || typeof giftId !== 'string' ||
      !mongoose.Types.ObjectId.isValid(receiverId) || !mongoose.Types.ObjectId.isValid(giftId)) {
    return res.status(400).json({ error: 'Valid receiverId and giftId are required' });
  }
  if (!Number.isSafeInteger(count) || count < 1 || count > 100) {
    return res.status(400).json({ error: 'Gift count must be a whole number between 1 and 100' });
  }
  if (new mongoose.Types.ObjectId(receiverId).equals(req.user.id)) {
    return res.status(400).json({ error: 'You cannot send a gift to yourself' });
  }
  if (roomId && (typeof roomId !== 'string' || !mongoose.Types.ObjectId.isValid(roomId))) {
    return res.status(400).json({ error: 'Invalid roomId' });
  }

  let session;
  let insufficientCoins = false;
  try {
    session = await mongoose.startSession();
    const [receiver, gift, room] = await Promise.all([
      User.findById(receiverId).select('_id username'),
      Gift.findById(giftId),
      roomId ? Room.findById(roomId) : null
    ]);
    if (!receiver || !gift) {
      return res.status(404).json({ error: 'Receiver or gift not found' });
    }
    if (roomId && !room) return res.status(404).json({ error: 'Room not found' });
    if (roomId && !room.ownerId.equals(receiverId) &&
        !room.seats.some((seat) => seat.userId?.equals(receiverId))) {
      return res.status(400).json({ error: 'Receiver is not participating in that room' });
    }
    if (!Number.isSafeInteger(gift.coinPrice) || gift.coinPrice <= 0 ||
        !Number.isFinite(gift.hostShareRate) || gift.hostShareRate < 0 || gift.hostShareRate > 1 ||
        !Number.isFinite(gift.charmRate) || gift.charmRate < 0 || gift.charmRate > 1) {
      return res.status(400).json({ error: 'Gift pricing or distribution is invalid' });
    }

    const totalCost = gift.coinPrice * count;
    if (!Number.isSafeInteger(totalCost)) {
      return res.status(400).json({ error: 'Gift total is outside the supported range' });
    }
    const { hostDiamonds, charmPoints } = processGiftDistribution(gift, totalCost);
    const luckyMultiplier = ['LUCKY', 'SUPER_LUCKY'].includes(gift.category)
      ? calculateLuckyGiftMultiplier(gift.category)
      : 0;
    const luckyWinCoins = totalCost * luckyMultiplier;
    if (!Number.isSafeInteger(luckyWinCoins)) {
      return res.status(400).json({ error: 'Gift payout is outside the supported range' });
    }

    let sender;
    let updatedReceiver;
    let transactions;
    await session.withTransaction(async () => {
      sender = await User.findOneAndUpdate(
        { _id: req.user.id, coins: { $gte: totalCost } },
        { $inc: { coins: luckyWinCoins - totalCost, charmPoints } },
        { new: true, session }
      );
      if (!sender) {
        insufficientCoins = true;
        throw new Error('Insufficient coins');
      }
      updatedReceiver = await User.findByIdAndUpdate(
        receiverId,
        { $inc: { diamonds: hostDiamonds } },
        { new: true, session }
      );
      if (!updatedReceiver) throw new Error('Receiver no longer exists');

      transactions = await Transaction.create([
        {
          userId: sender._id,
          type: 'GIFT_SENT',
          amountCoins: totalCost,
          referenceId: giftId
        },
        {
          userId: receiverId,
          type: 'GIFT_RECEIVED',
          amountDiamonds: hostDiamonds,
          referenceId: giftId
        }
      ], { session });
    });

    const io = req.app.get('io');
    if (roomId && io) {
      io.to(roomId).emit('gift_received', {
        senderName: sender.username,
        receiverName: receiver.username,
        giftName: gift.name,
        giftIcon: gift.icon,
        count,
        timestamp: new Date()
      });
      if (luckyWinCoins > 0 && luckyMultiplier >= 10) {
        io.to(roomId).emit('big_win_announcement', {
          winnerName: sender.username,
          giftName: gift.name,
          multiplier: luckyMultiplier,
          winAmount: luckyWinCoins
        });
      }
    }

    res.status(200).json({
      message: 'Gift sent successfully',
      spentCoins: totalCost,
      luckyWinCoins,
      luckyMultiplier,
      senderBalance: sender.coins,
      receiverDiamonds: updatedReceiver.diamonds,
      transactionId: transactions[0]._id
    });
  } catch (err) {
    if (insufficientCoins) {
      return res.status(400).json({ error: 'Insufficient coins' });
    }
    return res.status(500).json({ error: err.message });
  } finally {
    if (session) await session.endSession();
  }
});

module.exports = router;
