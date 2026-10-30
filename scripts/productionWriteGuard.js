function isProductionMongoUri(uri = process.env.MONGO_URI || process.env.MONGODB_URI || '') {
  return /mongodb\+srv:\/\//i.test(uri) || /(production|prod)/i.test(uri);
}

function requireProductionWriteApproval(env = process.env) {
  if (isProductionMongoUri() && env.ALLOW_PRODUCTION_DB_WRITE !== 'true') {
    throw new Error(
      'Refusing to write to a production database without explicit approval. ' +
      'Set ALLOW_PRODUCTION_DB_WRITE=true only for an approved, reviewed operation.'
    );
  }
}

module.exports = { isProductionMongoUri, requireProductionWriteApproval };