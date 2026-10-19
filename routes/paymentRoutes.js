const express = require('express');
const router = express.Router();
const Payment = require('../models/Payment');
const { verifyToken } = require('../middleware/authMiddleware');
const paymentService = require('../services/paymentService');

const isValidAmount = (amount) =>
  typeof amount === 'number' && Number.isFinite(amount) && amount > 0 && amount <= 1000000;

router.post('/initialize', verifyToken, async (req, res) => {
  try {
    const { amount, currency = 'ETB', description, coinsToCredit, customer } = req.body || {};
    if (!isValidAmount(amount)) {
      return res.status(400).json({ message: 'amount must be a positive number no greater than 1,000,000' });
    }
    if (!process.env.CHAPA_SECRET_KEY &&
        (!Number.isSafeInteger(coinsToCredit) || coinsToCredit <= 0)) {
      return res.status(400).json({ message: 'coinsToCredit must be a positive whole number' });
    }
    if (typeof currency !== 'string' || currency.trim().toUpperCase() !== 'ETB') {
      return res.status(400).json({ message: 'Only ETB payments are currently supported' });
    }
    if (typeof description !== 'string' || !description.trim() || description.trim().length > 255) {
      return res.status(400).json({ message: 'description must be between 1 and 255 characters' });
    }
    if (process.env.CHAPA_SECRET_KEY) {
      if (typeof customer?.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) {
        return res.status(400).json({ message: 'A valid customer.email is required for Chapa checkout' });
      }
      if (typeof customer.firstName !== 'string' || !customer.firstName.trim() ||
          typeof customer.lastName !== 'string' || !customer.lastName.trim()) {
        return res.status(400).json({ message: 'customer.firstName and customer.lastName are required' });
      }
    }

    const payment = await paymentService.initializePayment(
      req.user.id,
      amount,
      currency.trim().toUpperCase(),
      description.trim(),
      {
        ...(coinsToCredit !== undefined ? { coinsToCredit } : {}),
        email: customer?.email?.trim(),
        firstName: customer?.firstName?.trim(),
        lastName: customer?.lastName?.trim()
      }
    );
    return res.status(201).json(payment);
  } catch (err) {
    return res.status(err.status || 500).json({ message: err.message });
  }
});

router.get('/verify/:txRef', verifyToken, async (req, res) => {
  try {
    const payment = await Payment.findOne({
      transactionRef: req.params.txRef,
      userId: req.user.id
    }).select('transactionRef');
    if (!payment) return res.status(404).json({ message: 'Payment not found' });
    const result = await paymentService.verifyPayment(payment.transactionRef);
    return res.json(result);
  } catch (err) {
    return res.status(err.status || 500).json({ message: err.message });
  }
});

router.post('/webhook', async (req, res) => {
  try {
    const result = await paymentService.handleWebhook(req.body, req.headers, req.rawBody);
    return res.status(200).json({ received: true, result });
  } catch (err) {
    return res.status(err.status || 500).json({ message: err.message });
  }
});

module.exports = router;
