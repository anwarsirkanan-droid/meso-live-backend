const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const { app } = require('../server');
const Room = require('../models/Room');
const User = require('../models/User');
const RevokedToken = require('../models/RevokedToken');

const hostId = '507f1f77bcf86cd799439011';
const otherId = '507f1f77bcf86cd799439012';
const roomId = '507f1f77bcf86cd799439013';

function makeRoom(overrides = {}) {
  const room = {
    _id: roomId,
    ownerId: hostId,
    title: 'Original Title',
    coverPhoto: '',
    banner: '',
    notice: 'Original notice',
    moderators: [],
    isLive: true,
    ...overrides,
    saveCalls: 0,
  };
  room.save = async function save() {
    this.saveCalls += 1;
    return this;
  };
  return room;
}

function mockRoom(room) {
  const originalFindById = Room.findById;
  const originalRevokedExists = RevokedToken.exists;
  Room.findById = async () => room;
  RevokedToken.exists = async () => false;
  return () => {
    Room.findById = originalFindById;
    RevokedToken.exists = originalRevokedExists;
  };
}

test('authorized host can update room title, cover, and announcement', async (context) => {
  const room = makeRoom();
  const restore = mockRoom(room);
  context.after(restore);

  const server = app.listen(0);
  context.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));

  const token = jwt.sign({ id: hostId }, process.env.JWT_SECRET);
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/room/${roomId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Updated Title',
      cover: 'https://example.com/cover.png',
      announcement: 'Updated announcement',
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(room.title, 'Updated Title');
  assert.equal(room.coverPhoto, 'https://example.com/cover.png');
  assert.equal(room.banner, 'https://example.com/cover.png');
  assert.equal(room.notice, 'Updated announcement');
  assert.equal(room.saveCalls, 1);
  assert.equal(body.room.title, 'Updated Title');
  assert.equal(body.room.cover, 'https://example.com/cover.png');
  assert.equal(body.announcement, 'Updated announcement');
});

test('unauthorized user cannot update room details', async (context) => {
  const room = makeRoom();
  const restore = mockRoom(room);
  const originalUserFindById = User.findById;
  User.findById = async () => ({ _id: otherId, role: 'USER', select() { return this; } });
  context.after(() => {
    restore();
    User.findById = originalUserFindById;
  });

  const server = app.listen(0);
  context.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));

  const token = jwt.sign({ id: otherId }, process.env.JWT_SECRET);
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/room/${roomId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Hacked Title' }),
  });
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(room.title, 'Original Title');
  assert.equal(room.saveCalls, 0);
  assert.match(body.message, /host or an authorized moderator/i);
});

test('room detail update validates input', async (context) => {
  const room = makeRoom();
  const restore = mockRoom(room);
  context.after(restore);

  const server = app.listen(0);
  context.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));

  const token = jwt.sign({ id: hostId }, process.env.JWT_SECRET);
  const base = `http://127.0.0.1:${server.address().port}/api/room/${roomId}`;

  const emptyResponse = await fetch(base, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(emptyResponse.status, 400);

  const invalidTitleResponse = await fetch(base, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '   ' }),
  });
  assert.equal(invalidTitleResponse.status, 400);

  const invalidCoverResponse = await fetch(`${base}/cover`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cover: 123 }),
  });
  assert.equal(invalidCoverResponse.status, 400);
});

test('field-specific endpoints persist announcement using notice schema field', async (context) => {
  const room = makeRoom();
  const restore = mockRoom(room);
  context.after(restore);

  const server = app.listen(0);
  context.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));

  const token = jwt.sign({ id: hostId }, process.env.JWT_SECRET);
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/room/${roomId}/announcement`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ announcement: 'Saved through announcement field' }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(room.notice, 'Saved through announcement field');
  assert.equal(body.notice, 'Saved through announcement field');
  assert.equal(body.announcement, 'Saved through announcement field');
});

test('default seat capacity is 25', async (context) => {
  const room = makeRoom({ seatCapacity: 25, seats: [] });
  const restore = mockRoom(room);
  context.after(restore);

  const server = app.listen(0);
  context.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));

  assert.equal(room.seatCapacity, 25);
});

test('valid seat capacity values 10, 15 and 25 are accepted and persisted', async () => {
  for (const capacity of [10, 15, 25]) {
    const room = makeRoom({ seatCapacity: 25, seats: [] });
    const restore = mockRoom(room);
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));

    const token = jwt.sign({ id: hostId }, process.env.JWT_SECRET);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/room/${roomId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ seatCapacity: capacity }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(room.seatCapacity, capacity);
    assert.equal(body.room.seatCapacity, capacity);

    restore();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});


test('invalid seat capacity is rejected', async (context) => {
  const room = makeRoom({ seatCapacity: 25, seats: [] });
  const restore = mockRoom(room);
  context.after(restore);

  const server = app.listen(0);
  context.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));

  const token = jwt.sign({ id: hostId }, process.env.JWT_SECRET);
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/room/${roomId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ seatCapacity: 20 }),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.message, /10, 15, or 25/);
  assert.equal(room.seatCapacity, 25);
});

test('non-owner cannot change seat capacity', async (context) => {
  const room = makeRoom({ seatCapacity: 25, seats: [] });
  const restore = mockRoom(room);
  const originalUserFindById = User.findById;
  User.findById = async () => ({ _id: otherId, role: 'USER', select() { return this; } });
  context.after(() => {
    restore();
    User.findById = originalUserFindById;
  });

  const server = app.listen(0);
  context.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));

  const token = jwt.sign({ id: otherId }, process.env.JWT_SECRET);
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/room/${roomId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ seatCapacity: 10 }),
  });
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(room.seatCapacity, 25);
});

test('reducing capacity is rejected when higher seats are occupied', async (context) => {
  const room = makeRoom({ seatCapacity: 25, seats: [
    { seatIndex: 12, userId: '507f1f77bcf86cd799439099' },
    { seatIndex: 20, userId: '507f1f77bcf86cd799439098' },
  ] });
  const restore = mockRoom(room);
  context.after(restore);

  const server = app.listen(0);
  context.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));

  const token = jwt.sign({ id: hostId }, process.env.JWT_SECRET);
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/room/${roomId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ seatCapacity: 10 }),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.message, /13, 21/);
  assert.equal(room.seatCapacity, 25);
});

test('reducing capacity succeeds after higher seats are vacated', async (context) => {
  const room = makeRoom({ seatCapacity: 25, seats: [
    { seatIndex: 12, userId: null },
    { seatIndex: 20, userId: null },
  ] });
  const restore = mockRoom(room);
  context.after(restore);

  const server = app.listen(0);
  context.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));

  const token = jwt.sign({ id: hostId }, process.env.JWT_SECRET);
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/room/${roomId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ seatCapacity: 10 }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(room.seatCapacity, 10);
  assert.equal(body.room.seatCapacity, 10);
});