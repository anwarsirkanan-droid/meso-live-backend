const jwt = require('jsonwebtoken');
const { isTokenRevoked } = require('../services/tokenRevocationService');

const JWT_SECRET = process.env.JWT_SECRET;

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  let verified;
  try {
    verified = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Token is invalid or expired.' });
  }

  try {
    if (await isTokenRevoked(token)) {
      return res.status(401).json({ error: 'Token has been revoked.' });
    }
    req.user = verified;
    req.token = token;
    return next();
  } catch (error) {
    console.error('Could not verify token revocation status:', error);
    return res.status(503).json({ error: 'Authentication service is unavailable.' });
  }
};

module.exports = { verifyToken, JWT_SECRET };
