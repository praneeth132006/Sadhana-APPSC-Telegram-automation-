// ============================================
// schedule.js — Runs automated scheduled posting using cron expressions
// ============================================
// This script reads schedule configurations from config.xlsx and creates
// cron jobs that automatically send questions at regular intervals.
// It runs continuously in the background until you stop it (Ctrl+C).
//
// Usage:
//   node schedule.js             → Start all active schedules from config.xlsx
//   node schedule.js --dry-run   → Show what would run without actually sending
//
// Schedule config is read from config.xlsx:
//   - Schedule_Cron: cron expression (e.g., "0 */2 * * *" = every 2 hours)
//   - Questions_Per_Batch: how many questions per run
//   - Active: YES/NO to enable/disable a schedule
//
// Common cron expressions:
//   */30 * * * *    → Every 30 minutes
//   0 * * * *       → Every hour
//   0 */2 * * *     → Every 2 hours
//   0 9 * * *       → Daily at 9 AM
//   0 9,18 * * *    → Daily at 9 AM and 6 PM
//   0 8,14,20 * * * → Three times a day (8 AM, 2 PM, 8 PM)

require('dotenv').config(); // Load .env file variables into process.env

const cron = require('node-cron');          // Cron-based job scheduler
const excel = require('./src/excel');       // Excel read/write module
const telegram = require('./src/telegram'); // Telegram bot module

// Check for --dry-run flag (show schedule but don't actually run)
const isDryRun = process.argv.includes('--dry-run');

/**
 * sleep — Promise-based delay function for rate limiting.
 * @param {number} ms — Milliseconds to wait
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * sendBatch — Sends a batch of unposted questions for a subject.
 * Called by the cron job when it fires.
 *
 * @param {Object} cfg — Config object for the subject (from config.xlsx)
 */
async function sendBatch(cfg) {
  // Get a timestamp for logging
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  console.log(`\n⏰ [${now}] Cron fired for: ${cfg.emoji} ${cfg.subject}`);

  // Get unposted questions from the Excel file
  const questions = excel.getUnpostedQuestions(cfg.subject, cfg.questions_per_batch);

  if (questions.length === 0) {
    console.log(`   📭 No unposted questions remaining for "${cfg.subject}"`);
    return;
  }

  console.log(`   📤 Sending ${questions.length} question(s)...`);

  // Track successfully posted row indices for marking in Excel
  const postedRows = [];

  // Send each question with a delay between them
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    try {
      // Send the quiz poll to Telegram
      await telegram.sendQuizPoll(cfg.topic_thread_id, q);
      postedRows.push(q.row_index); // Track this row for Excel update

      // Log success
      const preview = q.question_text.substring(0, 50);
      console.log(`   ✅ [${i + 1}/${questions.length}] ${preview}...`);

      // Rate limit delay
      if (i < questions.length - 1) await sleep(1500);
    } catch (error) {
      console.error(`   ❌ [${i + 1}/${questions.length}] Failed: ${error.message}`);
    }
  }

  // Mark posted questions in the Excel file
  if (postedRows.length > 0) {
    excel.markAsPosted(cfg.subject, postedRows);
    console.log(`   📝 ${postedRows.length} question(s) marked as posted`);
  }
}

/**
 * main — Reads config, sets up cron jobs, and runs them.
 */
async function main() {
  console.log('');
  console.log('⏰ ═══════════════════════════════════════════');
  console.log('⏰  Sadhana APPSC — Scheduled Posting');
  console.log('⏰ ═══════════════════════════════════════════');

  // ---- Check environment variables ----
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_GROUP_ID) {
    console.error('\n❌ Missing environment variables!');
    console.error('   Set TELEGRAM_BOT_TOKEN and TELEGRAM_GROUP_ID in your .env file.\n');
    process.exit(1);
  }

  // ---- Initialize Telegram bot ----
  telegram.init(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_GROUP_ID);

  // ---- Test connection ----
  console.log('\n🧪 Testing Telegram connection...');
  const connected = await telegram.testConnection();
  if (!connected) {
    console.error('\n❌ Cannot connect to Telegram. Fix settings and try again.\n');
    process.exit(1);
  }

  // ---- Read config ----
  let config;
  try {
    config = excel.readConfig();
  } catch (error) {
    console.error(`\n❌ Failed to read config.xlsx: ${error.message}\n`);
    process.exit(1);
  }

  // Filter to only active schedules that have both a cron expression and topic thread ID
  const activeSchedules = config.filter(c =>
    c.active &&                  // Schedule is marked as Active = YES
    c.schedule_cron &&           // Has a cron expression defined
    c.topic_thread_id            // Has a Telegram topic to send to
  );

  if (activeSchedules.length === 0) {
    console.log('\n📭 No active schedules found in config.xlsx');
    console.log('   Make sure subjects have:');
    console.log('   - Schedule_Cron column filled (e.g., "0 */2 * * *")');
    console.log('   - Topic_Thread_ID set (run: node setup.js)');
    console.log('   - Active column set to YES\n');
    process.exit(0);
  }

  // ---- Display schedule info ----
  console.log(`\n📋 Active Schedules (${activeSchedules.length}):`);
  console.log('───────────────────────────────────────────────');
  for (const cfg of activeSchedules) {
    console.log(`   ${cfg.emoji} ${cfg.subject.padEnd(20)} │ Cron: ${cfg.schedule_cron.padEnd(16)} │ Batch: ${cfg.questions_per_batch}`);
  }
  console.log('───────────────────────────────────────────────');

  // ---- Dry run mode: show schedules without starting them ----
  if (isDryRun) {
    console.log('\n🏃 Dry run mode — schedules shown but NOT started.\n');
    return;
  }

  // ---- Start cron jobs ----
  console.log('\n🚀 Starting cron jobs...\n');

  for (const cfg of activeSchedules) {
    // Validate the cron expression before creating the job
    if (!cron.validate(cfg.schedule_cron)) {
      console.error(`   ❌ Invalid cron expression for "${cfg.subject}": "${cfg.schedule_cron}"`);
      continue;
    }

    // Create and start the cron job
    cron.schedule(cfg.schedule_cron, () => {
      // The callback runs every time the cron fires
      sendBatch(cfg).catch(err => {
        console.error(`   ❌ Error in schedule for "${cfg.subject}": ${err.message}`);
      });
    });

    console.log(`   ✅ Started: ${cfg.emoji} ${cfg.subject} → "${cfg.schedule_cron}"`);
  }

  console.log('\n⏰ Scheduler is running. Press Ctrl+C to stop.\n');

  // ---- Keep the process alive ----
  // The cron jobs run in the background, so we need to prevent the process from exiting
  // This handler also provides a clean shutdown message
  process.on('SIGINT', () => {
    console.log('\n\n⏹️  Scheduler stopped. Goodbye!\n');
    process.exit(0);
  });
}

// Run and handle errors
main().catch(error => {
  console.error(`\n💥 Scheduler failed: ${error.message}\n`);
  process.exit(1);
});
