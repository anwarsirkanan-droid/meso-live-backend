require('dotenv').config();

const mongoose = require('mongoose');
const { connectToMongo } = require('../config/database');
const { requireProductionWriteApproval } = require('./productionWriteGuard');
const User = require('../models/User');

const DEFAULT_TARGET_EMAIL = 'anwarsirkanan@gmail.com';
const DEFAULT_TARGET_PUBLIC_ID = 1000000;

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    email: DEFAULT_TARGET_EMAIL,
    targetPublicId: DEFAULT_TARGET_PUBLIC_ID,
    apply: false,
    grantAdmin: true,
    correctPublicId: true,
    requireVerifiedAccount: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--dry-run') {
      options.apply = false;
    } else if (arg === '--email') {
      options.email = String(argv[++index] || '').trim();
    } else if (arg === '--target-public-id') {
      options.targetPublicId = Number(argv[++index]);
    } else if (arg === '--grant-admin') {
      options.grantAdmin = true;
    } else if (arg === '--no-grant-admin') {
      options.grantAdmin = false;
    } else if (arg === '--correct-public-id') {
      options.correctPublicId = true;
    } else if (arg === '--no-correct-public-id') {
      options.correctPublicId = false;
    } else if (arg === '--allow-unverified') {
      options.requireVerifiedAccount = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.email || !options.email.includes('@')) {
    throw new Error('A valid target email is required.');
  }
  if (!Number.isSafeInteger(options.targetPublicId) || options.targetPublicId < 1000000) {
    throw new Error('targetPublicId must be a safe integer public ID.');
  }
  return options;
}

async function findTargetUser(UserModel, email, requireVerifiedAccount = true) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const users = await UserModel.find({ email: normalizedEmail })
    .select('username email googleId publicId role isHost isAgent agencyId followers following followersCount followingCount')
    .lean();

  if (users.length !== 1) {
    throw new Error(`Expected exactly one account for ${normalizedEmail}, found ${users.length}.`);
  }

  const user = users[0];
  if (requireVerifiedAccount && !user.googleId) {
    throw new Error(`Target account ${normalizedEmail} is not a verified Google account.`);
  }
  return user;
}

async function findPublicIdOwner(UserModel, publicId, excludedUserId) {
  return UserModel.findOne({
    publicId,
    _id: { $ne: excludedUserId },
  })
    .select('username email role publicId')
    .lean();
}

function planAccountSetup(target, publicIdOwner, options) {
  const changes = {};
  const blockers = [];
  let blocked = false;

  if (options.correctPublicId) {
    if (target.publicId === options.targetPublicId) {
      changes.publicId = {
        action: 'none',
        current: target.publicId,
        requested: options.targetPublicId,
      };
    } else if (publicIdOwner) {
      changes.publicId = {
        action: 'blocked',
        current: target.publicId,
        requested: options.targetPublicId,
        conflict: {
          userId: String(publicIdOwner._id),
          username: publicIdOwner.username,
          email: publicIdOwner.email,
          role: publicIdOwner.role,
          publicId: publicIdOwner.publicId,
        },
      };
      blocked = true;
      blockers.push(
        `Public ID ${options.targetPublicId} is already assigned to ${publicIdOwner.username} (${publicIdOwner.email}).`
      );
    } else {
      changes.publicId = {
        action: 'update',
        current: target.publicId,
        requested: options.targetPublicId,
      };
    }
  }

  if (options.grantAdmin) {
    changes.role = target.role === 'ADMIN'
      ? { action: 'none', current: target.role, requested: 'ADMIN' }
      : { action: 'update', current: target.role, requested: 'ADMIN' };
  }

  return {
    target: {
      userId: String(target._id),
      username: target.username,
      email: target.email,
      googleId: target.googleId,
      currentPublicId: target.publicId,
      currentRole: target.role,
    },
    changes,
    blocked,
    blockers,
    apply: options.apply,
  };
}

async function applyAccountSetup(UserModel, plan, options) {
  if (plan.blocked) {
    throw new Error(plan.blockers.join(' '));
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const user = await UserModel.findById(plan.target.userId).session(session);
      if (!user) {
        throw new Error('Target account no longer exists.');
      }
      if (String(user.email).toLowerCase() !== String(plan.target.email).toLowerCase()) {
        throw new Error('Target account email changed during setup.');
      }

      if (options.correctPublicId && user.publicId !== options.targetPublicId) {
        const owner = await UserModel.findOne({
          publicId: options.targetPublicId,
          _id: { $ne: user._id },
        }).session(session);
        if (owner) {
          throw new Error(
            `Public ID ${options.targetPublicId} is already assigned to ${owner.username} (${owner.email}).`
          );
        }
        user.publicId = options.targetPublicId;
      }

      if (options.grantAdmin) {
        user.role = 'ADMIN';
      }

      await user.save({ session, validateModifiedOnly: true });
    });
  } finally {
    await session.endSession();
  }
}

async function run() {
  const options = parseArgs();
  await connectToMongo(mongoose);
  try {
    const target = await findTargetUser(User, options.email, options.requireVerifiedAccount);
    const owner = options.correctPublicId
      ? await findPublicIdOwner(User, options.targetPublicId, target._id)
      : null;
    const plan = planAccountSetup(target, owner, options);

    console.log(JSON.stringify(plan, null, 2));

    if (plan.blocked) {
      console.error('Account setup blocked. No changes were made.');
      process.exitCode = 1;
      return;
    }

    if (!options.apply) {
      console.log('Dry run only. Re-run with --apply to make these changes.');
      return;
    }

    requireProductionWriteApproval();
    await applyAccountSetup(User, plan, options);
    console.log('Account setup applied successfully.');
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  findTargetUser,
  findPublicIdOwner,
  planAccountSetup,
  applyAccountSetup,
};
