#!/usr/bin/env node
// ============================================================================
// Forum topic reset (reset-topics.js)
// ============================================================================
// Deletes every forum topic in a group and rebuilds them from that group's
// subject list, one topic per subject, in order.
//
// This exists because an earlier version of setup-topics.js probed whether a
// topic existed by RENAMING it — editForumTopic with the name it should
// already have. On a real topic that is a no-op, but on a placeholder id it
// renamed whatever unrelated topic happened to hold that id. The result was
// groups where two subjects shared one topic and half the topics carried the
// wrong name. Nothing in the sheet showed it.
//
// The lesson is in the code below: existence is never probed with a call that
// can change something. A topic here is either created by this script and its
// id recorded, or it does not exist.
//
//   node reset-topics.js <groupId>     — one group
//   node reset-topics.js --all         — every configured group
//   node reset-topics.js <groupId> --dry-run
// ============================================================================

require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');

const groups = require('./src/groups');
const sheets = require('./src/sheets');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const doAll = args.includes('--all');
const only = args.find((a) => !a.startsWith('--'));

/** Highest topic id to try deleting. Ids climb, so this is a ceiling. */
const MAX_TOPIC_ID = 260;

let bot = null;
function postingBot() {
  if (!bot) {
    const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set.');
    bot = new TelegramBot(token, { polling: false });
  }
  return bot;
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Seconds Telegram asked us to wait, or 0 if this was not a rate limit. */
function retryAfterSeconds(err) {
  const body = err && err.response && err.response.body;
  const explicit = body && body.parameters && body.parameters.retry_after;
  if (explicit) return Number(explicit);
  const match = /retry after (\d+)/i.exec(err && err.message ? err.message : '');
  return match ? Number(match[1]) : 0;
}

/** Runs an API call, waiting out rate limits rather than giving up. */
async function withRetry(label, fn) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      const wait = retryAfterSeconds(err);
      if (!wait) throw err;
      console.log(`      rate limited (${label}), waiting ${wait}s…`);
      await pause((wait + 2) * 1000);
    }
  }
  throw new Error(`gave up after repeated rate limits: ${label}`);
}

/**
 * clearTopics — removes every topic in the group.
 *
 * Telegram has no "list topics" call, so ids are tried in order and the
 * failures are simply the gaps. Topic 1 is General, which cannot be deleted
 * and should not be.
 *
 * @param {string|number} chatId
 * @returns {Promise<number>} How many were deleted
 */
async function clearTopics(chatId) {
  let deleted = 0;

  for (let id = 2; id <= MAX_TOPIC_ID; id += 1) {
    try {
      await withRetry(`delete ${id}`, () => postingBot().deleteForumTopic(chatId, id));
      deleted += 1;
      process.stdout.write(`   deleting… ${deleted}\r`);
      await pause(400);
    } catch (err) {
      // No such topic — the overwhelming majority of ids. Not worth a line.
    }
  }

  process.stdout.write('                              \r');
  return deleted;
}

/**
 * rebuild — one topic per subject, in the group's configured order.
 *
 * @param {Object} group
 * @returns {Promise<{deleted: number, created: number}>}
 */
async function rebuild(group) {
  console.log(`\n${group.displayName}  (${group.id})`);
  console.log('─'.repeat(58));

  if (!group.ready) {
    console.log(`   skipped — ${group.missing.join(', ')}`);
    return { deleted: 0, created: 0 };
  }

  const sheet = sheets.forGroup(group.id);
  const config = await sheet.readConfig();

  if (!config.length) {
    console.log('   Config tab is empty. Run setupSpreadsheet in this sheet first.');
    return { deleted: 0, created: 0 };
  }

  if (dryRun) {
    console.log(`   would delete every topic, then create ${config.length}:`);
    config.forEach((row) => console.log(`     ${row.emoji ? row.emoji + ' ' : ''}${row.subject}`));
    return { deleted: 0, created: 0 };
  }

  const deleted = await clearTopics(group.telegramGroupId);
  console.log(`   deleted ${deleted} old topic(s)`);

  // Every id is dropped first. A stale id left in place is exactly how two
  // subjects came to share a topic: the row looked configured, so it was
  // skipped, and the topic it named belonged to something else.
  config.forEach((row) => { row.topic_thread_id = ''; });
  await sheet.writeConfig(config);

  let created = 0;
  for (const row of config) {
    const title = row.emoji ? `${row.emoji} ${row.subject}` : row.subject;
    try {
      const topic = await withRetry(`create ${title}`, () =>
        postingBot().createForumTopic(group.telegramGroupId, title, { icon_color: 0x6FB9F0 }));

      row.topic_thread_id = topic.message_thread_id;
      created += 1;
      console.log(`   ✅ ${title} — thread ${topic.message_thread_id}`);

      // Saved per topic: the topic exists in Telegram the moment it is made,
      // and losing its id means a duplicate with no way to tell which is live.
      await sheet.writeConfig(config);
      await pause(2500);
    } catch (err) {
      console.log(`   ❌ ${title} — ${err.message}`);
    }
  }

  return { deleted, created };
}

(async () => {
  if (!only && !doAll) {
    console.error('Name a group, or pass --all. Groups: ' +
      groups.listGroups().map((g) => g.id).join(', '));
    process.exit(1);
  }

  const targets = doAll ? groups.listGroups() : [groups.requireGroup(only)];

  console.log(dryRun
    ? '\nDRY RUN — nothing will be deleted or created'
    : '\nResetting forum topics. Existing topics WILL be deleted.');

  const totals = { deleted: 0, created: 0 };
  for (const group of targets) {
    const result = await rebuild(group);
    totals.deleted += result.deleted;
    totals.created += result.created;
  }

  console.log('\n' + '═'.repeat(58));
  console.log(`deleted ${totals.deleted}   created ${totals.created}\n`);
})().catch((err) => {
  console.error('❌ ' + err.message);
  process.exit(1);
});
