const mongoose = require('mongoose');

const hostDailyProgressSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: String, required: true },
  onMicSeconds: { type: Number, default: 0, min: 0 },
  crownMicSeconds: { type: Number, default: 0, min: 0 },
  onMicClaimed: { type: Boolean, default: false },
  crownMicClaimed: { type: Boolean, default: false },
}, { timestamps: true });

hostDailyProgressSchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('HostDailyProgress', hostDailyProgressSchema);
