const mongoose = require('mongoose');
const Message = require('../models/Message');
const User = require('../models/User');
const Room = require('../models/Room');

module.exports = (io, socket) => {
  const handleChatMessage = async (data = {}) => {
    try {
      const roomId = typeof data.roomId === 'string' ? data.roomId : null;
      const content = typeof data.content === 'string'
        ? data.content
        : (typeof data.text === 'string' ? data.text : '');
      const trimmed = content.trim();

      if (!mongoose.Types.ObjectId.isValid(roomId) || !socket.rooms.has(roomId)) {
        return socket.emit('error', { message: 'Join a valid room before sending a message' });
      }
      if (!trimmed || trimmed.length > 1000) {
        return socket.emit('error', { message: 'Message content must be between 1 and 1000 characters' });
      }

      const room = await Room.findById(roomId).select('bannedUsers');
      if (!room) return socket.emit('error', { message: 'Room not found' });
      if (room.bannedUsers.some((bannedUserId) => bannedUserId.toString() === socket.data.userId)) {
        return socket.emit('error', { message: 'You are banned from this room' });
      }

      const user = await User.findById(socket.data.userId).select('username avatar');
      const message = await Message.create({
        roomId,
        senderId: socket.data.userId,
        content: trimmed.slice(0, 1000),
        type: 'USER',
      });

      const payload = {
        id: message._id,
        messageId: message._id,
        roomId,
        senderId: socket.data.userId,
        userId: socket.data.userId,
        username: user?.username || 'User',
        avatar: user?.avatar || '',
        text: message.content,
        content: message.content,
        type: message.type,
        createdAt: message.createdAt,
      };

      io.to(roomId).emit('chat_message', payload);
      io.to(roomId).emit('new_message', payload);
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  };

  socket.on('send_message', handleChatMessage);
  socket.on('chat_message', handleChatMessage);
};
