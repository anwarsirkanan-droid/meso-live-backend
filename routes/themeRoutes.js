const express = require('express');
const router = express.Router();
const ThemeSettings = require('../models/ThemeSettings');
const { verifyToken } = require('../middleware/authMiddleware');

const THEME_FIELDS = [
  'themeMode',
  'primaryColor',
  'accentColor',
  'fontSize',
  'animationsEnabled',
  'animationLevel',
  'giftAnimationsEnabled'
];
const ANIMATION_FIELDS = ['animationsEnabled', 'animationLevel', 'giftAnimationsEnabled'];
const validColor = (value) => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);

router.get('/', verifyToken, async (req, res) => {
  try {
    const settings = await ThemeSettings.findOneAndUpdate(
      { userId: req.user.id },
      { $setOnInsert: { userId: req.user.id } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    return res.json(settings);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.put('/', verifyToken, async (req, res) => {
  try {
    const body = req.body || {};
    const updates = {};
    for (const field of THEME_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(body, field)) updates[field] = body[field];
    }
    if (!Object.keys(updates).length) {
      return res.status(400).json({ message: 'At least one theme setting is required' });
    }
    if (Object.keys(body).some((field) => !THEME_FIELDS.includes(field))) {
      return res.status(400).json({ message: 'Unsupported theme setting' });
    }
    if (updates.themeMode !== undefined && !['light', 'dark', 'auto'].includes(updates.themeMode)) {
      return res.status(400).json({ message: 'Invalid themeMode' });
    }
    if (updates.primaryColor !== undefined && !validColor(updates.primaryColor)) {
      return res.status(400).json({ message: 'primaryColor must be a six-digit hex color' });
    }
    if (updates.accentColor !== undefined && !validColor(updates.accentColor)) {
      return res.status(400).json({ message: 'accentColor must be a six-digit hex color' });
    }
    if (updates.fontSize !== undefined &&
        (typeof updates.fontSize !== 'string' || !updates.fontSize.trim() || updates.fontSize.length > 32)) {
      return res.status(400).json({ message: 'fontSize must be a non-empty string no longer than 32 characters' });
    }
    if (updates.animationsEnabled !== undefined && typeof updates.animationsEnabled !== 'boolean') {
      return res.status(400).json({ message: 'animationsEnabled must be a boolean' });
    }
    if (updates.giftAnimationsEnabled !== undefined &&
        typeof updates.giftAnimationsEnabled !== 'boolean') {
      return res.status(400).json({ message: 'giftAnimationsEnabled must be a boolean' });
    }
    if (updates.animationLevel !== undefined &&
        !['NONE', 'LOW', 'MEDIUM', 'HIGH'].includes(updates.animationLevel)) {
      return res.status(400).json({ message: 'Invalid animationLevel' });
    }

    const settings = await ThemeSettings.findOneAndUpdate(
      { userId: req.user.id },
      { $set: updates, $setOnInsert: { userId: req.user.id } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    return res.json(settings);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.put('/animation', verifyToken, async (req, res) => {
  try {
    const body = req.body || {};
    const updates = {};
    for (const field of ANIMATION_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(body, field)) updates[field] = body[field];
    }
    if (!Object.keys(updates).length) {
      return res.status(400).json({ message: 'At least one animation setting is required' });
    }
    if (Object.keys(body).some((field) => !ANIMATION_FIELDS.includes(field))) {
      return res.status(400).json({ message: 'Only animation settings can be updated here' });
    }
    if (updates.animationsEnabled !== undefined && typeof updates.animationsEnabled !== 'boolean') {
      return res.status(400).json({ message: 'animationsEnabled must be a boolean' });
    }
    if (updates.giftAnimationsEnabled !== undefined &&
        typeof updates.giftAnimationsEnabled !== 'boolean') {
      return res.status(400).json({ message: 'giftAnimationsEnabled must be a boolean' });
    }
    if (updates.animationLevel !== undefined &&
        !['NONE', 'LOW', 'MEDIUM', 'HIGH'].includes(updates.animationLevel)) {
      return res.status(400).json({ message: 'Invalid animationLevel' });
    }

    const settings = await ThemeSettings.findOneAndUpdate(
      { userId: req.user.id },
      { $set: updates, $setOnInsert: { userId: req.user.id } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    return res.json(settings);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
