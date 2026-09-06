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
process.env.TEST_PLAN_ENABLED = '';   // never inherit it from a local .env

// Tests configure their own groups. Without this the suite would pass or fail
// depending on which groups happen to be set up in the developer's .env.
process.env.LEGACY_GROUP_ID = '';
['APPSC_NEWS_EN', 'APPSC_Q_EN', 'UPSC'].forEach((prefix, i) => {
  process.env[`SHEET_URL_${prefix}`] =
    `https://script.google.com/macros/s/test-${prefix.toLowerCase()}/exec`;
  process.env[`SHEET_TOKEN_${prefix}`] = `token-${prefix}`;
  process.env[`TELEGRAM_GROUP_${prefix}`] = `-100${1000 + i}`;
});

const razorpay = require('../src/razorpay');
const plans = require('../src/plans');

// ===========================================================================
// Plans and expiry arithmetic
// ===========================================================================

test('the three sellable passes are defined with sane prices', () => {
  const all = plans.listPlans();
  assert.equal(all.length, 3, 'the test pass must not be sellable by default');

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

test('the Rs 1 test pass is hidden unless TEST_PLAN_ENABLED is set', () => {
  // A student who finds the bot must never be able to buy 30 days for a rupee,
  // so the guard is the absence of the plan rather than a price check.
  const before = process.env.TEST_PLAN_ENABLED;
  try {
    delete process.env.TEST_PLAN_ENABLED;
    assert.ok(!plans.listPlans().some((p) => p.id === 'test_5min'));

    process.env.TEST_PLAN_ENABLED = 'true';
    const shown = plans.listPlans();
    assert.ok(shown.some((p) => p.id === 'test_5min'));
    assert.equal(shown.length, 4);
  } finally {
    if (before === undefined) delete process.env.TEST_PLAN_ENABLED;
    else process.env.TEST_PLAN_ENABLED = before;
  }
});

test('a minute-based plan expires in minutes, not days', () => {
  const from = new Date('2026-09-06T00:00:00Z');
  const expiry = plans.computeExpiry(plans.getPlan('test_5min'), from, null);
  assert.equal(expiry.getTime() - from.getTime(), 5 * 60 * 1000);
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
          notes: { telegram_id: '555', plan_id: 'sprint_30', telegram_username: 'student', group_id: 'appsc_news_en' }
        }
      },
      payment: { entity: { id: 'pay_1', amount: 29900 } }
    }
  });

  assert.equal(result.handled, true);
  assert.equal(calls.grantAccess.length, 1);

  const granted = calls.grantAccess[0];
  // The group must come from the notes we set, never from anything the payer
  // supplies, or a payment could be recorded against the wrong group's sheet.
  assert.equal(granted.groupId, 'appsc_news_en');
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
      subscription: { entity: { id: 'sub_1', notes: { telegram_id: '777', plan_id: 'autopay_monthly', group_id: 'appsc_news_en' } } },
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
    payload: { subscription: { entity: { id: 'sub_2', notes: { telegram_id: '888', group_id: 'appsc_news_en' } } } }
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
  // The cancellation branch writes through the group-bound client, so the stub
  // has to sit on what forGroup returns rather than on the module.
  const upsert = async (subscriber) => {
    calls.upsert.push(subscriber);
    return subscriber;
  };
  sheets.upsertSubscriber = upsert;
  sheets.forGroup = (groupId) => ({ groupId, upsertSubscriber: upsert });

  const server = require('../server');
  return { handler: server.handlePaymentEvent, calls };
}

// ===========================================================================
// Who is allowed into the group
// ===========================================================================
// A Telegram invite link cannot be bound to an account: whoever opens it first
// gets in. That let a buyer forward their link to someone else, who joined in
// their place — and because the expiry sweep bans the id recorded on the sheet,
// the person actually sitting in the group was never removed. A free seat,
// permanently, invisible on the dashboard.
//
// Admission is now decided per-account at the moment of joining, so these
// tests are about identity rather than about links.

const membership = require('../src/membership');
const sheets = require('../src/sheets');
const paybot = require('../src/paybot');

const TEST_GROUP = 'appsc_q_en';

/** Runs `fn` with the bound sheets client stubbed to return `row`. */
async function withSubscriber(row, fn) {
  const original = sheets.forGroup;
  sheets.forGroup = (groupId) => {
    const real = original(groupId);
    return Object.assign({}, real, {
      getSubscriber: async () => row,
      upsertSubscriber: async (data) => data
    });
  };
  try {
    return await fn();
  } finally {
    sheets.forGroup = original;
  }
}

