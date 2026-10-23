const jwt = require('jsonwebtoken');
const { isTokenRevoked } = require('../services/tokenRevocationService');

// FIX: JWT_SECRET barbaachisa — hin jiru → app hin jalqabin
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

async function authenticateToken(token) {
  let verified;
  try {
    verified = jwt.verify(token, JWT_SECRET);
  } catch {
    const error = new Error('Token is invalid or expired.');
    error.statusCode = 401;
    throw error;
  }

  if (await isTokenRevoked(token)) {
    const error = new Error('Token has been revoked.');
    error.statusCode = 401;
    throw error;
  }

  if (!verified || !verified.id) {
    const error = new Error('Invalid authentication token.');
    error.statusCode = 401;
    throw error;
  }

  // Keep the token payload as the authenticated user without an extra database
  // lookup. Route handlers are responsible for loading full user documents.
  const user = { ...verified, id: verified.id, _id: verified.id };

  return { user, verified };
}

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const { user } = await authenticateToken(token);
    req.user = user;
    req.token = token;
    return next();
  } catch (error) {
    if (error.statusCode === 401) {
      return res.status(401).json({ error: error.message });
    }
    console.error('Could not verify token revocation status:', error);
    return res.status(503).json({ error: 'Authentication service is unavailable.' });
  }
};

module.exports = { verifyToken, authenticateToken, JWT_SECRET };
