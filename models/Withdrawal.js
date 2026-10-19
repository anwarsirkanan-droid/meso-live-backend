const mongoose = require('mongoose');
const { HOST_WITHDRAWAL_MINIMUM_DIAMONDS } = require('../config/commission');

const withdrawalSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  amountDiamonds: {
    type: Number,
    required: true,
    min: HOST_WITHDRAWAL_MINIMUM_DIAMONDS,
    validate: {
      validator: Number.isSafeInteger,
      message: 'Withdrawal amount must be a whole number of diamonds.',
    },
  },
  amountUsd: { type: Number, required: true, min: 10 },
  method: { type: String, enum: ['CBE', 'TELEBIRR', 'CRYPTO'], required: true },
  accountDetails: { type: String, required: true, trim: true, maxlength: 500 },
  status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED', 'PAID'], default: 'PENDING' },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
  paidAt: { type: Date, default: null },
  adminNote: { type: String, default: '', maxlength: 1000 },
}, { timestamps: true });

withdrawalSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Withdrawal', withdrawalSchema);
