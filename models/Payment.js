const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  provider: { type: String, enum: ['chapa', 'mock'], required: true },
  transactionRef: { type: String, required: true, unique: true },
  amount: { type: Number, required: true, min: 0.01 },
  currency: { type: String, required: true, uppercase: true, trim: true },
  coinsToCredit: { type: Number, required: true, min: 1 },
  description: { type: String, required: true, maxlength: 255 },
  status: {
    type: String,
    enum: ['PENDING', 'COMPLETED', 'FAILED'],
    default: 'PENDING'
  },
  checkoutUrl: { type: String, default: null },
  providerTransactionId: { type: String, default: null },
  verifiedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Payment', paymentSchema);
