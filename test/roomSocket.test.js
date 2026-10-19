const test = require('node:test');
const assert = require('node:assert/strict');

const Room = require('../models/Room');
const roomSocket = require('../sockets/roomSocket');

const roomId = '507f1f77bcf86cd799439012';
const hostId = '507f1f77bcf86cd799439011';

function createSocket(userId) {
  const handlers = new Map();
  const emitted = [];
  const roomMembership = [];
  return {
    data: { userId },
    handlers,
    emitted,
    roomMembership,
    on: (event, handler) => handlers.set(event, handler),
    emit: (event, payload) => emitted.push({ event, payload }),
    join: async (id) => roomMembership.push({ action: 'join', id }),
    leave: async (id) => roomMembership.push({ action: 'leave', id }),
  };
}

test('host leave and disconnect mark the room offline and broadcast room status', async (context) => {
  const originalFindById = Room.findById;
  const originalFindByIdAndUpdate = Room.findByIdAndUpdate;
  const originalFindOneAndUpdate = Room.findOneAndUpdate;
  const globalEvents = [];
  const roomEvents = [];
  let room = {
    _id: roomId,
    ownerId: hostId,
    bannedUsers: [],
    currentListenersCount: 0,
    isLive: false,
  };

  const applyUpdate = (update) => {
    if (update.$inc?.currentListenersCount) {
      room.currentListenersCount += update.$inc.currentListenersCount;
    }
    if (update.$set?.isLive !== undefined) room.isLive = update.$set.isLive;
    return room;
  };

  Room.findById = async () => room;
  Room.findByIdAndUpdate = (_id, update) => ({
    populate: async () => applyUpdate(update),
  });
  Room.findOneAndUpdate = async (_filter, update) => {
    if (room.currentListenersCount <= 0) return null;
    return applyUpdate(update);
  };

  context.after(() => {
    Room.findById = originalFindById;
    Room.findByIdAndUpdate = originalFindByIdAndUpdate;
    Room.findOneAndUpdate = originalFindOneAndUpdate;
  });

  const io = {
    emit: (event, payload) => globalEvents.push({ event, payload }),
    to: (id) => ({
      emit: (event, payload) => roomEvents.push({ id, event, payload }),
    }),
  };

  const host = createSocket(hostId);
  roomSocket(io, host);
  await host.handlers.get('join-room')(roomId);
  assert.equal(room.isLive, true);
  assert.equal(room.currentListenersCount, 1);

  await host.handlers.get('leave-room')(roomId);
  assert.equal(room.isLive, false);
  assert.equal(room.currentListenersCount, 0);
  assert.deepEqual(globalEvents.map(({ event, payload }) => [event, payload.isLive]), [
    ['room-status-changed', true],
    ['room-status-changed', false],
  ]);
  assert.ok(roomEvents.some(({ event }) => event === 'room_updated'));

  room = { ...room, currentListenersCount: 1, isLive: true };
  const listener = createSocket('507f1f77bcf86cd799439013');
  roomSocket(io, listener);
  await listener.handlers.get('join-room')({ roomId });
  await listener.handlers.get('leave-room')({ roomId });
  assert.equal(room.isLive, true);
  assert.equal(room.currentListenersCount, 1);
  assert.equal(globalEvents.length, 2);

  room = { ...room, currentListenersCount: 0, isLive: false };
  const disconnectedHost = createSocket(hostId);
  roomSocket(io, disconnectedHost);
  await disconnectedHost.handlers.get('join_room')({ roomId });
  assert.equal(room.isLive, true);
  await disconnectedHost.handlers.get('disconnect')();

  assert.equal(room.isLive, false);
  assert.equal(room.currentListenersCount, 0);
  assert.deepEqual(globalEvents.at(-1), {
    event: 'room-status-changed',
    payload: { roomId, isLive: false },
  });
});
