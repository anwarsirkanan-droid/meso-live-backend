const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { 
    type: String, 
    enum: ['RECHARGE', 'GIFT_SENT', 'GIFT_RECEIVED', 'GAME_BET', 'GAME_WIN', 'COMMISSION', 'WITHDRAWAL'], 
    required: true 
  },
  amountCoins: { type: Number, default: 0 },
  amountDiamonds: { type: Number, default: 0 },
  amountUsd: { type: Number, default: 0 },
  referenceId: { type: String, default: '' }, // e.g., Gift ID, GameRound ID, or External Tx ID
  status: { 
    type: String, 
    enum: ['PENDING', 'COMPLETED', 'FAILED'], 
    default: 'COMPLETED' 
  }
}, { timestamps: true });

transactionSchema.index(
  { type: 1, referenceId: 1 },
  { unique: true, partialFilterExpression: { type: 'RECHARGE' } }
);

module.exports = mongoose.model('Transaction', transactionSchema);