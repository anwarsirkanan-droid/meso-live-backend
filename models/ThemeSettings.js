const mongoose = require('mongoose');

const themeSettingsSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  themeMode: { type: String, enum: ['light', 'dark', 'auto'], default: 'dark' },
  primaryColor: { type: String, default: '#7C3AED' },
  accentColor: { type: String, default: '#F59E0B' },
  fontSize: { type: String, default: 'medium' },
  animationsEnabled: { type: Boolean, default: true },
  animationLevel: { type: String, enum: ['NONE', 'LOW', 'MEDIUM', 'HIGH'], default: 'MEDIUM' },
  giftAnimationsEnabled: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('ThemeSettings', themeSettingsSchema);
