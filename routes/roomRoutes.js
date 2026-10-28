const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const router = express.Router();
const Room = require('../models/Room');
const User = require('../models/User');
const Follow = require('../models/Follow');
const auth = require('../middleware/auth');

const CATEGORIES = ['Follow', 'Party', 'For You', 'Ethiopia', 'Rank'];
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const isObjectIdString = (value) => typeof value === 'string' && value.length === 24 && mongoose.Types.ObjectId.isValid(value);

async function findRoomByIdentifier(identifier) {
  const value = String(identifier || '').trim();
  if (!value) return null;
  if (isObjectIdString(value)) {
    return Room.findById(value);
  }
  const numericId = Number(value);
  if (Number.isInteger(numericId)) {
    const owner = await User.findOne({ publicId: numericId }).select('_id').lean();
    if (owner) {
      return Room.findOne({ ownerId: owner._id });
    }
  }
  return null;
}
const roomPopulation = [
  { path: 'ownerId', select: 'username avatar country region language publicId role' },
  { path: 'seats.userId', select: 'username avatar charmPoints' }
];

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalizeTab = (tab) => String(tab || 'foryou').trim().toLowerCase().replace(/[ _-]/g, '');

const serializeRoom = (room) => ({
  _id: room._id,
  host: room.ownerId ? {
    _id: room.ownerId._id,
    username: room.ownerId.username,
    avatar: room.ownerId.avatar,
    country: room.ownerId.country,
    region: room.ownerId.region,
    language: room.ownerId.language,
    publicId: room.ownerId.publicId,
    role: room.ownerId.role,
  } : null,
  title: room.title,
  cover: room.coverPhoto || room.banner,
  notice: room.notice,
  announcement: room.notice,
  category: room.category,
  region: room.region || room.ownerId?.region || room.ownerId?.country || '',
  language: room.language || room.ownerId?.language || '',
  membersCount: room.currentListenersCount,
  isLive: room.isLive,
});

