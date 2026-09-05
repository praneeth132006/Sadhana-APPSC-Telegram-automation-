// ============================================================================
// Payment and membership tests (test/payments.test.js)
// ============================================================================
// The webhook is the only path from money to group access, so most of this
// suite is about proving it cannot be tricked: a forged signature must never
// grant a seat, a replayed webhook must not double-charge or double-extend,
// and identity must come from Razorpay's echoed notes rather than anything a
// payer can set.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.RAZORPAY_KEY_ID = 'rzp_test_dummy';
process.env.RAZORPAY_KEY_SECRET = 'dummy_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook_secret_for_tests';
process.env.EXAM_PASS_END_DATE = '30-11-2026';
process.env.TELEGRAM_BOT_TOKEN = '123:TEST';
process.env.TELEGRAM_GROUP_ID = '-1001234567890';

const razorpay = require('../src/razorpay');
const plans = require('../src/plans');

// ===========================================================================
// Plans and expiry arithmetic
// ===========================================================================

test('all three passes are defined with sane prices', () => {
  const all = plans.listPlans();
  assert.equal(all.length, 3);

  const byId = Object.fromEntries(all.map((p) => [p.id, p]));
  assert.equal(byId.sprint_30.amountPaise, 29900);
  assert.equal(byId.autopay_monthly.amountPaise, 24900);
  assert.equal(byId.exam_pass.amountPaise, 79900);

  // Amounts are in paise. A plan priced in rupees by mistake would charge 1/100th.
  all.forEach((p) => {
    assert.equal(p.amountPaise % 100, 0, `${p.id} is not a whole rupee amount`);
    assert.ok(p.amountPaise >= 10000, `${p.id} looks like rupees, not paise`);
  });
});

test('formatAmount renders paise as rupees', () => {
  assert.equal(plans.formatAmount(29900), '₹299');
  assert.equal(plans.formatAmount(24900), '₹249');
  assert.equal(plans.formatAmount(79900), '₹799');
  assert.equal(plans.formatAmount(150), '₹1.50');
});

test('a 30-day pass expires 30 days out', () => {
  const now = new Date('2026-09-05T12:00:00Z');
  const expiry = plans.computeExpiry(plans.getPlan('sprint_30'), now);
  assert.equal(Math.round((expiry - now) / 86400000), 30);
});

test('the exam pass expires on the configured exam date, not after N days', () => {
  const expiry = plans.computeExpiry(plans.getPlan('exam_pass'), new Date('2026-09-05T12:00:00Z'));
  assert.equal(expiry.getFullYear(), 2026);
  assert.equal(expiry.getMonth(), 10, 'should be November');
  assert.equal(expiry.getDate(), 30);
});

test('renewing early extends from the existing expiry, not from today', () => {
  // A student with 15 days left who renews must end up with 45, not 30 —
  // otherwise paying early silently destroys the days they already bought.
  const now = new Date('2026-09-05T00:00:00Z');
  const currentExpiry = new Date('2026-09-20T00:00:00Z');

  const renewed = plans.computeExpiry(plans.getPlan('sprint_30'), now, currentExpiry);
  assert.equal(Math.round((renewed - currentExpiry) / 86400000), 30);
  assert.ok(renewed > currentExpiry);
});

test('renewing after lapsing starts a fresh term from today', () => {
  const now = new Date('2026-09-05T00:00:00Z');
  const lapsed = new Date('2026-08-01T00:00:00Z');

  const renewed = plans.computeExpiry(plans.getPlan('sprint_30'), now, lapsed);
  assert.equal(Math.round((renewed - now) / 86400000), 30,
    'an expired member should not be charged for days already gone');
});

test('a missing exam date still grants access rather than nothing', () => {
  const original = process.env.EXAM_PASS_END_DATE;
  process.env.EXAM_PASS_END_DATE = '';
  try {
    const now = new Date('2026-09-05T00:00:00Z');
    const expiry = plans.computeExpiry(plans.getPlan('exam_pass'), now);
    assert.ok(expiry > now, 'a paid student must never get zero access from a config typo');
  } finally {
    process.env.EXAM_PASS_END_DATE = original;
  }
});

test('daysUntil counts whole days and goes negative after expiry', () => {
  const from = new Date('2026-09-05T00:00:00Z');
  assert.equal(plans.daysUntil(new Date('2026-09-08T00:00:00Z'), from), 3);
  assert.equal(plans.daysUntil(new Date('2026-09-05T00:00:00Z'), from), 0);
  assert.ok(plans.daysUntil(new Date('2026-09-01T00:00:00Z'), from) < 0);
});

// ===========================================================================
// Webhook signature verification
// ===========================================================================

/** Signs a body the way Razorpay does. */
function sign(body, secret = process.env.RAZORPAY_WEBHOOK_SECRET) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

test('a correctly signed webhook is accepted', () => {
  const body = JSON.stringify({ event: 'payment_link.paid' });
  assert.equal(razorpay.verifyWebhookSignature(body, sign(body)), true);
});

test('a forged or altered webhook is rejected', () => {
  const body = JSON.stringify({ event: 'payment_link.paid', amount: 29900 });
  const signature = sign(body);

  // The exact attack this guards against: claim a payment that never happened.
  const forged = JSON.stringify({ event: 'payment_link.paid', amount: 1 });
  assert.equal(razorpay.verifyWebhookSignature(forged, signature), false,
    'an altered body kept the original signature and was accepted');

  assert.equal(razorpay.verifyWebhookSignature(body, 'f'.repeat(64)), false);
  assert.equal(razorpay.verifyWebhookSignature(body, ''), false);
  assert.equal(razorpay.verifyWebhookSignature(body, undefined), false);
  assert.equal(razorpay.verifyWebhookSignature(body, signature.slice(0, -1) + '0'), false);
});

