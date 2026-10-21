const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Agency = require('../models/Agency');
const Room = require('../models/Room');
const auth = require('../middleware/auth');

const router = express.Router();
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

router.get('/', auth, async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!query) return res.json({ users: [], agencies: [], rooms: [] });
  if (query.length > 80) return res.status(400).json({ message: 'Search query is too long.' });

  try {
    const expression = new RegExp(escapeRegex(query), 'i');
    const numericId = Number(query);
    const numericMatch = Number.isInteger(numericId) ? [{ publicId: numericId }, { customId: query }] : [];
    const objectIdMatch = isObjectId(query) ? [{ _id: query }] : [];

    const users = await User.find({
        $or: [{ username: expression }, { name: expression }, { nickname: expression }, ...numericMatch, ...objectIdMatch],
      })
        .populate('agencyId', 'name agencyName agencyCode')
        .select('publicId customId username nickname name avatar profilePicture agencyId role isHost')
        .limit(25)
        .lean();
    const matchedUserIds = users.map((user) => user._id);
    const [agencies, rooms] = await Promise.all([
      Agency.find({
        $or: [
          { agencyCode: expression },
          { agencyName: expression },
          { name: expression },
          ...objectIdMatch,
        ],
      }).select('_id name agencyName agencyCode tier').limit(25).lean(),
      Room.find({
        isLive: true,
        $or: [{ title: expression }, ...objectIdMatch, ...(matchedUserIds.length ? [{ ownerId: { $in: matchedUserIds } }] : [])],
      })
        .populate('ownerId', 'publicId username name avatar profilePicture agencyId isHost role')
        .sort({ currentListenersCount: -1, updatedAt: -1 })
        .limit(25)
        .lean(),
    ]);

    const liveRoomByOwner = new Map(rooms.filter((room) => room.ownerId).map((room) => [String(room.ownerId._id), room]));
    return res.json({
      users: users.map((user) => ({
        id: user._id,
        userId: user.publicId || user._id,
        customId: user.customId || user.publicId || user._id,
        nickname: user.nickname || user.name || user.username,
        username: user.username,
        avatar: user.avatar || user.profilePicture || '',
        agencyName: user.agencyId?.agencyName || user.agencyId?.name || '',
        isHost: user.isHost === true || user.role === 'HOST',
        role: user.role,
        roomId: liveRoomByOwner.get(String(user._id))?._id || null,
      })),
      agencies: agencies.map((agency) => ({
        id: agency._id,
        agencyId: agency.agencyCode || agency._id,
        name: agency.agencyName || agency.name,
        tier: agency.tier,
      })),
      rooms: rooms.map((room) => ({
        id: room._id,
        roomId: room._id,
        title: room.title,
        avatar: room.coverPhoto || room.banner || '',
        listeners: room.currentListenersCount || 0,
        host: room.ownerId ? {
          id: room.ownerId._id,
          userId: room.ownerId.publicId || room.ownerId._id,
          nickname: room.ownerId.name || room.ownerId.username,
        } : null,
      })),
    });
  } catch (error) {
    console.error('Global search failed:', error);
    return res.status(500).json({ message: 'Could not complete global search.' });
  }
});

module.exports = router;
