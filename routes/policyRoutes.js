const express = require('express');
const mongoose = require('mongoose');
const Policy = require('../models/Policy');
const { verifyToken } = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/adminAuth');

const router = express.Router();

function sanitize(value) {
  return String(value || '').replace(/<script[\s\S]*?<\/script>/gi, '').trim();
}

router.get('/published', async (req, res) => {
  try {
    const policies = await Policy.find({ status: 'PUBLISHED' }).sort({ section: 1, version: -1, updatedAt: -1 });
    return res.json({ policies });
  } catch (err) {
    return res.status(500).json({ message: 'Could not load policies.' });
  }
});

router.get('/', verifyToken, requireAdmin, async (req, res) => {
  try {
    const policies = await Policy.find({}).sort({ section: 1, createdAt: -1 });
    return res.json({ policies });
  } catch (err) {
    return res.status(500).json({ message: 'Could not load policies.' });
  }
});

router.post('/', verifyToken, requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const section = sanitize(body.section);
    const title = sanitize(body.title);
    const content = sanitize(body.content);
    const version = sanitize(body.version || '1.0');
    if (!section || !title || !content) {
      return res.status(400).json({ message: 'Section, title, and content are required.' });
    }
    if (section.length > 100 || title.length > 200 || content.length > 20000 || version.length > 20) {
      return res.status(400).json({ message: 'Input exceeds allowed length.' });
    }
    const policy = await Policy.create({
      section, title, content, version,
      status: 'DRAFT',
      createdBy: req.user.id, updatedBy: req.user.id,
    });
    return res.status(201).json({ policy });
  } catch (err) {
    return res.status(500).json({ message: 'Could not create policy.' });
  }
});

router.put('/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid policy ID.' });
    const policy = await Policy.findById(req.params.id);
    if (!policy) return res.status(404).json({ message: 'Policy not found.' });
    const body = req.body || {};
    if (Object.prototype.hasOwnProperty.call(body, 'section')) policy.section = sanitize(body.section);
    if (Object.prototype.hasOwnProperty.call(body, 'title')) policy.title = sanitize(body.title);
    if (Object.prototype.hasOwnProperty.call(body, 'content')) policy.content = sanitize(body.content);
    if (Object.prototype.hasOwnProperty.call(body, 'version')) policy.version = sanitize(body.version);
    policy.updatedBy = req.user.id;
    if (!policy.section || !policy.title || !policy.content) {
      return res.status(400).json({ message: 'Section, title, and content are required.' });
    }
    await policy.save();
    return res.json({ policy });
  } catch (err) {
    return res.status(500).json({ message: 'Could not update policy.' });
  }
});

router.post('/:id/publish', verifyToken, requireAdmin, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid policy ID.' });
    const policy = await Policy.findById(req.params.id);
    if (!policy) return res.status(404).json({ message: 'Policy not found.' });
    if (!policy.title.trim() || !policy.content.trim()) {
      return res.status(400).json({ message: 'Cannot publish empty content.' });
    }
    policy.status = 'PUBLISHED';
    policy.publishedAt = new Date();
    policy.publishedBy = req.user.id;
    policy.updatedBy = req.user.id;
    await policy.save();
    return res.json({ policy });
  } catch (err) {
    return res.status(500).json({ message: 'Could not publish policy.' });
  }
});

router.post('/:id/retire', verifyToken, requireAdmin, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid policy ID.' });
    const policy = await Policy.findById(req.params.id);
    if (!policy) return res.status(404).json({ message: 'Policy not found.' });
    policy.status = 'RETIRED';
    policy.updatedBy = req.user.id;
    await policy.save();
    return res.json({ policy });
  } catch (err) {
    return res.status(500).json({ message: 'Could not retire policy.' });
  }
});

module.exports = router;
