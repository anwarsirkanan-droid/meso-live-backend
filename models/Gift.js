// backend/models/Gift.js
const mongoose = require('mongoose');

const giftSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    coinsPrice: { type: Number, required: true, min: 1 },
    icon: { type: String, default: '🎁' },
    animationUrl: { type: String, default: '' },
    // FIX: 'type' — giftController charm rate fayyadama
    type: {
      type: String,
      enum: ['normal', 'lucky', 'superLucky', 'luxury'],
      default: 'normal'
    },
    // FIX: 'active' — giftController mirkaneessa
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Gift', giftSchema);