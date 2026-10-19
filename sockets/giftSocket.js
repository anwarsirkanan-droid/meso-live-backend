module.exports = (io, socket) => {
  socket.on('send_gift_event', () => {
    socket.emit('error', { message: 'Gift events are broadcast only after a verified gift transaction.' });
  });
};
