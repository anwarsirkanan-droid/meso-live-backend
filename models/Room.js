const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  title: { type: String, required: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  coverPhoto: { type: String, default: '' },
  // FIX: notice qofa fayyadami (announcement haqi — frontend room.notice fayyadama)
  notice: { type: String, default: 'Welcome to the room!', maxlength: 300 },
  category: {
    type: String,
    enum: ['Follow', 'Party', 'For You', 'Ethiopia', 'Rank'],
    default: 'For You'
  },
  region: { type: String, trim: true, default: '' },
  language: { type: String, trim: true, default: '' },
  // FIX: micMode dabalame — roomSocket.js fayyadama
  micMode: {
    type: String,
    enum: ['free', 'apply'],
    default: 'free'
  },
  seats: [{
    seatIndex: {
      type: Number,
      required: true,
      min: 0,
      max: 24  // FIX: 25 seats (0–24)
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    isLocked: { type: Boolean, default: false },
    isMuted: { type: Boolean, default: false },
    isCrownMic: { type: Boolean, default: false }
  }],
  bannedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  currentListenersCount: { type: Number, default: 0 },
  isLive: { type: Boolean, default: false },
  banner: { type: String, default: '' }
}, { timestamps: true });

// FIX: Max 25 seats validate godhi
roomSchema.pre('save', function (next) {
  if (this.seats && this.seats.length > 25) {
    return next(new Error('Room cannot have more than 25 seats'));
  }
  next();
});

module.exports = mongoose.model('Room', roomSchema);