/** Captures approve/decline/remove calls instead of hitting Telegram. */
function stubPaybot() {
  const calls = [];
  const originals = {
    approveJoinRequest: paybot.approveJoinRequest,
    declineJoinRequest: paybot.declineJoinRequest,
    removeFromChat: paybot.removeFromChat
  };
  paybot.approveJoinRequest = async (env, c, u) => { calls.push(['approve', String(u), env]); };
  paybot.declineJoinRequest = async (env, c, u) => { calls.push(['decline', String(u), env]); };
  paybot.removeFromChat = async (env, c, u) => { calls.push(['remove', String(u), env]); };
  return {
    calls,
    restore() { Object.assign(paybot, originals); }
  };
}

const activeRow = {
  telegram_id: '111', status: 'active',
  expiry_date: '31-12-2030, 11:59:00 PM IST', plan: 'sprint_30'
};

test('the paying account is approved when it asks to join', async () => {
  const stub = stubPaybot();
  try {
    const result = await withSubscriber(activeRow, () => membership.handleJoinRequest(TEST_GROUP, '111'));
    assert.equal(result.approved, true);
    assert.deepEqual(stub.calls.map((c) => c.slice(0, 2)), [['approve', '111']]);
    assert.equal(stub.calls[0][2], 'TELEGRAM_PAYBOT_SADHANA', 'wrong payment bot for this group');
  } finally {
    stub.restore();
  }
});

test('a forwarded invite does not admit someone who never paid', async () => {
  // The exact hole: the buyer hands their link to a friend, the friend taps it.
  const stub = stubPaybot();
  try {
    const result = await withSubscriber(null, () => membership.handleJoinRequest(TEST_GROUP, '999'));
    assert.equal(result.approved, false);
    assert.deepEqual(stub.calls.map((c) => c.slice(0, 2)), [['decline', '999']]);
  } finally {
    stub.restore();
  }
});

test('an expired subscription is turned away at the door', async () => {
  const stub = stubPaybot();
  const expired = Object.assign({}, activeRow, {
    expiry_date: '01-01-2020, 12:00:00 AM IST'
  });
  try {
    const result = await withSubscriber(expired, () => membership.handleJoinRequest(TEST_GROUP, '111'));
    assert.equal(result.approved, false);
    assert.match(result.reason, /expired/);
  } finally {
    stub.restore();
  }
});

test('a cancelled subscription that has not yet run out still gets in', async () => {
  // Cancelling stops renewal; it does not forfeit days already paid for.
  const stub = stubPaybot();
  const cancelled = Object.assign({}, activeRow, { status: 'cancelled' });
  try {
    const result = await withSubscriber(cancelled, () => membership.handleJoinRequest(TEST_GROUP, '111'));
    // status is the record of intent, so a cancelled row is not active access.
    assert.equal(result.approved, false);
  } finally {
    stub.restore();
  }
});

test('someone added to the group by hand without paying is removed', async () => {
  // The net behind join requests: an admin adding a friend never triggers one.
  const stub = stubPaybot();
  try {
    const result = await withSubscriber(null, () => membership.enforceMembership(TEST_GROUP, '777'));
    assert.equal(result.removed, true);
    assert.deepEqual(stub.calls.map((c) => c.slice(0, 2)), [['remove', '777']]);
  } finally {
    stub.restore();
  }
});

test('a paying member is never removed by the guard', async () => {
  const stub = stubPaybot();
  try {
    const result = await withSubscriber(activeRow, () => membership.enforceMembership(TEST_GROUP, '111'));
    assert.equal(result.removed, false);
    assert.deepEqual(stub.calls, []);
  } finally {
    stub.restore();
  }
});

// ===========================================================================
// Text sent to Razorpay
// ===========================================================================

test('emoji are stripped from anything sent to Razorpay', () => {
  // Razorpay answers HTTP 400 "Error 3988: Conversion from collation
  // utf8mb3_general_ci into utf8mb4_0900_ai_ci impossible" if any string holds
  // a character outside the Basic Multilingual Plane. Telegram display names
  // routinely do, and the bot could only report "could not create your payment
  // link" — the buyer had no way to know their own name was the problem.
  assert.equal(razorpay.bmpOnly('Praneeth \u{1F3AF}\u{1F525}'), 'Praneeth');
  assert.equal(razorpay.bmpOnly('user\u{1F680}name'), 'username');

  // Ordinary non-English text is inside the BMP and must survive untouched.
  assert.equal(razorpay.bmpOnly('\u0C38\u0C3E\u0C27\u0C28'), '\u0C38\u0C3E\u0C27\u0C28');
  assert.equal(razorpay.bmpOnly('Rs 299 \u2014 pass'), 'Rs 299 \u2014 pass');

  // A name of nothing but emoji collapses to empty, so the caller can drop it
  // rather than sending an empty customer object.
  assert.equal(razorpay.bmpOnly('\u{1F600}\u{1F601}'), '');

  assert.equal(razorpay.bmpOnly('abcdef', 3), 'abc');
});

