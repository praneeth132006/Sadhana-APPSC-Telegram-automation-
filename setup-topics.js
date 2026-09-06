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
// Safe to re-run. A subject that already has a thread id is skipped, so this
// never creates the same topic twice.
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
 * topicExists — is this thread id a real topic in this group?
 *
 * Telegram offers no "get topic" call, so this renames the topic to the title
 * it should already have. On a real topic that is a no-op; on an id that was
 * never created it fails, which is the answer we want.
 *
 * @param {string|number} chatId
 * @param {string|number} threadId
 * @param {string} title
 * @returns {Promise<boolean>}
 */
async function topicExists(chatId, threadId, title) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await postingBot().editForumTopic(chatId, threadId, { name: title });
      return true;
    } catch (err) {
      // A rate limit says nothing about whether the topic exists. Treating it
      // as "missing" is how a second run recreated sixteen topics that were
      // already there, leaving the group full of duplicates and the sheet
      // pointing at the newest of each pair.
      const wait = retryAfterSeconds(err);
      if (wait) {
        console.log(`      rate limited while checking, waiting ${wait}s…`);
        await pause((wait + 2) * 1000);
        continue;
      }

      // TOPIC_NOT_MODIFIED means the rename changed nothing because the name
      // already matched — which is proof the topic is there. It arrives as an
      // error only because Telegram reports a no-op edit that way.
      if (/TOPIC_NOT_MODIFIED/i.test(String(err && err.message ? err.message : ''))) {
        return true;
      }

      // Only a definite "no such topic" counts as missing. Anything else —
      // a network blip, a permissions problem — must not silently cause a
      // duplicate, so it is raised.
      const message = String(err && err.message ? err.message : '');
      if (/TOPIC_ID_INVALID|thread not found|message thread not found/i.test(message)) {
        return false;
      }
      throw err;
    }
  }
  throw new Error('rate limited repeatedly while checking whether a topic exists');
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
      // The id in the sheet is not proof the topic exists. setupSpreadsheet
      // seeds Config with placeholder ids counting up from 6, and a placeholder
      // looks exactly like a real one — so trusting it means every question for
      // that subject is posted to a thread that was never created, or worse, to
      // whichever unrelated topic happens to hold that id.
      const exists = await topicExists(group.telegramGroupId, row.topic_thread_id, title);
      if (exists) {
        console.log(`   ⏭  ${title} — thread ${row.topic_thread_id} exists`);
        skipped += 1;
        continue;
      }
      console.log(`   ⚠  ${title} — thread ${row.topic_thread_id} does not exist, recreating`);
      row.topic_thread_id = '';
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
