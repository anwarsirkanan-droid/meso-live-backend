// backend/controllers/giftController.js
const Room = require('../models/Room');
const Gift = require('../models/Gift');
const User = require('../models/User');

// Get Gift Catalog — from DB
exports.getGiftCatalog = async (req, res) => {
  try {
    const gifts = await Gift.find({ active: true }).sort({ coinsPrice: 1 });
    res.json(gifts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Send Gift — deduct coins + charm + diamonds + broadcast
exports.sendGift = async (req, res) => {
  try {
    const { roomId, receiverId, giftId, quantity } = req.body;
    const sender = req.user;
    const qty = Math.max(1, Math.min(100, Number(quantity) || 1));

    const gift = await Gift.findById(giftId);
    if (!gift || !gift.active) return res.status(404).json({ error: 'Gift not found' });

    const room = await Room.findById(roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const receiver = await User.findById(receiverId);
    if (!receiver) return res.status(404).json({ error: 'Receiver not found' });

    const totalCost = gift.coinsPrice * qty;
    if (sender.coins < totalCost) {
      return res.status(400).json({ error: 'Not enough coins' });
    }

    // Atomic coin deduction
    const result = await User.updateOne(
      { _id: sender._id, coins: { $gte: totalCost } },
      { $inc: { coins: -totalCost } }
    );
    if (result.modifiedCount === 0) {
      return res.status(400).json({ error: 'Not enough coins' });
    }

    // Charm points per gift type
    const charmRates = { luxury: 0.70, lucky: 0.04, superLucky: 0.02, normal: 0 };
    const charmRate = charmRates[gift.type] || 0;
    const charmPoints = Math.floor(totalCost * charmRate);

    if (charmPoints > 0) {
      await User.updateOne({ _id: sender._id }, { $inc: { charmPoints } });
      await User.updateOne({ _id: receiverId }, { $inc: { charmPoints } });
    }

    // Diamonds to receiver (host)
    const diamondsEarned = Math.floor(totalCost / 100);
    await User.updateOne({ _id: receiverId }, { $inc: { diamonds: diamondsEarned } });

    const giftPayload = {
      senderId: sender._id,
      senderName: sender.username,
      receiverId,
      giftId,
      giftName: gift.name,
      giftIcon: gift.icon,
      quantity: qty,
      totalCost,
      charmPoints,
      timestamp: new Date().toISOString(),
    };

    req.io?.in(roomId).emit('gift_sent', giftPayload);
    res.json({ success: true, gift: giftPayload, charmPoints, diamondsEarned });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};