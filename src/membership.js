// ============================================================================
// Membership lifecycle (src/membership.js)
// ============================================================================
// Everything that happens between "a student paid" and "a student is in the
// group", plus the daily job that reminds and removes people.
//
// The one rule this file exists to enforce: access is granted from the
// PAYMENT, never from anything the student's browser or Telegram client says.
// A webhook whose signature checked out, carrying a Telegram id Razorpay
// echoed back from our own `notes`, is the only thing that opens the door.
// ============================================================================

const sheets = require('./sheets');
const telegram = require('./telegram');
const plans = require('./plans');

/**
 * getPremiumGroupId — the private group paying members join.
 * Falls back to the main group so a single-group setup works unchanged.
 *
 * @returns {string}
 */
function getPremiumGroupId() {
  return String(
    process.env.TELEGRAM_PREMIUM_GROUP_ID || process.env.TELEGRAM_GROUP_ID || ''
  ).trim();
}

/** Formats a Date the way every timestamp in the sheet is stored. */
function formatIst(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
  }).formatToParts(date);

  const get = (type) => (parts.find((p) => p.type === type) || {}).value || '';
  const meridiem = get('dayPeriod').toUpperCase();

  return `${get('day')}-${get('month')}-${get('year')}, ` +
         `${get('hour')}:${get('minute')}:${get('second')} ${meridiem} IST`;
}

/**
 * parseIst — reads back a timestamp this project wrote.
 *
 * @param {string} value
 * @returns {Date|null}
 */
function parseIst(value) {
  const text = String(value || '').trim();
  if (!text || text === '-') return null;

  const match = text.match(/^(\d{2})-(\d{2})-(\d{4})(?:,\s*(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM))?/i);
  if (!match) return null;

  let hour = match[4] ? Number(match[4]) : 23;
  const minute = match[5] ? Number(match[5]) : 59;
  const second = match[6] ? Number(match[6]) : 59;

  if (match[7]) {
    const meridiem = match[7].toUpperCase();
    if (meridiem === 'PM' && hour < 12) hour += 12;
    if (meridiem === 'AM' && hour === 12) hour = 0;
  }

  const date = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), hour, minute, second);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Ensures the Telegram client is initialised before use. */
let telegramReady = false;
function ensureTelegram() {
  if (telegramReady) return;
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set.');
  telegram.init(token, getPremiumGroupId());
  telegramReady = true;
}

/**
 * createSingleUseInvite — a private invite link only one person can use.
 *
 * member_limit 1 means the link dies the moment it is used, so a student who
 * forwards it to a friend gives away their own seat rather than creating a
 * second free one. It also expires on its own if never used.
 *
 * @param {string|number} telegramId Who it is for, used only for the link name
 * @returns {Promise<string>} The invite URL
 */
async function createSingleUseInvite(telegramId) {
  ensureTelegram();
  const groupId = getPremiumGroupId();
  if (!groupId) throw new Error('No premium group configured.');

  const result = await telegram.createSingleUseInviteLink(
    groupId,
    `member-${telegramId}`,
    Math.floor(Date.now() / 1000) + 24 * 60 * 60
  );
  return result.invite_link;
}

/**
 * grantAccess — the single path from a verified payment to group membership.
 *
 * Idempotent by design: Razorpay retries webhooks, and a duplicate delivery
 * must not double-charge the ledger or extend the expiry twice. A payment id
 * already recorded against the member is treated as already handled.
 *
 * @param {Object} options
 * @param {string|number} options.telegramId Buyer, from Razorpay notes
 * @param {string} options.planId Plan id, from Razorpay notes
 * @param {string} options.paymentId Razorpay payment id
 * @param {number} options.amountPaise Amount actually captured
 * @param {string} [options.username] Telegram @handle
 * @param {string} [options.name] Display name
 * @param {string} [options.linkId] Payment link id
 * @param {string} [options.subscriptionId] Subscription id, recurring only
 * @param {string} [options.event] Label for the payment log
 * @returns {Promise<Object>} { subscriber, inviteLink, alreadyProcessed }
 */
