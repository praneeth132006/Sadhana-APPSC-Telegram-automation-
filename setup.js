// ============================================
// setup.js — One-time setup: creates Telegram forum topics for each subject
// ============================================
// Run this ONCE after configuring your bot and group.
// It reads subjects from config.xlsx, creates a Telegram forum topic
// for each subject, and saves the topic_thread_ids back to config.xlsx.
//
// Usage:
//   node setup.js
//
// Prerequisites:
//   1. Create a bot via @BotFather and get the token
//   2. Create a supergroup with Topics enabled
//   3. Add the bot as admin with "Manage topics" permission
//   4. Get the group ID (add @raw_data_bot to the group)
//   5. Fill in .env with TELEGRAM_BOT_TOKEN and TELEGRAM_GROUP_ID
//   6. Fill in config.xlsx with your subject names and emojis

require('dotenv').config(); // Load .env file variables into process.env

// Load unified data manager — connects to Google Sheets if GOOGLE_SHEET_WEBAPP_URL is set, or local Excel
const data = require('./src/data');
// Load Telegram bot module to interact with Telegram Supergroups and forum topics
const telegram = require('./src/telegram');

/**
 * main — Reads config, creates Telegram topics, saves thread IDs back to config.
 */
async function main() {
  console.log('');
  console.log('🔧 ═══════════════════════════════════════════');
  console.log('🔧  Sadhana APPSC — Topic Setup');
  console.log('🔧 ═══════════════════════════════════════════');
  // Log active data storage backend
  console.log(`📡 Storage: ${data.getDataSourceName()}`);

  // ---- Check environment variables ----
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_GROUP_ID) {
    console.error('\n❌ Missing environment variables!');
    console.error('   Set TELEGRAM_BOT_TOKEN and TELEGRAM_GROUP_ID in your .env file.');
    console.error('   See .env.example for the template.\n');
    process.exit(1);
  }

  // ---- Initialize the Telegram bot ----
  telegram.init(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_GROUP_ID);

  // ---- Test connection first ----
  console.log('\n🧪 Testing Telegram connection...');
  const connected = await telegram.testConnection();
  if (!connected) {
    console.error('\n❌ Cannot connect to Telegram. Fix your .env settings and try again.\n');
    process.exit(1);
  }

  // ---- Read the config file asynchronously ----
  let config;
  try {
    // Read subject configuration from active data source (Google Sheets or Excel)
    config = await data.readConfig();
  } catch (error) {
    console.error(`\n❌ Failed to read configuration: ${error.message}`);
    console.error('   Verify your settings or run: node create-sample.js\n');
    process.exit(1);
  }

  if (!config || config.length === 0) {
    console.error('\n❌ No subjects found in configuration. Add subjects first.\n');
    process.exit(1);
  }

  // ---- Create forum topics for each subject ----
  console.log(`\n📌 Creating ${config.length} forum topic(s)...\n`);

  let created = 0;  // Counter for successfully created topics
  let skipped = 0;  // Counter for topics that already exist

  for (const cfg of config) {
    // Skip subjects that already have a topic thread ID assigned
    if (cfg.topic_thread_id) {
      console.log(`   ⏭️  "${cfg.emoji} ${cfg.subject}" — Already has Thread ID: ${cfg.topic_thread_id}`);
      skipped++;
      continue;
    }

    try {
      // Create the forum topic with emoji + subject name as the title
      const threadId = await telegram.createForumTopic(`${cfg.emoji} ${cfg.subject}`);

      // Save the thread ID back to the config object
      cfg.topic_thread_id = threadId;
      created++;

      // Small delay to avoid Telegram rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`   ❌ Failed to create topic for "${cfg.subject}": ${error.message}`);
    }
  }

  // ---- Save updated config with topic thread IDs ----
  if (created > 0) {
    // Write the updated configuration back to Google Sheets or local Excel
    await data.writeConfig(config);
    console.log(`\n✅ Created ${created} new topic(s), skipped ${skipped} existing.`);
    console.log(`   Topic Thread IDs saved to ${data.getDataSourceName()}\n`);
  } else {
    console.log(`\n✅ All ${skipped} topic(s) already exist. Nothing to create.\n`);
  }

  // ---- Print summary ----
  console.log('📋 Subject → Topic Mapping:');
  console.log('───────────────────────────────────────────');
  for (const cfg of config) {
    const status = cfg.topic_thread_id ? `Thread ID: ${cfg.topic_thread_id}` : '❌ Not created';
    console.log(`   ${cfg.emoji} ${cfg.subject.padEnd(20)} → ${status}`);
  }
  console.log('───────────────────────────────────────────\n');
}

// Run and handle errors
main().catch(error => {
  console.error(`\n💥 Setup failed: ${error.message}\n`);
  process.exit(1);
});
