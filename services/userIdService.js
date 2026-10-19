const UserIdCounter = require('../models/UserIdCounter');

const COUNTER_ID = 'public-user-id';
const FIRST_PUBLIC_ID = 1_000_000;
const LAST_PUBLIC_ID = 9_999_999;

async function allocatePublicUserId() {
  let counter = await UserIdCounter.findByIdAndUpdate(
    COUNTER_ID,
    { $inc: { sequence: 1 } },
    { new: true }
  );

  if (!counter) {
    try {
      counter = await UserIdCounter.create({
        _id: COUNTER_ID,
        sequence: FIRST_PUBLIC_ID
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      counter = await UserIdCounter.findByIdAndUpdate(
        COUNTER_ID,
        { $inc: { sequence: 1 } },
        { new: true }
      );
    }
  }

  if (!counter || counter.sequence > LAST_PUBLIC_ID) {
    throw new Error('The public user ID limit has been reached.');
  }

  return counter.sequence;
}

module.exports = { allocatePublicUserId };
