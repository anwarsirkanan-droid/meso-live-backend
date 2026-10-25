const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },

  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  coverPhoto: {
    type: String,
    default: ''
  },

  // Notice qofa fayyadami.
  notice: {
    type: String,
    default: 'Welcome to the room!',
    maxlength: 300
  },

  category: {
    type: String,
    enum: ['Follow', 'Party', 'For You', 'Ethiopia', 'Rank'],
    default: 'For You'
  },

  region: {
    type: String,
    trim: true,
    default: ''
  },

  language: {
    type: String,
    trim: true,
    default: ''
  },

  // Mic mode: free ykn apply.
  micMode: {
    type: String,
    enum: ['free', 'apply'],
    default: 'free'
  },

  // Teessota 25 (seatIndex 0 hanga 24).
  seats: [{
    seatIndex: {
      type: Number,
      required: true,
      min: 0,
      max: 24
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },

    isLocked: {
      type: Boolean,
      default: false
    },

    isMuted: {
      type: Boolean,
      default: false
    },

    isCrownMic: {
      type: Boolean,
      default: false
    }
  }],

  bannedUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],

  currentListenersCount: {
    type: Number,
    default: 0
  },

  isLive: {
    type: Boolean,
    default: false
  },

  banner: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Teessota 25 ol akka hin taane mirkaneessi.
// Mongoose 9 waliin callback next() hin fayyadamnu.
roomSchema.pre('save', function () {
  if (this.seats && this.seats.length > 25) {
    throw new Error('Room cannot have more than 25 seats');
  }
});

module.exports = mongoose.model('Room', roomSchema);