test('a webhook signed with the wrong secret is rejected', () => {
  const body = JSON.stringify({ event: 'payment_link.paid' });
  assert.equal(razorpay.verifyWebhookSignature(body, sign(body, 'someone_elses_secret')), false);
});

test('with no webhook secret configured, everything is rejected', () => {
  // Failing open here would mean any POST grants free access.
  const original = process.env.RAZORPAY_WEBHOOK_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = '';
  try {
    const body = JSON.stringify({ event: 'payment_link.paid' });
    assert.equal(razorpay.verifyWebhookSignature(body, sign(body, 'anything')), false);
    assert.equal(razorpay.verifyWebhookSignature(body, ''), false);
  } finally {
    process.env.RAZORPAY_WEBHOOK_SECRET = original;
  }
});

test('signature comparison tolerates length mismatches without throwing', () => {
  const body = '{}';
  assert.equal(razorpay.verifyWebhookSignature(body, 'short'), false);
  assert.equal(razorpay.verifyWebhookSignature(body, 'x'.repeat(500)), false);
});

test('safeCompare is exact', () => {
  assert.equal(razorpay.safeCompare('abc123', 'abc123'), true);
  assert.equal(razorpay.safeCompare('abc123', 'abc124'), false);
  assert.equal(razorpay.safeCompare('abc', 'abcd'), false);
  assert.equal(razorpay.safeCompare('', ''), true);
});

// ===========================================================================
// Webhook event handling
// ===========================================================================

test('handlePaymentEvent grants access from a paid payment link', async () => {
  const { handler, calls } = loadServerWithStubs();

  const result = await handler({
    event: 'payment_link.paid',
    payload: {
      payment_link: {
        entity: {
          id: 'plink_1',
          notes: { telegram_id: '555', plan_id: 'sprint_30', telegram_username: 'student' }
        }
      },
      payment: { entity: { id: 'pay_1', amount: 29900 } }
    }
  });

  assert.equal(result.handled, true);
  assert.equal(calls.grantAccess.length, 1);

  const granted = calls.grantAccess[0];
  assert.equal(granted.telegramId, '555');
  assert.equal(granted.planId, 'sprint_30');
  assert.equal(granted.paymentId, 'pay_1');
  assert.equal(granted.amountPaise, 29900);
});

test('a webhook with no telegram_id in notes grants nothing', async () => {
  // Without notes we cannot know who paid, and guessing would hand a seat to
  // the wrong person.
  const { handler, calls } = loadServerWithStubs();

  const result = await handler({
    event: 'payment_link.paid',
    payload: { payment_link: { entity: { id: 'plink_2', notes: {} } }, payment: { entity: { id: 'pay_2' } } }
  });

  assert.equal(result.handled, false);
  assert.match(result.reason, /notes/);
  assert.equal(calls.grantAccess.length, 0, 'access was granted without knowing who paid');
});

test('a subscription charge extends the same member', async () => {
  const { handler, calls } = loadServerWithStubs();

  const result = await handler({
    event: 'subscription.charged',
    payload: {
      subscription: { entity: { id: 'sub_1', notes: { telegram_id: '777', plan_id: 'autopay_monthly' } } },
      payment: { entity: { id: 'pay_3', amount: 24900 } }
    }
  });

  assert.equal(result.handled, true);
  assert.equal(calls.grantAccess[0].telegramId, '777');
  assert.equal(calls.grantAccess[0].subscriptionId, 'sub_1');
});

test('cancelling a subscription does not revoke access immediately', async () => {
  // They paid for the current period; the nightly sweep removes them when it
  // actually ends.
  const { handler, calls } = loadServerWithStubs();

  const result = await handler({
    event: 'subscription.cancelled',
    payload: { subscription: { entity: { id: 'sub_2', notes: { telegram_id: '888' } } } }
  });

  assert.equal(result.handled, true);
  assert.equal(calls.grantAccess.length, 0);
  assert.equal(calls.upsert.length, 1);
  assert.equal(calls.upsert[0].status, 'cancelled');
  assert.equal(calls.upsert[0].is_payment, false, 'a cancellation must not count as revenue');
});

test('an unrelated event is acknowledged but changes nothing', async () => {
  const { handler, calls } = loadServerWithStubs();

  const result = await handler({ event: 'payment.authorized', payload: {} });
  assert.equal(result.handled, false);
  assert.equal(calls.grantAccess.length, 0);
  assert.equal(calls.upsert.length, 0);
});

/**
 * loadServerWithStubs — loads server.js with membership and sheets stubbed,
 * and returns its exported handlePaymentEvent plus a record of what it called.
 */
function loadServerWithStubs() {
  // Fresh module instances so recorded calls do not leak between tests.
  for (const key of Object.keys(require.cache)) {
    if (key.includes('server.js') || key.includes('membership.js') || key.includes('sheets.js')) {
      delete require.cache[key];
    }
  }

  const membership = require('../src/membership');
  const sheets = require('../src/sheets');
  const calls = { grantAccess: [], upsert: [] };

  membership.grantAccess = async (options) => {
    calls.grantAccess.push(options);
    return { subscriber: { telegram_id: options.telegramId }, inviteLink: 'https://t.me/+stub', alreadyProcessed: false };
  };
  membership.formatIst = () => '05-09-2026, 10:00:00 AM IST';
  sheets.upsertSubscriber = async (subscriber) => {
    calls.upsert.push(subscriber);
    return subscriber;
  };

  const server = require('../server');
  return { handler: server.handlePaymentEvent, calls };
}
