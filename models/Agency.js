const mongoose = require('mongoose');
const { AGENCY_TIERS } = require('../config/commission');

const agencySchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  agencyName: { type: String, trim: true, unique: true, sparse: true },
  agencyCode: { type: String, trim: true, uppercase: true, unique: true, sparse: true },
  parentAgentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agency', default: null },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  name: { type: String, required: true },
  tier: {
    type: String,
    enum: AGENCY_TIERS.map(({ tier }) => tier),
    default: 'D'
  },
  commissionRate: {
    type: Number,
    default: function defaultCommissionRate() {
      return this.agencyName ? 10 : AGENCY_TIERS[0].rate;
    },
    min: 0,
    max: 100
  },
  monthlyGiftRevenue: { type: Number, default: 0 },
  totalEarnings: { type: Number, default: 0 },
  hostsCount: { type: Number, default: 0 },
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

agencySchema.pre('validate', function syncAgencyName() {
  if (!this.agencyName && this.name) this.agencyName = this.name;
  if (!this.name && this.agencyName) this.name = this.agencyName;
});

module.exports = mongoose.model('Agency', agencySchema);