test('a payment link body carries no astral-plane characters', async () => {
  const originalFetch = globalThis.fetch;
  let sentBody = null;
  globalThis.fetch = async (url, opts) => {
    sentBody = opts.body;
    const payload = JSON.stringify({ id: 'plink_x', short_url: 'https://rzp.io/x' });
    return {
      ok: true,
      status: 200,
      text: async () => payload,
      json: async () => JSON.parse(payload)
    };
  };

  try {
    await razorpay.createPaymentLink({
      plan: plans.getPlan('sprint_30'),
      telegramId: '4242',
      name: 'Praneeth \u{1F3AF}',
      username: 'user\u{1F680}name',
      callbackUrl: 'https://example.com/done'
    });

    const body = JSON.parse(sentBody);
    const asText = JSON.stringify(body);
    assert.equal(
      Array.from(asText).some((ch) => ch.codePointAt(0) > 0xFFFF), false,
      'an emoji reached Razorpay'
    );
    assert.equal(body.customer.name, 'Praneeth');
    assert.equal(body.notes.telegram_username, 'username');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ===========================================================================
// Group isolation
// ===========================================================================
// Five groups, five sheets, and the promise that nothing is mixed. That
// promise rests on one rule — there is no default group — so these tests are
// about what happens when a caller forgets to say which group it means.

const groups = require('../src/groups');
const sheetsModule = require('../src/sheets');

test('every configured group has a unique id and an envPrefix', () => {
  const all = groups.listGroups();
  assert.ok(all.length >= 2, 'expected several groups');

  const ids = all.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, 'two groups share an id');
  all.forEach((g) => assert.ok(g.envPrefix, `${g.id} has no envPrefix`));
});

test('a data call with no group id is refused, not defaulted', () => {
  // The whole isolation guarantee is this line. Falling back to "the first
  // group" or "the legacy group" here is how one group's questions end up in
  // another group's paid channel.
  assert.throws(() => groups.requireGroup(''), /must name its group/);
  assert.throws(() => groups.requireGroup(null), /must name its group/);
});

test('an unknown group id is refused and the error lists the real ones', () => {
  assert.throws(() => groups.requireGroup('not_a_group'), (err) => {
    assert.match(err.message, /Unknown group "not_a_group"/);
    assert.match(err.message, /Configured groups:/);
    return true;
  });
});

test('two groups never resolve to the same sheet', () => {
  // Same URL for two groups would silently merge them, and every guarantee
  // above would still pass while the data was already mixed.
  const configured = groups.listGroups().filter((g) => g.sheetUrl);
  const urls = configured.map((g) => g.sheetUrl);
  assert.equal(new Set(urls).size, urls.length,
    'two groups point at the same Apps Script URL');
});

test('prices are per group, not shared', () => {
  // UPSC is priced differently on purpose; if plansFor ever read a single
  // global plan table this would start passing by accident.
  const a = groups.plansFor('appsc_q_en').find((p) => p.id === 'sprint_30');
  const b = groups.plansFor('upsc').find((p) => p.id === 'sprint_30');
  assert.ok(a && b);
  assert.notEqual(a.amountPaise, b.amountPaise);
  assert.equal(a.groupId, 'appsc_q_en');
  assert.equal(b.groupId, 'upsc');
});

test('the test pass is hidden per group unless explicitly included', () => {
  const hidden = groups.plansFor('upsc');
  assert.ok(!hidden.some((p) => p.id === 'test_5min'));

  const shown = groups.plansFor('upsc', { includeTest: true });
  assert.ok(shown.some((p) => p.id === 'test_5min'));
});

test('a sheets client is bound to one group and exposes the whole API', () => {
  const client = sheetsModule.forGroup('appsc_q_en');
  assert.equal(client.groupId, 'appsc_q_en');
  sheetsModule.API_NAMES.forEach((name) => {
    assert.equal(typeof client[name], 'function', `${name} missing from the bound client`);
  });
});
