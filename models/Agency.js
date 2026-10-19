const mongoose = require('mongoose');
const { AGENCY_TIERS } = require('../config/commission');

const agencySchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  parentAgentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agency', default: null },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  name: { type: String, required: true },
  tier: {
    type: String,
    enum: AGENCY_TIERS.map(({ tier }) => tier),
    default: 'D'
  },
  commissionRate: { type: Number, default: AGENCY_TIERS[0].rate },
  monthlyGiftRevenue: { type: Number, default: 0 },
  todayGiftRevenue: { type: Number, default: 0 },
  yesterdayCommission: { type: Number, default: 0 },
  invitedByAgencyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agency', default: null },
  sLevelInvitesCount: { type: Number, default: 0 },
  protectionBonus: { type: Number, default: 0 },
  hostInviteCode: { type: String, default: undefined },
  agencyInviteCode: { type: String, default: undefined },
}, { timestamps: true });

agencySchema.index({ hostInviteCode: 1 }, { unique: true, sparse: true });
agencySchema.index({ agencyInviteCode: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Agency', agencySchema);