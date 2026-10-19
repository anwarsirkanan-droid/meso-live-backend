module.exports = (io, socket) => {
  socket.on('game_play_event', () => {
    socket.emit('error', { message: 'Game results are broadcast only after a verified game round.' });
  });
};
