const mongoose = require('mongoose');

const gameRoundSchema = new mongoose.Schema({
  gameType: { 
    type: String, 
    enum: ['MegaJackpot', 'Keno', '777', 'Jungle Hunt', 'Fish Hunter'], 
    required: true 
  },
  roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  betAmount: { type: Number, required: true },
  winAmount: { type: Number, default: 0 },
  isWin: { type: Boolean, default: false },
  resultMultiplier: { type: Number, default: 0 }, // e.g., 2x, 5x, 10x
  serverRngData: { type: Object, default: {} } // Stores details of RNG roll for audit
}, { timestamps: true });

module.exports = mongoose.model('GameRound', gameRoundSchema);