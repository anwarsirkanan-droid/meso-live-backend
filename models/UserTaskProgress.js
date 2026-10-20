const mongoose = require('mongoose');

const userTaskProgressSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true },
  progress: { type: Number, default: 0, min: 0 },
  completed: { type: Boolean, default: false },
  claimed: { type: Boolean, default: false },
  claimedAt: { type: Date, default: null }
}, { timestamps: true });

userTaskProgressSchema.index({ userId: 1, taskId: 1 }, { unique: true });

module.exports = mongoose.model('UserTaskProgress', userTaskProgressSchema);
