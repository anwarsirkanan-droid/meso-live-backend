const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true },
  reward: { type: Number, required: true, min: 0 },
  type: { type: String, enum: ['daily', 'weekly'], required: true },
  requirementTarget: { type: Number, required: true, min: 1 },
  active: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Task', taskSchema);
