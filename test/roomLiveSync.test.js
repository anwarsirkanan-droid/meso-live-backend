const test = require('node:test');
const assert = require('node:assert/strict');

const Room = require('../models/Room');
const roomRoutes = require('../routes/roomRoutes');

test('active room endpoints query only live rooms and disable response caching', async (context) => {
  const originalFind = Room.find;
  const query = { isLive: true };
  const activeRoom = {
    _id: 'live-room',
    ownerId: {
      _id: 'host-id',
      username: 'live-host',
      avatar: 'avatar.png',
      country: 'Ethiopia',
      region: 'Addis Ababa',
      language: 'Amharic',
    },
    title: 'Live now',
    coverPhoto: 'cover.png',
    category: 'Party',
    region: '',
    language: '',
    currentListenersCount: 4,
    isLive: true,
  };
  Room.find = (filter) => {
    assert.deepEqual(filter, query);
    return {
      populate() {
        return this;
      },
      sort() {
        return this;
      },
      limit: async () => [activeRoom],
    };
  };
  context.after(() => {
    Room.find = originalFind;
  });

  const route = roomRoutes.stack.find((layer) =>
    layer.route && layer.route.path === '/active' && layer.route.methods.get
  );
  assert.ok(route);
  assert.equal(route.route.stack.length, 1);

  const headers = {};
  let result;
  const response = {
    set(name, value) {
      headers[name] = value;
      return this;
    },
    json(value) {
      result = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
  };

  await route.route.stack[0].handle({}, response);
  assert.equal(headers['Cache-Control'], 'no-store, no-cache, must-revalidate, proxy-revalidate');
  assert.equal(headers.Pragma, 'no-cache');
  assert.equal(headers.Expires, '0');
  assert.equal(result.length, 1);
  assert.equal(result[0]._id, 'live-room');
  assert.equal(result[0].isLive, true);
});
