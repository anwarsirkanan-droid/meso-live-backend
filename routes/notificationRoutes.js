const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Notification = require('../models/Notification');
const { verifyToken } = require('../middleware/authMiddleware');

router.get('/', verifyToken, async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(100);
    return res.json(notifications);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.put('/read/:id', verifyToken, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid notification ID' });
    }
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { $set: { isRead: true } },
      { new: true }
    );
    if (!notification) return res.status(404).json({ message: 'Notification not found' });
    return res.json(notification);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.put('/read-all', verifyToken, async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { userId: req.user.id, isRead: false },
      { $set: { isRead: true } }
    );
    return res.json({ message: 'Notifications marked as read', modifiedCount: result.modifiedCount });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.get('/unread-count', verifyToken, async (req, res) => {
  try {
    const count = await Notification.countDocuments({ userId: req.user.id, isRead: false });
    return res.json({ count });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
