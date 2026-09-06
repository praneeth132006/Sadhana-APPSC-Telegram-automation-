// ============================================================================
// bot.js — the subscription bot students talk to
// ============================================================================
// Handles /start, /plans, /status, /help and /cancel, shows the three passes as
// buttons, and hands back a personal Razorpay checkout link.
//
// Run it alongside the dashboard:
//   node bot.js
//
// It never grants access itself. Tapping a button only produces a payment link;
// the door is opened by the webhook in server.js, and only after Razorpay's
// signature has been verified. That separation is deliberate — a student can
// press buttons all day and never obtain an invite without paying.
// ============================================================================

require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');

const plans = require('./src/plans');
const sheets = require('./src/sheets');
const membership = require('./src/membership');
const razorpay = require('./src/razorpay');

// This process is the PAYMENT bot: it sells passes and guards the group. The
// questions bot is a different token entirely and is driven by send.js and
// schedule.js. Falling back to TELEGRAM_BOT_TOKEN keeps a single-bot setup
// working until a dedicated payment bot exists.
const PAYMENT_TOKEN = String(
  process.env.TELEGRAM_PAYMENT_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || ''
).trim();

/** Refuse to start without the pieces the bot cannot work without. */
function checkConfig() {
  const missing = [];
  if (!PAYMENT_TOKEN) missing.push('TELEGRAM_PAYMENT_BOT_TOKEN (or TELEGRAM_BOT_TOKEN)');
  if (!razorpay.isConfigured()) missing.push('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET');
  if (!membership.getPremiumGroupId()) missing.push('TELEGRAM_PREMIUM_GROUP_ID or TELEGRAM_GROUP_ID');

  if (missing.length) {
    console.error('❌ Cannot start. Missing in .env:\n   ' + missing.join('\n   '));
    process.exit(1);
  }
}
checkConfig();

// allowed_updates must be stated explicitly on every getUpdates call.
// Telegram remembers the last list it was given for a bot and silently drops
// every other update type — this bot's stored list was
// ["message","channel_post","my_chat_member","chat_member"], with no
// callback_query, so every tap on a plan button was discarded by Telegram
// before it reached us: no request, no error, nothing to log. Passing the list
// here means the set the bot needs is re-asserted on each poll rather than
// inherited from whatever last touched the token.
// chat_join_request is what makes a forwarded invite worthless: the link asks
// to join rather than joining, and this bot decides who is let in. Leave it out
// and every request sits unanswered forever, with paying students locked out.
const ALLOWED_UPDATES = [
  'message', 'callback_query', 'my_chat_member', 'chat_member', 'chat_join_request'
];

const bot = new TelegramBot(PAYMENT_TOKEN, {
  polling: { params: { allowed_updates: JSON.stringify(ALLOWED_UPDATES) } }
});

// src/paybot.js builds its own non-polling client from the same token for
// invites, approvals and removals, so nothing here has to be handed around.

