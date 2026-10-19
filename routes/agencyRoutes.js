const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Agency = require('../models/Agency');
const User = require('../models/User');
const auth = require('../middleware/auth');

router.post('/create', auth, async (req, res) => {
  let session;
  try {
    session = await mongoose.startSession();
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 100) {
      return res.status(400).json({ message: 'Agency name is required and must be at most 100 characters' });
    }
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.agencyId) return res.status(400).json({ message: 'You are already in an agency' });
    if (await Agency.exists({ ownerId: req.user.id })) {
      return res.status(400).json({ message: 'You already own an agency' });
    }

    let agency;
    await session.withTransaction(async () => {
      [agency] = await Agency.create([{
        name,
        ownerId: user._id,
        members: [user._id]
      }], { session });
      user.agencyId = agency._id;
      user.role = 'AGENT';
      await user.save({ session });
    });
    res.status(201).json({ message: 'Agency created successfully', agency });
  } catch (err) {
    res.status(500).json({ message: err.message });
  } finally {
    if (session) await session.endSession();
  }
});

router.get('/my-agency', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('agencyId');
    if (!user || !user.agencyId) {
      return res.status(404).json({ message: 'You are not in any agency' });
    }
    const agency = await Agency.findById(user.agencyId)
      .populate('ownerId', 'username avatar charmPoints')
      .populate('members', 'username avatar charmPoints role');
    if (!agency) return res.status(404).json({ message: 'Agency not found' });
    res.json(agency);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/join/:agencyId', auth, async (req, res) => {
  let session;
  try {
    session = await mongoose.startSession();
    if (!mongoose.Types.ObjectId.isValid(req.params.agencyId)) {
      return res.status(400).json({ message: 'Invalid agency ID' });
    }
    const [agency, user] = await Promise.all([
      Agency.findById(req.params.agencyId),
      User.findById(req.user.id)
    ]);
    if (!agency) return res.status(404).json({ message: 'Agency not found' });
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.agencyId) {
      return res.status(400).json({
        message: user.agencyId.equals(agency._id) ? 'Already a member of this agency' : 'You are already in another agency'
      });
    }

    await session.withTransaction(async () => {
      agency.members.addToSet(user._id);
      await agency.save({ session });
      user.agencyId = agency._id;
      if (user.role === 'USER') user.role = 'HOST';
      await user.save({ session });
    });
    res.json({ message: 'Successfully joined agency', agency });
  } catch (err) {
    res.status(500).json({ message: err.message });
  } finally {
    if (session) await session.endSession();
  }
});

router.post('/leave', auth, async (req, res) => {
  let session;
  try {
    session = await mongoose.startSession();
    const user = await User.findById(req.user.id);
    if (!user || !user.agencyId) {
      return res.status(400).json({ message: 'You are not in any agency' });
    }
    const agency = await Agency.findById(user.agencyId);
    if (!agency) return res.status(404).json({ message: 'Agency not found' });
    if (agency.ownerId.equals(user._id)) {
      return res.status(400).json({ message: 'Agency owners cannot leave without transferring ownership' });
    }

    await session.withTransaction(async () => {
      agency.members.pull(user._id);
      await agency.save({ session });
      user.agencyId = null;
      await user.save({ session });
    });
    res.json({ message: 'Left agency successfully. Stats preserved.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  } finally {
    if (session) await session.endSession();
  }
});

module.exports = router;
