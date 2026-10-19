const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true, unique: true },
  googleId: { type: String, default: null },
  password: { type: String, default: undefined },
  name: { type: String, trim: true, default: '' },
  phoneNumber: {
    type: String,
    trim: true,
    required: [function isProfileComplete() { return this.profileComplete; }, 'Phone number is required']
  },
  country: {
    type: String,
    trim: true,
    required: [function isProfileComplete() { return this.profileComplete; }, 'Country is required']
  },
  gender: {
    type: String,
    enum: ['Male', 'Female', 'Other'],
    required: [function isProfileComplete() { return this.profileComplete; }, 'Gender is required']
  },
  role: { 
    type: String, 
    enum: ['USER', 'HOST', 'AGENT', 'ADMIN'], 
    default: 'USER' 
  },
  avatar: { type: String, default: '' },
  profilePicture: {
    type: String,
    default: function defaultProfilePicture() { return this.avatar || ''; }
  },
  profileComplete: { type: Boolean, default: false },
  cover: { type: String, default: '' },
  bio: { type: String, default: '' },
  coins: { type: Number, default: 0 },
  diamonds: { type: Number, default: 0 },
  totalRechargedCoins: { type: Number, default: 0 },
  charmPoints: { type: Number, default: 0 },
  isVerified: { type: Boolean, default: false },
  isFaceVerified: { type: Boolean, default: false },
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