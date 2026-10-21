require('dotenv').config();

const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const walletRoutes = require('./routes/walletRoutes');
const withdrawRoutes = require('./routes/withdrawRoutes');
const roomRoutes = require('./routes/roomRoutes');
const messageRoutes = require('./routes/messageRoutes');
const giftRoutes = require('./routes/giftRoutes');
const gameRoutes = require('./routes/gameRoutes');
const agencyRoutes = require('./routes/agencyRoutes');
const taskRoutes = require('./routes/taskRoutes');
const unifiedTaskRoutes = require('./routes/tasks');
const followRoutes = require('./routes/followRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const leaderboardRoutes = require('./routes/leaderboardRoutes');
const checkInRoutes = require('./routes/checkInRoutes');
const liveStatusRoutes = require('./routes/liveStatusRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const themeRoutes = require('./routes/themeRoutes');
const appSettingsRoutes = require('./routes/appSettingsRoutes');
const faceVerificationRoutes = require('./routes/faceVerificationRoutes');
const invitationRoutes = require('./routes/invitationRoutes');
const globalSearchRoutes = require('./routes/globalSearchRoutes');
const roomSocket = require('./sockets/roomSocket');
const chatSocket = require('./sockets/chatSocket');
const giftSocket = require('./sockets/giftSocket');
const gameSocket = require('./sockets/gameSocket');
const { connectToMongo } = require('./config/database');
const { isTokenRevoked } = require('./services/tokenRevocationService');
const { ensureHostAgentUsers } = require('./scripts/updateTargetUserRole');

const app = express();
const configuredOrigins = process.env.CORS_ORIGINS
  || process.env.FRONTEND_URL
  || 'https://meso-live-frontend.onrender.com';
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  ...configuredOrigins.split(',').map((origin) => origin.trim()).filter(Boolean),
];

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({
  limit: '1mb',
  verify: (req, res, buffer) => {
    req.rawBody = Buffer.from(buffer);
  }
}));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

app.use('/api/auth', authRoutes);
app.use('/api/search', globalSearchRoutes);
app.use('/api/user', userRoutes);
app.use('/api/users', userRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/withdraw', withdrawRoutes);
app.use('/api/room', roomRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/message', messageRoutes);
app.use('/api/gift', giftRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/agency', agencyRoutes);
app.use('/api/agencies', agencyRoutes);
app.use('/api/task', taskRoutes);
app.use('/api/tasks', unifiedTaskRoutes);
app.use('/api/rewards', unifiedTaskRoutes);
app.use('/api/follow', followRoutes);
app.use('/api/notification', notificationRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/checkin', checkInRoutes);
app.use('/api/live-status', liveStatusRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/theme', themeRoutes);
app.use('/api/app-settings', appSettingsRoutes);
app.use('/api/face-verification', faceVerificationRoutes);
app.use('/api/invitation', invitationRoutes);

async function startServer() {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET must be configured');
  }
  if (process.env.JWT_SECRET.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET must contain at least 32 characters in production');
    }
    console.warn('JWT_SECRET should contain at least 32 characters; use a strong secret before deploying.');
  }

  await connectToMongo(mongoose);
  const roleBootstrap = await ensureHostAgentUsers();
  console.log(`Host and agency bootstrap completed for ${roleBootstrap.users.length} user(s).`);

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: allowedOrigins, credentials: true }
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (typeof token !== 'string') {
      return next(new Error('Authentication required'));
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!decoded.id) {
        return next(new Error('Invalid authentication token'));
      }
    } catch (error) {
      return next(new Error('Invalid authentication token'));
    }

    try {
      if (await isTokenRevoked(token)) {
        return next(new Error('Authentication token has been revoked'));
      }
      socket.data.userId = decoded.id;
      return next();
    } catch (error) {
      console.error('Could not verify socket token revocation status:', error);
      return next(new Error('Authentication service is unavailable'));
    }
  });

  app.set('io', io);
  io.on('connection', (socket) => {
    roomSocket(io, socket);
    chatSocket(io, socket);
    giftSocket(io, socket);
    gameSocket(io, socket);
  });

  const port = Number(process.env.PORT) || 5000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.removeListener('error', reject);
      console.log(`Meso Live Backend server is running on port ${port}`);
      resolve();
    });
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Backend startup failed:', error);
    if (error.code === 'ENOTFOUND' || error.cause?.code === 'ENOTFOUND' || error.message.includes('ENOTFOUND')) {
      console.error(
        'MongoDB DNS lookup failed. Verify the Atlas cluster hostname and DNS/SRV records, and confirm the deployment environment can resolve them.'
      );
    }
    process.exitCode = 1;
  });
}

module.exports = { app, startServer };
