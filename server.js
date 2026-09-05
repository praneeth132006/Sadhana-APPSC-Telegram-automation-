// ============================================================================
// Sadhana APPSC — Dashboard server & API (server.js)
// ============================================================================
// Serves the five dashboards out of dashboard/ and exposes the JSON API they
// run on. It is the only process that holds secrets (the Telegram bot token and
// the Sheets API token), so it is also the security boundary:
//
//   - Every mutating and data-reading endpoint requires a Firebase ID token
//     that is verified server-side (src/auth.js). The browser-side login gate
//     is cosmetic; this is the control that actually holds.
//   - It binds to 127.0.0.1 by default, so nothing on the local network can
//     reach it.
//   - It sends no permissive CORS headers, so another origin cannot drive it
//     from a page the curator happens to have open.
//   - Callers cannot supply a URL to fetch. The Sheets endpoint comes from
//     .env only, which closes the SSRF hole the previous /api/ping?url= had.
//   - Request bodies are size capped and requests are rate limited.
//
// Run with: npm run dashboard
// ============================================================================

require('dotenv').config();

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const sheets = require('./src/sheets');
const auth = require('./src/auth');
const telegram = require('./src/telegram');
const razorpay = require('./src/razorpay');
const membership = require('./src/membership');
const plans = require('./src/plans');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/* What this line does: Resolves port number from PORT environment variable or defaults to 3000 */
/* What it brings: Seamless port assignment on cloud runtimes like Vercel and local machines */
/* Where changes can be seen: Listening HTTP port */
const PORT = Number(process.env.PORT) || 3000;

/* What this line does: Binds to 0.0.0.0 in cloud/Vercel or explicit HOST, and 127.0.0.1 on local machines */
/* What it brings: Allows container ingress on Vercel while preserving local loopback security */
/* Where changes can be seen: Incoming network socket binding in server.listen */
const HOST = process.env.HOST || (process.env.VERCEL ? '0.0.0.0' : '127.0.0.1');

const DASHBOARD_DIR = path.resolve(__dirname, 'dashboard');

/** Largest JSON body we accept. A full batch of questions is far below this. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** Apps Script version these dashboards require. Older deployments lack the
 *  analytics, browse and edit actions, so the UI warns instead of failing. */
const REQUIRED_SHEET_VERSION = 'v6 (30 columns + membership)';

/** Major version number REQUIRED_SHEET_VERSION asks for, e.g. 6. */
const REQUIRED_SHEET_MAJOR = Number(REQUIRED_SHEET_VERSION.match(/^v(\d+)/)[1]);

/** Whether a deployment's reported version is new enough for the dashboards.
 *  A later major version is fine; only an older one is a problem. Both the
 *  ping route and the health report ask this, and when they each carried their
 *  own copy of the test one was left behind on an upgrade and the Health page
 *  called a current deployment outdated against itself. */
function sheetVersionIsCurrent(version) {
  const major = Number((String(version).match(/^v(\d+)/) || [])[1]);
  return Number.isFinite(major) && major >= REQUIRED_SHEET_MAJOR;
}

/** Rate limit: requests allowed per IP inside the window. */
const RATE_LIMIT_MAX = 240;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/** Extensions we are willing to serve, mapped to their content types. */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/** Per-IP request counters: ip -> { count, resetAt }. */
const rateBuckets = new Map();

/**
 * checkRateLimit — fixed-window counter per client address.
 *
 * @param {string} ip Remote address
 * @returns {boolean} true when the request may proceed
 */
function checkRateLimit(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);

  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  bucket.count++;
  return bucket.count <= RATE_LIMIT_MAX;
}

// Drop expired buckets periodically so the map cannot grow without bound.
const rateCleanup = setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateBuckets) {
    if (now > bucket.resetAt) rateBuckets.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS);
rateCleanup.unref();

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

/**
 * applySecurityHeaders — headers applied to every response.
 * The CSP allowlists exactly the Google origins Firebase Auth needs and
 * nothing else, so an injected script has nowhere to send data.
 */
