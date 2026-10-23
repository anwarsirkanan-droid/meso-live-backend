// backend/sockets/voiceSocket.js
// Voice/WebRTC signaling is handled by the frontend client in this project.
// This compatibility module keeps Socket.IO initialization working on the backend.
function registerVoiceSocket(io, socket) {
  // Intentionally a no-op: no backend voice signaling is implemented here.
}

module.exports = { registerVoiceSocket };
