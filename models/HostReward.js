const mongoose = require('mongoose');

const hostRewardSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  micSeconds: { type: Number, default: 0, min: 0 },
  crownSeconds: { type: Number, default: 0, min: 0 },
  micClaimed: { type: Boolean, default: false },
  crownClaimed: { type: Boolean, default: false },
  welcomeClaimed: { type: Boolean, default: false },
  lastResetDate: { type: Date, default: null },
  hostStartDate: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('HostReward', hostRewardSchema);
