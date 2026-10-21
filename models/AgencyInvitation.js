const mongoose = require('mongoose');

const agencyInvitationSchema = new mongoose.Schema({
  agencyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agency', required: true, index: true },
  agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  inviteeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ['PENDING', 'ACCEPTED', 'REJECTED'], default: 'PENDING', index: true },
  createdAt: { type: Date, default: Date.now },
  respondedAt: { type: Date, default: null }
}, { timestamps: true });

agencyInvitationSchema.index(
  { agencyId: 1, inviteeId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'PENDING' } }
);

module.exports = mongoose.model('AgencyInvitation', agencyInvitationSchema);
