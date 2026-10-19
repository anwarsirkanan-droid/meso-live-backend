const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const FaceVerification = require('../models/FaceVerification');
const User = require('../models/User');
const Host = require('../models/Host');
const { verifyToken } = require('../middleware/authMiddleware');

// TODO: Real face-match AI (AWS Rekognition/Face++) can be added later via adapter pattern
const isFaceImage = (value) => {
  if (typeof value !== 'string' || value.length > 900000) return false;
  if (/^https?:\/\/\S+$/i.test(value)) return true;
  return /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ||
    /^[A-Za-z0-9+/]+={0,2}$/.test(value);
};

router.post('/submit', verifyToken, async (req, res) => {
  try {
    const { faceImage } = req.body || {};
    if (!isFaceImage(faceImage)) {
      return res.status(400).json({ message: 'faceImage must be a valid image URL or base64 image' });
    }
    const existingPending = await FaceVerification.findOne({
      userId: req.user.id,
      status: 'PENDING'
    });
    if (existingPending) {
      return res.status(409).json({
        message: 'A face verification is already pending review',
        verification: existingPending
      });
    }
    const verification = await FaceVerification.create({
      userId: req.user.id,
      faceImage
    });
    return res.status(201).json({ message: 'Face verification submitted', verification });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.get('/status', verifyToken, async (req, res) => {
  try {
    const verification = await FaceVerification.findOne({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .select('-faceImage');
    return res.json({
      status: verification ? verification.status : 'NOT_SUBMITTED',
      verification
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.put('/:id/review', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid verification ID' });
    }
    const { status, adminNote = '' } = req.body || {};
    if (!['VERIFIED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ message: 'status must be VERIFIED or REJECTED' });
    }
    if (typeof adminNote !== 'string' || adminNote.length > 1000) {
      return res.status(400).json({ message: 'adminNote must be a string no longer than 1000 characters' });
    }

    const verification = await FaceVerification.findOneAndUpdate(
      { _id: req.params.id, status: 'PENDING' },
      {
        $set: {
          status,
          adminNote,
          verifiedAt: status === 'VERIFIED' ? new Date() : null
        }
      },
      { new: true, runValidators: true }
    );
    if (!verification) {
      return res.status(404).json({ message: 'Pending face verification not found' });
    }
    const isVerified = status === 'VERIFIED';
    await User.findOneAndUpdate(
      { _id: verification.userId, role: 'HOST' },
      { $set: { isVerified, isFaceVerified: isVerified } }
    );
    await Host.findOneAndUpdate(
      { userId: verification.userId },
      { $set: { faceVerified: isVerified } }
    );
    return res.json({ message: 'Face verification reviewed', verification });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