function applySecurityHeaders(res) {
  const projectId = auth.getProjectId();
  const authFrames = projectId
    ? `https://${projectId}.firebaseapp.com https://accounts.google.com`
    : 'https://accounts.google.com';

  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' https://www.gstatic.com https://apis.google.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://lh3.googleusercontent.com https://*.googleusercontent.com",
    "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://www.gstatic.com",
    `frame-src ${authFrames}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; '));

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
}

/**
 * sendJSON — writes a JSON response.
 * Deliberately sends no Access-Control-Allow-Origin: the dashboard is served
 * from this same origin, so it needs none, and omitting it means no other site
 * can read our responses.
 */
function sendJSON(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(body);
}

/** Sends a plain-text error without leaking internals. */
function sendText(res, statusCode, message) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(message);
}

/**
 * readJsonBody — buffers and parses a request body, aborting if it is too big.
 *
 * @param {http.IncomingMessage} req
 * @returns {Promise<Object>} Parsed JSON body
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > MAX_BODY_BYTES) {
      reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
      return;
    }

    const chunks = [];
    let received = 0;

    req.on('data', (chunk) => {
      received += chunk.length;
      // Enforce the cap on the actual stream too — Content-Length can lie.
      if (received > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('error', reject);

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(Object.assign(new Error('Body must be a JSON object'), { statusCode: 400 }));
          return;
        }
        resolve(parsed);
      } catch (err) {
        reject(Object.assign(new Error('Body is not valid JSON'), { statusCode: 400 }));
      }
    });
  });
}

/**
 * readRawBody — buffers a request body as raw bytes.
 *
 * A webhook signature is an HMAC over the EXACT bytes Razorpay sent.
 * Re-serialising parsed JSON changes key order and whitespace, so the hash
 * would never match. Everything else uses readJsonBody; this exists only for
 * signature verification.
 *
 * @param {http.IncomingMessage} req
 * @returns {Promise<string>} The body as a UTF-8 string
 */
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;

    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

/** Field length ceilings, so one oversized paste cannot wreck a sheet. */
const LIMITS = {
  question: 4000,
  option: 300,
  explanation: 4000,
  short: 200,
  url: 500,
  notes: 1000
};

/** Maximum questions accepted in a single upload. */
const MAX_QUESTIONS_PER_BATCH = 100;

/** Coerces to a trimmed string of at most `max` characters. */
function str(value, max) {
  return String(value === null || value === undefined ? '' : value).trim().slice(0, max);
}

/**
 * sanitiseQuestion — normalises one incoming question object.
 * Only known fields survive; anything else the client sends is dropped, which
 * is what stops a crafted payload from setting Posted or Added By directly.
 *
 * @returns {{ok: boolean, error?: string, value?: Object}}
 */
function sanitiseQuestion(raw, index) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: `Question ${index + 1} is not an object` };
  }

  const question = str(raw.question || raw.question_text, LIMITS.question);
  if (!question) return { ok: false, error: `Question ${index + 1} has empty question text` };

  const answer = str(raw.correct_answer, 4).toUpperCase();
  if (!['A', 'B', 'C', 'D'].includes(answer)) {
    return { ok: false, error: `Question ${index + 1} has an invalid correct answer "${answer}" (expected A, B, C or D)` };
  }

  const options = ['a', 'b', 'c', 'd'].map((letter) => str(raw['option_' + letter], LIMITS.option));
  if (options.some((o) => !o)) {
    return { ok: false, error: `Question ${index + 1} is missing one or more options` };
  }

  // Only allow http(s) source links — no javascript: or data: URLs into a cell
  // that a curator may later click from the sheet.
  let sourceUrl = str(raw.source_url || raw.sourceUrl, LIMITS.url);
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) sourceUrl = '';

  return {
    ok: true,
    value: {
      date: str(raw.date, 40),
      newspaper: str(raw.newspaper, LIMITS.short),
      topic: str(raw.topic, LIMITS.short),
      question,
      option_a: options[0],
      option_b: options[1],
      option_c: options[2],
      option_d: options[3],
      correct_answer: answer,
      explanation: str(raw.explanation, LIMITS.explanation),
      difficulty: str(raw.difficulty, 20) || 'Medium',
      tags: str(raw.tags, LIMITS.short),
      source_url: sourceUrl,
      // What this does: Sets the default workflow status for newly added questions to 'Approved'
      // What it brings: Ensures all incoming questions default to Approved as requested by the user
      // Where changes can be seen: In API responses from /api/questions and rows saved to Google Sheets
      status: str(raw.status, 20) || 'Approved',
      review_notes: str(raw.review_notes, LIMITS.notes),
      scheduled_for: str(raw.scheduled_for, 40)
    }
  };
}

/**
 * sanitiseQuestionBatch — validates a whole upload.
 *
 * @returns {{ok: boolean, error?: string, value?: Array<Object>}}
 */
function sanitiseQuestionBatch(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    return { ok: false, error: 'No questions provided' };
  }
  if (questions.length > MAX_QUESTIONS_PER_BATCH) {
    return { ok: false, error: `Too many questions in one batch (max ${MAX_QUESTIONS_PER_BATCH})` };
  }

  const clean = [];
  for (let i = 0; i < questions.length; i++) {
    const result = sanitiseQuestion(questions[i], i);
    if (!result.ok) return result;
    clean.push(result.value);
  }
  return { ok: true, value: clean };
}

/**
 * validateSubject — a subject must be a plain, reasonable sheet-tab name.
 * This keeps an arbitrary string out of the sheet-name lookups on the Apps
 * Script side.
 */
function validateSubject(value) {
  const subject = str(value, 60);
  if (!subject) return { ok: false, error: 'Missing "subject"' };
  if (!/^[A-Za-z0-9 &()\-.]+$/.test(subject)) {
    return { ok: false, error: 'Subject contains unsupported characters' };
  }
  return { ok: true, value: subject };
}

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------

/**
 * resolveStaticPath — maps a URL path to a real file inside dashboard/.
 * Percent-encoding is decoded first (so %2e%2e is caught), the path is
 * normalised, and the result must sit strictly inside DASHBOARD_DIR — compared
 * with a trailing separator so a sibling like `dashboard-backup` cannot match
 * the prefix. Only allowlisted extensions are served.
 *
 * @returns {string|null} Absolute file path, or null when the request is unsafe
 */
function resolveStaticPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (err) {
    return null; // Malformed percent-encoding.
  }

  if (decoded.includes('\0')) return null;

  const requested = decoded === '/' ? '/index.html' : decoded;
  const resolved = path.resolve(DASHBOARD_DIR, '.' + path.posix.normalize(requested));

  if (resolved !== DASHBOARD_DIR && !resolved.startsWith(DASHBOARD_DIR + path.sep)) {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(MIME_TYPES, path.extname(resolved).toLowerCase())) {
    return null;
  }
  return resolved;
}

/** Streams a static file, or 404s. */
async function serveStatic(res, pathname) {
  const filePath = resolveStaticPath(pathname);
  if (!filePath) {
    sendText(res, 404, '404 Not Found');
    return;
  }

  try {
    const stats = await fsp.stat(filePath);
    if (!stats.isFile()) {
      sendText(res, 404, '404 Not Found');
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', MIME_TYPES[path.extname(filePath).toLowerCase()]);
    res.setHeader('Content-Length', stats.size);
    // Dashboards change often during curation; never let a stale copy stick.
    res.setHeader('Cache-Control', 'no-cache');

    fs.createReadStream(filePath)
      .on('error', () => sendText(res, 500, '500 Internal Server Error'))
      .pipe(res);
  } catch (err) {
    sendText(res, 404, '404 Not Found');
  }
}

/**
 * createCheckoutForStudent — builds the right kind of Razorpay checkout.
 *
 * A one-time pass gets a payment link; the recurring plan gets a subscription
 * mandate. Both carry the Telegram id in `notes`, which is how the webhook
 * later knows who to let in.
 *
 * @param {Object} options { plan, telegramId, username, name }
 * @returns {Promise<Object>} { url, kind, id, plan, price }
 */
async function createCheckoutForStudent({ plan, telegramId, username, name }) {
  if (plan.type === 'recurring') {
    const razorpayPlanId = String(process.env[plan.razorpayPlanIdEnv] || '').trim();
    if (!razorpayPlanId) {
      throw new Error(
        `${plan.razorpayPlanIdEnv} is not set. Run "node setup-razorpay.js" once and put the id in .env.`
      );
    }

    const subscription = await razorpay.createSubscription({
      plan, razorpayPlanId, telegramId, username
    });
    return {
      url: subscription.short_url,
      kind: 'subscription',
      id: subscription.id,
      plan: plan.id,
      price: plans.formatAmount(plan.amountPaise)
    };
  }

  const base = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  const link = await razorpay.createPaymentLink({
    plan,
    telegramId,
    username,
    name,
    callbackUrl: base ? `${base}/payment-success.html` : undefined
  });

  return {
    url: link.short_url,
    kind: 'payment_link',
    id: link.id,
    plan: plan.id,
    price: plans.formatAmount(plan.amountPaise)
  };
}

/**
 * handlePaymentEvent — turns a verified Razorpay webhook into group access.
 *
 * Only the events that actually mean "money arrived" grant anything. Every
 * identity fact — who paid, for which plan — is read from `notes`, which
 * Razorpay echoes back from what WE set when creating the link. Nothing here
 * trusts a value the payer could choose.
 *
 * @param {Object} event Parsed, signature-verified webhook body
 * @returns {Promise<{handled: boolean, reason?: string}>}
 */
async function handlePaymentEvent(event) {
  const type = String(event.event || '');
  const payload = event.payload || {};

  /** Pulls our own notes back out of whichever entity the event carries. */
  const notesFrom = (entity) => (entity && entity.notes) || {};

  // ---- One-time passes: a payment link was paid --------------------------
  if (type === 'payment_link.paid') {
    const link = (payload.payment_link && payload.payment_link.entity) || {};
    const payment = (payload.payment && payload.payment.entity) || {};
    const notes = notesFrom(link);

    if (!notes.telegram_id || !notes.plan_id) {
      return { handled: false, reason: 'payment link had no telegram_id/plan_id in notes' };
    }

    await membership.grantAccess({
      telegramId: notes.telegram_id,
      planId: notes.plan_id,
      username: notes.telegram_username,
      paymentId: payment.id || link.id,
      amountPaise: payment.amount || link.amount_paid || link.amount,
      linkId: link.id,
      event: type
    });
    return { handled: true };
  }

  // ---- Recurring: a subscription cycle was charged -----------------------
  if (type === 'subscription.charged') {
    const subscription = (payload.subscription && payload.subscription.entity) || {};
    const payment = (payload.payment && payload.payment.entity) || {};
    const notes = notesFrom(subscription);

    if (!notes.telegram_id || !notes.plan_id) {
      return { handled: false, reason: 'subscription had no telegram_id/plan_id in notes' };
    }

    await membership.grantAccess({
      telegramId: notes.telegram_id,
      planId: notes.plan_id,
      username: notes.telegram_username,
      paymentId: payment.id || subscription.id,
      amountPaise: payment.amount,
      subscriptionId: subscription.id,
      event: type
    });
    return { handled: true };
  }

  // ---- Recurring: the mandate ended --------------------------------------
  // The member keeps what they already paid for; the daily cron removes them
  // when the paid period actually runs out.
  if (type === 'subscription.cancelled' || type === 'subscription.halted') {
    const subscription = (payload.subscription && payload.subscription.entity) || {};
    const notes = notesFrom(subscription);
    if (!notes.telegram_id) return { handled: false, reason: 'no telegram_id in notes' };

    await sheets.upsertSubscriber({
      telegram_id: notes.telegram_id,
      status: 'cancelled',
      subscription_id: subscription.id,
      notes: `Subscription ${type.split('.')[1]} on ${membership.formatIst(new Date())}. ` +
             'Access continues until the paid period ends.',
      is_payment: false
    }, type);
    return { handled: true };
  }

  // Everything else (payment.captured for a link we already handled,
  // authorisations, refunds) is acknowledged without action.
  return { handled: false, reason: `no handler for "${type}"` };
}

/**
 * canonicalRedirect — returns the localhost URL to send a 127.0.0.1 request to.
 *
 * Set CANONICAL_HOST_REDIRECT=false in .env to switch this off (for example if
 * you deliberately added 127.0.0.1 to your Firebase authorised domains).
 *
 * @param {URL} parsedUrl The incoming request URL
 * @returns {string|null} Absolute URL to redirect to, or null to serve normally
 */
function canonicalRedirect(parsedUrl) {
  if (String(process.env.CANONICAL_HOST_REDIRECT || '').toLowerCase() === 'false') return null;
  if (parsedUrl.hostname !== '127.0.0.1' && parsedUrl.hostname !== '[::1]' && parsedUrl.hostname !== '::1') {
    return null;
  }
  return `http://localhost:${parsedUrl.port || PORT}${parsedUrl.pathname}${parsedUrl.search}`;
}