async function getFilteredRooms(req, res, next) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  try {
    const tab = normalizeTab(req.query.tab);
    const region = typeof req.query.region === 'string' ? req.query.region.trim() : '';
    const language = typeof req.query.language === 'string' ? req.query.language.trim() : '';
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const validTabs = ['follow', ...CATEGORIES.map(normalizeTab)];
    if (!validTabs.includes(tab)) {
      return res.status(400).json({ message: 'Invalid tab or category' });
    }

    const filter = { isLive: true };
    const andFilters = [];
    let sort = { currentListenersCount: -1, updatedAt: -1 };

    if (tab === 'follow') {
      const follows = await Follow.find({ followerId: req.user.id }).select('followingId').lean();
      filter.ownerId = { $in: follows.map(({ followingId }) => followingId) };
    } else if (tab !== 'foryou') {
      const matchedCategory = CATEGORIES.find((c) => normalizeTab(c) === tab);
      if (matchedCategory) {
        filter.category = matchedCategory;
      }
    }

    if (region) {
      const regionExpression = new RegExp(`^${escapeRegex(region)}$`, 'i');
      const regionalHosts = await User.find({
        $or: [{ region: regionExpression }, { country: regionExpression }]
      }).select('_id').lean();
      const regionalOwnerIds = regionalHosts.map(({ _id }) => _id);
      andFilters.push({ $or: [
        { region: regionExpression },
        ...(regionalOwnerIds.length ? [{ ownerId: { $in: regionalOwnerIds } }] : []),
      ] });
    }
    if (language) filter.language = new RegExp(`^${escapeRegex(language)}$`, 'i');

    if (search) {
      const searchExpression = new RegExp(escapeRegex(search), 'i');
      const matchingUsers = await User.find({
        $or: [
          { username: searchExpression },
          { name: searchExpression },
          ...(Number.isInteger(Number(search)) ? [{ publicId: Number(search) }, { customId: search }] : []),
        ],
      }).select('_id').lean();
      const searchConditions = [
        { title: searchExpression },
        ...(matchingUsers.length ? [{ ownerId: { $in: matchingUsers.map(({ _id }) => _id) } }] : []),
      ];
      if (isValidId(search)) searchConditions.push({ _id: search });
      andFilters.push({ $or: searchConditions });
    }

    if (andFilters.length) filter.$and = andFilters;

    const rooms = await Room.find(filter)
      .populate(roomPopulation)
      .sort(sort)
      .limit(100);
    return res.json(rooms.filter((room) => room.ownerId).map(serializeRoom));
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

const isOwnerOrAdmin = async (req, res, next) => {
  try {
    const param = req.params.roomId;
    const isNumericRoomId = Number.isInteger(Number(param)) && !isValidId(param);
    if (!isValidId(param) && !isNumericRoomId) {
      return res.status(400).json({ message: 'Invalid room ID' });
    }
    const room = await findRoomByIdentifier(param);
    if (!room) return res.status(404).json({ message: 'Room not found' });

    const user = await User.findById(req.user.id).select('role');
    const isOwner = room.ownerId.toString() === req.user.id;
    const isAdmin = user && user.role === 'ADMIN';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: 'Only the room owner or an admin can moderate.' });
    }

    req.room = room;
    return next();
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// Shared handler for host-authorized room title, cover, and announcement updates.
async function updateRoomDetails(req, res) {
  try {
    const param = req.params.roomId;
    const isNumericRoomId = Number.isInteger(Number(param)) && !isValidId(param);
    if (!isValidId(param) && !isNumericRoomId) {
      return res.status(400).json({ message: 'Invalid room ID' });
    }

    const room = await findRoomByIdentifier(param);
    if (!room) return res.status(404).json({ message: 'Room not found' });

    const userId = String(req.user?.id || req.user?._id || '');
    const isOwner = Boolean(userId) && room.ownerId?.toString() === userId;
    let isAuthorized = isOwner;

    if (!isAuthorized) {
      let role = req.user?.role;
      if (!role && userId) {
        try {
          const user = await User.findById(userId).select('role');
          role = user?.role;
        } catch {
          role = null;
        }
      }
      isAuthorized = role === 'ADMIN' || role === 'MODERATOR' ||
        (Array.isArray(room.moderators) && room.moderators.some((moderatorId) => moderatorId?.toString() === userId));
    }

    if (!isAuthorized) {
      return res.status(403).json({ message: 'Only the room host or an authorized moderator can edit this room.' });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const updates = {};

    const titleInput = body.title ?? body.roomTitle ?? body.name ?? body.roomName;
    if (titleInput !== undefined) {
      if (typeof titleInput !== 'string') {
        return res.status(400).json({ message: 'Room title must be a string.' });
      }
      const title = titleInput.trim();
      if (!title) {
        return res.status(400).json({ message: 'Room title is required.' });
      }
      if (title.length > 100) {
        return res.status(400).json({ message: 'Room title must be at most 100 characters.' });
      }
      updates.title = title;
    }

    const coverInput = body.cover ?? body.coverPhoto ?? body.banner ?? body.roomCover ?? body.image ?? body.coverUrl;
    if (coverInput !== undefined) {
      if (typeof coverInput !== 'string') {
        return res.status(400).json({ message: 'Room cover must be a string.' });
      }
      const cover = coverInput.trim();
      updates.coverPhoto = cover;
      updates.banner = cover;
    }

    const announcementInput = body.announcement ?? body.notice ?? body.noticeText ?? body.announcementText ?? body.description;
    if (announcementInput !== undefined) {
      if (typeof announcementInput !== 'string') {
        return res.status(400).json({ message: 'Room announcement must be a string.' });
      }
      const notice = announcementInput.trim().slice(0, 300);
      updates.notice = notice;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'At least one room field is required.' });
    }

    Object.assign(room, updates);
    await room.save();

    let updatedRoom = room;
    try {
      const populated = await Room.findById(room._id).populate(roomPopulation);
      if (populated) updatedRoom = populated;
    } catch {
      updatedRoom = room;
    }

    // Keep frontend-friendly aliases available even for plain mocked room objects.
    if (updatedRoom && typeof updatedRoom === 'object') {
      if (updatedRoom.cover === undefined) updatedRoom.cover = room.coverPhoto || room.banner || '';
      if (updatedRoom.announcement === undefined) updatedRoom.announcement = room.notice;
      if (updatedRoom.notice === undefined) updatedRoom.notice = room.notice;
    }

    const io = req.app && typeof req.app.get === 'function' ? req.app.get('io') : null;
    if (io) {
      io.to(String(room._id)).emit('room_updated', updatedRoom);
      io.emit('room_list_updated', {
        roomId: room._id,
        title: room.title,
        cover: room.coverPhoto || room.banner,
        notice: room.notice,
        announcement: room.notice,
        isLive: room.isLive,
      });
    }

    return res.json({
      success: true,
      message: 'Room updated successfully',
      room: updatedRoom,
      updatedRoom,
      title: room.title,
      cover: room.coverPhoto || room.banner,
      coverPhoto: room.coverPhoto,
      banner: room.banner,
      notice: room.notice,
      announcement: room.notice,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

function registerRoomUpdateRoutes(path) {
  router.put(path, auth, updateRoomDetails);
  router.patch(path, auth, updateRoomDetails);
  router.post(path, auth, updateRoomDetails);
}

// Field-specific room editing endpoints.
function registerFieldRoute(path, field) {
  router.put(path, auth, async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? { ...req.body } : {};
    if (body[field] === undefined && body.value !== undefined) body[field] = body.value;
    if (body[field] === undefined && body.data !== undefined) body[field] = body.data;
    req.body = body;
    return updateRoomDetails(req, res);
  });
  router.patch(path, auth, async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? { ...req.body } : {};
    if (body[field] === undefined && body.value !== undefined) body[field] = body.value;
    if (body[field] === undefined && body.data !== undefined) body[field] = body.data;
    req.body = body;
    return updateRoomDetails(req, res);
  });
  router.post(path, auth, async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? { ...req.body } : {};
    if (body[field] === undefined && body.value !== undefined) body[field] = body.value;
    if (body[field] === undefined && body.data !== undefined) body[field] = body.data;
    req.body = body;
    return updateRoomDetails(req, res);
  });
}

