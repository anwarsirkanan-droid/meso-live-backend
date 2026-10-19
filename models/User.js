const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, trim: true, lowercase: true, sparse: true, unique: true },
  googleId: { type: String, default: null },
  password: { type: String, required: true },
  role: { 
    type: String, 
    enum: ['USER', 'HOST', 'AGENT', 'ADMIN'], 
    default: 'USER' 
  },
  avatar: { type: String, default: '' },
  cover: { type: String, default: '' },
  bio: { type: String, default: '' },
  coins: { type: Number, default: 0 },
  diamonds: { type: Number, default: 0 },
  totalRechargedCoins: { type: Number, default: 0 },
  charmPoints: { type: Number, default: 0 },
  isVerified: { type: Boolean, default: false },
  isOnline: { type: Boolean, default: false },
  lastSeen: { type: Date, default: null },
  followersCount: { type: Number, default: 0 },
  followingCount: { type: Number, default: 0 },
  checkInStreak: { type: Number, default: 0 },
  isVip: { type: Boolean, default: false },
  rewardCoins: { type: Number, default: 0 },
  agencyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agency', default: null }
}, { timestamps: true });

userSchema.index(
  { googleId: 1 },
  { unique: true, partialFilterExpression: { googleId: { $type: 'string' } } }
);

module.exports = mongoose.model('User', userSchema);