// ---------------------------------------------------------------------------
// Telegram helpers
// ---------------------------------------------------------------------------

/** True when the bot token and group id are both present. */
function telegramConfigured() {
  /* What this line does: Validates presence of TELEGRAM_BOT_TOKEN and either TELEGRAM_GROUP_ID or TELEGRAM_CHANNEL_ID */
  /* What it brings: Seamless support for both Telegram supergroup setups and channel setups */
  /* Where changes can be seen: /api/config telegramConfigured flag and posting capability checks */
  const chatId = process.env.TELEGRAM_GROUP_ID || process.env.TELEGRAM_CHANNEL_ID;
  return Boolean(
    String(process.env.TELEGRAM_BOT_TOKEN || '').trim() &&
    String(chatId || '').trim()
  );
}

/** Lazily initialises the Telegram client the first time it is needed. */
let telegramReady = false;
function ensureTelegram() {
  /* What this line does: Verifies configuration before attempting to initialize client */
  /* What it brings: Clear explanatory error if credentials are not configured */
  /* Where changes can be seen: /api/telegram/post endpoint */
  if (!telegramConfigured()) {
    throw new Error('Telegram is not configured — set TELEGRAM_BOT_TOKEN and TELEGRAM_GROUP_ID in .env');
  }
  /* What this line does: Lazily creates Telegram bot client once when needed */
  /* What it brings: Avoids startup crashes if network is briefly unavailable */
  /* Where changes can be seen: Telegram dispatch execution */
  if (!telegramReady) {
    const chatId = process.env.TELEGRAM_GROUP_ID || process.env.TELEGRAM_CHANNEL_ID;
    telegram.init(process.env.TELEGRAM_BOT_TOKEN, chatId);
    telegramReady = true;
  }
}

