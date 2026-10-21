const mongoose = require('mongoose');

const faceVerificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'], default: 'PENDING_APPROVAL' },
  faceImage: { type: String, required: true },
  verifiedAt: { type: Date, default: null },
  adminNote: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('FaceVerification', faceVerificationSchema);
