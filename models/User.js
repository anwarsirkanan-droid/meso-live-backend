const mongoose = require('mongoose');
const { allocatePublicUserId } = require('../services/userIdService');

const userSchema = new mongoose.Schema({
  publicId: { type: Number, min: 1_000_000, max: 9_999_999 },
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
  region: { type: String, trim: true, default: '' },
  language: { type: String, trim: true, default: '' },
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
  isHost: { type: Boolean, default: false },
  isAgent: { type: Boolean, default: false },
  avatar: { type: String, default: '' },
  profilePicture: {
    type: String,
    default: function defaultProfilePicture() { return this.avatar || ''; }
  },
  profileComplete: { type: Boolean, default: false },
  cover: { type: String, default: '' },
  birthday: { type: Date, default: null },
  album: { type: [String], default: [] },
  bio: { type: String, default: '' },
  coins: { type: Number, default: 0 },
  diamonds: { type: Number, default: 0 },
  hostEarningsUsd: { type: Number, default: 0, min: 0 },
  hostStartDate: { type: Date, default: null },
  totalRechargedCoins: { type: Number, default: 0 },
  charmPoints: { type: Number, default: 0 },
  isVerified: { type: Boolean, default: false },
  isFaceVerified: { type: Boolean, default: false },
  isVerifiedHost: { type: Boolean, default: false },
  faceVerificationStatus: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
  hostVerificationStatus: {
    type: String,
    enum: ['NOT_SUBMITTED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'],
    default: 'NOT_SUBMITTED'
  },
  isOnline: { type: Boolean, default: false },
  lastSeen: { type: Date, default: null },
  followersCount: { type: Number, default: 0 },
  followingCount: { type: Number, default: 0 },
  checkInStreak: { type: Number, default: 0 },
  isVip: { type: Boolean, default: false },
  rewardCoins: { type: Number, default: 0 },
  agencyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agency', default: null }
}, { timestamps: true });

userSchema.index({ publicId: 1 }, { unique: true, sparse: true });

userSchema.pre('save', async function assignPublicId() {
  if (this.publicId == null) {
    this.publicId = await allocatePublicUserId();
  }
});

userSchema.index(
  { googleId: 1 },
  { unique: true, partialFilterExpression: { googleId: { $type: 'string' } } }
);

module.exports = mongoose.model('User', userSchema);
