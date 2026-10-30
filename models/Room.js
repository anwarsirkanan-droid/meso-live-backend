const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },

  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Public numeric room ID aligned with the host's public user ID when available.
  publicId: { type: Number, unique: true, sparse: true },

  coverPhoto: {
    type: String,
    default: ''
  },

  // Room notice.
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

  // Microphone access mode.
  micMode: {
    type: String,
    enum: ['free', 'apply'],
    default: 'free'
  },

  seatCapacity: {
    type: Number,
    enum: [10, 15, 25],
    default: 25,
  },

  // Maximum of 25 seats, indexed from 0 to 24.
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
  },

  // Users explicitly authorized to moderate or edit this room in addition to the host.
  moderators: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Keep the frontend "cover" and "announcement" fields compatible with persisted fields.
roomSchema.virtual('cover')
  .get(function getCover() {
    return this.coverPhoto || this.banner || '';
  })
  .set(function setCover(value) {
    this.coverPhoto = value;
    this.banner = value;
  });

// Keep the frontend "announcement" field compatible with the persisted "notice" field.
roomSchema.virtual('announcement')
  .get(function getAnnouncement() {
    return this.notice;
  })
  .set(function setAnnouncement(value) {
    this.notice = value;
  });

// Validate the maximum number of seats.
roomSchema.pre('save', async function () {
  if (this.seats && this.seats.length > 25) {
    throw new Error('Room cannot have more than 25 seats');
  }
});

roomSchema.index({ ownerId: 1 }, { unique: true });

module.exports = mongoose.model('Room', roomSchema);