async function grantAccess(options) {
  const {
    telegramId, planId, paymentId, amountPaise,
    username, name, linkId, subscriptionId, event
  } = options;

  const plan = plans.getPlan(planId);
  if (!plan) throw new Error(`Unknown plan "${planId}"`);
  if (!telegramId) throw new Error('grantAccess requires a telegramId');

  const existing = await sheets.getSubscriber(telegramId);

  // Razorpay retries on any non-2xx, so the same payment can arrive twice.
  if (existing && paymentId && existing.payment_id === paymentId) {
    return { subscriber: existing, inviteLink: existing.invite_link, alreadyProcessed: true };
  }

  // A renewal extends from the current expiry, so paying early never costs days.
  const currentExpiry = existing ? parseIst(existing.expiry_date) : null;
  const expiry = plans.computeExpiry(plan, new Date(), currentExpiry);

  // Reuse a still-valid invite rather than minting a second live link.
  let inviteLink = existing && existing.invite_link ? existing.invite_link : '';
  const isRejoining = !existing || existing.status !== 'active';
  if (!inviteLink || isRejoining) {
    try {
      inviteLink = await createSingleUseInvite(telegramId);
    } catch (err) {
      // The payment is real even if Telegram is briefly unreachable. Record it
      // and let the student retry with /status rather than losing the sale.
      console.error('[membership] could not create invite link:', err.message);
      inviteLink = existing ? existing.invite_link : '';
    }
  }

  const subscriber = await sheets.upsertSubscriber({
    telegram_id: String(telegramId),
    username: username || (existing ? existing.username : ''),
    name: name || (existing ? existing.name : ''),
    plan: plan.id,
    plan_label: plan.label,
    status: 'active',
    start_date: existing && existing.start_date ? existing.start_date : formatIst(new Date()),
    expiry_date: formatIst(expiry),
    amount: (Number(amountPaise) || plan.amountPaise) / 100,
    payment_id: paymentId || '',
    link_id: linkId || '',
    subscription_id: subscriptionId || (existing ? existing.subscription_id : ''),
    invite_link: inviteLink,
    // A fresh expiry invalidates any reminder already sent.
    reminder_sent: '',
    is_payment: true
  }, event || 'payment.captured');

  return { subscriber, inviteLink, alreadyProcessed: false, expiry };
}

/**
 * removeMember — kicks someone from the premium group.
 *
 * Uses ban-then-unban: an outright ban would stop them rejoining after they
 * pay again, which is the opposite of what a lapsed subscriber needs.
 *
 * @param {string|number} telegramId
 * @returns {Promise<boolean>} Whether Telegram accepted the removal
 */
async function removeMember(telegramId) {
  ensureTelegram();
  const groupId = getPremiumGroupId();
  if (!groupId) throw new Error('No premium group configured.');

  try {
    await telegram.banChatMember(groupId, telegramId);
    await telegram.unbanChatMember(groupId, telegramId);
    return true;
  } catch (err) {
    // Already gone, or never joined — not a failure worth stopping the run for.
    console.error(`[membership] could not remove ${telegramId}: ${err.message}`);
    return false;
  }
}

/**
 * markExpired — flips a member to expired without touching the money columns.
 *
 * @param {Object} subscriber The stored member
 * @param {boolean} removed Whether they were actually removed from the group
 */
async function markExpired(subscriber, removed) {
  return sheets.upsertSubscriber({
    telegram_id: subscriber.telegram_id,
    status: removed ? 'removed' : 'expired',
    // Clear the invite so a lapsed member cannot rejoin on an old link.
    invite_link: '',
    notes: `Access ended ${formatIst(new Date())}`,
    is_payment: false
  }, 'expired');
}

/**
 * sendRenewalReminder — nudges a member whose access is about to end.
 *
 * @param {Object} subscriber The stored member
 * @param {number} daysLeft Days until expiry
 */
