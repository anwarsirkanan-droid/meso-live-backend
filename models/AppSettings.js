const mongoose = require('mongoose');

const appSettingsSchema = new mongoose.Schema({
  appName: { type: String, default: 'Meso Live' },
  appLogo: { type: String, default: '' },
  splashScreen: { type: String, default: '' },
  welcomeMessage: { type: String, default: 'Welcome to Meso Live!' }
}, { timestamps: true });

module.exports = mongoose.model('AppSettings', appSettingsSchema);
