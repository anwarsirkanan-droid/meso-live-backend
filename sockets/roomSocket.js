const mongoose = require('mongoose');
const Room = require('../models/Room');
const User = require('../models/User');
const { recordHostTime } = require('../services/hostDailyTaskService');


const roomViewers = new Map(); // roomId -> Map<userId, count>

function addViewer(roomId, userId) {
  if (!roomViewers.has(roomId)) roomViewers.set(roomId, new Map());
  const viewers = roomViewers.get(roomId);
  const prev = viewers.get(userId) || 0;
  viewers.set(userId, prev + 1);
  return prev === 0; // true if newly added
}

function removeViewer(roomId, userId) {
  const viewers = roomViewers.get(roomId);
  if (!viewers) return false;
  const prev = viewers.get(userId) || 0;
  if (prev <= 1) {
    viewers.delete(userId);
    if (viewers.size === 0) roomViewers.delete(roomId);
    return prev > 0; // true if removed
  }
  viewers.set(userId, prev - 1);
  return false;
}

function viewerCountFor(roomId) {
  const viewers = roomViewers.get(roomId);
  return viewers ? viewers.size : 0;
}
module.exports = (io, socket) => {
  const joinedRoomIds = new Map();
  const joiningRoomIds = new Map();
  const hostTaskSessions = new Map();
  const userId = socket.data.userId;
  let disconnecting = false;


  // WebRTC Signaling Relay
  const relaySignal = (event, payload = {}) => {
    const roomId = getRoomId(payload);
    const targetSocketId = [payload.target, payload.to, payload.peerId]
      .find((value) => typeof value === 'string' && value && value !== socket.id);
    const targetSocket = targetSocketId && io.sockets?.sockets?.get(targetSocketId);
    if (
      typeof roomId !== 'string' ||
      !joinedRoomIds.has(roomId) ||
      !targetSocket?.rooms?.has(roomId)
    ) {
      return socket.emit('error', { message: 'Invalid room signaling target' });
    }

    io.to(targetSocketId).emit(event, {
      ...payload,
      roomId,
      from: socket.id,
      socketId: socket.id,
      userId,
    });
  };

  const getRoomId = (payload) => typeof payload === 'string' ? payload : payload?.roomId;

  // Host Task Tracking Logic
  const startHostTaskTracking = (roomId) => {
    if (hostTaskSessions.has(roomId)) return;
    const session = { lastRecordedAt: Date.now(), pending: Promise.resolve(), interval: null };
    const record = () => {
      session.pending = session.pending.catch(() => {}).then(async () => {
        const now = Date.now();
        if (now <= session.lastRecordedAt) return;
        const room = await Room.findById(roomId);
        const crownSeats = room?.seats?.filter((seat) => seat.isCrownMic) || [];
        const crownMicActive = room?.seats?.some((seat) =>
          seat.isCrownMic && seat.userId?.toString() === userId
        ) || (!crownSeats.length && room?.seats?.some((seat) =>
          seat.seatIndex === 0 && seat.userId?.toString() === userId
        )) || false;
        await recordHostTime(userId, new Date(session.lastRecordedAt), new Date(now), crownMicActive);
        session.lastRecordedAt = now;
      });
      return session.pending;
    };
    session.record = record;
    session.interval = setInterval(() => {
      record().catch((error) => console.error(`Failed to record host task time in room ${roomId}:`, error));
    }, 15_000);
    session.interval.unref?.();
    hostTaskSessions.set(roomId, session);
  };

  const stopHostTaskTracking = async (roomId) => {
    const session = hostTaskSessions.get(roomId);
    if (!session) return;
    clearInterval(session.interval);
    try {
      await session.record();
    } finally {
      hostTaskSessions.delete(roomId);
    }
  };

  // Perform Join Room
  const performJoin = async (roomId) => {
    if (disconnecting) return { error: 'Socket is disconnecting' };
    try {
      if (!mongoose.Types.ObjectId.isValid(roomId)) {
        return { error: 'Invalid room ID' };
      }

      const room = await Room.findById(roomId);
      if (!room) {
        return { error: 'Room not found' };
      }
      if (room.bannedUsers?.some((bannedUserId) => bannedUserId.toString() === userId)) {
        return { error: 'You are banned from entering this room' };
      }

      const isHost = room.ownerId.toString() === userId;
      await socket.join(roomId);
      joinedRoomIds.set(roomId, isHost);
      const isNewViewer = addViewer(roomId, userId);
      const update = isNewViewer ? { $inc: { currentListenersCount: 1 } } : {};
      if (isHost) update.$set = { ...(update.$set || {}), isLive: true };

      const updatedRoom = await Room.findByIdAndUpdate(
        roomId,
        update,
        { new: true }
      ).populate('seats.userId', 'username avatar customId');

      if (updatedRoom) {
        // keep DB count authoritative
      }

      if (!updatedRoom) {
        await socket.leave(roomId);
        return { error: 'Room no longer exists' };
      }

      joinedRoomIds.set(roomId, isHost);
      io.to(roomId).emit('room_updated', updatedRoom);
      io.to(roomId).emit('viewer_count', { count: updatedRoom.currentListenersCount });
      io.to(roomId).emit('user_joined', {
        userId,
        currentListenersCount: updatedRoom.currentListenersCount
      });
      socket.to(roomId).emit('user-joined', {
        socketId: socket.id,
        userId,
      });

      if (isHost) {
        startHostTaskTracking(roomId);
        io.emit('room-status-changed', { roomId, isLive: true });
        io.emit('room_list_updated', { roomId, isLive: true });
        io.emit('room_started', { roomId, isLive: true });
      }
      return { roomId };
    } catch (error) {
      joinedRoomIds.delete(roomId);
      if (socket.rooms?.has(roomId)) {
        try {
          await socket.leave(roomId);
        } catch (leaveError) {
          console.error(`Failed to leave room ${roomId} after a join error:`, leaveError);
        }
      }
      console.error(`Failed to join room ${roomId}:`, error);
      return { error: 'Could not join this room.' };
    }
  };

  const joinRoom = async (payload, acknowledge) => {
    const roomId = getRoomId(payload);
    if (!mongoose.Types.ObjectId.isValid(roomId)) {
      const result = { error: 'Invalid room ID' };
      if (typeof acknowledge === 'function') acknowledge(result);
      return socket.emit('error', { message: result.error });
    }
    if (joinedRoomIds.has(roomId)) {
      if (typeof acknowledge === 'function') acknowledge({ roomId });
      return;
    }

    let pendingJoin = joiningRoomIds.get(roomId);
    if (!pendingJoin) {
      pendingJoin = performJoin(roomId);
      joiningRoomIds.set(roomId, pendingJoin);
    }
    const result = await pendingJoin;
    if (joiningRoomIds.get(roomId) === pendingJoin) joiningRoomIds.delete(roomId);
    if (typeof acknowledge === 'function') acknowledge(result);
    if (result.error) socket.emit('error', { message: result.error });
  };

  socket.on('join_room', joinRoom);
  socket.on('join-room', joinRoom);

  // WebRTC Signals
  socket.on('offer', (payload) => relaySignal('offer', payload));
  socket.on('answer', (payload) => relaySignal('answer', payload));
  socket.on('ice-candidate', (payload) => relaySignal('ice-candidate', payload));

  // ═══════════════════════════════════════
  // NEW: NOTICE UPDATE (Host only)
  // ═══════════════════════════════════════
  socket.on('notice_update', async ({ roomId, notice } = {}) => {
    try {
      if (!joinedRoomIds.has(roomId)) {
        return socket.emit('error', { message: 'Join the room first' });
      }
      const room = await Room.findById(roomId);
      if (!room) return socket.emit('error', { message: 'Room not found' });
      if (room.ownerId.toString() !== userId) {
        return socket.emit('error', { message: 'Only the room owner can update the notice' });
      }
      if (!notice || typeof notice !== 'string') {
        return socket.emit('error', { message: 'Invalid notice' });
      }
      room.notice = notice.trim().slice(0, 300);
      await room.save();
      io.to(roomId).emit('notice_update', { notice: room.notice });
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // ═══════════════════════════════════════
  // NEW: MIC MODE (Host only)
  // ═══════════════════════════════════════
  socket.on('mic_mode', async ({ roomId, mode } = {}) => {
    try {
      if (!joinedRoomIds.has(roomId)) {
        return socket.emit('error', { message: 'Join the room first' });
      }
      const room = await Room.findById(roomId);
      if (!room) return socket.emit('error', { message: 'Room not found' });
      if (room.ownerId.toString() !== userId) {
        return socket.emit('error', { message: 'Only the room owner can change mic mode' });
      }
      if (!['free', 'apply'].includes(mode)) {
        return socket.emit('error', { message: 'Invalid mic mode' });
      }
      room.micMode = mode;
      await room.save();
      io.to(roomId).emit('mic_mode', { mode });
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // ═══════════════════════════════════════
  // NEW: CLOSE ALL MICS (Host only)
  // ═══════════════════════════════════════
  socket.on('close_all_mics', async ({ roomId } = {}) => {
    try {
      if (!joinedRoomIds.has(roomId)) {
        return socket.emit('error', { message: 'Join the room first' });
      }
      const room = await Room.findById(roomId);
      if (!room) return socket.emit('error', { message: 'Room not found' });
      if (room.ownerId.toString() !== userId) {
        return socket.emit('error', { message: 'Only the room owner can close all mics' });
      }
      room.seats.forEach((seat) => { seat.isMuted = true; });
      await room.save();
      io.to(roomId).emit('room_updated', room);
      io.to(roomId).emit('close_all_mics');
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // Follow Real-time Notification Event
  socket.on('user_follow', async ({ targetUserId, roomId } = {}) => {
    try {
      if (!targetUserId || !mongoose.Types.ObjectId.isValid(targetUserId)) return;
      io.to(roomId).emit('follow_updated', {
        followerId: userId,
        targetUserId,
      });
    } catch (err) {
      console.error('Error broadcasting follow event:', err.message);
    }
  });

  // Leave Room & Automatic Seat Clear (25 Seats)
  const leaveRoom = async (roomId) => {
    if (!joinedRoomIds.has(roomId)) return;
    const isHost = joinedRoomIds.get(roomId);
    joinedRoomIds.delete(roomId);
    if (isHost) {
      try {
        await stopHostTaskTracking(roomId);
      } catch (error) {
        console.error(`Failed to finalize host task time in room ${roomId}:`, error);
      }
    }
    await socket.leave(roomId);
    const wasRemoved = removeViewer(roomId, userId);
    const update = {
      $set: { 'seats.$[seat].userId': null }
    };
    if (wasRemoved) update.$inc = { currentListenersCount: -1 };
    if (isHost) update.$set.isLive = false;

    let room = await Room.findOneAndUpdate(
      { _id: roomId, currentListenersCount: { $gt: 0 } },
      update,
      {
        new: true,
        arrayFilters: [{ 'seat.userId': userId }]
      }
    ).populate('seats.userId', 'username avatar customId');

    if (!room) {
      const fallbackUpdate = { $set: { 'seats.$[seat].userId': null } };
      if (isHost) fallbackUpdate.$set.isLive = false;
      room = await Room.findByIdAndUpdate(
        roomId,
        fallbackUpdate,
        { new: true, arrayFilters: [{ 'seat.userId': userId }] }
      ).populate('seats.userId', 'username avatar customId');
    }
    if (!room) return;

    io.to(roomId).emit('room_updated', room);
    io.to(roomId).emit('viewer_count', { count: room.currentListenersCount });
    io.to(roomId).emit('user_left', {
      userId,
      currentListenersCount: room.currentListenersCount
    });
    io.to(roomId).emit('user-left', { socketId: socket.id, userId });
    if (isHost) {
      io.emit('room-status-changed', { roomId, isLive: false });
      io.emit('room_list_updated', { roomId, isLive: false });
    }
  };

  const handleLeaveRoom = async (payload) => {
    try {
      const roomId = getRoomId(payload);
      if (typeof roomId !== 'string') return;
      await leaveRoom(roomId);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  };

  socket.on('leave_room', handleLeaveRoom);
  socket.on('leave-room', handleLeaveRoom);

  // Update Seat Settings (Seats 0 to 24 — 25 Seats)
  socket.on('update_seat', async ({ roomId, seatIndex, isLocked, isMuted } = {}) => {
    try {
      // FIX: 24 → 25 (seatIndex 0–24)
      if (!mongoose.Types.ObjectId.isValid(roomId) ||
          !Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= 25) {
        return socket.emit('error', { message: 'Invalid room or seat ID (Must be between 0 and 24)' });
      }
      const room = await Room.findById(roomId);
      if (!room) return socket.emit('error', { message: 'Room not found' });
      const user = await User.findById(userId).select('role');
      if (room.ownerId.toString() !== userId && (!user || user.role !== 'ADMIN')) {
        return socket.emit('error', { message: 'Only the room owner or an admin can update seats' });
      }
      const seat = room.seats.find((entry) => entry.seatIndex === seatIndex);
      if (!seat) return socket.emit('error', { message: 'Invalid seat number' });
      if (typeof isLocked === 'boolean') seat.isLocked = isLocked;
      if (typeof isMuted === 'boolean') seat.isMuted = isMuted;
      if (typeof isLocked !== 'boolean' && typeof isMuted !== 'boolean') {
        return socket.emit('error', { message: 'No seat setting was provided' });
      }

      await room.save();
      io.to(roomId).emit('seat_updated', { seatIndex, seat });
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // Disconnect Cleanup
  socket.on('disconnect', async () => {
    disconnecting = true;
    await Promise.all(joiningRoomIds.values());
    for (const roomId of [...joinedRoomIds.keys()]) {
      try {
        await leaveRoom(roomId);
      } catch (error) {
        console.error(`Failed to clean up socket room ${roomId}:`, error);
      }
    }
  });
};