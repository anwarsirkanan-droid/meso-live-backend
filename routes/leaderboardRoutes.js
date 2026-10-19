const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Transaction = require('../models/Transaction');

const PUBLIC_USER_FIELDS = 'username avatar isVip followersCount';
const levelExpression = {
  $switch: {
    branches: [
      { case: { $gte: ['$totalRechargedCoins', 1000000] }, then: 50 },
      { case: { $gte: ['$totalRechargedCoins', 500000] }, then: 40 },
      { case: { $gte: ['$totalRechargedCoins', 100000] }, then: 30 },
      { case: { $gte: ['$totalRechargedCoins', 20000] }, then: 20 },
      { case: { $gte: ['$totalRechargedCoins', 5000] }, then: 10 }
    ],
    default: 1
  }
};

router.get('/coins', async (req, res) => {
  try {
    const users = await User.find()
      .select(`${PUBLIC_USER_FIELDS} coins`)
      .sort({ coins: -1, _id: 1 })
      .limit(50)
      .lean();
    return res.json(users);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.get('/diamonds', async (req, res) => {
  try {
    const users = await User.find()
      .select(`${PUBLIC_USER_FIELDS} diamonds`)
      .sort({ diamonds: -1, _id: 1 })
      .limit(50)
      .lean();
    return res.json(users);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.get('/level', async (req, res) => {
  try {
    const users = await User.aggregate([
      { $addFields: { level: levelExpression } },
      { $sort: { level: -1, totalRechargedCoins: -1, _id: 1 } },
      { $limit: 50 },
      {
        $project: {
          username: 1,
          avatar: 1,
          isVip: 1,
          followersCount: 1,
          level: 1
        }
      }
    ]);
    return res.json(users);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.get('/gifts', async (req, res) => {
  try {
    const users = await Transaction.aggregate([
      { $match: { type: 'GIFT_RECEIVED', status: 'COMPLETED' } },
      { $group: { _id: '$userId', giftsReceived: { $sum: '$amountDiamonds' } } },
      { $sort: { giftsReceived: -1, _id: 1 } },
      { $limit: 50 },
      {
        $lookup: {
          from: User.collection.name,
          localField: '_id',
          foreignField: '_id',
          pipeline: [{ $project: { username: 1, avatar: 1, isVip: 1, followersCount: 1 } }],
          as: 'user'
        }
      },
      { $unwind: '$user' },
      {
        $project: {
          _id: '$user._id',
          username: '$user.username',
          avatar: '$user.avatar',
          isVip: '$user.isVip',
          followersCount: '$user.followersCount',
          giftsReceived: 1
        }
      }
    ]);
    return res.json(users);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
