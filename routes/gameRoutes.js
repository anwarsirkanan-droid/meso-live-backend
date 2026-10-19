const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const User = require('../models/User');
const Room = require('../models/Room');
const GameRound = require('../models/GameRound');
const Transaction = require('../models/Transaction');
const auth = require('../middleware/auth');
const { playMiniGame } = require('../services/gameService');

const GAME_TYPES = ['MegaJackpot', 'Keno', '777', 'Jungle Hunt', 'Fish Hunter'];

router.post('/play', auth, async (req, res) => {
  const { roomId, gameType, betAmount } = req.body || {};
  if (typeof roomId !== 'string' || !mongoose.Types.ObjectId.isValid(roomId)) {
    return res.status(400).json({ error: 'A valid roomId is required' });
  }
  if (!GAME_TYPES.includes(gameType)) {
    return res.status(400).json({ error: 'Invalid game type' });
  }
  if (!Number.isSafeInteger(betAmount) || betAmount <= 0) {
    return res.status(400).json({ error: 'Bet amount must be a positive whole number' });
  }

  try {
    const room = await Room.findById(roomId).select('_id');
    if (!room) return res.status(404).json({ error: 'Room not found' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  let session;
  let insufficientCoins = false;
  try {
    session = await mongoose.startSession();
    let user;
    let roundLog;
    let gameResult;
    await session.withTransaction(async () => {
      user = await User.findOneAndUpdate(
        { _id: req.user.id, coins: { $gte: betAmount } },
        { $inc: { coins: -betAmount } },
        { new: true, session }
      );
      if (!user) {
        insufficientCoins = true;
        throw new Error('Insufficient coins');
      }

      gameResult = playMiniGame(gameType, betAmount);
      if (!Number.isSafeInteger(gameResult.winAmount) || gameResult.winAmount < 0) {
        throw new Error('Game payout is outside the supported range');
      }
      if (gameResult.isWin) {
        user = await User.findByIdAndUpdate(
          user._id,
          { $inc: { coins: gameResult.winAmount } },
          { new: true, session }
        );
      }
      [roundLog] = await GameRound.create([{
        gameType,
        roomId,
        userId: user._id,
        betAmount,
        winAmount: gameResult.winAmount,
        isWin: gameResult.isWin,
        resultMultiplier: gameResult.multiplier,
        serverRngData: { rngRoll: gameResult.rngRoll }
      }], { session });
      const transactions = [{
        userId: user._id,
        type: 'GAME_BET',
        amountCoins: betAmount,
        referenceId: roundLog._id.toString()
      }];
      if (gameResult.isWin) {
        transactions.push({
          userId: user._id,
          type: 'GAME_WIN',
          amountCoins: gameResult.winAmount,
          referenceId: roundLog._id.toString()
        });
      }
      await Transaction.create(transactions, { session });
    });

    const io = req.app.get('io');
    if (io) {
      io.to(roomId).emit('game_result_broadcast', {
        username: user.username,
        gameType,
        betAmount,
        winAmount: gameResult.winAmount,
        isWin: gameResult.isWin,
        multiplier: gameResult.multiplier,
        timestamp: new Date()
      });
      if (gameResult.isWin && gameResult.multiplier >= 50) {
        io.to(roomId).emit('jackpot_announcement', {
          winnerName: user.username,
          gameType,
          multiplier: gameResult.multiplier,
          winAmount: gameResult.winAmount
        });
      }
    }

    res.status(200).json({
      message: gameResult.isWin ? 'Congratulations! You won!' : 'Better luck next time!',
      isWin: gameResult.isWin,
      multiplier: gameResult.multiplier,
      winAmount: gameResult.winAmount,
      newBalance: user.coins,
      gameRoundId: roundLog._id
    });
  } catch (err) {
    if (insufficientCoins) {
      return res.status(400).json({ error: 'Insufficient coins for bet' });
    }
    return res.status(500).json({ error: err.message });
  } finally {
    if (session) await session.endSession();
  }
});

module.exports = router;
