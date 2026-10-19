const test = require('node:test');
const assert = require('node:assert/strict');
const { connectToMongo, getMongoUri } = require('../config/database');

test('prefers MONGODB_URI and trims its value', () => {
  assert.equal(
    getMongoUri({
      MONGODB_URI: '  mongodb+srv://atlas.example/meso_live  ',
      MONGO_URI: 'mongodb://legacy.example/meso_live',
    }),
    'mongodb+srv://atlas.example/meso_live'
  );
});

test('supports MONGO_URI as a backwards-compatible fallback', () => {
  assert.equal(
    getMongoUri({ MONGODB_URI: ' ', MONGO_URI: ' mongodb://localhost/meso_live ' }),
    'mongodb://localhost/meso_live'
  );
});

test('rejects missing and unsupported MongoDB URI values', () => {
  assert.throws(() => getMongoUri({}), /MONGODB_URI or MONGO_URI must be configured/);
  assert.throws(() => getMongoUri({ MONGODB_URI: 'https://example.com' }), /must start with mongodb/);
});

test('connects using current MongoDB driver options', async () => {
  let actualUri;
  let actualOptions;
  const fakeMongoose = {
    connect: async (uri, options) => {
      actualUri = uri;
      actualOptions = options;
    },
  };

  await connectToMongo(fakeMongoose, { MONGODB_URI: 'mongodb://localhost/meso_live' });

  assert.equal(actualUri, 'mongodb://localhost/meso_live');
  assert.deepEqual(actualOptions, {
    family: 4,
    serverSelectionTimeoutMS: 10_000,
  });
});
