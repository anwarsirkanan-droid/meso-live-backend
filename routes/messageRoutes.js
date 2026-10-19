const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Message = require('../models/Message');
const User = require('../models/User');
const auth = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const messages = await Message.find({ receiverId: req.user.id })
      .populate('senderId', 'username avatar')
      .sort({ createdAt: -1 })
      .limit(100);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/send', auth, async (req, res) => {
  try {
    const { receiverId, content, type = 'USER' } = req.body;
    if (typeof receiverId !== 'string' || !mongoose.Types.ObjectId.isValid(receiverId)) {
      return res.status(400).json({ message: 'A valid receiverId is required' });
    }
    if (typeof content !== 'string' || !content.trim() || content.trim().length > 2000) {
      return res.status(400).json({ message: 'Message content must be between 1 and 2000 characters' });
    }
    if (type !== 'USER') {
      return res.status(400).json({ message: 'Only USER messages can be sent through this endpoint' });
    }
    if (new mongoose.Types.ObjectId(receiverId).equals(req.user.id)) {
      return res.status(400).json({ message: 'You cannot send a message to yourself' });
    }
    const receiver = await User.findById(receiverId).select('_id');
    if (!receiver) return res.status(404).json({ message: 'Receiver not found' });

    const message = await Message.create({
      senderId: req.user.id,
      receiverId,
      type,
      content: content.trim()
    });
    res.status(201).json({ message: 'Message sent successfully', data: message });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
