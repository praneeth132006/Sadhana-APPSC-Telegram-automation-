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
const groupRegistry = require('./src/groups');

// This process is ONE payment bot, serving ONE family of groups.
//
// PAYBOT_ENV names which: TELEGRAM_PAYBOT_UPSC, TELEGRAM_PAYBOT_SADHANA or
// TELEGRAM_PAYBOT_NEWS. Everything the bot offers is derived from that, so the
// UPSC bot cannot sell a newspaper pass or hand out a Telugu group's invite —
// not because it chooses not to, but because those groups are not in its list.
//
// Three processes therefore run, one per family:
//   PAYBOT_ENV=TELEGRAM_PAYBOT_NEWS    npm run bot
//   PAYBOT_ENV=TELEGRAM_PAYBOT_SADHANA npm run bot
//   PAYBOT_ENV=TELEGRAM_PAYBOT_UPSC    npm run bot
const PAYBOT_ENV = String(process.env.PAYBOT_ENV || '').trim();

/** The groups this bot sells, in configuration order. */
function familyGroups() {
  return groupRegistry.listGroups().filter((g) => g.paymentBotEnv === PAYBOT_ENV && g.ready);
}

/** A group, but only if this bot is allowed to sell it. */
function familyGroup(groupId) {
  return familyGroups().find((g) => g.id === groupId) || null;
}

/** The passes a group sells, at that group's prices. */
function plansFor(groupId) {
  return groupRegistry.plansFor(groupId, { includeTest: plans.testPlanEnabled() });
}

/** One pass within one group. */
function planFor(groupId, planId) {
  return groupRegistry.getPlanFor(groupId, planId, { includeTest: plans.testPlanEnabled() });
}

/** That group's sheet. */
function sheetFor(groupId) {
  return sheets.forGroup(groupId);
}

