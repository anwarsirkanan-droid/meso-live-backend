const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const router = express.Router();

const User = require('../models/User');
const { JWT_SECRET } = require('../middleware/authMiddleware');
const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
const googleClient = new OAuth2Client(
  googleClientId || undefined,
  googleClientSecret || undefined
);

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

async function createGoogleUser({ email, name, googleId, picture }) {
  const password = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
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
        password,
        avatar: picture || '',
        isVerified: true
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      const existing = await User.findOne({ $or: [{ googleId }, { email }] });
      if (existing) return existing;
    }
  }
  throw new Error('Could not create a unique username for this Google account.');
}

// 1. REGISTER API
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'This username is already registered.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword });
    await newUser.save();

    const token = jwt.sign(
      { id: newUser._id, username: newUser.username, role: newUser.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'Registration successful!',
      token,
      user: { id: newUser._id, username: newUser.username }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. LOGIN API
router.post('/login', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const loginIdentifier = typeof email === 'string' && email.trim()
      ? email.trim().toLowerCase()
      : typeof username === 'string'
        ? username.trim()
        : '';

    if (!loginIdentifier || typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Email or username and password are required.' });
    }

    const user = await User.findOne(
      loginIdentifier.includes('@')
        ? { email: loginIdentifier }
        : { username: loginIdentifier }
    );
    if (!user) {
      return res.status(400).json({ error: 'Invalid username or password.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
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
      user: { id: user._id, username: user.username }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body || {};
    if (typeof credential !== 'string' || !credential.trim()) {
      return res.status(400).json({ error: 'Google credential is required.' });
    }
    if (!googleClientId) {
      return res.status(503).json({ error: 'Google sign-in is not configured on the server.' });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: googleClientId
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email || payload.email_verified !== true) {
      return res.status(401).json({ error: 'Google account must have a verified email address.' });
    }

    const email = payload.email.trim().toLowerCase();
    let user = await User.findOne({
      $or: [{ googleId: payload.sub }, { email }]
    });

    if (user) {
      if (user.googleId && user.googleId !== payload.sub) {
        return res.status(409).json({ error: 'This email is linked to another Google account.' });
      }
      user.googleId = payload.sub;
      user.email = email;
      user.isVerified = true;
      if (!user.avatar && payload.picture) user.avatar = payload.picture;
      await user.save();
    } else {
      user = await createGoogleUser({
        email,
        name: payload.name,
        googleId: payload.sub,
        picture: payload.picture
      });
    }

    return res.status(200).json({
      message: 'Google login successful!',
      token: createToken(user),
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        avatar: user.avatar
      }
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'An account already exists with this Google identity.' });
    }
    if (err.message && /token|audience|issuer|signature/i.test(err.message)) {
      return res.status(401).json({ error: 'Google credential is invalid or expired.' });
    }
    return res.status(500).json({ error: 'Google sign-in failed. Please try again.' });
  }
});

// 3. LOGOUT API
router.post('/logout', (req, res) => {
  res.status(200).json({ message: 'Logged out successfully!' });
});

module.exports = router;