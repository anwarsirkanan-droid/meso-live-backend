const mongoose = require('mongoose');

const hostSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  agencyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agency', required: true },
  hostLevel: { type: String, default: 'L' }, // S, A, B, C, D, E, F, G, H, I, J, K, L
  weeklyGiftPoints: { type: Number, default: 0 },
  weeklyLiveMinutes: { type: Number, default: 0 },
  isNewHost: { type: Boolean, default: true },
  joinDate: { type: Date, default: Date.now },
  faceVerified: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Host', hostSchema);