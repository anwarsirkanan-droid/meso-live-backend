const mongoose = require('mongoose');

const userIdCounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  sequence: { type: Number, required: true }
}, { versionKey: false });

module.exports = mongoose.model('UserIdCounter', userIdCounterSchema);
