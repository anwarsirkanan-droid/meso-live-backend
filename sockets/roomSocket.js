const mongoose = require('mongoose');
const Room = require('../models/Room');
const User = require('../models/User');
const { recordHostTime } = require('../services/hostDailyTaskService');

module.exports = (io, socket) => {
  const joinedRoomIds = new Map();
  const hostTaskSessions = new Map();
  const userId = socket.data.userId;
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

  const startHostTaskTracking = (roomId) => {
    if (hostTaskSessions.has(roomId)) return;
    const session = { lastRecordedAt: Date.now(), pending: Promise.resolve(), interval: null };
    const record = () => {
      session.pending = session.pending.catch(() => {}).then(async () => {
        const now = Date.now();
        if (now <= session.lastRecordedAt) return;
        const room = await Room.findById(roomId);
        const crownMicActive = room?.seats?.some((seat) =>
          seat.isCrownMic && seat.userId?.toString() === userId
        ) || false;
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

  const joinRoom = async (payload) => {
    try {
      const roomId = getRoomId(payload);
      if (!mongoose.Types.ObjectId.isValid(roomId)) {
        return socket.emit('error', { message: 'Invalid room ID' });
      }
      if (joinedRoomIds.has(roomId)) return;

      const room = await Room.findById(roomId);
      if (!room) return socket.emit('error', { message: 'Room not found' });
      if (room.bannedUsers?.some((bannedUserId) => bannedUserId.toString() === userId)) {
        return socket.emit('error', { message: 'You are banned from entering this room' });
      }

      const isHost = room.ownerId.toString() === userId;
      await socket.join(roomId);
      joinedRoomIds.set(roomId, isHost);
      const update = { $inc: { currentListenersCount: 1 } };
      if (isHost) update.$set = { isLive: true };
      const updatedRoom = await Room.findByIdAndUpdate(
        roomId,
        update,
        { new: true }
      ).populate('seats.userId', 'username avatar');
      if (!updatedRoom) {
        joinedRoomIds.delete(roomId);
        await socket.leave(roomId);
        return socket.emit('error', { message: 'Room no longer exists' });
      }
      io.to(roomId).emit('room_updated', updatedRoom);
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
      }
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  };

  socket.on('join_room', joinRoom);
  socket.on('join-room', joinRoom);
  socket.on('offer', (payload) => relaySignal('offer', payload));
  socket.on('answer', (payload) => relaySignal('answer', payload));
  socket.on('ice-candidate', (payload) => relaySignal('ice-candidate', payload));

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
    const update = {
      $inc: { currentListenersCount: -1 },
      $set: { 'seats.$[seat].userId': null }
    };
    if (isHost) update.$set.isLive = false;
    let room = await Room.findOneAndUpdate(
      { _id: roomId, currentListenersCount: { $gt: 0 } },
      update,
      {
        new: true,
        arrayFilters: [{ 'seat.userId': userId }]
      }
    );
    if (!room) {
      const fallbackUpdate = { $set: { 'seats.$[seat].userId': null } };
      if (isHost) fallbackUpdate.$set.isLive = false;
      room = await Room.findByIdAndUpdate(
        roomId,
        fallbackUpdate,
        { new: true, arrayFilters: [{ 'seat.userId': userId }] }
      );
    }
    if (!room) return;
    io.to(roomId).emit('room_updated', room);
    io.to(roomId).emit('user_left', {
      userId,
      currentListenersCount: room.currentListenersCount
    });
    io.to(roomId).emit('user-left', { socketId: socket.id, userId });
    if (isHost) {
      io.emit('room-status-changed', { roomId, isLive: false });
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

  socket.on('update_seat', async ({ roomId, seatIndex, isLocked, isMuted } = {}) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(roomId) ||
          !Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= 25) {
        return socket.emit('error', { message: 'Invalid room or seat ID' });
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

  socket.on('disconnect', async () => {
    for (const roomId of joinedRoomIds.keys()) {
      try {
        await leaveRoom(roomId);
      } catch (error) {
        console.error(`Failed to clean up socket room ${roomId}:`, error);
      }
    }
  });
};
