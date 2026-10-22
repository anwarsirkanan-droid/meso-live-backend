// backend/controllers/roomController.js
const Room = require('../models/Room');
const bcrypt = require('bcryptjs');

// Get Room Details
exports.getRoom = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id)
      .populate('ownerId', 'username avatar')
      .populate('seats.userId', 'username avatar');
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json(room);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Update Room Notice — HOST ONLY
exports.updateNotice = async (req, res) => {
  try {
    const { notice } = req.body;
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    // Host check
    if (String(room.ownerId) !== String(req.user._id)) {
      return res.status(403).json({ error: 'Only the room owner can update the notice' });
    }

    room.notice = String(notice || '').slice(0, 300);
    await room.save();
    const updated = await Room.findById(req.params.id)
      .populate('ownerId', 'username avatar')
      .populate('seats.userId', 'username avatar');
    req.io?.in(req.params.id).emit('notice_update', { notice: room.notice });
    req.io?.in(req.params.id).emit('room_updated', updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Set Room Password — HOST ONLY + bcrypt hash
exports.setRoomPassword = async (req, res) => {
  try {
    const { password } = req.body;
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    // Host check
    if (String(room.ownerId) !== String(req.user._id)) {
      return res.status(403).json({ error: 'Only the room owner can set the password' });
    }

    // Hash password before saving (never store plain text)
    room.password = password ? await bcrypt.hash(password, 10) : null;
    await room.save();
    res.json({ message: 'Password updated', roomId: room._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Take / Change Seat (25 seats: 0 to 24)
exports.takeSeat = async (req, res) => {
  try {
    const { seatIndex } = req.body;
    const userId = req.user._id;
    const roomId = req.params.id;

    // Validate seatIndex 0–24 (25 seats)
    const idx = Number(seatIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= 25) {
      return res.status(400).json({ error: 'Invalid seat (must be 0-24)' });
    }

    const room = await Room.findById(roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const targetSeat = room.seats.find((s) => s.seatIndex === idx);
    if (!targetSeat) return res.status(400).json({ error: 'Seat not found' });

    // Check seat not locked
    if (targetSeat.isLocked) {
      return res.status(403).json({ error: 'Seat is locked' });
    }

    // Check seat not already taken (by someone else)
    if (targetSeat.userId && String(targetSeat.userId) !== String(userId)) {
      return res.status(400).json({ error: 'Seat already taken' });
    }

    // Clear user from previous seats
    room.seats = room.seats.map((seat) =>
      String(seat.userId) === String(userId) ? { ...seat, userId: null } : seat
    );

    // Occupy new seat
    targetSeat.userId = userId;

    await room.save();
    const updated = await Room.findById(roomId)
      .populate('seats.userId', 'username avatar')
      .populate('ownerId', 'username avatar');
    req.io?.in(roomId).emit('room_updated', updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Leave Seat
exports.leaveSeat = async (req, res) => {
  try {
    const { seatIndex } = req.body;
    const roomId = req.params.id;

    const idx = Number(seatIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= 25) {
      return res.status(400).json({ error: 'Invalid seat (must be 0-24)' });
    }

    const room = await Room.findById(roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const targetSeat = room.seats.find((s) => s.seatIndex === idx);
    if (!targetSeat) return res.status(400).json({ error: 'Seat not found' });

    // Only the seat owner can leave their own seat
    if (String(targetSeat.userId) !== String(req.user._id)) {
      return res.status(403).json({ error: 'Not your seat' });
    }

    targetSeat.userId = null;

    await room.save();
    const updated = await Room.findById(roomId)
      .populate('seats.userId', 'username avatar')
      .populate('ownerId', 'username avatar');
    req.io?.in(roomId).emit('room_updated', updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};