// ============================================================================
// Payment bot client (src/paybot.js)
// ============================================================================
// The bot that sells passes and guards the premium group, kept separate from
// the one that posts questions.
//
// Why a second module rather than reusing src/telegram.js: that module holds a
// single bot instance and a single group id at module level. server.js both
// posts questions and handles payment webhooks, so one shared instance would
// mean whichever ran last silently decided which bot sent everything — a
// question posted by the payment bot, or an invite sent by the posting bot.
// Separate clients make that impossible.
//
// TELEGRAM_PAYMENT_BOT_TOKEN is optional. Without it this falls back to
// TELEGRAM_BOT_TOKEN, so an existing single-bot setup keeps working unchanged
// until a second bot actually exists.
// ============================================================================

const TelegramBot = require('node-telegram-bot-api');

/** The payment bot client. Created on first use, never polled from here. */
let client = null;

/** Which env var supplied the token, for the health dashboard to report. */
let tokenSource = null;

/**
 * paymentToken — the token this bot should use.
 *
 * @returns {string} The payment bot token, or the shared one as a fallback
 */
function paymentToken() {
  const dedicated = String(process.env.TELEGRAM_PAYMENT_BOT_TOKEN || '').trim();
  if (dedicated) {
    tokenSource = 'TELEGRAM_PAYMENT_BOT_TOKEN';
    return dedicated;
  }
  tokenSource = 'TELEGRAM_BOT_TOKEN';
  return String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
}

/** Whether a dedicated payment bot token is configured. */
function hasDedicatedBot() {
  return Boolean(String(process.env.TELEGRAM_PAYMENT_BOT_TOKEN || '').trim());
}

/** Which env var the active token came from. Null until first use. */
function getTokenSource() {
  return tokenSource;
}

/**
 * bot — the shared client, created on first call.
 *
 * polling is false: this client only ever makes API calls. bot.js runs its own
 * polling client for commands and join requests.
 *
 * @returns {TelegramBot}
 */
function bot() {
  if (client) return client;

  const token = paymentToken();
  if (!token) {
    throw new Error(
      'No payment bot token. Set TELEGRAM_PAYMENT_BOT_TOKEN (preferred) or TELEGRAM_BOT_TOKEN.'
    );
  }

  client = new TelegramBot(token, { polling: false });
  return client;
}

/** Drops the cached client, so a token change is picked up. Tests use this. */
function reset() {
  client = null;
  tokenSource = null;
}

/**
 * createJoinRequestInvite — an invite that asks to join rather than joining.
 *
 * A plain invite link cannot be tied to an account: whoever opens it first
 * gets in. That let a buyer hand their link to someone else, who then joined
 * in their place — and because the expiry sweep bans the id recorded on the
 * sheet, the person actually sitting in the group was never removed. A free
 * seat, forever, invisible on the dashboard.
 *
 * creates_join_request turns the link into a request the bot must approve, so
 * identity is checked by Telegram at the moment of joining rather than assumed
 * from who is holding a URL. Telegram rejects member_limit alongside it, which
 * is fine: the approval is the limit.
 *
 * @param {string|number} chatId    The premium group
 * @param {string|number} telegramId Who it is for, recorded in the link name
 * @param {number} [ttlSeconds]     How long the link stays usable
 * @returns {Promise<string>} The invite URL
 */
async function createJoinRequestInvite(chatId, telegramId, ttlSeconds = 24 * 60 * 60) {
  return (await bot().createChatInviteLink(chatId, {
    creates_join_request: true,
    name: `member-${telegramId}`.slice(0, 32),
    expire_date: Math.floor(Date.now() / 1000) + ttlSeconds
  })).invite_link;
}

/**
 * approveJoinRequest — lets someone in.
 *
 * @param {string|number} chatId
 * @param {string|number} userId
 */
async function approveJoinRequest(chatId, userId) {
  return bot().approveChatJoinRequest(chatId, userId);
}

/**
 * declineJoinRequest — turns someone away.
 *
 * @param {string|number} chatId
 * @param {string|number} userId
 */
async function declineJoinRequest(chatId, userId) {
  return bot().declineChatJoinRequest(chatId, userId);
}

/**
 * sendDirectMessage — HTML message to one user.
 *
 * Telegram forbids a bot from opening a conversation, so this only works once
 * the student has messaged this bot. With two bots that is worth remembering:
 * having messaged the questions bot does not help.
 *
 * @param {string|number} userId
 * @param {string} text HTML
 * @param {Object} [extra] Extra sendMessage options
 */
async function sendDirectMessage(userId, text, extra) {
  return bot().sendMessage(userId, text, Object.assign({
    parse_mode: 'HTML',
    disable_web_page_preview: true
  }, extra || {}));
}

/**
 * removeFromChat — ban then unban, so a lapsed member can rejoin after paying.
 *
 * @param {string|number} chatId
 * @param {string|number} userId
 */
async function removeFromChat(chatId, userId) {
  await bot().banChatMember(chatId, userId);
  await bot().unbanChatMember(chatId, userId);
}

/**
 * getMemberStatus — 'member', 'administrator', 'left', 'kicked', …
 *
 * @param {string|number} chatId
 * @param {string|number} userId
 * @returns {Promise<string|null>} The status, or null if it cannot be read
 */
async function getMemberStatus(chatId, userId) {
  try {
    const member = await bot().getChatMember(chatId, userId);
    return (member && member.status) || null;
  } catch (err) {
    return null;
  }
}

/** getMe, for the health dashboard. */
async function getMe() {
  return bot().getMe();
}

module.exports = {
  bot,
  reset,
  hasDedicatedBot,
  getTokenSource,
  createJoinRequestInvite,
  approveJoinRequest,
  declineJoinRequest,
  sendDirectMessage,
  removeFromChat,
  getMemberStatus,
  getMe
};
