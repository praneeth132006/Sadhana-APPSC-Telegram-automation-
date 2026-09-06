#!/usr/bin/env node
// ============================================================================
// Forum topic creator (setup-topics.js)
// ============================================================================
// Creates one Telegram forum topic per subject, in each group, and writes the
// thread ids back into that group's own sheet.
//
// The thread id is how a question finds its way to the right topic, so getting
// this wrong is not a cosmetic problem: a wrong id posts Polity questions into
// the Economy topic, and there is nothing in the sheet to say so. Each group's
// ids therefore go into that group's Config tab and nowhere else.
//
// Only creates topics for subjects with no thread id yet. It never inspects or
// modifies an existing topic — see the note in the loop below for why.
// To rebuild a group whose ids are wrong, use reset-topics.js.
//
//   node setup-topics.js              — every configured group
//   node setup-topics.js <groupId>    — one group
//   node setup-topics.js --dry-run    — say what would be created, create nothing
// ============================================================================

require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');

const groups = require('./src/groups');
const sheets = require('./src/sheets');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const only = args.find((a) => !a.startsWith('--'));

const POSTING_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();

/** One shared client for the posting bot; the chat is passed per call. */
let bot = null;
function postingBot() {
  if (!bot) {
    if (!POSTING_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not set.');
    bot = new TelegramBot(POSTING_TOKEN, { polling: false });
  }
  return bot;
}

/** Pause between API calls, so Telegram does not rate-limit a run of sixteen. */
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * retryAfterSeconds — how long Telegram asked us to wait, if it did.
 *
 * @param {Error} err
 * @returns {number} Seconds, or 0 when this was not a rate limit
 */
function retryAfterSeconds(err) {
  const body = err && err.response && err.response.body;
  const explicit = body && body.parameters && body.parameters.retry_after;
  if (explicit) return Number(explicit);
  // Some responses only carry it in the text.
  const match = /retry after (\d+)/i.exec(err && err.message ? err.message : '');
  return match ? Number(match[1]) : 0;
}

/**
 * createTopic — creates one topic, waiting out any rate limit.
 *
 * Telegram throttles topic creation aggressively: sixteen subjects across five
 * groups is eighty calls, and it starts refusing after roughly a dozen. Giving
 * up on a 429 leaves a group half set up, with some subjects pointing at real
 * topics and others at placeholder ids that were never created — which is worse
 * than not having started, because the sheet then looks configured.
 *
 * @param {string|number} chatId
 * @param {string} title
 * @returns {Promise<Object>} The created topic
 */
async function createTopic(chatId, title) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await postingBot().createForumTopic(chatId, title, { icon_color: 0x6FB9F0 });
    } catch (err) {
      const wait = retryAfterSeconds(err);
      if (!wait) throw err;
      console.log(`      rate limited, waiting ${wait}s…`);
      await pause((wait + 2) * 1000);
    }
  }
  throw new Error('still rate limited after several retries');
}

/**
 * setupGroup — creates whatever topics this group is still missing.
 *
 * @param {Object} group From the registry
 * @returns {Promise<{created: number, skipped: number, failed: number}>}
 */
async function setupGroup(group) {
  console.log(`\n${group.displayName}  (${group.id})`);
  console.log('─'.repeat(58));

  if (!group.ready) {
    console.log(`   skipped — not configured: ${group.missing.join(', ')}`);
    return { created: 0, skipped: 0, failed: 0 };
  }

  const sheet = sheets.forGroup(group.id);
  const config = await sheet.readConfig();

  if (!config.length) {
    console.log('   Config tab is empty. Run setupSpreadsheet in this sheet first.');
    return { created: 0, skipped: 0, failed: 0 };
  }

  let created = 0;
  let skipped = 0;
  let failed = 0;
  let changed = false;

  for (const row of config) {
    const title = row.emoji ? `${row.emoji} ${row.subject}` : row.subject;

    if (row.topic_thread_id) {
      // Trusted as-is, and never probed. An earlier version checked existence
      // by renaming the topic to the name it should already have — a no-op on a
      // real topic, but on a placeholder id it renamed whatever unrelated topic
      // held that id. Groups ended up with two subjects sharing one topic and
      // half the names wrong, and nothing in the sheet showed it.
      //
      // There is no way to ask Telegram whether a topic exists without a call
      // that can change something, so this does not ask. If the ids are wrong,
      // reset-topics.js rebuilds the group from scratch.
      console.log(`   ⏭  ${title} — thread ${row.topic_thread_id}`);
      skipped += 1;
      continue;
    }

    if (dryRun) {
      console.log(`   ○  ${title} — would create`);
      created += 1;
      continue;
    }

    try {
      const topic = await createTopic(group.telegramGroupId, title);
      row.topic_thread_id = topic.message_thread_id;
      changed = true;
      created += 1;
      console.log(`   ✅ ${title} — thread ${topic.message_thread_id}`);
      // Written straight away rather than at the end: a topic exists in
      // Telegram the moment it is created, and losing its id to a crash means
      // a duplicate topic on the next run with no way to tell which is live.
      await sheet.writeConfig(config);
      await pause(2500);
    } catch (err) {
      failed += 1;
      console.log(`   ❌ ${title} — ${err.message}`);
      // A group that is not a forum has no topics at all, and every remaining
      // subject would fail the same way; say so once rather than sixteen times.
      if (/not a forum|TOPIC_/i.test(err.message)) {
        console.log('      This group is not a forum. Turn ON "Topics" in group settings.');
        break;
      }
    }
  }

  if (changed && !dryRun) {
    await sheet.writeConfig(config);
    console.log(`   Saved ${created} thread id(s) to this group's Config tab.`);
  }

  return { created, skipped, failed };
}

(async () => {
  const targets = only ? [groups.requireGroup(only)] : groups.listGroups();

  console.log(dryRun ? '\nDRY RUN — nothing will be created' : '\nCreating forum topics');

  const totals = { created: 0, skipped: 0, failed: 0 };
  for (const group of targets) {
    const result = await setupGroup(group);
    totals.created += result.created;
    totals.skipped += result.skipped;
    totals.failed += result.failed;
  }

  console.log('\n' + '═'.repeat(58));
  console.log(`created ${totals.created}   already existed ${totals.skipped}   failed ${totals.failed}\n`);
  process.exit(totals.failed ? 1 : 0);
})().catch((err) => {
  console.error('❌ ' + err.message);
  process.exit(1);
});
