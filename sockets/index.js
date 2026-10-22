// backend/sockets/index.js
const { registerRoomSocket } = require('./roomSocket');
const { registerVoiceSocket } = require('./voiceSocket');

const initializeSockets = (io) => {
  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Register room & voice socket event handlers
    registerRoomSocket(io, socket);
    registerVoiceSocket(io, socket);

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.id}`);
    });
  });
};

module.exports = { initializeSockets };