const mongoose = require('mongoose');

const dailyCheckInSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: {
    type: String,
    required: true,
    match: [/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD format']
  },
  coinsEarned: { type: Number, default: 0 },
  streak: { type: Number, default: 1 }
});

dailyCheckInSchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('DailyCheckIn', dailyCheckInSchema);
