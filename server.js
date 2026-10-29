require('dotenv').config();

const cors = require('cors');
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const { connectToMongo } = require('./config/database');
const { authenticateToken } = require('./middleware/authMiddleware');
const { initializeSockets } = require('./sockets');

const app = express();
const DEFAULT_CORS_ORIGIN = 'https://meso-live-v2.onrender.com';
const allowedOrigins = (process.env.CORS_ORIGINS || DEFAULT_CORS_ORIGIN)
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => Boolean(origin) && origin !== '*');

const corsOptions = {
  origin(origin, callback) {
    callback(null, !origin || allowedOrigins.includes(origin));
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.use(express.json({
  limit: '8mb',
  verify: (req, res, buffer) => {
    req.rawBody = Buffer.from(buffer);
  },
}));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

const routeMounts = [
  ['/api/auth', './routes/authRoutes'],
  ['/api/search', './routes/globalSearchRoutes'],
  ['/api/users', './routes/userRoutes'],
  ['/api/wallet', './routes/walletRoutes'],
  ['/api/withdraw', './routes/withdrawRoutes'],
  ['/api/room', './routes/roomRoutes'],
  ['/api/rooms', './routes/roomRoutes'],
  ['/api/message', './routes/messageRoutes'],
  ['/api/gift', './routes/giftRoutes'],
  ['/api/game', './routes/gameRoutes'],
  ['/api/agency', './routes/agencyRoutes'],
  ['/api/agencies', './routes/agencyRoutes'],
  ['/api/task', './routes/taskRoutes'],
  ['/api/tasks', './routes/tasks'],
  ['/api/rewards', './routes/tasks'],
  ['/api/follow', './routes/followRoutes'],
  ['/api/notification', './routes/notificationRoutes'],
  ['/api/payment', './routes/paymentRoutes'],
  ['/api/face-verification', './routes/faceVerificationRoutes'],
  ['/api/check-in', './routes/checkInRoutes'],
  ['/api/invite', './routes/invitationRoutes'],
  ['/api/leaderboard', './routes/leaderboardRoutes'],
  ['/api/live', './routes/liveStatusRoutes'],
  ['/api/user/theme', './routes/themeRoutes'],
  ['/api/policy', './routes/policyRoutes'],
  ['/api/policies', './routes/policyRoutes'],
];

for (const [path, routerPath] of routeMounts) {
  app.use(path, require(routerPath));
}

app.use((err, req, res, next) => {
  console.error('SERVER ERROR STACK:', err.stack);
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
});

async function startServer() {
  await connectToMongo(mongoose);

  const server = http.createServer(app);
  const io = new Server(server, { cors: corsOptions });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string' || !token) {
      return next(new Error('Authentication required'));
    }

    try {
      const { user } = await authenticateToken(token);
      socket.data.userId = String(user._id);
      return next();
    } catch {
      return next(new Error('Authentication failed'));
    }
  });

  initializeSockets(io);

  const port = Number(process.env.PORT) || 5000;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, resolve);
    });
  } catch (error) {
    io.close();
    await mongoose.disconnect();
    throw error;
  }

  console.log(`Server is listening on port ${port}`);
  return { server, io };
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(`Backend startup failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { app, startServer };
