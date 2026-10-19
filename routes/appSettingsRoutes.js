const express = require('express');
const router = express.Router();
const AppSettings = require('../models/AppSettings');
const { verifyToken } = require('../middleware/authMiddleware');

const SETTINGS_ID = '000000000000000000000001';
const EDITABLE_FIELDS = ['appName', 'appLogo', 'splashScreen', 'welcomeMessage'];

router.get('/', async (req, res) => {
  try {
    const settings = await AppSettings.findByIdAndUpdate(
      SETTINGS_ID,
      { $setOnInsert: { _id: SETTINGS_ID } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    return res.json(settings);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.put('/', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const body = req.body || {};
    const updates = {};
    for (const field of EDITABLE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(body, field)) updates[field] = body[field];
    }
    if (!Object.keys(updates).length) {
      return res.status(400).json({ message: 'At least one app setting is required' });
    }
    if (Object.keys(body).some((field) => !EDITABLE_FIELDS.includes(field))) {
      return res.status(400).json({ message: 'Unsupported app setting' });
    }
    for (const [field, value] of Object.entries(updates)) {
      if (typeof value !== 'string' || value.length > 2000 ||
          (field === 'appName' && !value.trim())) {
        return res.status(400).json({ message: `Invalid ${field}` });
      }
    }

    const settings = await AppSettings.findByIdAndUpdate(
      SETTINGS_ID,
      { $set: updates, $setOnInsert: { _id: SETTINGS_ID } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    return res.json(settings);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
