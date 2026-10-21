const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  title: { type: String, required: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  coverPhoto: { type: String, default: '' },
  announcement: { type: String, default: '' },
  category: { 
    type: String, 
    enum: ['Follow', 'Party', 'For You', 'Ethiopia', 'Rank'], 
    default: 'For You' 
  },
  region: { type: String, trim: true, default: '' },
  language: { type: String, trim: true, default: '' },
  seats: [{
    seatIndex: { type: Number, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    isLocked: { type: Boolean, default: false },
    isMuted: { type: Boolean, default: false },
    isCrownMic: { type: Boolean, default: false }
  }],
  bannedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  currentListenersCount: { type: Number, default: 0 },
  isLive: { type: Boolean, default: false },
  banner: { type: String, default: '' },
  notice: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('Room', roomSchema);
