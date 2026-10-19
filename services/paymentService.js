const crypto = require('crypto');
const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const Transaction = require('../models/Transaction');
const User = require('../models/User');

const CHAPA_API_URL = 'https://api.chapa.co/v1';

class PaymentError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'PaymentError';
    this.status = status;
  }
}

function getProviderConfig() {
  const secretKey = process.env.CHAPA_SECRET_KEY || '';
  const publicKey = process.env.CHAPA_PUBLIC_KEY || '';
  if (publicKey && !secretKey) {
    throw new PaymentError('CHAPA_SECRET_KEY is required when CHAPA_PUBLIC_KEY is configured.', 503);
  }
  return {
    mode: secretKey ? 'chapa' : 'mock',
    secretKey,
    publicKey
  };
}

async function chapaRequest(path, { method = 'GET', body, secretKey }) {
  const response = await fetch(`${CHAPA_API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json'
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000)
  });

  let result;
  try {
    result = await response.json();
  } catch (error) {
    throw new PaymentError('Chapa returned an invalid response.');
  }
  if (!response.ok) {
    throw new PaymentError(result.message || `Chapa request failed with HTTP ${response.status}.`, 502);
  }
  return result;
}

async function initializePayment(userId, amount, currency, description, options = {}) {
  const config = getProviderConfig();
  const { email, firstName, lastName } = options;
  const configuredCoinsPerEtb = Number(process.env.CHAPA_COINS_PER_ETB);
  if (config.mode === 'chapa' &&
      (!Number.isSafeInteger(configuredCoinsPerEtb) || configuredCoinsPerEtb <= 0)) {
    throw new PaymentError('Configure CHAPA_COINS_PER_ETB before accepting real payments.', 503);
  }
  const coinsToCredit = config.mode === 'chapa'
    ? Math.floor(amount * configuredCoinsPerEtb)
    : options.coinsToCredit;
  if (!mongoose.Types.ObjectId.isValid(userId) ||
      typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 1000000 ||
      typeof currency !== 'string' || currency.trim().toUpperCase() !== 'ETB' ||
      typeof description !== 'string' || !description.trim() || description.trim().length > 255 ||
      !Number.isSafeInteger(coinsToCredit) || coinsToCredit <= 0) {
    throw new PaymentError('Invalid payment details.', 400);
  }
  const transactionRef = `meso-${crypto.randomUUID()}`;
  const payment = await Payment.create({
    userId,
    provider: config.mode,
    transactionRef,
    amount,
    currency,
    coinsToCredit,
    description,
    status: 'PENDING'
  });

  if (config.mode === 'mock') {
    return {
      mode: 'mock',
      transactionRef,
      status: payment.status,
      checkoutUrl: null,
      message: 'Payment provider keys are not configured. This mock payment cannot credit coins.'
    };
  }

  try {
    // TODO: Add a Flutterwave adapter here and select it by provider configuration.
    // TODO: Add a Stripe adapter here and select it by provider configuration.
    const requestBody = {
      amount: String(amount),
      currency,
      email,
      first_name: firstName,
      last_name: lastName,
      tx_ref: transactionRef,
      customization: { title: 'Meso Live', description }
    };
    if (process.env.CHAPA_CALLBACK_URL) requestBody.callback_url = process.env.CHAPA_CALLBACK_URL;
    if (process.env.CHAPA_RETURN_URL) requestBody.return_url = process.env.CHAPA_RETURN_URL;

    const result = await chapaRequest('/transaction/initialize', {
      method: 'POST',
      body: requestBody,
      secretKey: config.secretKey
    });
    const checkoutUrl = result.data && result.data.checkout_url;
    if (result.status !== 'success' || typeof checkoutUrl !== 'string' || !checkoutUrl) {
      throw new PaymentError('Chapa did not return a checkout URL.', 502);
    }
    await Payment.updateOne(
      { _id: payment._id, status: 'PENDING' },
      { $set: { checkoutUrl } }
    );
    return {
      mode: 'chapa',
      transactionRef,
      status: payment.status,
      checkoutUrl
    };
  } catch (error) {
    await Payment.updateOne(
      { _id: payment._id, status: 'PENDING' },
      { $set: { status: 'FAILED' } }
    );
    throw error;
  }
}

async function creditVerifiedPayment(payment, verification) {
  let session;
  try {
    session = await mongoose.startSession();
    let result;
    await session.withTransaction(async () => {
      const current = await Payment.findOne({ transactionRef: payment.transactionRef }).session(session);
      if (!current) throw new PaymentError('Payment not found.', 404);
      if (current.status === 'COMPLETED') {
        result = { payment: current, credited: false };
        return;
      }
      if (current.status !== 'PENDING') {
        result = { payment: current, credited: false };
        return;
      }

      const completed = await Payment.findOneAndUpdate(
        { _id: current._id, status: 'PENDING', provider: 'chapa' },
        {
          $set: {
            status: 'COMPLETED',
            providerTransactionId: String(verification.data.id || ''),
            verifiedAt: new Date()
          }
        },
        { new: true, session }
      );
      if (!completed) {
        result = {
          payment: await Payment.findById(current._id).session(session),
          credited: false
        };
        return;
      }

      const user = await User.findByIdAndUpdate(
        completed.userId,
        {
          $inc: {
            coins: completed.coinsToCredit,
            totalRechargedCoins: completed.coinsToCredit
          }
        },
        { new: true, session }
      );
      if (!user) throw new PaymentError('Payment owner no longer exists.');

      await Transaction.create([{
        userId: completed.userId,
        type: 'RECHARGE',
        amountCoins: completed.coinsToCredit,
        amountUsd: completed.currency === 'USD' ? completed.amount : 0,
        referenceId: completed.transactionRef,
        status: 'COMPLETED'
      }], { session });

      result = { payment: completed, credited: true, balance: user.coins };
    });
    return result;
  } finally {
    if (session) await session.endSession();
  }
}

async function verifyPayment(transactionRef) {
  if (typeof transactionRef !== 'string' || !transactionRef) {
    throw new PaymentError('A transaction reference is required.', 400);
  }
  const payment = await Payment.findOne({ transactionRef });
  if (!payment) throw new PaymentError('Payment not found.', 404);
  if (payment.status === 'COMPLETED' || payment.status === 'FAILED') {
    return { status: payment.status, transactionRef, credited: false };
  }
  if (payment.provider !== 'chapa') {
    return { status: payment.status, transactionRef, credited: false, mode: 'mock' };
  }

  const config = getProviderConfig();
  const result = await chapaRequest(
    `/transaction/verify/${encodeURIComponent(transactionRef)}`,
    { secretKey: config.secretKey }
  );
  const data = result.data || {};
  const verified = result.status === 'success' && data.status === 'success' &&
    data.tx_ref === payment.transactionRef &&
    Number(data.amount) === payment.amount &&
    String(data.currency).toUpperCase() === payment.currency;

  if (verified) {
    const credited = await creditVerifiedPayment(payment, data);
    return {
      status: credited.payment.status,
      transactionRef,
      credited: credited.credited,
      ...(credited.balance !== undefined ? { balance: credited.balance } : {})
    };
  }

  const providerStatus = String(data.status || '').toLowerCase();
  if (['failed', 'cancelled', 'canceled'].includes(providerStatus)) {
    await Payment.updateOne(
      { _id: payment._id, status: 'PENDING' },
      { $set: { status: 'FAILED' } }
    );
    return { status: 'FAILED', transactionRef, credited: false };
  }
  if (result.status !== 'success') {
    throw new PaymentError('Chapa could not verify this payment.', 502);
  }
  return { status: 'PENDING', transactionRef, credited: false };
}

function signaturesMatch(expected, received) {
  if (typeof expected !== 'string' || typeof received !== 'string') return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function verifyWebhookSignature(payload, headers, rawBody) {
  const webhookSecret = process.env.CHAPA_WEBHOOK_SECRET || '';
  if (!webhookSecret || !Buffer.isBuffer(rawBody)) return false;

  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers || {}).map(([key, value]) => [key.toLowerCase(), value])
  );
  const directSignature = normalizedHeaders['x-chapa-signature'];
  const payloadSignature = normalizedHeaders['chapa-signature'];
  const expectedPayloadSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');

  return signaturesMatch(webhookSecret, directSignature) ||
    signaturesMatch(expectedPayloadSignature, payloadSignature);
}

async function handleWebhook(payload, headers = {}, rawBody) {
  if (!verifyWebhookSignature(payload, headers, rawBody)) {
    throw new PaymentError('Invalid Chapa webhook signature.', 401);
  }
  const transactionRef = payload && (
    payload.tx_ref ||
    payload.data?.tx_ref ||
    payload.data?.reference
  );
  if (typeof transactionRef !== 'string' || !transactionRef) {
    throw new PaymentError('Webhook payload is missing a transaction reference.', 400);
  }
  return verifyPayment(transactionRef);
}

module.exports = {
  PaymentError,
  initializePayment,
  verifyPayment,
  handleWebhook,
  verifyWebhookSignature
};
