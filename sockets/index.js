// backend/sockets/index.js
const registerRoomSocket = require('./roomSocket');
const registerChatSocket = require('./chatSocket');
const { registerVoiceSocket } = require('./voiceSocket');
const registerGiftSocket = require('./giftSocket');
const registerGameSocket = require('./gameSocket');

const initializeSockets = (io) => {
  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Register room, chat, voice, gift, and game socket event handlers
    registerRoomSocket(io, socket);
    registerChatSocket(io, socket);
    registerVoiceSocket(io, socket);
    registerGiftSocket(io, socket);
    registerGameSocket(io, socket);

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.id}`);
    });
  });
};

module.exports = { initializeSockets };