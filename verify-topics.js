// ============================================================================
// verify-topics.js — check that every subject's Telegram forum topic exists
// ============================================================================
// Telegram's Bot API has no method to LIST forum topics, so the only way to
// test whether a thread id is real is to address it. This script uses
// `editForumTopic` with the topic's name set to exactly what it should already
// be — a no-op rename that succeeds when the topic exists and fails when it
// does not.
//
//   node verify-topics.js            # check every configured subject
//   node verify-topics.js --fix      # additionally create any missing topics
//
// --fix creates topics for subjects whose thread id does not resolve, and
// writes the new ids back to the Config tab. Without it nothing is changed
// beyond the no-op rename.
// ============================================================================

require('dotenv').config();

const https = require('https');
const data = require('./src/data');
const telegram = require('./src/telegram');

/** Whether the caller asked us to create missing topics. */
const shouldFix = process.argv.includes('--fix');

/**
 * callTelegram — minimal Bot API caller, so this script does not depend on the
 * wrapper's method surface.
 *
 * @param {string} method Bot API method name
 * @param {Object} payload JSON body
 * @returns {Promise<Object>} Parsed API response
 */
function callTelegram(method, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(text)); } catch (err) { reject(new Error('Bad response: ' + text.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** Pauses between API calls to stay inside Telegram's rate limits. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_GROUP_ID) {
    console.error('❌ Set TELEGRAM_BOT_TOKEN and TELEGRAM_GROUP_ID in .env first.');
    process.exit(1);
  }

  telegram.init(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_GROUP_ID);

  // Confirm the group itself is a forum before checking individual topics.
  const chat = await callTelegram('getChat', { chat_id: process.env.TELEGRAM_GROUP_ID });
  if (!chat.ok) {
    console.error(`❌ Cannot read the group: ${chat.description}`);
    console.error('   Check TELEGRAM_GROUP_ID and that the bot is still a member.');
    process.exit(1);
  }

  console.log(`\n📡 Group: "${chat.result.title}"`);
  console.log(`   Topics enabled: ${chat.result.is_forum ? '✅ yes' : '❌ NO — enable Topics in group settings'}`);

  if (!chat.result.is_forum) {
    console.error('\n   Without Topics enabled there are no threads to post into. Stopping.\n');
    process.exit(1);
  }

  const config = await data.readConfig();
  console.log(`\n🔍 Checking ${config.length} subject(s) against the group…\n`);

  const missing = [];
  let present = 0;

  for (const cfg of config) {
    const label = cfg.subject.padEnd(24);

    if (!cfg.topic_thread_id) {
      console.log(`   ${label} ⚠️  no thread id in Config`);
      missing.push(cfg);
      continue;
    }

    // The no-op rename: same name in, so a healthy topic is unchanged.
    const title = cfg.emoji ? `${cfg.emoji} ${cfg.subject}` : cfg.subject;
    const result = await callTelegram('editForumTopic', {
      chat_id: process.env.TELEGRAM_GROUP_ID,
      message_thread_id: cfg.topic_thread_id,
      name: title
    });

    if (result.ok) {
      console.log(`   ${label} ✅ thread ${cfg.topic_thread_id} exists`);
      present++;
    } else {
      console.log(`   ${label} ❌ thread ${cfg.topic_thread_id} — ${result.description}`);
      missing.push(cfg);
    }

    await sleep(400);
  }

  console.log(`\n📊 ${present} present, ${missing.length} missing or unreachable.`);

  if (!missing.length) {
    console.log('\n✅ Every subject has a working Telegram topic.\n');
    return;
  }

  if (!shouldFix) {
    console.log('\n   Re-run with --fix to create the missing topics and write the new ids to Config:');
    console.log('   node verify-topics.js --fix\n');
    return;
  }

  console.log('\n🛠️  Creating missing topics…\n');

  for (const cfg of missing) {
    const title = cfg.emoji ? `${cfg.emoji} ${cfg.subject}` : cfg.subject;
    const created = await callTelegram('createForumTopic', {
      chat_id: process.env.TELEGRAM_GROUP_ID,
      name: title
    });

    if (created.ok) {
      cfg.topic_thread_id = created.result.message_thread_id;
      console.log(`   ${cfg.subject.padEnd(24)} ✅ created thread ${cfg.topic_thread_id}`);
    } else {
      console.log(`   ${cfg.subject.padEnd(24)} ❌ ${created.description}`);
    }
    await sleep(600);
  }

  await data.writeConfig(config);
  console.log('\n📝 Config updated with the new thread ids.\n');
}

main().catch((err) => {
  console.error('\n❌ ' + err.message + '\n');
  process.exit(1);
});
