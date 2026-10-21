const mongoose = require('mongoose');

const agencyApplicationSchema = new mongoose.Schema({
  applicantId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  agencyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agency', required: true },
  targetAgencyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agency', default: null },
  applicationType: { type: String, enum: ['HOST', 'SUB_AGENCY', 'EXIT'], required: true },
  phoneNumber: { type: String, trim: true, default: '' },
  message: { type: String, default: '', maxlength: 1000 },
  status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
}, { timestamps: true });

agencyApplicationSchema.index(
  { applicantId: 1, agencyId: 1, applicationType: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'PENDING' } }
);

module.exports = mongoose.model('AgencyApplication', agencyApplicationSchema);