/** Small promise delay used to stay under Telegram's rate limits. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// API route handlers
// ---------------------------------------------------------------------------

/**
 * handlePublicRoute — the two endpoints that work before sign-in.
 * Neither returns any spreadsheet content or secret value.
 *
 * @param {string} pathname Request path
 * @param {string} method HTTP method
 * @param {http.IncomingMessage} req Needed by the webhook, which must read the
 *   raw request body to verify Razorpay's signature over the exact bytes sent
 * @param {http.ServerResponse} res
 * @returns {Promise<boolean>} true when the route was handled
 */
async function handlePublicRoute(pathname, method, req, res) {
  // Client bootstrap: what the browser needs to render the login gate.
  if (pathname === '/api/config' && method === 'GET') {
    sendJSON(res, 200, {
      success: true,
      firebaseProjectId: auth.getProjectId() || null,
      authEnforced: auth.isConfigured(),
      // Deliberately reports only whether the sheet is wired up. The Web App
      // URL itself stays on the server; the browser never needs it.
      sheetConfigured: sheets.isConfigured(),
      telegramConfigured: telegramConfigured(),
      allowRegistration: String(process.env.ALLOW_SELF_REGISTRATION || '').toLowerCase() === 'true'
    });
    return true;
  }

  // Plan catalogue. Public: it is a price list, and the bot reads it too.
  if (pathname === '/api/plans' && method === 'GET') {
    sendJSON(res, 200, {
      success: true,
      data: {
        configured: razorpay.isConfigured(),
        testMode: razorpay.isTestMode(),
        plans: plans.listPlans().map((plan) => ({
          id: plan.id,
          label: plan.label,
          emoji: plan.emoji,
          price: plans.formatAmount(plan.amountPaise),
          amountPaise: plan.amountPaise,
          type: plan.type,
          durationDays: plan.durationDays,
          tagline: plan.tagline,
          description: plan.description
        }))
      }
    });
    return true;
  }

  // ---- Razorpay webhook --------------------------------------------------
  // Public because Razorpay's servers call it, and they cannot present a
  // Firebase token. It is NOT unauthenticated: the HMAC signature over the raw
  // body is the credential, and a request without a valid one is rejected
  // before a single field of its payload is read.
  if (pathname === '/api/payments/webhook' && method === 'POST') {
    const rawBody = await readRawBody(req);
    const signature = req.headers['x-razorpay-signature'];

    if (!razorpay.verifyWebhookSignature(rawBody, signature)) {
      // Deliberately terse: telling a forger why they failed helps them.
      console.warn('[payments] rejected a webhook with an invalid signature');
      sendJSON(res, 401, { success: false, error: 'Invalid signature' });
      return true;
    }

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch (err) {
      sendJSON(res, 400, { success: false, error: 'Malformed webhook payload' });
      return true;
    }

    try {
      const result = await handlePaymentEvent(event);
      // Always 200 once handled, so Razorpay stops retrying.
      sendJSON(res, 200, { success: true, handled: result.handled, reason: result.reason || null });
    } catch (err) {
      // A 500 makes Razorpay retry, which is what we want for a transient
      // failure — the payment is real and must not be silently dropped.
      console.error('[payments] webhook handling failed:', err.message);
      sendJSON(res, 500, { success: false, error: 'Processing failed, please retry' });
    }
    return true;
  }

  // Liveness of the Apps Script deployment, for the header status pill.
  if (pathname === '/api/ping' && method === 'GET') {
    if (!sheets.isConfigured()) {
      sendJSON(res, 200, { success: false, status: 'unconfigured', error: 'GOOGLE_SHEET_WEBAPP_URL is not set in .env' });
      return true;
    }
    try {
      const result = await sheets.ping();
      // v5 reports `version`; older deployments only put it in `message`.
      const version = result.version ||
        (String(result.message || '').match(/v\d+[^)"]*/) || ['unknown'])[0].trim();

      // The dashboards call actions that only exist in v6 of the Apps Script
      // (the membership reads behind the Members page). Detect an older
      // deployment here so the UI can say exactly what to do instead of
      // surfacing an opaque "Unknown action" from Google.
      const outdated = !sheetVersionIsCurrent(version);

      // A script that is not bound to a spreadsheet was pasted into a
      // standalone project instead of the Sheet's own Extensions > Apps Script.
      const unbound = result.boundToSpreadsheet === false;

      sendJSON(res, 200, {
        success: true,
        status: 'ok',
        version,
        outdated,
        unbound,
        spreadsheetName: result.spreadsheetName || null,
        requiredVersion: REQUIRED_SHEET_VERSION,
        tokenRequired: result.tokenRequired,
        upgradeHint: outdated
          ? 'The Web App at your GOOGLE_SHEET_WEBAPP_URL is running ' + version + '. Open your Google ' +
            'Sheet > Extensions > Apps Script (NOT script.google.com — that creates a standalone project ' +
            'with a different URL), paste the current google_apps_script.js, run upgradeSpreadsheet, then ' +
            'Deploy > Manage deployments > Edit > New version. Redeploying that project keeps this same URL.'
          : null
      });
    } catch (err) {
      sendJSON(res, 200, { success: false, status: 'offline', error: err.message });
    }
    return true;
  }

  return false;
}

/**
 * handleAuthedRoute — everything that reads or writes real data.
 * `user` is the verified Firebase identity; it is the only source of the
 * "Added By" / "Updated By" attribution, so a client cannot forge authorship.
 *
 * @returns {Promise<boolean>} true when the route was handled
 */
async function handleAuthedRoute(pathname, method, req, res, query, user) {
  const actor = user.name ? `${user.name} (${user.email})` : user.email;

  // ---- System health -------------------------------------------------------
  if (pathname === '/api/health' && method === 'GET') {
    const health = {
      server: { ok: true, port: PORT, host: HOST, node: process.version, uptimeSeconds: Math.round(process.uptime()) },
      auth: auth.describeConfig(),
      sheets: {
        configured: sheets.isConfigured(), reachable: false, version: null,
        requiredVersion: REQUIRED_SHEET_VERSION,
        tokenRequired: null, current: false, bound: null, spreadsheetName: null,
        membershipReady: null, membershipError: null, error: null
      },
      telegram: {
        configured: telegramConfigured(), reachable: false, botUsername: null,
        groupTitle: null, groupReachable: false, isForum: false, error: null
      },
      payments: {
        configured: razorpay.isConfigured(),
        testMode: razorpay.isTestMode(),
        webhookSecretSet: Boolean(String(process.env.RAZORPAY_WEBHOOK_SECRET || '').trim()),
        publicBaseUrl: String(process.env.PUBLIC_BASE_URL || '') || null,
        recurringPlanReady: Boolean(String(process.env.RAZORPAY_MONTHLY_PLAN_ID || '').trim()),
        premiumGroupSet: Boolean(membership.getPremiumGroupId())
      },
      you: { email: user.email, uid: user.uid, provider: user.signInProvider, emailVerified: user.emailVerified }
    };

    if (sheets.isConfigured()) {
      try {
        const ping = await sheets.ping();
        health.sheets.reachable = true;
        health.sheets.version = ping.version ||
          (String(ping.message || '').match(/v\d+[^)"]*/) || [null])[0];
        health.sheets.tokenRequired = Boolean(ping.tokenRequired);
        health.sheets.current = sheetVersionIsCurrent(health.sheets.version);
        health.sheets.bound = ping.boundToSpreadsheet !== false;
        health.sheets.spreadsheetName = ping.spreadsheetName || null;

        // The membership actions only exist in a script deployed after the
        // payments release. Probe one so the dashboard can say so plainly
        // rather than letting a webhook fail mysteriously at 2am.
        try {
          await sheets.getRevenue();
          health.sheets.membershipReady = true;
        } catch (err) {
          health.sheets.membershipReady = false;
          health.sheets.membershipError = err.message;
        }
      } catch (err) {
        health.sheets.error = err.message;
      }
    }

    if (telegramConfigured()) {
      try {
        ensureTelegram();
        const info = await telegram.getBotInfo();
        health.telegram.reachable = true;
        health.telegram.botUsername = info.username || null;
        health.telegram.groupTitle = info.groupTitle;
        health.telegram.isForum = info.isForum;
        health.telegram.groupReachable = info.groupReachable;
      } catch (err) {
        health.telegram.error = err.message;
      }
    }

    sendJSON(res, 200, { success: true, data: health });
    return true;
  }

  // ---- Subjects / config ---------------------------------------------------
  if (pathname === '/api/subjects' && method === 'GET') {
    sendJSON(res, 200, { success: true, data: await sheets.readConfig() });
    return true;
  }

  // ---- Analytics -----------------------------------------------------------
  if (pathname === '/api/analytics' && method === 'GET') {
    sendJSON(res, 200, { success: true, data: await sheets.getAnalytics() });
    return true;
  }

  if (pathname === '/api/stats' && method === 'GET') {
    sendJSON(res, 200, { success: true, data: await sheets.getStats() });
    return true;
  }

  // ---- Question browse -----------------------------------------------------
  if (pathname === '/api/questions' && method === 'GET') {
    const data = await sheets.listQuestions({
      subject: str(query.get('subject'), 60) || 'all',
      status: str(query.get('status'), 20),
      posted: str(query.get('posted'), 4),
      difficulty: str(query.get('difficulty'), 20),
      search: str(query.get('search'), 120),
      page: str(query.get('page'), 8) || '1',
      pageSize: str(query.get('pageSize'), 4) || '25'
    });
    sendJSON(res, 200, { success: true, data });
    return true;
  }

  // ---- Question upload -----------------------------------------------------
  // /api/send is the name the original dashboard used; both paths are accepted
  // so an older cached page keeps working.
  if ((pathname === '/api/questions' || pathname === '/api/send') && method === 'POST') {
    const body = await readJsonBody(req);

    const subject = validateSubject(body.subject);
    if (!subject.ok) { sendJSON(res, 400, { success: false, error: subject.error }); return true; }

    const batch = sanitiseQuestionBatch(body.questions);
    if (!batch.ok) { sendJSON(res, 400, { success: false, error: batch.error }); return true; }

    // Attribution comes from the verified token, never from the request body.
    const result = await sheets.addQuestions(subject.value, batch.value, actor, body.skipDuplicates !== false);
    sendJSON(res, 200, {
      success: true,
      addedCount: result.addedCount || 0,
      skippedCount: result.skippedCount || 0,
      skipped: result.skipped || [],
      ids: result.ids || [],
      message: result.message
    });
    return true;
  }

  // ---- Question edit -------------------------------------------------------
  if (pathname === '/api/questions/update' && method === 'POST') {
    const body = await readJsonBody(req);
    const subject = validateSubject(body.subject);
    if (!subject.ok) { sendJSON(res, 400, { success: false, error: subject.error }); return true; }

    const questionId = str(body.questionId, 60);
    const rowNumber = parseInt(body.rowNumber, 10) || '';
    if (!questionId && !rowNumber) {
      sendJSON(res, 400, { success: false, error: 'Missing questionId' });
      return true;
    }
    if (!body.fields || typeof body.fields !== 'object') {
      sendJSON(res, 400, { success: false, error: 'Missing fields object' });
      return true;
    }

    const result = await sheets.updateQuestion(
      subject.value, questionId, body.fields, actor, rowNumber, str(body.verifyText, LIMITS.question)
    );
    sendJSON(res, 200, { success: true, message: result.message });
    return true;
  }

  // ---- Question delete -----------------------------------------------------
  if (pathname === '/api/questions/delete' && method === 'POST') {
    const body = await readJsonBody(req);
    const subject = validateSubject(body.subject);
    if (!subject.ok) { sendJSON(res, 400, { success: false, error: subject.error }); return true; }

    const questionId = str(body.questionId, 60);
    const rowNumber = parseInt(body.rowNumber, 10) || '';
    if (!questionId && !rowNumber) {
      sendJSON(res, 400, { success: false, error: 'Missing questionId' });
      return true;
    }

    const result = await sheets.deleteQuestion(
      subject.value, questionId, rowNumber, str(body.verifyText, LIMITS.question)
    );
    sendJSON(res, 200, { success: true, message: result.message });
    return true;
  }

  // ---- Bulk status change --------------------------------------------------
  if (pathname === '/api/questions/status' && method === 'POST') {
    const body = await readJsonBody(req);
    const subject = validateSubject(body.subject);
    if (!subject.ok) { sendJSON(res, 400, { success: false, error: subject.error }); return true; }

    const ids = Array.isArray(body.questionIds) ? body.questionIds.map((id) => str(id, 60)).filter(Boolean) : [];
    if (!ids.length) { sendJSON(res, 400, { success: false, error: 'No questionIds provided' }); return true; }
    if (ids.length > 200) { sendJSON(res, 400, { success: false, error: 'Too many questionIds (max 200)' }); return true; }

    const status = str(body.status, 20);
    if (!status) { sendJSON(res, 400, { success: false, error: 'Missing status' }); return true; }

    const updatedCount = await sheets.bulkStatus(subject.value, ids, status, actor);
    sendJSON(res, 200, { success: true, updatedCount });
    return true;
  }

  // ---- Schedule ------------------------------------------------------------
  if (pathname === '/api/questions/schedule' && method === 'POST') {
    const body = await readJsonBody(req);
    const subject = validateSubject(body.subject);
    if (!subject.ok) { sendJSON(res, 400, { success: false, error: subject.error }); return true; }

    const ids = Array.isArray(body.questionIds) ? body.questionIds.map((id) => str(id, 60)).filter(Boolean) : [];
    if (!ids.length) { sendJSON(res, 400, { success: false, error: 'No questionIds provided' }); return true; }

    const updatedCount = await sheets.scheduleQuestions(subject.value, ids, str(body.scheduledFor, 40), actor);
    sendJSON(res, 200, { success: true, updatedCount });
    return true;
  }

  // ---- Members -------------------------------------------------------------
  if (pathname === '/api/members' && method === 'GET') {
    const data = await sheets.listSubscribers({
      status: str(query.get('status'), 20),
      plan: str(query.get('plan'), 40),
      search: str(query.get('search'), 120),
      page: str(query.get('page'), 8) || '1',
      pageSize: str(query.get('pageSize'), 4) || '50'
    });
    sendJSON(res, 200, { success: true, data });
    return true;
  }

  if (pathname === '/api/members/revenue' && method === 'GET') {
    sendJSON(res, 200, { success: true, data: await sheets.getRevenue() });
    return true;
  }

  // Creates a checkout link on behalf of a student. The bot calls this, and so
  // can an admin issuing a link manually.
  if (pathname === '/api/payments/link' && method === 'POST') {
    const body = await readJsonBody(req);

    const plan = plans.getPlan(str(body.planId, 40));
    if (!plan) { sendJSON(res, 400, { success: false, error: 'Unknown plan' }); return true; }

    const telegramId = str(body.telegramId, 32);
    if (!/^\d+$/.test(telegramId)) {
      sendJSON(res, 400, { success: false, error: 'telegramId must be numeric' });
      return true;
    }

    const link = await createCheckoutForStudent({
      plan,
      telegramId,
      username: str(body.username, 60),
      name: str(body.name, 100)
    });
    sendJSON(res, 200, { success: true, data: link });
    return true;
  }

  // Runs the expiry sweep on demand, so an admin can see what the nightly job
  // will do (or fix a missed run) without waiting for cron.
  if (pathname === '/api/members/run-check' && method === 'POST') {
    const body = await readJsonBody(req);
    const summary = await membership.runDailyCheck({ dryRun: body.dryRun !== false });
    sendJSON(res, 200, { success: true, data: summary });
    return true;
  }

  // ---- Telegram status -----------------------------------------------------
  if (pathname === '/api/telegram/status' && method === 'GET') {
    if (!telegramConfigured()) {
      sendJSON(res, 200, { success: true, data: { configured: false, connected: false } });
      return true;
    }
    try {
      ensureTelegram();
      const info = await telegram.getBotInfo();
      sendJSON(res, 200, {
        success: true,
        data: {
          configured: true,
          connected: true,
          botUsername: info.username,
          botName: info.firstName,
          groupTitle: info.groupTitle,
          groupReachable: info.groupReachable,
          isForum: info.isForum
        }
      });
    } catch (err) {
      sendJSON(res, 200, { success: true, data: { configured: true, connected: false, error: err.message } });
    }
    return true;
  }

  // ---- Post to Telegram now ------------------------------------------------
  // This is the endpoint that makes the automation dashboard able to publish
  // without dropping to the CLI. It is the most sensitive route in the app:
  // it writes to a public channel, so it is authenticated, rate limited, and
  // capped at a small batch per call.
  if (pathname === '/api/telegram/post' && method === 'POST') {
    const body = await readJsonBody(req);

    const subject = validateSubject(body.subject);
    if (!subject.ok) { sendJSON(res, 400, { success: false, error: subject.error }); return true; }

    const count = Math.min(Math.max(parseInt(body.count, 10) || 1, 1), 20);
    const requireApproved = body.requireApproved !== false;

    try {
      ensureTelegram();
    } catch (err) {
      sendJSON(res, 400, { success: false, error: err.message });
      return true;
    }

    // Resolve the forum topic for this subject from the Config tab.
    const config = await sheets.readConfig();
    const subjectConfig = config.find((c) => c.subject === subject.value);
    if (!subjectConfig) {
      sendJSON(res, 400, { success: false, error: `"${subject.value}" is not in the Config tab` });
      return true;
    }
    if (!subjectConfig.topic_thread_id) {
      sendJSON(res, 400, { success: false, error: `No Telegram topic thread configured for "${subject.value}". Run: node setup.js` });
      return true;
    }

    const questions = await sheets.getUnpostedQuestions(subject.value, count, requireApproved);
    if (!questions.length) {
      sendJSON(res, 200, {
        success: true,
        postedCount: 0,
        results: [],
        message: requireApproved
          ? `No Approved or Scheduled questions waiting in "${subject.value}"`
          : `No unposted questions left in "${subject.value}"`
      });
      return true;
    }

    const results = [];
    const postedRowIndices = [];
    const pollIds = {};
    let lastMessageId = null;

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      try {
        const sent = await telegram.sendQuizPoll(subjectConfig.topic_thread_id, q);
        if (sent && sent.message_id) lastMessageId = sent.message_id;
        if (sent && sent.poll && sent.poll.id) pollIds[String(q.excel_row)] = sent.poll.id;

        postedRowIndices.push(q.row_index !== undefined ? q.row_index : q.excel_row);
        results.push({ questionId: q.question_id, ok: true, preview: q.question_text.slice(0, 80) });
      } catch (err) {
        results.push({ questionId: q.question_id, ok: false, error: err.message, preview: q.question_text.slice(0, 80) });
      }
      // Telegram tolerates roughly 30 messages/second; 1.5s is deliberately safe.
      if (i < questions.length - 1) await sleep(1500);
    }

    if (postedRowIndices.length) {
      await sheets.markAsPosted(
        subject.value, postedRowIndices, lastMessageId, subjectConfig.topic_thread_id, pollIds
      );
    }

    sendJSON(res, 200, {
      success: true,
      postedCount: postedRowIndices.length,
      failedCount: results.length - postedRowIndices.length,
      results,
      message: `${postedRowIndices.length} of ${questions.length} question(s) posted to "${subject.value}"`
    });
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  applySecurityHeaders(res);

  const clientIp = req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(clientIp)) {
    res.setHeader('Retry-After', '60');
    sendJSON(res, 429, { success: false, error: 'Too many requests — slow down.' });
    return;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch (err) {
    sendText(res, 400, '400 Bad Request');
    return;
  }

  const pathname = parsedUrl.pathname;
  const method = req.method;

  // No CORS preflight is answered: the API is same-origin only. A cross-origin
  // page that tries to send an Authorization header gets stopped right here.
  if (method === 'OPTIONS') {
    sendText(res, 405, '405 Method Not Allowed');
    return;
  }

  if (!pathname.startsWith('/api/')) {
    if (method !== 'GET' && method !== 'HEAD') {
      sendText(res, 405, '405 Method Not Allowed');
      return;
    }

    // Firebase authorises sign-in per DOMAIN, and it treats "localhost" and
    // "127.0.0.1" as different domains. Only "localhost" is on the default
    // authorised list, so loading the dashboard at http://127.0.0.1:3000 makes
    // Google sign-in fail — often as an opaque 500 from accounts.google.com.
    // Same machine, same port, so redirecting is free and removes the trap.
    const redirect = canonicalRedirect(parsedUrl);
    if (redirect) {
      res.statusCode = 302;
      res.setHeader('Location', redirect);
      res.setHeader('Cache-Control', 'no-store');
      res.end();
      return;
    }

    await serveStatic(res, pathname);
    return;
  }

  try {
    if (await handlePublicRoute(pathname, method, req, res)) return;

    // Everything past this point requires a verified Firebase identity.
    if (!auth.isConfigured()) {
      sendJSON(res, 503, {
        success: false,
        error: 'Server auth is not configured. Set FIREBASE_PROJECT_ID in .env and restart.'
      });
      return;
    }

    const token = auth.extractBearerToken(req);
    if (!token) {
      sendJSON(res, 401, { success: false, error: 'Sign in required.' });
      return;
    }

    let user;
    try {
      user = await auth.authorize(token);
    } catch (err) {
      sendJSON(res, 403, { success: false, error: err.message });
      return;
    }

    if (await handleAuthedRoute(pathname, method, req, res, parsedUrl.searchParams, user)) return;

    sendJSON(res, 404, { success: false, error: `Unknown API route: ${method} ${pathname}` });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    // Log the full error locally; return only the message to the client.
    console.error(`[api] ${method} ${pathname} failed:`, err.message);
    sendJSON(res, statusCode, { success: false, error: err.message });
  }
});

// Cap header size and idle sockets so a slow client cannot hold resources.
server.headersTimeout = 20000;
server.requestTimeout = 60000;
server.keepAliveTimeout = 10000;

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    const warnings = [];
    if (!auth.isConfigured()) warnings.push('FIREBASE_PROJECT_ID not set — API is locked (503) until you set it');
    if (!sheets.isConfigured()) warnings.push('GOOGLE_SHEET_WEBAPP_URL not set — sheet features disabled');
    if (!process.env.SHEET_API_TOKEN) warnings.push('SHEET_API_TOKEN not set — your Apps Script Web App is world-writable');
    if (!auth.getCuratorAllowlist().length) warnings.push('CURATOR_EMAILS not set — any verified Firebase user can curate');
    if (HOST === '0.0.0.0') warnings.push('HOST=0.0.0.0 — this dashboard is reachable from your whole network');

    // Always print the localhost form: it is the origin Firebase authorises.
    const displayHost = (HOST === '127.0.0.1' || HOST === '::1') ? 'localhost' : HOST;

    console.log('════════════════════════════════════════════════════════');
    console.log(`🚀 Sadhana APPSC Dashboard   http://${displayHost}:${PORT}`);
    console.log('────────────────────────────────────────────────────────');
    console.log('   📤 Upload      /index.html');
    console.log('   📊 Analytics   /analytics.html');
    console.log('   📚 Questions   /questions.html');
    console.log('   🤖 Automation  /automation.html');
    console.log('   🩺 Health      /health.html');
    console.log('────────────────────────────────────────────────────────');
    console.log(`   Google Sheets: ${sheets.isConfigured() ? 'configured ✅' : 'not configured ⚠️'}`);
    console.log(`   Telegram bot : ${telegramConfigured() ? 'configured ✅' : 'not configured ⚠️'}`);
    console.log(`   Firebase auth: ${auth.isConfigured() ? 'enforced ✅' : 'NOT ENFORCED ❌'}`);
    if (warnings.length) {
      console.log('────────────────────────────────────────────────────────');
      warnings.forEach((w) => console.log('   ⚠️  ' + w));
    }
    console.log('════════════════════════════════════════════════════════');
  });
}

module.exports = server;
module.exports.createCheckoutForStudent = createCheckoutForStudent;
module.exports.handlePaymentEvent = handlePaymentEvent;
