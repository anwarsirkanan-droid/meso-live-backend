const mongoose = require('mongoose');

const agencySchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  name: { type: String, required: true },
  tier: { 
    type: String, 
    enum: ['D', 'C', 'B', 'A', 'S', 'S+'], 
    default: 'D' 
  },
  commissionRate: { type: Number, default: 0.08 }, // Default 8% (Tier D)
  monthlyGiftRevenue: { type: Number, default: 0 },
  todayGiftRevenue: { type: Number, default: 0 },
  yesterdayCommission: { type: Number, default: 0 },
  invitedByAgencyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agency', default: null },
  sLevelInvitesCount: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Agency', agencySchema);