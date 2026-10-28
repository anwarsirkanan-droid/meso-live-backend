const mongoose = require('mongoose');
const User = require('../models/User');

async function loadAuthenticatedUser(req, res) {
  const userId = req.user && (req.user.id || req.user._id);
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    res.status(401).json({ message: 'Authentication required.' });
    return null;
  }

  try {
    const user = await User.findById(userId).select('role isAgent');
    if (!user) {
      res.status(401).json({ message: 'Authenticated user not found.' });
      return null;
    }
    return user;
  } catch (error) {
    res.status(500).json({ message: 'Could not verify administrative access.' });
    return null;
  }
}

async function requireAdmin(req, res, next) {
  const user = await loadAuthenticatedUser(req, res);
  if (!user) return;
  if (user.role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin access required.' });
  }
  req.adminUser = user;
  return next();
}

async function requireAdminOrAgent(req, res, next) {
  const user = await loadAuthenticatedUser(req, res);
  if (!user) return;
  const isAdmin = user.role === 'ADMIN';
  const isAgent = user.role === 'AGENT' || user.isAgent === true;
  if (!isAdmin && !isAgent) {
    return res.status(403).json({ message: 'Admin or Agent access required.' });
  }
  req.adminUser = user;
  return next();
}

module.exports = { requireAdmin, requireAdminOrAgent };