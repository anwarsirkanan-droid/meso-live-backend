const mongoose = require('mongoose');

const policySchema = new mongoose.Schema({
  section: { type: String, required: true, trim: true, maxlength: 100 },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  content: { type: String, required: true, trim: true, maxlength: 20000 },
  version: { type: String, required: true, trim: true, default: '1.0' },
  status: { type: String, enum: ['DRAFT', 'PUBLISHED', 'RETIRED'], default: 'DRAFT' },
  publishedAt: { type: Date, default: null },
  publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

policySchema.index({ section: 1, status: 1, version: -1 });

module.exports = mongoose.model('Policy', policySchema);
