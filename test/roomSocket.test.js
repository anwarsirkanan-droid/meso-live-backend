const test = require('node:test');
const assert = require('node:assert/strict');

const Room = require('../models/Room');
const roomSocket = require('../sockets/roomSocket');

const roomId = '507f1f77bcf86cd799439012';
const hostId = '507f1f77bcf86cd799439011';

function createSocket(userId, socketId = `socket-${userId}`) {
  const handlers = new Map();
  const emitted = [];
  const roomMembership = [];
  const rooms = new Set();
  const broadcasts = [];
  return {
    id: socketId,
    data: { userId },
    handlers,
    emitted,
    roomMembership,
    rooms,
    broadcasts,
    on: (event, handler) => handlers.set(event, handler),
    emit: (event, payload) => emitted.push({ event, payload }),
    to: (id) => ({
      emit: (event, payload) => broadcasts.push({ id, event, payload }),
    }),
    join: async (id) => {
      roomMembership.push({ action: 'join', id });
      rooms.add(id);
    },
    leave: async (id) => {
      roomMembership.push({ action: 'leave', id });
      rooms.delete(id);
    },
  };
}

test('room participants exchange authenticated, room-scoped WebRTC signaling events', async (context) => {
  const originalFindById = Room.findById;
  const originalFindByIdAndUpdate = Room.findByIdAndUpdate;
  let room = {
    _id: roomId,
    ownerId: hostId,
    bannedUsers: [],
    currentListenersCount: 0,
    isLive: false,
  };
  Room.findById = async () => room;
  Room.findByIdAndUpdate = (_id, update) => ({
    populate: async () => {
      room.currentListenersCount += update.$inc.currentListenersCount;
      return room;
    },
  });
  context.after(() => {
    Room.findById = originalFindById;
    Room.findByIdAndUpdate = originalFindByIdAndUpdate;
  });

  const relays = [];
  const io = {
    sockets: { sockets: new Map() },
    to: (id) => ({
      emit: (event, payload) => relays.push({ id, event, payload }),
    }),
    emit: () => {},
  };
  const first = createSocket('507f1f77bcf86cd799439013', 'socket-first');
  const second = createSocket('507f1f77bcf86cd799439014', 'socket-second');
  const outside = createSocket('507f1f77bcf86cd799439015', 'socket-outside');
  io.sockets.sockets.set(first.id, first);
  io.sockets.sockets.set(second.id, second);
  io.sockets.sockets.set(outside.id, outside);
  roomSocket(io, first);
  roomSocket(io, second);
  await first.handlers.get('join-room')(roomId);
  await second.handlers.get('join-room')(roomId);

  assert.ok(second.broadcasts.some(({ event, payload }) =>
    event === 'user-joined' && payload.socketId === second.id
  ));

  const description = { type: 'offer', sdp: 'test-sdp' };
  first.handlers.get('offer')({
    roomId,
    target: second.id,
    from: 'spoofed-sender',
    offer: description,
  });
  assert.deepEqual(relays.at(-1), {
    id: second.id,
    event: 'offer',
    payload: {
      roomId,
      target: second.id,
      from: first.id,
      socketId: first.id,
      userId: first.data.userId,
      offer: description,
    },
  });

  second.handlers.get('answer')({
    roomId,
    to: first.id,
    answer: { type: 'answer', sdp: 'answer-sdp' },
  });
  assert.equal(relays.at(-1).event, 'answer');
  assert.equal(relays.at(-1).id, first.id);

  first.handlers.get('ice-candidate')({
    roomId,
    peerId: second.id,
    candidate: { candidate: 'candidate' },
  });
  assert.equal(relays.at(-1).event, 'ice-candidate');
  assert.equal(relays.at(-1).id, second.id);

  const relayCount = relays.length;
  first.handlers.get('offer')({ roomId, target: outside.id, offer: description });
  assert.equal(relays.length, relayCount);
  assert.ok(first.emitted.some(({ event }) => event === 'error'));
});

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
    ['room_list_updated', true],
    ['room_started', true],
    ['room-status-changed', false],
    ['room_list_updated', false],
  ]);
  assert.ok(roomEvents.some(({ event }) => event === 'room_updated'));

  const globalEventCount = globalEvents.length;
  room = { ...room, currentListenersCount: 1, isLive: true };
  const listener = createSocket('507f1f77bcf86cd799439013');
  roomSocket(io, listener);
  await listener.handlers.get('join-room')({ roomId });
  await listener.handlers.get('leave-room')({ roomId });
  assert.equal(room.isLive, true);
  assert.equal(room.currentListenersCount, 1);
  assert.equal(globalEvents.length, globalEventCount);

  room = { ...room, currentListenersCount: 0, isLive: false };
  const disconnectedHost = createSocket(hostId);
  roomSocket(io, disconnectedHost);
  await disconnectedHost.handlers.get('join_room')({ roomId });
  assert.equal(room.isLive, true);
  await disconnectedHost.handlers.get('disconnect')();

  assert.equal(room.isLive, false);
  assert.equal(room.currentListenersCount, 0);
  assert.deepEqual(globalEvents.slice(-2), [{
    event: 'room-status-changed',
    payload: { roomId, isLive: false },
  }, {
    event: 'room_list_updated',
    payload: { roomId, isLive: false },
  }]);
});
