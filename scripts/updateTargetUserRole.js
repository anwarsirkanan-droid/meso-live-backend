require('dotenv').config();

const mongoose = require('mongoose');
const { connectToMongo } = require('../config/database');
const { requireProductionWriteApproval } = require('./productionWriteGuard');
const User = require('../models/User');
const Agency = require('../models/Agency');
const HostReward = require('../models/HostReward');

const TARGET_PUBLIC_ID = 1000000;
const DEFAULT_USERNAME = 'Anwar';
const DEFAULT_EMAIL = 'anwar@mesolive.local';

function agencyCodeFor(user) {
  const suffix = String(user.publicId || user._id).replace(/[^A-Z0-9]/gi, '').toUpperCase();
  return `PRIMARY${suffix}`.slice(0, 24);
}

async function getOrCreateAgency(user) {
  let agency = await Agency.findOne({ ownerId: user._id });
  if (agency) return agency;

  const agencyCode = agencyCodeFor(user);
  const agencyName = `Primary Agency ${user.publicId || user.username}`;
  agency = await Agency.findOne({ agencyCode });
  if (agency && !agency.ownerId.equals(user._id)) {
    throw new Error(`Agency code ${agencyCode} is already owned by another user.`);
  }
  if (!agency) {
    agency = await Agency.create({
      ownerId: user._id,
      agencyName,
      agencyCode,
      name: agencyName,
      members: [user._id],
      hostsCount: 0
    });
  } else {
    await Agency.findByIdAndUpdate(agency._id, { $addToSet: { members: user._id } });
  }
  return agency;
}

async function prepareUser(user) {
  const hostStartDate = user.hostStartDate || new Date();
  const agency = await getOrCreateAgency(user);
  user.role = 'AGENT';
  user.isAgent = true;
  user.isHost = true;
  user.agencyId = agency._id;
  user.hostStartDate = hostStartDate;
  await user.save();
  await Agency.findByIdAndUpdate(agency._id, {
    $set: { ownerId: user._id },
    $addToSet: { members: user._id }
  });
  await HostReward.findOneAndUpdate(
    { userId: user._id },
    { $setOnInsert: { userId: user._id, hostStartDate, lastResetDate: new Date() } },
    { upsert: true, new: true }
  );
  return { user, agency };
}

async function ensureHostAgentUsers() {
  let users = await User.find({ publicId: TARGET_PUBLIC_ID });
  let selection = `public ID ${TARGET_PUBLIC_ID}`;

  if (users.length === 0) {
    const userCount = await User.countDocuments();
    if (userCount === 0) {
      users = [await User.create({
        publicId: TARGET_PUBLIC_ID,
        username: DEFAULT_USERNAME,
        email: DEFAULT_EMAIL,
        role: 'AGENT',
        isHost: true,
        isAgent: true,
        hostStartDate: new Date(),
        profileComplete: false
      })];
      selection = 'new default user';
    } else {
      users = await User.find({});
      selection = 'all existing users because the target public ID was not found';
    }
  }

  const results = [];
  for (const user of users) {
    const prepared = await prepareUser(user);
    results.push({
      publicId: prepared.user.publicId,
      userId: String(prepared.user._id),
      username: prepared.user.username,
      email: prepared.user.email,
      role: prepared.user.role,
      isAgent: prepared.user.isAgent,
      isHost: prepared.user.isHost,
      agencyId: String(prepared.agency._id),
      hostStartDate: prepared.user.hostStartDate.toISOString()
    });
  }
  return { selection, users: results };
}

async function run() {
  requireProductionWriteApproval();
  await connectToMongo(mongoose);
  console.log(JSON.stringify(await ensureHostAgentUsers(), null, 2));
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

module.exports = { ensureHostAgentUsers };
