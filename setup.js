// ============================================================================
// setup.js — One-time setup: creates Telegram forum topics for each APPSC subject
// ============================================================================
// Run this ONCE after configuring your bot and group.
// It reads subjects from config.xlsx (or Google Sheets), creates a Telegram forum topic
// for each subject, and saves the topic_thread_ids back to config.xlsx.
//
// Usage:
//   node setup.js
//   node setup.js https://t.me/c/3814998988/1   <-- You can also pass topic/group link directly!
//
// Prerequisites:
//   1. Create a bot via @BotFather and get the token (configured in .env)
//   2. Create a supergroup with Topics enabled
//   3. Add the bot as admin with "Manage topics" permission
//   4. Pass group ID in .env, as a CLI argument, or send /start in group for auto-detection!
// ============================================================================

// Load environment variables from .env file into process.env
require('dotenv').config();
// Import Node.js built-in file system module for reading and updating .env file
const fs = require('fs');
// Import path module for resolving file paths
const path = require('path');

// Load unified data manager — connects to Google Sheets if GOOGLE_SHEET_WEBAPP_URL is set, or local Excel
const data = require('./src/data');
// Load Telegram bot module to interact with Telegram Supergroups and forum topics
const telegram = require('./src/telegram');

/**
 * saveGroupIdToEnv — Persists discovered or provided group ID to the local .env file.
 * What it does: Replaces TELEGRAM_GROUP_ID in .env with the actual group ID so user doesn't have to manually edit it.
 * What it brings: Seamless persistence across subsequent runs of send.js and schedule.js.
 * Where changes can be seen: In the .env file on the root workspace directory.
 *
 * @param {string} newGroupId — The Telegram group chat ID (starting with -100)
 */
function saveGroupIdToEnv(newGroupId) {
  // Resolve absolute path to .env file in the workspace
  const envPath = path.resolve(__dirname, '.env');
  // Check if .env file exists on the filesystem
  if (fs.existsSync(envPath)) {
    // Read the current contents of the .env file
    const content = fs.readFileSync(envPath, 'utf8');
    // Replace TELEGRAM_GROUP_ID line with the newly discovered ID
    const updated = content.replace(/TELEGRAM_GROUP_ID=.*/, `TELEGRAM_GROUP_ID=${newGroupId}`);
    // Write back the modified content to .env
    fs.writeFileSync(envPath, updated, 'utf8');
    // Log confirmation message
    console.log(`💾 Automatically saved TELEGRAM_GROUP_ID=${newGroupId} to .env file.`);
  }
}

/**
 * main — Reads config, creates Telegram topics, saves thread IDs back to config.
 * What it does: Orchestrates group discovery, connection testing, topic creation for 16 subjects, and config persistence.
 * What it brings: End-to-end automated setup of all APPSC sub-groups in Telegram.
 * Where changes can be seen: New forum topics in Telegram supergroup and updated Thread IDs in config.xlsx.
 */
async function main() {
  console.log('');
  console.log('🔧 ═══════════════════════════════════════════');
  console.log('🔧  Sadhana APPSC — Topic Setup (16 Subjects)');
  console.log('🔧 ═══════════════════════════════════════════');
  // Log active data storage backend (Google Sheets or Excel)
  console.log(`📡 Storage: ${data.getDataSourceName()}`);

  // ---- Check bot token ----
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error('\n❌ Missing TELEGRAM_BOT_TOKEN in .env file!');
    console.error('   Please add your Bot Token to .env and run again.\n');
    process.exit(1);
  }

  // ---- Check CLI arguments for group link or raw group ID ----
  // Read all command-line arguments passed after script name
  const args = process.argv.slice(2);
  // Store resolved group ID
  let groupId = process.env.TELEGRAM_GROUP_ID || '';

  // Check if user passed a link or group ID in CLI arguments (e.g. node setup.js https://t.me/c/...)
  for (const arg of args) {
    const extracted = telegram.extractGroupIdFromLink(arg);
    if (extracted) {
      groupId = extracted;
      console.log(`🔗 Extracted Group ID from argument: ${groupId}`);
      break;
    }
  }

  // Initialize bot with current token and resolved or placeholder group ID
  telegram.init(process.env.TELEGRAM_BOT_TOKEN, groupId);

  // ---- Auto-detect Group ID if not yet configured or is placeholder ----
  if (!groupId || groupId.includes('xxx')) {
    console.log('\n🔍 Supergroup ID not specified in .env. Attempting automatic detection...');
    // Scan recent bot updates for supergroup interactions
    const detected = await telegram.detectGroupId();

    if (detected && detected.id) {
      // Group discovered automatically via Bot API updates
      groupId = detected.id;
      console.log(`🎉 Discovered Supergroup: "${detected.title}" (ID: ${groupId})`);
      // Update telegram module's internal group ID
      telegram.setGroupId(groupId);
      // Persist to .env file for future executions
      saveGroupIdToEnv(groupId);
    } else {
      // Group could not be automatically discovered
      console.error('\n⚠️ Group ID is not configured yet!');
      console.error('   How to provide your group:');
      console.error('   1. Run with group link: node setup.js <link_or_group_id>');
      console.error('      Example: node setup.js https://t.me/c/3814998988/1');
      console.error('   2. OR type /start or @sadhanamainbot inside your Telegram group, then re-run: node setup.js');
      console.error('   3. OR paste TELEGRAM_GROUP_ID directly into .env file.\n');
      process.exit(1);
    }
  }

  // ---- Test connection first ----
  console.log('\n🧪 Testing Telegram connection...');
  const connected = await telegram.testConnection();
  if (!connected) {
    console.error('\n❌ Cannot connect to Telegram supergroup.');
    console.error('   Ensure:');
    console.error('   1. The bot is added to your supergroup as an ADMINISTRATOR.');
    console.error('   2. The bot has "Manage Topics" admin permission turned ON.');
    console.error('   3. Supergroup Topics are enabled in Group Settings > Topics.\n');
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

  // Verify that configuration contains at least one subject
  if (!config || config.length === 0) {
    console.error('\n❌ No subjects found in configuration. Run: node create-sample.js first.\n');
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
      // Create the forum topic with emoji + subject name as the title in Telegram supergroup
      const threadId = await telegram.createForumTopic(`${cfg.emoji} ${cfg.subject}`);

      // Save the thread ID back to the config object
      cfg.topic_thread_id = threadId;
      created++;

      // Small 1 second delay to respect Telegram API rate limits
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
    console.log(`   ${cfg.emoji} ${cfg.subject.padEnd(25)} → ${status}`);
  }
  console.log('───────────────────────────────────────────\n');
}

// Run and handle unexpected top-level exceptions
main().catch(error => {
  console.error(`\n💥 Setup failed: ${error.message}\n`);
  process.exit(1);
});
