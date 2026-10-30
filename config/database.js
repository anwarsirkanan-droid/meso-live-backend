const MONGOOSE_OPTIONS = {
  family: 4,
  serverSelectionTimeoutMS: 10_000,
};

function getMongoUri(env = process.env) {
  const uri = env.MONGODB_URI?.trim() || env.MONGO_URI?.trim();

  if (!uri) {
    throw new Error('MONGODB_URI or MONGO_URI must be configured');
  }

  if (!/^mongodb(?:\+srv)?:\/\//i.test(uri)) {
    throw new Error('MongoDB URI must start with mongodb:// or mongodb+srv://');
  }

  return uri;
}

async function connectToMongo(mongoose, env = process.env) {
  const uri = getMongoUri(env);
  // Reuse an already established connection instead of opening a new one.
  if (mongoose.connection && mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }
  await mongoose.connect(uri, MONGOOSE_OPTIONS);
  return mongoose.connection;
}

module.exports = { connectToMongo, getMongoUri };
