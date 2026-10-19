const mongoose = require('mongoose');

const giftSchema = new mongoose.Schema({
  name: { type: String, required: true },
  icon: { type: String, required: true },
  coinPrice: { type: Number, required: true },
  category: { 
    type: String, 
    enum: ['LUCKY', 'SUPER_LUCKY', 'LUXURY'], 
    required: true 
  },
  hostShareRate: { type: Number, required: true }, // e.g. 0.04 (Lucky), 0.02 (Super Lucky), 0.70 (Luxury)
  charmRate: { type: Number, required: true }      // e.g. 0.02, 0.04, 0.70
}, { timestamps: true });

module.exports = mongoose.model('Gift', giftSchema);