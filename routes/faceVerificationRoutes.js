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
  return /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
};

router.post('/submit', verifyToken, async (req, res) => {
  try {
    const { faceImage } = req.body || {};
    if (!isFaceImage(faceImage)) {
      return res.status(400).json({ message: 'faceImage must be a valid image URL or base64 image' });
    }
    const existingPending = await FaceVerification.findOne({
      userId: req.user.id,
      status: 'PENDING_APPROVAL'
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
    await User.findByIdAndUpdate(req.user.id, {
      $set: { hostVerificationStatus: 'PENDING_APPROVAL', isFaceVerified: false }
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

router.get('/pending', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'AGENT' && req.user.isAgent !== true) {
      return res.status(403).json({ message: 'Admin or Agent access required' });
    }
    const verifications = await FaceVerification.find({ status: 'PENDING_APPROVAL' })
      .populate('userId', 'publicId username name avatar profilePicture role hostVerificationStatus')
      .sort({ createdAt: 1 });
    return res.json({ verifications });
  } catch (err) {
    return res.status(500).json({ message: 'Could not load pending face verifications' });
  }
});

router.put('/:id/review', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'AGENT' && req.user.isAgent !== true) {
      return res.status(403).json({ message: 'Admin or Agent access required' });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid verification ID' });
    }
    const { status, adminNote = '' } = req.body || {};
    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ message: 'status must be APPROVED or REJECTED' });
    }
    if (typeof adminNote !== 'string' || adminNote.length > 1000) {
      return res.status(400).json({ message: 'adminNote must be a string no longer than 1000 characters' });
    }

    const verification = await FaceVerification.findOneAndUpdate(
      { _id: req.params.id, status: 'PENDING_APPROVAL' },
      {
        $set: {
          status,
          adminNote,
          verifiedAt: status === 'APPROVED' ? new Date() : null
        }
      },
      { new: true, runValidators: true }
    );
    if (!verification) {
      return res.status(404).json({ message: 'Pending face verification not found' });
    }
    const isVerified = status === 'APPROVED';
    await User.findOneAndUpdate(
      { _id: verification.userId },
      { $set: { isVerified, isFaceVerified: isVerified, hostVerificationStatus: status } }
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
