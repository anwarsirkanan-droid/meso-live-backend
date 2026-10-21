const mongoose = require('mongoose');

const agencyAgentApplicationSchema = new mongoose.Schema({
  applicantId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  currentAgencyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agency', default: null },
  agencyName: { type: String, required: true, trim: true, maxlength: 100 },
  phoneNumber: { type: String, required: true, trim: true, maxlength: 40 },
  experience: { type: String, required: true, trim: true, maxlength: 2000 },
  approvalType: { type: String, enum: ['AGENT', 'ADMIN'], required: true },
  proofImage: {
    type: Buffer,
    required: function proofRequired() { return this.approvalType === 'ADMIN'; },
  },
  proofMimeType: {
    type: String,
    required: function proofMimeTypeRequired() { return this.approvalType === 'ADMIN'; },
  },
  status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
}, { timestamps: true });

agencyAgentApplicationSchema.index(
  { applicantId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'PENDING' } },
);
agencyAgentApplicationSchema.index({ currentAgencyId: 1, status: 1, createdAt: 1 });

module.exports = mongoose.model('AgencyAgentApplication', agencyAgentApplicationSchema);