/** Escapes text before putting it in an HTML-formatted message. */
function esc(text) {
  return String(text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The inline keyboard listing the three passes. */
function planKeyboard() {
  return {
    inline_keyboard: plans.listPlans().map((plan) => ([{
      text: `${plan.emoji} ${plan.label} — ${plans.formatAmount(plan.amountPaise)}`,
      callback_data: `buy:${plan.id}`
    }]))
  };
}

/** The message that introduces the passes. */
function plansMessage() {
  const lines = [
    '🎓 <b>APPSC Premium Preparation Group</b>',
    '',
    'Choose a pass to get instant private group access:',
    ''
  ];

  plans.listPlans().forEach((plan, index) => {
    lines.push(
      `${index + 1}. ${plan.emoji} <b>${esc(plan.label)}</b> — ${plans.formatAmount(plan.amountPaise)}` +
      (plan.type === 'recurring' ? '/month' : '')
    );
    lines.push(`    <i>${esc(plan.tagline)}</i>`);
    lines.push('');
  });

  if (razorpay.isTestMode()) {
    lines.push('⚠️ <i>Test mode — use Razorpay test cards, no real money is charged.</i>');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

bot.onText(/^\/start/, async (msg) => {
  const name = msg.from.first_name || 'there';
  await bot.sendMessage(msg.chat.id,
    `👋 Hello ${esc(name)}!\n\n` +
    'This bot gives you access to the <b>APPSC Premium Preparation Group</b> — ' +
    'daily quiz polls across all 16 subjects, with explanations.\n\n' +
    'Commands:\n' +
    '/plans — see the passes and subscribe\n' +
    '/status — check your current pass\n' +
    '/help — how it all works',
    { parse_mode: 'HTML' }
  );
  await bot.sendMessage(msg.chat.id, plansMessage(), {
    parse_mode: 'HTML',
    reply_markup: planKeyboard()
  });
});

bot.onText(/^\/plans/, async (msg) => {
  await bot.sendMessage(msg.chat.id, plansMessage(), {
    parse_mode: 'HTML',
    reply_markup: planKeyboard()
  });
});

bot.onText(/^\/status/, async (msg) => {
  try {
    const subscriber = await sheets.getSubscriber(msg.from.id);
    const text = membership.describeStatus(subscriber);

    // Offer a rejoin link only when they actually hold access but lost the link.
    const options = { parse_mode: 'HTML' };
    if (subscriber && subscriber.status === 'active' && subscriber.invite_link) {
      options.reply_markup = {
        inline_keyboard: [[{ text: '🔗 Open the group', url: subscriber.invite_link }]]
      };
    } else if (!subscriber || subscriber.status !== 'active') {
      options.reply_markup = planKeyboard();
    }

    await bot.sendMessage(msg.chat.id, text, options);
  } catch (err) {
    console.error('[bot] /status failed:', err.message);
    await bot.sendMessage(msg.chat.id, '⚠️ Could not read your status right now. Please try again shortly.');
  }
});

bot.onText(/^\/help/, async (msg) => {
  await bot.sendMessage(msg.chat.id,
    '<b>How it works</b>\n\n' +
    '1. Send /plans and tap the pass you want.\n' +
    '2. Pay on the secure Razorpay page that opens.\n' +
    '3. This bot sends you a private, single-use invite link.\n' +
    '4. Tap it to join the group. The link stops working after you use it.\n\n' +
    'You will get a reminder before your pass runs out. Check /status any time.\n\n' +
    'Trouble? Reply here and an admin will help.',
    { parse_mode: 'HTML' }
  );
});

bot.onText(/^\/cancel/, async (msg) => {
  try {
    const subscriber = await sheets.getSubscriber(msg.from.id);

    if (!subscriber || !subscriber.subscription_id) {
      await bot.sendMessage(msg.chat.id,
        'You do not have an auto-renewing subscription, so there is nothing to cancel.\n\n' +
        'One-time passes simply end on their expiry date.');
      return;
    }

    // Cancel at cycle end: they keep what they already paid for.
    await razorpay.cancelSubscription(subscriber.subscription_id, true);
    await sheets.upsertSubscriber({
      telegram_id: String(msg.from.id),
      status: 'cancelled',
      notes: `Cancelled by user on ${membership.formatIst(new Date())}`,
      is_payment: false
    }, 'subscription.cancelled');

    await bot.sendMessage(msg.chat.id,
      `✅ Auto-renewal cancelled.\n\n` +
      `You keep access until <b>${esc(subscriber.expiry_date)}</b> — you paid for it.\n\n` +
      'Send /plans if you want to come back later.',
      { parse_mode: 'HTML' });
  } catch (err) {
    console.error('[bot] /cancel failed:', err.message);
    await bot.sendMessage(msg.chat.id, '⚠️ Could not cancel automatically. Please message an admin.');
  }
});

// ---------------------------------------------------------------------------
// Buying a pass
// ---------------------------------------------------------------------------

bot.on('callback_query', async (query) => {
  const data = String(query.data || '');
  if (!data.startsWith('buy:')) {
    await bot.answerCallbackQuery(query.id);
    return;
  }

  const planId = data.slice(4);
  const plan = plans.getPlan(planId);
  const user = query.from;

  if (!plan) {
    await bot.answerCallbackQuery(query.id, { text: 'That plan no longer exists.', show_alert: true });
    return;
  }

  // Acknowledging must not be able to kill the handler. A callback from a
  // message sent by an earlier bot process is "too old" by the time it
  // arrives, and answerCallbackQuery throws — outside a try that left the
  // student tapping a dead button with nothing logged and nothing sent.
  try {
    await bot.answerCallbackQuery(query.id, { text: 'Creating your payment link…' });
  } catch (err) {
    console.error('[bot] could not acknowledge the tap (stale button?):', err.message);
  }

  try {
    // If they already hold access, say so rather than quietly selling again.
    const existing = await sheets.getSubscriber(user.id);
    if (existing && existing.status === 'active') {
      await bot.sendMessage(user.id,
        `ℹ️ You already have an active <b>${esc(existing.plan_label)}</b> until ` +
        `<b>${esc(existing.expiry_date)}</b>.\n\n` +
        'Paying again extends your access from that date — you will not lose the days you have.',
        { parse_mode: 'HTML' });
    }

    const checkout = await createCheckout(plan, user);

    await bot.sendMessage(user.id,
      `${plan.emoji} <b>${esc(plan.label)}</b> — ${plans.formatAmount(plan.amountPaise)}` +
      (plan.type === 'recurring' ? ' per month' : '') + '\n\n' +
      `${esc(plan.description)}\n\n` +
      'Tap below to pay. Your private invite link arrives here the moment payment clears.' +
      (razorpay.isTestMode() ? '\n\n⚠️ <i>Test mode — use a Razorpay test card.</i>' : ''),
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: `💳 Pay ${plans.formatAmount(plan.amountPaise)}`, url: checkout.url }]]
        }
      });
  } catch (err) {
    console.error('[bot] could not create checkout:', err.message);
    await bot.sendMessage(user.id,
      '⚠️ Could not create your payment link just now. Please try again in a minute, ' +
      'or message an admin if it keeps happening.');
  }
});

