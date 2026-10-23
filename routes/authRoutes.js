const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const router = express.Router();

const User = require('../models/User');
const { withProfileMetadata } = require('../services/profileMetadata');
const auth = require('../middleware/auth');
const { revokeToken } = require('../services/tokenRevocationService');
const { JWT_SECRET } = require('../middleware/authMiddleware');
const { calculateCharmLevel, calculateWealthLevel } = require('../config/levels');
const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
const googleClient = new OAuth2Client(
  googleClientId || undefined,
  googleClientSecret || undefined
);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function createToken(user) {
  return jwt.sign(
    { id: user._id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function usernameFromName(name, email) {
  const source = (name || email.split('@')[0])
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  return source || `user_${crypto.randomBytes(4).toString('hex')}`;
}

async function verifyGoogleCredential(credential) {
  if (typeof credential !== 'string' || !credential.trim()) {
    const error = new Error('Google credential is required.');
    error.status = 400;
    throw error;
  }
  if (!googleClientId) {
    const error = new Error('Google sign-in is not configured on the server.');
    error.status = 503;
    throw error;
  }

  const ticket = await googleClient.verifyIdToken({
    idToken: credential,
    audience: googleClientId
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.sub || !payload.email || payload.email_verified !== true) {
    const error = new Error('Google account must have a verified email address.');
    error.status = 401;
    throw error;
  }
  return {
    googleId: payload.sub,
    email: payload.email.trim().toLowerCase(),
    name: typeof payload.name === 'string' ? payload.name.trim() : '',
    profilePicture: typeof payload.picture === 'string' ? payload.picture : ''
  };
}

function publicUser(user, googleProfile = {}) {
  return {
    id: user._id,
    publicId: user.publicId,
    username: user.username,
    name: user.name || googleProfile.name || '',
    email: user.email || googleProfile.email || '',
    role: user.role,
    googleId: user.googleId || null,
    avatar: user.avatar || user.profilePicture || googleProfile.profilePicture || '',
    profilePicture: user.profilePicture || user.avatar || googleProfile.profilePicture || '',
    profileComplete: user.profileComplete === true
  };
}

router.get('/me', auth, async (req, res) => {
  if (!req.user?.id) {
    return res.status(401).json({ error: 'Invalid authentication token.' });
  }

  try {
    const userQuery = User.findById(req.user.id).select('-password');
    const user = typeof userQuery?.populate === 'function'
      ? await userQuery.populate('agencyId', 'name agencyName')
      : await userQuery;
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (user.publicId == null) await user.save({ validateModifiedOnly: true });

    const profile = withProfileMetadata(user);
    delete profile.password;
    profile.id = profile.id || profile._id;
    profile.profileComplete = profile.profileComplete === true;
    profile.wealthLevel = calculateWealthLevel(profile.totalRechargedCoins);
    profile.charmLevel = calculateCharmLevel(profile.charmPoints);
    return res.json({ user: profile });
  } catch (error) {
    console.error('Could not load the authenticated user profile:', error);
    return res.status(500).json({ error: 'Could not load your profile. Please try again.' });
  }
});

async function createGoogleUser({ email, name, googleId, profilePicture }) {
  const baseUsername = usernameFromName(name, email);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const username = attempt === 0
      ? baseUsername
      : `${baseUsername.slice(0, 22)}_${crypto.randomBytes(3).toString('hex')}`;
    try {
      return await User.create({
        username,
        email,
        googleId,
        name,
        avatar: profilePicture,
        profilePicture,
        role: 'USER',
        profileComplete: false,
        isVerified: false,
        isFaceVerified: false
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      const googleMatch = await User.findOne({ googleId });
      if (googleMatch) return googleMatch;
      const emailMatch = await User.findOne({ email });
      if (emailMatch) {
        if (emailMatch.googleId && emailMatch.googleId !== googleId) {
          const conflict = new Error('This email is linked to another Google account.');
          conflict.status = 409;
          throw conflict;
        }
        emailMatch.googleId = googleId;
        if (!emailMatch.name && name) emailMatch.name = name;
        if (!emailMatch.avatar && profilePicture) emailMatch.avatar = profilePicture;
        if (!emailMatch.profilePicture && profilePicture) emailMatch.profilePicture = profilePicture;
        await emailMatch.save();
        return emailMatch;
      }
    }
  }
  throw new Error('Could not create a unique username for this Google account.');
}

// 1. REGISTER API
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body || {};

    if (typeof username !== 'string' || !username.trim() ||
        typeof email !== 'string' || !EMAIL_PATTERN.test(email.trim()) ||
        typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Username, a valid email, and a password of at least 8 characters are required.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await User.findOne({
      $or: [{ username: username.trim() }, { email: normalizedEmail }]
    });
    if (existingUser) {
      return res.status(400).json({ error: 'This username or email is already registered.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      username: username.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      isVerified: false,
      isFaceVerified: false
    });
    await newUser.save();

    const token = jwt.sign(
      { id: newUser._id, username: newUser.username, role: newUser.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'Registration successful!',
      token,
      user: publicUser(newUser)
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: 'This username or email is already registered.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// 2. LOGIN API
router.post('/login', async (req, res) => {
  try {
    const { password } = req.body || {};
    const identifierCandidates = [
      req.body?.email,
      req.body?.username,
      req.body?.userId,
      req.body?.publicId,
      req.body?.identifier,
      req.body?.login
    ];
    const rawIdentifier = identifierCandidates.find((value) =>
      typeof value === 'string' && value.trim()
    ) || identifierCandidates.find((value) => Number.isInteger(value));
    const loginIdentifier = typeof rawIdentifier === 'number'
      ? String(rawIdentifier)
      : typeof rawIdentifier === 'string'
        ? rawIdentifier.trim()
        : '';
    const normalizedIdentifier = loginIdentifier.includes('@')
      ? loginIdentifier.toLowerCase()
      : loginIdentifier;

    if (!loginIdentifier || typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Email or username and password are required.' });
    }

    let userQuery;
    if (normalizedIdentifier.includes('@')) {
      userQuery = { email: normalizedIdentifier };
    } else if (/^\d+$/.test(normalizedIdentifier)) {
      const publicId = Number(normalizedIdentifier);
      if (!Number.isSafeInteger(publicId)) {
        return res.status(400).json({ error: 'Invalid user ID.' });
      }
      userQuery = { publicId };
    } else {
      userQuery = { username: normalizedIdentifier };
    }
    const userQueryResult = User.findOne(userQuery);
    const user = typeof userQueryResult?.select === 'function'
      ? await userQueryResult.select('+password')
      : await userQueryResult;
    if (!user) {
      return res.status(400).json({ error: 'Invalid username or password.' });
    }

    const isPasswordValid = typeof user.password === 'string' &&
      await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ error: 'Invalid username or password.' });
    }

    const token = jwt.sign(
      { id: user._id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(200).json({
      message: 'Login successful!',
      token,
      user: {
        id: user._id,
        username: user.username,
        profileComplete: user.profileComplete === true
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/google', async (req, res) => {
  try {
    const googleProfile = await verifyGoogleCredential(req.body?.credential);
    let user = await User.findOne({ googleId: googleProfile.googleId });
    if (!user) user = await User.findOne({ email: googleProfile.email });

    if (user) {
      if (user.googleId && user.googleId !== googleProfile.googleId) {
        return res.status(409).json({ error: 'This email is linked to another Google account.' });
      }
      user.googleId = googleProfile.googleId;
      user.email = googleProfile.email;
      if (!user.name && googleProfile.name) user.name = googleProfile.name;
      if (user.role === 'HOST' && user.isFaceVerified !== true) {
        user.isVerified = false;
      }
      if (!user.avatar && googleProfile.profilePicture) user.avatar = googleProfile.profilePicture;
      if (!user.profilePicture && googleProfile.profilePicture) {
        user.profilePicture = googleProfile.profilePicture;
      }
      await user.save();
    } else {
      user = await createGoogleUser(googleProfile);
    }

    return res.status(200).json({
      message: 'Google login successful!',
      token: createToken(user),
      user: publicUser(user, googleProfile)
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === 11000) {
      return res.status(409).json({ error: 'An account already exists with this Google identity.' });
    }
    if (err.message && /token|audience|issuer|signature/i.test(err.message)) {
      return res.status(401).json({ error: 'Google credential is invalid or expired.' });
    }
    return res.status(500).json({ error: 'Google sign-in failed. Please try again.' });
  }
});

router.post('/link-google', auth, async (req, res) => {
  try {
    const googleProfile = await verifyGoogleCredential(req.body?.credential);
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const [googleOwner, emailOwner] = await Promise.all([
      User.findOne({ googleId: googleProfile.googleId }),
      User.findOne({ email: googleProfile.email, _id: { $ne: user._id } })
    ]);
    if (googleOwner && !googleOwner._id.equals(user._id)) {
      return res.status(409).json({ error: 'This Google account is already linked to another user.' });
    }
    if (emailOwner) {
      return res.status(409).json({ error: 'This Google email is already registered to another user.' });
    }
    if (user.googleId && user.googleId !== googleProfile.googleId) {
      return res.status(409).json({ error: 'A different Google account is already linked to this user.' });
    }

    user.googleId = googleProfile.googleId;
    if (!user.email) user.email = googleProfile.email;
    if (!user.name && googleProfile.name) user.name = googleProfile.name;
    if (!user.avatar && googleProfile.profilePicture) user.avatar = googleProfile.profilePicture;
    if (!user.profilePicture && googleProfile.profilePicture) {
      user.profilePicture = googleProfile.profilePicture;
    }
    await user.save();

    return res.json({
      message: 'Google account linked successfully.',
      token: createToken(user),
      user: publicUser(user, googleProfile)
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === 11000) {
      return res.status(409).json({ error: 'This Google account or email is already linked to another user.' });
    }
    if (err.message && /token|audience|issuer|signature/i.test(err.message)) {
      return res.status(401).json({ error: 'Google credential is invalid or expired.' });
    }
    return res.status(500).json({ error: 'Could not link the Google account.' });
  }
});

router.post('/change-password', auth, async (req, res) => {
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  if (currentPassword && currentPassword === newPassword) {
    return res.status(400).json({ error: 'New password must be different from the current password.' });
  }

  try {
    const user = await User.findById(req.user.id).select('+password');
    if (!user) return res.status(404).json({ error: 'User not found.' });

    if (user.password) {
      const matches = await bcrypt.compare(currentPassword, user.password);
      if (!matches) return res.status(400).json({ error: 'Current password is incorrect.' });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save({ validateModifiedOnly: true });
    return res.json({ message: 'Password updated successfully.' });
  } catch (error) {
    console.error('Could not change password:', error);
    return res.status(500).json({ error: 'Could not update your password. Please try again.' });
  }
});

// 3. LOGOUT API
router.post('/logout', auth, async (req, res) => {
  try {
    const decoded = jwt.decode(req.token);
    const expiresAt = decoded?.exp
      ? new Date(decoded.exp * 1000)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await revokeToken(req.token, expiresAt);
    return res.status(200).json({ message: 'Logged out successfully!' });
  } catch (error) {
    console.error('Could not revoke token during logout:', error);
    return res.status(503).json({ error: 'Authentication service is unavailable.' });
  }
});

module.exports = router;