/** Refuse to start without the pieces the bot cannot work without. */
function checkConfig() {
  const missing = [];
  if (!PAYBOT_ENV) {
    missing.push('PAYBOT_ENV (which payment bot this is, e.g. TELEGRAM_PAYBOT_UPSC)');
  } else if (!String(process.env[PAYBOT_ENV] || '').trim()) {
    missing.push(`${PAYBOT_ENV} (the bot token)`);
  } else if (!familyGroups().length) {
    missing.push(`no ready group has paymentBotEnv "${PAYBOT_ENV}" — check groups.config.json and .env`);
  }
  if (!razorpay.isConfigured()) missing.push('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET');

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

const bot = new TelegramBot(String(process.env[PAYBOT_ENV] || '').trim(), {
  polling: { params: { allowed_updates: JSON.stringify(ALLOWED_UPDATES) } }
});

// src/paybot.js builds its own non-polling client from the same token for
// invites, approvals and removals, so nothing here has to be handed around.

/** Escapes text before putting it in an HTML-formatted message. */
function esc(text) {
  return String(text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

/**
 * groupKeyboard — one button per group this bot sells.
 *
 * Only shown when the family has more than one. A bot serving a single group
 * asking "which group?" is a question with one answer.
 */
function groupKeyboard() {
  return {
    inline_keyboard: familyGroups().map((group) => ([{
      text: `${group.language === 'Telugu' ? '🇮🇳' : '🔤'} ${group.shortName}`,
      callback_data: `pick:${group.id}`
    }]))
  };
}

/** The passes for one group, as buttons that carry the group with them. */
function planKeyboard(groupId) {
  return {
    inline_keyboard: plansFor(groupId).map((plan) => ([{
      text: `${plan.emoji} ${plan.label} — ${plans.formatAmount(plan.amountPaise)}`,
      // The group travels in the callback data, so a tap can never be applied
      // to a different group than the one the student was reading about.
      callback_data: `buy:${groupId}:${plan.id}`
    }]))
  };
}

/** The "which group?" message. */
function chooseGroupMessage() {
  const groups = familyGroups();
  return '<b>Which group do you want to join?</b>\n\n' +
    groups.map((g, i) => `${i + 1}. <b>${esc(g.shortName)}</b>`).join('\n') +
    '\n\n<i>Both cost the same. Your pass and invite are for the group you pick — ' +
    'the link will not let you into the other one.</i>';
}

/** The passes message for one group. */
function plansMessage(groupId) {
  const group = groupRegistry.requireGroup(groupId);
  const lines = plansFor(groupId).map((plan, index) =>
    `${index + 1}. ${plan.emoji} <b>${esc(plan.label)}</b> — ${plans.formatAmount(plan.amountPaise)}` +
    (plan.type === 'recurring' ? '/month' : '') +
    `\n<i>${esc(plan.tagline)}</i>`
  );

  return `<b>${esc(group.shortName)}</b>\n\nChoose a pass:\n\n` + lines.join('\n\n');
}

/**
 * offerGroups — the entry point for a student.
 *
 * With one group in the family this goes straight to that group's passes;
 * with two it asks first. Either way the student only ever sees groups this
 * bot is responsible for.
 */
async function offerGroups(chatId) {
  const groups = familyGroups();

  if (groups.length === 1) {
    await bot.sendMessage(chatId, plansMessage(groups[0].id), {
      parse_mode: 'HTML',
      reply_markup: planKeyboard(groups[0].id)
    });
    return;
  }

  await bot.sendMessage(chatId, chooseGroupMessage(), {
    parse_mode: 'HTML',
    reply_markup: groupKeyboard()
  });
}

/**
 * findSubscription — where does this person hold a pass, within this family?
 *
 * Each group keeps its own sheet, so this asks each in turn. A student may
 * hold English and not Telugu, and the answer has to say which.
 *
 * @param {string|number} telegramId
 * @returns {Promise<Array<{group: Object, subscriber: Object}>>}
 */
async function findSubscriptions(telegramId) {
  const found = [];
  for (const group of familyGroups()) {
    try {
      const subscriber = await sheetFor(group.id).getSubscriber(telegramId);
      if (subscriber) found.push({ group, subscriber });
    } catch (err) {
      console.error(`[bot] could not read ${group.id}: ${err.message}`);
    }
  }
  return found;
}

bot.onText(/^\/start/, async (msg) => {
  const name = msg.from.first_name || 'there';
  const groups = familyGroups();
  const what = groups.length === 1
    ? `the <b>${esc(groups[0].shortName)}</b> group`
    : `our <b>${esc(groups[0].label)}</b> groups`;

  await bot.sendMessage(msg.chat.id,
    `👋 Hello ${esc(name)}!\n\n` +
    `This bot gives you access to ${what} — daily practice questions with ` +
    'explanations.\n\n' +
    'Commands:\n' +
    '/plans — see the passes and subscribe\n' +
    '/status — check your current pass\n' +
    '/help — how it all works',
    { parse_mode: 'HTML' }
  );
  await offerGroups(msg.chat.id);
});

bot.onText(/^\/plans/, async (msg) => {
  await offerGroups(msg.chat.id);
});

bot.onText(/^\/status/, async (msg) => {
  try {
    const held = await findSubscriptions(msg.from.id);

    if (!held.length) {
      await bot.sendMessage(msg.chat.id,
        'You do not have a pass yet.\n\nSend /plans to see the options.',
        { parse_mode: 'HTML' });
      await offerGroups(msg.chat.id);
      return;
    }

    // Reported per group, because a student can hold English and not Telugu,
    // and "you are active" without saying where is not an answer.
    for (const { group, subscriber } of held) {
      const options = { parse_mode: 'HTML' };
      if (subscriber.status === 'active' && subscriber.invite_link) {
        options.reply_markup = {
          inline_keyboard: [[{ text: `🔗 Open ${group.shortName}`, url: subscriber.invite_link }]]
        };
      }
      await bot.sendMessage(msg.chat.id,
        `<b>${esc(group.shortName)}</b>\n` + membership.describeStatus(subscriber), options);
    }
  } catch (err) {
    console.error('[bot] /status failed:', err.message);
    await bot.sendMessage(msg.chat.id, '⚠️ Could not read your status right now. Please try again shortly.');
  }
});

bot.onText(/^\/help/, async (msg) => {
  const many = familyGroups().length > 1;
  await bot.sendMessage(msg.chat.id,
    '<b>How it works</b>\n\n' +
    (many ? '1. Send /plans and choose which group you want.\n2. Pick a pass.\n'
          : '1. Send /plans and tap the pass you want.\n') +
    `${many ? '3' : '2'}. Pay on the secure Razorpay page that opens.\n` +
    `${many ? '4' : '3'}. This bot sends you a private invite link.\n` +
    `${many ? '5' : '4'}. Tap it and you are let in automatically.\n\n` +
    (many ? '<i>Your pass is for the group you chose. The invite will not let you ' +
            'into the other one, and forwarding it will not let anyone else in.</i>\n\n'
          : '<i>The invite is tied to your account — forwarding it will not let ' +
            'anyone else in.</i>\n\n') +
    'You will get a reminder before your pass runs out. Check /status any time.\n\n' +
    'Trouble? Reply here and an admin will help.',
    { parse_mode: 'HTML' }
  );
});

bot.onText(/^\/cancel/, async (msg) => {
  try {
    const held = await findSubscriptions(msg.from.id);
    const renewing = held.filter(({ subscriber }) => subscriber.subscription_id);

    if (!renewing.length) {
      await bot.sendMessage(msg.chat.id,
        'You do not have an auto-renewing subscription, so there is nothing to cancel.\n\n' +
        'One-time passes simply end on their expiry date.');
      return;
    }

    for (const { group, subscriber } of renewing) {
      // Cancel at cycle end: they keep what they already paid for.
      await razorpay.cancelSubscription(subscriber.subscription_id, true);
      await sheetFor(group.id).upsertSubscriber({
        telegram_id: String(msg.from.id),
        status: 'cancelled',
        notes: `Cancelled by user on ${membership.formatIst(new Date())}`,
        is_payment: false
      }, 'subscription.cancelled');

      await bot.sendMessage(msg.chat.id,
        `✅ Auto-renewal cancelled for <b>${esc(group.shortName)}</b>.\n\n` +
        `You keep access until <b>${esc(subscriber.expiry_date)}</b> — you paid for it.\n\n` +
        'Send /plans if you want to come back later.',
        { parse_mode: 'HTML' });
    }
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
  const user = query.from;

  // Acknowledging must not be able to kill the handler. A callback from a
  // message sent by an earlier bot process is "too old" by the time it
  // arrives, and answerCallbackQuery throws — which once left students
  // tapping a dead button with nothing logged and nothing sent.
  const ack = async (text) => {
    try {
      await bot.answerCallbackQuery(query.id, text ? { text } : undefined);
    } catch (err) {
      console.error('[bot] could not acknowledge the tap (stale button?):', err.message);
    }
  };

  // ---- picking a group ----------------------------------------------------
  if (data.startsWith('pick:')) {
    const group = familyGroup(data.slice(5));
    if (!group) {
      await ack('That group is not available here.');
      return;
    }
    await ack();
    await bot.sendMessage(user.id, plansMessage(group.id), {
      parse_mode: 'HTML',
      reply_markup: planKeyboard(group.id)
    });
    return;
  }

  if (!data.startsWith('buy:')) {
    await ack();
    return;
  }

  // ---- buying a pass ------------------------------------------------------
  // buy:<groupId>:<planId> — the group is carried on the button rather than
  // held in memory, so a tap on yesterday's message still buys the group it
  // was offering, and a restart cannot silently redirect it to another.
  const [, groupId, planId] = data.split(':');

  const group = familyGroup(groupId);
  if (!group) {
    // Either a stale button from another bot, or a group this bot does not
    // sell. Refusing is the whole point of one bot per family.
    await ack('That group is not available from this bot.');
    return;
  }

  const plan = planFor(groupId, planId);
  if (!plan) {
    await ack('That pass no longer exists.');
    return;
  }

  await ack('Creating your payment link…');

  try {
    // If they already hold this group, say so rather than quietly selling again.
    const existing = await sheetFor(groupId).getSubscriber(user.id);
    if (existing && existing.status === 'active') {
      await bot.sendMessage(user.id,
        `ℹ️ You already have an active <b>${esc(existing.plan_label)}</b> for ` +
        `<b>${esc(group.shortName)}</b> until <b>${esc(existing.expiry_date)}</b>.\n\n` +
        'Paying again extends your access from that date — you will not lose the days you have.',
        { parse_mode: 'HTML' });
    }

    const checkout = await createCheckout(group, plan, user);

    await bot.sendMessage(user.id,
      `${plan.emoji} <b>${esc(plan.label)}</b> — ${plans.formatAmount(plan.amountPaise)}` +
      (plan.type === 'recurring' ? ' per month' : '') + '\n' +
      `for <b>${esc(group.shortName)}</b>\n\n` +
      `${esc(plan.description)}\n\n` +
      'Tap below to pay. Your private invite arrives here the moment payment clears.' +
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
 * createCheckout — a Razorpay link or subscription for one group's pass.
 *
 * @param {Object} group The group being bought
 * @param {Object} plan  The pass, already carrying its group's price
 * @param {Object} user  Telegram user
 * @returns {Promise<{url: string}>}
 */
async function createCheckout(group, plan, user) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ');

  if (plan.type === 'recurring') {
    // Each group needs its own Razorpay plan, because the price is baked into
    // the plan and the groups do not all charge the same.
    const razorpayPlanId = String(plan.razorpayPlanId || '').trim();
    if (!razorpayPlanId) {
      throw new Error(
        `RAZORPAY_PLAN_${group.envPrefix} is not set — run setup-razorpay.js for ${group.displayName}.`
      );
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
// Guarding the groups
// ---------------------------------------------------------------------------

/** Which of this bot's groups a chat id belongs to, if any. */
function groupForChat(chatId) {
  return familyGroups().find((g) => String(g.telegramGroupId) === String(chatId)) || null;
}

// A join request is Telegram telling us exactly who is asking and which group
// they are asking about — the two things an invite link cannot carry. Approve
// only someone with a live pass FOR THAT GROUP. This is what stops an English
// invite opening the Telugu group: the request names the chat, and the check
// is made against that chat's sheet, not against "any group in the family".
bot.on('chat_join_request', async (req) => {
  const user = req.from || {};
  const group = groupForChat(req.chat && req.chat.id);

  // A request for a chat this bot does not sell is somebody else's business.
  if (!group) return;

  try {
    const result = await membership.handleJoinRequest(group.id, user.id);
    console.log(
      `[join] ${group.id}: ${result.approved ? 'APPROVED' : 'DECLINED'} ` +
      `${user.id} (@${user.username}) — ${result.reason}`
    );

    if (!result.approved) {
      // Telling them why turns a silent rejection into something they can act
      // on. The common case is a forwarded link, or a pass for the other
      // language's group.
      try {
        await bot.sendMessage(user.id,
          `❌ <b>That invite is not for this account.</b>\n\n` +
          `Access to <b>${esc(group.shortName)}</b> is tied to the Telegram account that ` +
          'paid for it, and a pass for one group does not open another.\n\n' +
          'Send /plans to buy your own.',
          { parse_mode: 'HTML' });
      } catch (err) {
        // Expected when they have never messaged this bot; nothing is lost.
      }
    }
  } catch (err) {
    console.error(`[join] ${group.id}: could not handle request from ${user.id} — ${err.message}`);
  }
});

// Behind the join request, a net for the ways into a group that skip it: an
// admin adding someone by hand, or a link made in the Telegram client.
bot.on('chat_member', async (update) => {
  const group = groupForChat(update.chat && update.chat.id);
  if (!group) return;

  const next = update.new_chat_member || {};
  const user = next.user || {};
  if (!['member', 'restricted'].includes(next.status)) return;
  if (user.is_bot) return;

  try {
    const result = await membership.enforceMembership(group.id, user.id);
    if (result.removed) {
      console.log(`[guard] ${group.id}: removed ${user.id} (@${user.username}) — ${result.reason}`);
    }
  } catch (err) {
    console.error(`[guard] ${group.id}: check failed for ${user.id} — ${err.message}`);
  }
});

bot.on('polling_error', (err) => {
  console.error('[bot] polling error:', err.message);
});

console.log('════════════════════════════════════════════════════');
console.log(`🤖 Payment bot running — ${PAYBOT_ENV}`);
console.log(`   Razorpay : ${razorpay.isTestMode() ? 'TEST mode' : 'LIVE mode'}`);
familyGroups().forEach((group) => {
  console.log(`   Group    : ${group.shortName}  (${group.telegramGroupId})`);
  console.log(`              ${plansFor(group.id).map((p) => p.label + ' ' + plans.formatAmount(p.amountPaise)).join(', ')}`);
});
console.log('   Commands : /start /plans /status /cancel /help');
console.log('════════════════════════════════════════════════════');

// Stop cleanly so polling does not linger on restart.
['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.on(signal, () => {
    console.log('\nStopping bot…');
    bot.stopPolling().then(() => process.exit(0)).catch(() => process.exit(0));
  });
});