/**
 * createCheckout — a payment link or subscription mandate for one student.
 *
 * The Telegram id goes into Razorpay's `notes`, which is the only thing that
 * later tells the webhook who to admit.
 *
 * @param {Object} plan Plan from src/plans.js
 * @param {Object} user Telegram user from the callback query
 * @returns {Promise<{url: string}>}
 */
async function createCheckout(plan, user) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ');

  if (plan.type === 'recurring') {
    const razorpayPlanId = String(process.env[plan.razorpayPlanIdEnv] || '').trim();
    if (!razorpayPlanId) {
      throw new Error(`${plan.razorpayPlanIdEnv} is not set — run "node setup-razorpay.js" first.`);
    }
    const subscription = await razorpay.createSubscription({
      plan, razorpayPlanId, telegramId: user.id, username: user.username
    });
    return { url: subscription.short_url };
  }

  const base = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  const link = await razorpay.createPaymentLink({
    plan,
    telegramId: user.id,
    username: user.username,
    name,
    callbackUrl: base ? `${base}/payment-success.html` : undefined
  });
  return { url: link.short_url };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Guarding the group
// ---------------------------------------------------------------------------

// A join request is Telegram telling us exactly who is asking, which is the
// one thing an invite link cannot. Approve a live subscription, decline
// everything else. This is what stops a forwarded link admitting a stranger.
bot.on('chat_join_request', async (req) => {
  const user = req.from || {};
  const chatId = (req.chat && req.chat.id) || membership.getPremiumGroupId();

  // Requests for some other chat this bot administers are none of our business.
  if (String(chatId) !== String(membership.getPremiumGroupId())) return;

  try {
    const result = await membership.handleJoinRequest(user.id);
    console.log(
      `[join] ${result.approved ? 'APPROVED' : 'DECLINED'} ${user.id} (@${user.username}) — ${result.reason}`
    );

    if (!result.approved) {
      // Telling them why turns a silent rejection into something they can act
      // on: the buyer forwarded their link, and this is the friend who tapped it.
      try {
        await bot.sendMessage(user.id,
          '❌ <b>That invite is not for this account.</b>\n\n' +
          'Group access is tied to the Telegram account that paid, so a forwarded ' +
          'link will not let you in.\n\nSend /plans to buy your own pass.',
          { parse_mode: 'HTML' });
      } catch (err) {
        // Expected when they have never messaged this bot; nothing is lost.
      }
    }
  } catch (err) {
    console.error('[join] could not handle request from', user.id, '-', err.message);
  }
});

// Behind the join request, a net for the ways into a group that skip it
// entirely — an admin adding a friend by hand, or a link made in the Telegram
// client rather than by this code.
bot.on('chat_member', async (update) => {
  const chatId = (update.chat && update.chat.id) || '';
  if (String(chatId) !== String(membership.getPremiumGroupId())) return;

  const next = update.new_chat_member || {};
  const user = next.user || {};
  if (!['member', 'restricted'].includes(next.status)) return;
  if (user.is_bot) return;

  try {
    const result = await membership.enforceMembership(user.id);
    if (result.removed) {
      console.log(`[guard] removed ${user.id} (@${user.username}) — ${result.reason}`);
    }
  } catch (err) {
    console.error('[guard] check failed for', user.id, '-', err.message);
  }
});

bot.on('polling_error', (err) => {
  console.error('[bot] polling error:', err.message);
});

console.log('════════════════════════════════════════════════════');
console.log('🤖 Sadhana APPSC subscription bot is running');
console.log(`   Razorpay : ${razorpay.isTestMode() ? 'TEST mode' : 'LIVE mode'}`);
console.log(`   Group    : ${membership.getPremiumGroupId()}`);
console.log(`   Plans    : ${plans.listPlans().map((p) => p.label).join(', ')}`);
console.log('   Commands : /start /plans /status /cancel /help');
console.log('════════════════════════════════════════════════════');

// Stop cleanly so polling does not linger on restart.
['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.on(signal, () => {
    console.log('\nStopping bot…');
    bot.stopPolling().then(() => process.exit(0)).catch(() => process.exit(0));
  });
});
