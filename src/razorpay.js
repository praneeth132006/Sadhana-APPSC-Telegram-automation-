// ============================================================================
// Razorpay client (src/razorpay.js)
// ============================================================================
// Talks to the Razorpay REST API over plain fetch and verifies the signatures
// on everything that comes back. No SDK: the surface used here is four
// endpoints and two HMACs, and keeping it native means the same code runs
// unchanged on a Vercel function.
//
// Two signature checks matter, and they are the whole security model:
//
//   verifyWebhookSignature  — proves a webhook really came from Razorpay.
//                             Without it anyone who finds the webhook URL can
//                             POST "payment captured" and be handed a paid
//                             invite link for free.
//
//   verifyPaymentSignature  — proves a browser redirect back from checkout is
//                             genuine, for the thank-you page.
//
// Both compare with crypto.timingSafeEqual so a forged signature cannot be
// guessed a byte at a time.
// ============================================================================

const crypto = require('crypto');

/** Razorpay API root. */
const API_BASE = 'https://api.razorpay.com/v1';

/** Give up on a Razorpay call after this long. */
const REQUEST_TIMEOUT_MS = 20000;

/**
 * getCredentials — reads and validates the API keys.
 *
 * @returns {{keyId: string, keySecret: string}}
 * @throws {Error} When either key is missing
 */
function getCredentials() {
  const keyId = String(process.env.RAZORPAY_KEY_ID || '').trim();
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || '').trim();

  if (!keyId || !keySecret) {
    throw new Error(
      'Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env.'
    );
  }
  return { keyId, keySecret };
}

/** True when the keys are present, so callers can degrade gracefully. */
function isConfigured() {
  try {
    getCredentials();
    return true;
  } catch (err) {
    return false;
  }
}

/** True when the keys are test-mode keys rather than live ones. */
function isTestMode() {
  return String(process.env.RAZORPAY_KEY_ID || '').startsWith('rzp_test_');
}

/**
 * request — one authenticated Razorpay API call.
 *
 * @param {'GET'|'POST'|'PATCH'} method HTTP method
 * @param {string} path Path under /v1, e.g. '/payment_links'
 * @param {Object} [body] JSON body for writes
 * @returns {Promise<Object>} Parsed response
 */