router.get('/categories', async (req, res, next) => {
  try {
    const counts = await Room.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } }
    ]);
    res.json(CATEGORIES.map((category) => ({
      category,
      count: counts.find((entry) => entry._id === category)?.count || 0
    })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/search', async (req, res, next) => {
  try {
    const page = Number.parseInt(req.query.page, 10) || 1;
    const limit = Number.parseInt(req.query.limit, 10) || 10;
    if (page < 1 || limit < 1 || limit > 100) {
      return res.status(400).json({ message: 'Page must be positive and limit must be between 1 and 100.' });
    }
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const escapedQuery = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filter = escapedQuery ? { title: { $regex: escapedQuery, $options: 'i' } } : {};
    const rooms = await Room.find(filter)
      .populate(roomPopulation)
      .skip((page - 1) * limit)
      .limit(limit);
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/search/owner/:ownerId', async (req, res, next) => {
  try {
    if (!isValidId(req.params.ownerId)) {
      return res.status(400).json({ message: 'Invalid owner ID' });
    }
    const rooms = await Room.find({ ownerId: req.params.ownerId }).populate(roomPopulation);
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/category/:category', async (req, res, next) => {
  try {
    if (!CATEGORIES.includes(req.params.category)) {
      return res.status(400).json({ message: 'Invalid room category' });
    }
    const rooms = await Room.find({ category: req.params.category }).populate(roomPopulation);
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/', auth, getFilteredRooms);

async function getActiveRooms(req, res, next) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  try {
    const rooms = await Room.find({ isLive: true })
      .populate('ownerId', 'username avatar customId')
      .sort({ updatedAt: -1 })
      .limit(50);
    return res.json(rooms);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

router.get('/active', getActiveRooms);
router.get('/live', getActiveRooms);

router.get('/all', async (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  try {
    const rooms = await Room.find({
      $or: [{ isLive: true }, { isLive: { $exists: false } }]
    })
      .populate('ownerId', 'username avatar')
      .sort({ createdAt: -1 })
      .limit(100);
    const activeRooms = rooms.filter((room) => room.ownerId);
    res.json(activeRooms.map(serializeRoom));
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.post('/create', auth, async (req, res, next) => {
  try {
    const { title, banner = '', coverPhoto = banner, announcement = '', notice: requestedNotice, category = 'For You', region = '', language = '' } = req.body;

    const currentUser = await User.findById(req.user.id).select('name username publicId');
    const userName = currentUser?.name || currentUser?.username || 'Anwar';
    const roomTitle = title && title.trim() ? title.trim() : `${userName}'s Live Room`;

    if (roomTitle.length > 100) {
      return res.status(400).json({ message: 'Room title must be at most 100 characters.' });
    }
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ message: 'Invalid room category' });
    }

    const existingRoom = await Room.findOne({ ownerId: req.user.id }).populate(roomPopulation);
    if (existingRoom) {
      if (existingRoom.publicId == null && currentUser?.publicId != null) {
        existingRoom.publicId = currentUser.publicId;
        await existingRoom.save();
      }
      existingRoom.isLive = true;
      await existingRoom.save();
      const io = typeof req.app?.get === 'function' ? req.app.get('io') : null;
      if (io) {
        io.emit('active-rooms-updated', { roomId: existingRoom._id, isLive: true });
        io.emit('room_list_updated', { roomId: existingRoom._id, isLive: true });
      }
      return res.status(200).json({ message: 'Room already exists', room: existingRoom, roomId: existingRoom._id, publicId: existingRoom.publicId });
    }

    const seats = Array.from({ length: 25 }, (_, seatIndex) => ({
      seatIndex,
      ...(seatIndex === 0 ? { userId: req.user.id } : {}),
    }));

    const room = await Room.create({
      title: roomTitle,
      ownerId: req.user.id,
      publicId: currentUser?.publicId,
      coverPhoto,
      banner,
      notice: typeof requestedNotice === 'string' ? requestedNotice : announcement,
      category,
      region: typeof region === 'string' ? region.trim() : '',
      language: typeof language === 'string' ? language.trim() : '',
      seats,
      isLive: true
    });

    const populatedRoom = await Room.findById(room._id).populate(roomPopulation);

    const io = req.app.get('io');
    if (io) {
      io.emit('active-rooms-updated', { roomId: room._id, isLive: true });
      io.emit('room_list_updated', { roomId: room._id, isLive: true });
    }

    res.status(201).json({ message: 'Room created successfully', room: populatedRoom });
  } catch (err) {
    if (err && err.code === 11000) {
      const existingRoom = await Room.findOne({ ownerId: req.user.id }).populate(roomPopulation);
      if (existingRoom) {
        existingRoom.isLive = true;
        await existingRoom.save();
        return res.status(200).json({ message: 'Room already exists', room: existingRoom, roomId: existingRoom._id });
      }
    }
    return res.status(500).json({ message: err.message });
  }
});

// General room editing endpoints.
registerRoomUpdateRoutes('/:roomId');
registerRoomUpdateRoutes('/:roomId/update');
registerRoomUpdateRoutes('/:roomId/settings');
registerRoomUpdateRoutes('/:roomId/edit');
registerRoomUpdateRoutes('/:roomId/update-room');
registerRoomUpdateRoutes('/:roomId/room-settings');
registerRoomUpdateRoutes('/:roomId/edit-room');

// Field-specific room editing endpoints.
registerFieldRoute('/:roomId/title', 'title');
registerFieldRoute('/:roomId/cover', 'cover');
registerFieldRoute('/:roomId/cover-photo', 'cover');
registerFieldRoute('/:roomId/coverPhoto', 'coverPhoto');
registerFieldRoute('/:roomId/announcement', 'announcement');
registerFieldRoute('/:roomId/notice', 'notice');

router.get('/:roomId', auth, async (req, res, next) => {
  try {
    const param = req.params.roomId;
    const isNumericRoomId = Number.isInteger(Number(param)) && !isValidId(param);
    if (!isValidId(param) && !isNumericRoomId) {
      return res.status(400).json({ message: 'Invalid room ID' });
    }
    let room = await findRoomByIdentifier(param);
    if (!room) return res.status(404).json({ message: 'Room not found' });
    if (typeof room.populate === 'function') {
      try { await room.populate(roomPopulation); } catch { /* ignore */ }
    }
    if (room.bannedUsers.some((userId) => userId.toString() === req.user.id)) {
      return res.status(403).json({ message: 'You are banned from entering this room.' });
    }

    if (room.password) {
      const password = req.query.password;
      const isMatch = password && await bcrypt.compare(password, room.password);
      if (!isMatch) {
        return res.status(401).json({ message: 'Room password required', requiresPassword: true });
      }
    }

    res.json(room);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/:roomId/seat/:seatIndex/take', auth, async (req, res, next) => {
  try {
    const { roomId, seatIndex: rawSeatIndex } = req.params;
    const seatIndex = Number.parseInt(rawSeatIndex, 10);
    if (!isValidId(roomId) || !Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= 25) {
      return res.status(400).json({ message: 'Invalid room or seat ID' });
    }
    const room = await Room.findById(roomId);
    if (!room) return res.status(404).json({ message: 'Room not found' });
    if (room.bannedUsers.some((userId) => userId.toString() === req.user.id)) {
      return res.status(403).json({ message: 'You are banned from entering this room.' });
    }

    const updatedRoom = await Room.findOneAndUpdate(
      {
        _id: roomId,
        bannedUsers: { $ne: req.user.id },
        'seats.seatIndex': seatIndex,
        seats: { $elemMatch: { seatIndex, userId: null, isLocked: false } },
        'seats.userId': { $ne: req.user.id }
      },
      { $set: { 'seats.$.userId': req.user.id } },
      { new: true }
    ).populate(roomPopulation);
    if (!updatedRoom) {
      const seat = room.seats.find((entry) => entry.seatIndex === seatIndex);
      const message = !seat ? 'Invalid seat number' :
        seat.isLocked ? 'This seat is locked by host' :
          seat.userId ? 'Seat is already occupied' : 'You already occupy a seat in this room';
      return res.status(400).json({ message });
    }
    const io = req.app.get('io');
    if (io) io.to(roomId).emit('room_updated', updatedRoom);
    res.json({ message: `Successfully joined seat ${seatIndex}`, room: updatedRoom });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/:roomId/seat/:seatIndex/leave', auth, async (req, res, next) => {
  try {
    const { roomId, seatIndex: rawSeatIndex } = req.params;
    const seatIndex = Number.parseInt(rawSeatIndex, 10);
    if (!isValidId(roomId) || !Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= 25) {
      return res.status(400).json({ message: 'Invalid room or seat ID' });
    }
    const room = await Room.findOneAndUpdate(
      { _id: roomId, seats: { $elemMatch: { seatIndex, userId: req.user.id } } },
      { $set: { 'seats.$.userId': null } },
      { new: true }
    ).populate(roomPopulation);
    if (!room) return res.status(400).json({ message: 'You are not on this seat' });
    const io = req.app.get('io');
    if (io) io.to(roomId).emit('room_updated', room);
    res.json({ message: `Left seat ${seatIndex} successfully`, room });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/:roomId/moderate/mute/:seatIndex', auth, isOwnerOrAdmin, async (req, res, next) => {
  try {
    const seatIndex = Number.parseInt(req.params.seatIndex, 10);
    const seat = req.room.seats.find((entry) => entry.seatIndex === seatIndex);
    if (!seat) return res.status(400).json({ message: 'Invalid seat number' });
    seat.isMuted = !seat.isMuted;
    await req.room.save();
    res.json({ message: `Seat ${seatIndex} mute status changed`, isMuted: seat.isMuted, room: req.room });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/:roomId/moderate/lock/:seatIndex', auth, isOwnerOrAdmin, async (req, res, next) => {
  try {
    const seatIndex = Number.parseInt(req.params.seatIndex, 10);
    const seat = req.room.seats.find((entry) => entry.seatIndex === seatIndex);
    if (!seat) return res.status(400).json({ message: 'Invalid seat number' });
    seat.isLocked = !seat.isLocked;
    await req.room.save();
    res.json({ message: `Seat ${seatIndex} lock status changed`, isLocked: seat.isLocked, room: req.room });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/:roomId/moderate/kick/:userId', auth, isOwnerOrAdmin, async (req, res, next) => {
  try {
    if (!isValidId(req.params.userId)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }
    const seat = req.room.seats.find((entry) => entry.userId?.toString() === req.params.userId);
    if (seat) {
      seat.userId = null;
      await req.room.save();
    }
    res.json({ message: 'User kicked from seat successfully', room: req.room });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/:roomId/moderate/ban/:userId', auth, isOwnerOrAdmin, async (req, res, next) => {
  try {
    if (!isValidId(req.params.userId)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }
    const targetUserId = req.params.userId;
    if (!req.room.bannedUsers.some((userId) => userId.toString() === targetUserId)) {
      req.room.bannedUsers.push(targetUserId);
      req.room.seats.forEach((seat) => {
        if (seat.userId?.toString() === targetUserId) seat.userId = null;
      });
      await req.room.save();
    }
    res.json({ message: 'User banned from room successfully', room: req.room });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
