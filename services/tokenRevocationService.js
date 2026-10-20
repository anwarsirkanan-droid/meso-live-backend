const crypto = require('crypto');
const RevokedToken = require('../models/RevokedToken');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function isTokenRevoked(token) {
  const tokenHash = hashToken(token);
  return Boolean(await RevokedToken.exists({
    tokenHash,
    expiresAt: { $gt: new Date() }
  }));
}

async function revokeToken(token, expiresAt) {
  const tokenHash = hashToken(token);
  await RevokedToken.updateOne(
    { tokenHash },
    { $setOnInsert: { tokenHash, expiresAt } },
    { upsert: true }
  );
}

module.exports = { isTokenRevoked, revokeToken };