async function sendRenewalReminder(subscriber, daysLeft) {
  ensureTelegram();

  const plan = plans.getPlan(subscriber.plan);
  const label = plan ? plan.label : subscriber.plan_label || 'your pass';
  const when = daysLeft <= 0
    ? 'today'
    : daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`;

  const message =
    `⏳ <b>Your ${label} expires ${when}.</b>\n\n` +
    `Renew to keep your access to the APPSC premium group and daily quizzes.\n\n` +
    `Send /plans to this bot to renew in a couple of taps.`;

  await telegram.sendDirectMessage(subscriber.telegram_id, message);

  // Record which expiry this reminder was for, so a renewal (new expiry) makes
  // the member eligible for a reminder again, but today's is not repeated.
  await sheets.upsertSubscriber({
    telegram_id: subscriber.telegram_id,
    reminder_sent: subscriber.expiry_date,
    is_payment: false
  }, 'reminder');
}

/**
 * runDailyCheck — the daily job: remind whoever is close to expiry, remove
 * whoever is past it.
 *
 * @param {Object} [options]
 * @param {boolean} [options.dryRun] Report what would happen, change nothing
 * @returns {Promise<Object>} Summary of the run
 */
async function runDailyCheck({ dryRun = false } = {}) {
  const summary = { checked: 0, reminded: [], removed: [], failed: [], dryRun };

  // Widest reminder window of any plan, so one query covers every case.
  const lookAhead = Math.max(...plans.listPlans().map((p) => p.reminderDaysBefore || 0), 0);
  const candidates = await sheets.getExpiring(lookAhead);
  summary.checked = candidates.length;

  for (const subscriber of candidates) {
    const expiry = parseIst(subscriber.expiry_date);
    if (!expiry) {
      summary.failed.push({ telegram_id: subscriber.telegram_id, reason: 'unreadable expiry date' });
      continue;
    }

    const daysLeft = plans.daysUntil(expiry);
    const plan = plans.getPlan(subscriber.plan);

    try {
      if (daysLeft <= 0) {
        // Past expiry: remove from the group and mark the row.
        if (!dryRun) {
          const removed = await removeMember(subscriber.telegram_id);
          await markExpired(subscriber, removed);
          try {
            await telegram.sendDirectMessage(
              subscriber.telegram_id,
              `Your <b>${subscriber.plan_label || 'pass'}</b> has expired and your group access has ended.\n\n` +
              `Send /plans to rejoin whenever you are ready — your progress and history are kept.`
            );
          } catch (err) {
            // A student who blocked the bot still gets removed; that is fine.
          }
        }
        summary.removed.push({
          telegram_id: subscriber.telegram_id,
          username: subscriber.username,
          plan: subscriber.plan
        });
        continue;
      }

      // Still active: remind once, if this plan uses reminders.
      const window = plan ? plan.reminderDaysBefore : 3;
      const alreadyReminded = subscriber.reminder_sent === subscriber.expiry_date;

      if (window > 0 && daysLeft <= window && !alreadyReminded) {
        if (!dryRun) await sendRenewalReminder(subscriber, daysLeft);
        summary.reminded.push({
          telegram_id: subscriber.telegram_id,
          username: subscriber.username,
          daysLeft
        });
      }
    } catch (err) {
      summary.failed.push({ telegram_id: subscriber.telegram_id, reason: err.message });
    }
  }

  return summary;
}

/**
 * describeStatus — the text behind /status in the bot.
 *
 * @param {Object|null} subscriber
 * @returns {string} HTML-formatted status message
 */
function describeStatus(subscriber) {
  if (!subscriber || subscriber.status === 'pending') {
    return '📋 You do not have an active pass yet.\n\nSend /plans to see the options.';
  }

  const expiry = parseIst(subscriber.expiry_date);
  const daysLeft = expiry ? plans.daysUntil(expiry) : null;

  if (subscriber.status === 'active' && daysLeft !== null && daysLeft > 0) {
    return `✅ <b>${subscriber.plan_label}</b> — active\n\n` +
           `Expires: <b>${subscriber.expiry_date}</b>\n` +
           `Days remaining: <b>${daysLeft}</b>\n` +
           `Total paid: ₹${subscriber.total_paid}\n\n` +
           (subscriber.subscription_id
             ? 'This renews automatically. Send /cancel to stop it.'
             : 'Send /plans to renew before it runs out.');
  }

  return `⌛ Your <b>${subscriber.plan_label || 'pass'}</b> has ended.\n\n` +
         `It expired on ${subscriber.expiry_date}.\n\n` +
         `Send /plans to rejoin.`;
}

module.exports = {
  getPremiumGroupId,
  formatIst,
  parseIst,
  createSingleUseInvite,
  grantAccess,
  removeMember,
  markExpired,
  sendRenewalReminder,
  runDailyCheck,
  describeStatus
};
