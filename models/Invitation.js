const mongoose = require('mongoose');

const invitationSchema = new mongoose.Schema({
  inviterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  inviteeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  inviteCode: { type: String, required: true, unique: true },
  status: { type: String, enum: ['PENDING', 'ACCEPTED', 'EXPIRED'], default: 'PENDING' },
  rewardCoins: { type: Number, default: 50 },
  createdAt: { type: Date, default: Date.now },
  acceptedAt: { type: Date, default: null }
}, { timestamps: false });

invitationSchema.index(
  { inviteeId: 1 },
  { unique: true, partialFilterExpression: { inviteeId: { $type: 'objectId' } } }
);

module.exports = mongoose.model('Invitation', invitationSchema);
