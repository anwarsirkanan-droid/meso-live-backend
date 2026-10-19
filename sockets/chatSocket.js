const mongoose = require('mongoose');
const Message = require('../models/Message');
const Room = require('../models/Room');

module.exports = (io, socket) => {
  socket.on('send_message', async (data = {}) => {
    try {
      const { roomId, content } = data;
      if (!mongoose.Types.ObjectId.isValid(roomId) || !socket.rooms.has(roomId)) {
        return socket.emit('error', { message: 'Join a valid room before sending a message' });
      }
      if (typeof content !== 'string' || !content.trim() || content.trim().length > 1000) {
        return socket.emit('error', { message: 'Message content must be between 1 and 1000 characters' });
      }

      const room = await Room.findById(roomId).select('bannedUsers');
      if (!room) return socket.emit('error', { message: 'Room not found' });
      if (room.bannedUsers.some((bannedUserId) => bannedUserId.toString() === socket.data.userId)) {
        return socket.emit('error', { message: 'You are banned from this room' });
      }

      const message = await Message.create({
        roomId,
        senderId: socket.data.userId,
        content: content.trim(),
        type: 'USER'
      });
      io.to(roomId).emit('new_message', {
        messageId: message._id,
        roomId,
        senderId: socket.data.userId,
        content: message.content,
        type: message.type,
        createdAt: message.createdAt
      });
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });
};
