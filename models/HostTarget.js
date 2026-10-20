const mongoose = require('mongoose');

const hostTargetSchema = new mongoose.Schema({
  hostId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  agencyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agency', required: true, index: true },
  month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
  liveHoursTarget: { type: Number, default: 30, min: 0 },
  liveHoursCompleted: { type: Number, default: 0, min: 0 },
  diamondTarget: { type: Number, default: 50000, min: 0 },
  diamondsEarned: { type: Number, default: 0, min: 0 },
  targetStatus: {
    type: String,
    enum: ['in_progress', 'completed', 'failed'],
    default: 'in_progress'
  }
}, { timestamps: true });

hostTargetSchema.index({ hostId: 1, month: 1 }, { unique: true });
hostTargetSchema.index({ agencyId: 1, month: 1 });

module.exports = mongoose.model('HostTarget', hostTargetSchema);