async function request(method, path, body = null) {
  const { keyId, keySecret } = getCredentials();
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(API_BASE + path, {
      method,
      headers: {
        Authorization: 'Basic ' + auth,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('Razorpay request timed out.');
    throw new Error('Razorpay request failed: ' + err.message);
  }
  clearTimeout(timer);

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (err) {
    throw new Error(`Razorpay returned a non-JSON response (HTTP ${response.status}): ${text.slice(0, 200)}`);
  }

  if (!response.ok) {
    const detail = payload && payload.error ? payload.error.description : text.slice(0, 200);
    throw new Error(`Razorpay ${method} ${path} failed (HTTP ${response.status}): ${detail}`);
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Payment links (one-time plans)
// ---------------------------------------------------------------------------

/**
 * createPaymentLink — a personal checkout link for one student.
 *
 * The Telegram id and plan travel in `notes`, which Razorpay echoes back on the
 * webhook. That is what lets the webhook know who paid and for what without
 * trusting anything the browser sends.
 *
 * @param {Object} options
 * @param {Object} options.plan Plan from src/plans.js
 * @param {string|number} options.telegramId Buyer's Telegram user id
 * @param {string} [options.name] Display name, prefilled at checkout
 * @param {string} [options.username] Telegram @username, for the sheet
 * @param {string} [options.callbackUrl] Where to send the browser after paying
 * @returns {Promise<Object>} The created payment link
 */
/**
 * bmpOnly — strips characters Razorpay's storage cannot hold.
 *
 * Razorpay rejects an entire request with
 *   "Error 3988: Conversion from collation utf8mb3_general_ci into
 *    utf8mb4_0900_ai_ci impossible for parameter"
 * when any string carries a character outside the Basic Multilingual Plane —
 * in practice, an emoji. Telegram display names are full of them and we build
 * the text we send from them, so a student whose name contained one simply
 * could not buy: the bot could only say "could not create your payment link".
 *
 * Stripping at this boundary makes every field sent to Razorpay safe by
 * construction, rather than each call site having to remember.
 *
 * @param {string} value
 * @param {number} [max] Truncate to this many characters afterwards
 * @returns {string} The text with astral-plane characters removed
 */
function bmpOnly(value, max) {
  // Iterate by code point, so a surrogate pair is dropped whole rather than
  // leaving half of one behind.
  const cleaned = Array.from(String(value == null ? '' : value))
    .filter((ch) => ch.codePointAt(0) <= 0xFFFF)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return max ? cleaned.slice(0, max) : cleaned;
}

async function createPaymentLink({ plan, telegramId, name, username, callbackUrl }) {
  const body = {
    amount: plan.amountPaise,
    currency: 'INR',
    accept_partial: false,
    description: bmpOnly(`${plan.label} - APPSC Premium Group`, 255),
    // Expire the link so a stale one cannot be paid weeks later and grant
    // access the student no longer expects.
    expire_by: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    reference_id: `tg_${telegramId}_${plan.id}_${Date.now()}`,
    notes: {
      telegram_id: String(telegramId),
      telegram_username: bmpOnly(username, 60),
      plan_id: plan.id,
      // Which group this pass is for. It rides in notes, the same channel the
      // telegram id uses, because Razorpay echoes notes back on the webhook
      // untouched — so the group is something we set, never something the
      // payer can choose. Without it the webhook has no way to know which of
      // five sheets to record the sale in.
      group_id: String(plan.groupId || '')
    },
    notify: { sms: false, email: false },
    reminder_enable: false
  };

  // A name made entirely of emoji sanitises to nothing, and an empty customer
  // object is worse than none, so only send it when something survives.
  const safeName = bmpOnly(name, 100);
  if (safeName) body.customer = { name: safeName };
  if (callbackUrl) {
    body.callback_url = callbackUrl;
    body.callback_method = 'get';
  }

  return request('POST', '/payment_links', body);
}

/** Fetches one payment link by id. */
async function getPaymentLink(linkId) {
  return request('GET', `/payment_links/${encodeURIComponent(linkId)}`);
}

// ---------------------------------------------------------------------------
// Subscriptions (recurring plan)
// ---------------------------------------------------------------------------

/**
 * createPlan — registers a recurring plan with Razorpay.
 * Run once via `node setup-razorpay.js`; the returned id goes in .env.
 *
 * @param {Object} plan Plan from src/plans.js with type 'recurring'
 * @returns {Promise<Object>} The created Razorpay plan
 */
async function createPlan(plan) {
  return request('POST', '/plans', {
    period: 'monthly',
    interval: plan.intervalMonths || 1,
    item: {
      name: plan.label,
      description: plan.description,
      amount: plan.amountPaise,
      currency: 'INR'
    },
    notes: { plan_id: plan.id }
  });
}

/**
 * createSubscription — starts a recurring mandate for one student.
 *
 * @param {Object} options
 * @param {Object} options.plan Plan from src/plans.js
 * @param {string} options.razorpayPlanId Razorpay plan id from .env
 * @param {string|number} options.telegramId Buyer's Telegram user id
 * @param {string} [options.username] Telegram @username
 * @returns {Promise<Object>} The subscription, including short_url to pay at
 */
async function createSubscription({ plan, razorpayPlanId, telegramId, username }) {
  return request('POST', '/subscriptions', {
    plan_id: razorpayPlanId,
    total_count: plan.totalBillingCycles || 12,
    quantity: 1,
    customer_notify: 0,
    notes: {
      telegram_id: String(telegramId),
      telegram_username: bmpOnly(username, 60),
      plan_id: plan.id,
      group_id: String(plan.groupId || '')
    }
  });
}

/** Fetches one subscription by id. */
async function getSubscription(subscriptionId) {
  return request('GET', `/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

/**
 * cancelSubscription — stops a recurring mandate.
 *
 * @param {string} subscriptionId Razorpay subscription id
 * @param {boolean} [atCycleEnd] Cancel at the end of the paid period rather
 *   than immediately, so the student keeps what they already paid for
 */
async function cancelSubscription(subscriptionId, atCycleEnd = true) {
  return request('POST', `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
    cancel_at_cycle_end: atCycleEnd ? 1 : 0
  });
}

/** Fetches one payment by id, used to reconcile a webhook against the API. */
async function getPayment(paymentId) {
  return request('GET', `/payments/${encodeURIComponent(paymentId)}`);
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/**
 * safeCompare — constant-time comparison of two hex signatures.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeCompare(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  // timingSafeEqual throws on a length mismatch, so check that first — the
  // length of a signature is not a secret.
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * verifyWebhookSignature — proves a webhook body really came from Razorpay.
 *
 * The signature is HMAC-SHA256 of the RAW request body under the webhook
 * secret. It must be computed on the exact bytes received: re-serialising the
 * parsed JSON changes key order and whitespace and will never match.
 *
 * @param {string|Buffer} rawBody The unmodified request body
 * @param {string} signature Value of the X-Razorpay-Signature header
 * @returns {boolean} True only when the signature is valid
 */
function verifyWebhookSignature(rawBody, signature) {
  const secret = String(process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();
  // No secret configured means we cannot prove anything — reject, never accept.
  if (!secret || !signature) return false;

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeCompare(expected, signature);
}

/**
 * verifyPaymentSignature — validates a checkout redirect back to our site.
 *
 * @param {Object} params
 * @param {string} params.paymentLinkId
 * @param {string} params.paymentId
 * @param {string} params.referenceId
 * @param {string} params.status
 * @param {string} params.signature razorpay_signature from the query string
 * @returns {boolean}
 */
function verifyPaymentLinkSignature({ paymentLinkId, paymentId, referenceId, status, signature }) {
  const { keySecret } = getCredentials();
  const payload = `${paymentLinkId}|${referenceId}|${status}|${paymentId}`;
  const expected = crypto.createHmac('sha256', keySecret).update(payload).digest('hex');
  return safeCompare(expected, signature);
}

module.exports = {
  bmpOnly,
  isConfigured,
  isTestMode,
  createPaymentLink,
  getPaymentLink,
  createPlan,
  createSubscription,
  getSubscription,
  cancelSubscription,
  getPayment,
  verifyWebhookSignature,
  verifyPaymentLinkSignature,
  safeCompare
};
