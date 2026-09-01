// ============================================
// send.js — CLI tool to manually send questions to Telegram
// ============================================
// This is the main command-line entry point for manually sending
// quiz questions from the Excel file to Telegram forum topics.
//
// Usage:
//   node send.js --subject Polity --count 5     → Send 5 unposted Polity questions
//   node send.js --subject Economy              → Send 1 unposted Economy question (default)
//   node send.js --all --count 3                → Send 3 questions from EACH subject
//   node send.js --stats                        → Show question counts per subject
//   node send.js --test                         → Test Telegram connection
//
// The script reads questions from questions.xlsx, sends them as quiz polls
// to the correct Telegram forum topic, then marks them as "Posted" in the Excel file.

require('dotenv').config(); // Load .env file variables into process.env

const excel = require('./src/excel');       // Excel read/write module
const telegram = require('./src/telegram'); // Telegram bot module

// ============================================
// Parse command-line arguments
// ============================================
// Process.argv contains: [node_path, script_path, ...user_args]
const args = process.argv.slice(2); // Remove "node" and script path, keep user args

/**
 * getArgValue — Helper to extract a value after a named argument flag.
 * Example: getArgValue('--subject') returns 'Polity' from '--subject Polity'
 *
 * @param {string} flag — The flag to look for (e.g., '--subject')
 * @returns {string|null} The value after the flag, or null if not found
 */
function getArgValue(flag) {
  const index = args.indexOf(flag); // Find the position of the flag
  // Return the next argument after the flag, or null if not found
  return index !== -1 && args[index + 1] ? args[index + 1] : null;
}

/**
 * hasFlag — Helper to check if a flag exists in the arguments.
 *
 * @param {string} flag — The flag to check for (e.g., '--all')
 * @returns {boolean} true if the flag is present
 */
function hasFlag(flag) {
  return args.includes(flag);
}

// Extract command-line options
const subject = getArgValue('--subject');       // Which subject to send from
const count = Number(getArgValue('--count')) || 1; // How many questions to send (default: 1)
const sendAll = hasFlag('--all');                // Send from ALL subjects
const showStats = hasFlag('--stats');            // Show question stats only (don't send)
const testMode = hasFlag('--test');              // Test Telegram connection only

/**
 * sleep — Promise-based delay function.
 * Used between API calls to respect Telegram rate limits.
 *
 * @param {number} ms — Milliseconds to wait
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * sendQuestionsForSubject — Sends unposted questions for one subject to Telegram.
 * Reads from Excel, sends as quiz polls, marks as posted.
 *
 * @param {Object} subjectConfig — Config object for this subject (from config.xlsx)
 * @param {number} questionsCount — How many questions to send
 */
async function sendQuestionsForSubject(subjectConfig, questionsCount) {
  console.log(`\n📚 Subject: ${subjectConfig.emoji} ${subjectConfig.subject}`);
  console.log(`   Topic Thread ID: ${subjectConfig.topic_thread_id || '❌ Not set'}`);

  // Check if this subject has a Telegram topic configured
  if (!subjectConfig.topic_thread_id) {
    console.error(`   ❌ No Topic_Thread_ID set for "${subjectConfig.subject}". Run: node setup.js`);
    return;
  }

  // Get unposted questions from the Excel file
  const questions = excel.getUnpostedQuestions(subjectConfig.subject, questionsCount);

  // If no unposted questions remain, inform the user
  if (questions.length === 0) {
    console.log(`   📭 No unposted questions remaining for "${subjectConfig.subject}"`);
    return;
  }

  console.log(`   📤 Sending ${questions.length} question(s)...`);

  // Track which rows were successfully posted (for marking in Excel)
  const postedRowIndices = [];

  // Send each question one by one with a delay between them
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];

    try {
      // Send the quiz poll to the subject's Telegram forum topic
      await telegram.sendQuizPoll(subjectConfig.topic_thread_id, q);

      // Track this row for marking as posted
      postedRowIndices.push(q.row_index);

      // Log success with a preview of the question text
      const preview = q.question_text.length > 50
        ? q.question_text.substring(0, 50) + '...'
        : q.question_text;
      console.log(`   ✅ [${i + 1}/${questions.length}] ${preview}`);

      // Wait 1.5 seconds between sends to avoid Telegram rate limits
      // Telegram allows ~30 msg/sec but being conservative prevents 429 errors
      if (i < questions.length - 1) {
        await sleep(1500);
      }
    } catch (error) {
      // Log the error but continue with the next question
      console.error(`   ❌ [${i + 1}/${questions.length}] Failed: ${error.message}`);
    }
  }

  // Mark all successfully posted questions in the Excel file
  if (postedRowIndices.length > 0) {
    excel.markAsPosted(subjectConfig.subject, postedRowIndices);
    console.log(`   📝 ${postedRowIndices.length} question(s) marked as posted in Excel`);
  }
}

/**
 * showStatsOnly — Prints a summary of question counts per subject.
 * Reads from config.xlsx and questions.xlsx to show total/posted/pending.
 */
function showStatsOnly() {
  console.log('\n📊 Question Statistics');
  console.log('═══════════════════════════════════════════════');

  // Read the config to get the list of subjects
  const config = excel.readConfig();

  if (config.length === 0) {
    console.log('❌ No subjects found in config.xlsx');
    return;
  }

  // Get the subject names from config
  const subjectNames = config.map(c => c.subject);

  // Get stats for all subjects from the questions Excel file
  const stats = excel.getStats(subjectNames);

  // Print each subject's stats in a formatted table
  let totalAll = 0, postedAll = 0, pendingAll = 0;

  for (const s of stats) {
    // Find the emoji for this subject from config
    const cfg = config.find(c => c.subject === s.subject);
    const emoji = cfg ? cfg.emoji : '📚';

    // Print formatted line
    console.log(`  ${emoji} ${s.subject.padEnd(20)} │ Total: ${String(s.total).padStart(4)} │ Posted: ${String(s.posted).padStart(4)} │ Pending: ${String(s.pending).padStart(4)}`);

    totalAll += s.total;
    postedAll += s.posted;
    pendingAll += s.pending;
  }

  // Print totals
  console.log('───────────────────────────────────────────────');
  console.log(`  ${'TOTAL'.padEnd(22)} │ Total: ${String(totalAll).padStart(4)} │ Posted: ${String(postedAll).padStart(4)} │ Pending: ${String(pendingAll).padStart(4)}`);
  console.log('═══════════════════════════════════════════════\n');
}

/**
 * main — Entry point that runs the appropriate action based on CLI arguments.
 */
async function main() {
  // Print the app banner
  console.log('');
  console.log('🎯 ═══════════════════════════════════════════');
  console.log('🎯  Sadhana APPSC Quiz — Telegram Automation');
  console.log('🎯 ═══════════════════════════════════════════');

  // ---- Stats mode: just show stats and exit ----
  if (showStats) {
    showStatsOnly();
    return;
  }

  // ---- Initialize Telegram bot ----
  // Check that the required environment variables are set
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_GROUP_ID) {
    console.error('\n❌ Missing environment variables!');
    console.error('   Set TELEGRAM_BOT_TOKEN and TELEGRAM_GROUP_ID in your .env file.');
    console.error('   See .env.example for the template.\n');
    process.exit(1); // Exit with error code
  }

  // Initialize the Telegram bot with credentials from .env
  telegram.init(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_GROUP_ID);

  // ---- Test mode: just test connection and exit ----
  if (testMode) {
    console.log('\n🧪 Testing Telegram connection...');
    const ok = await telegram.testConnection();
    if (ok) {
      console.log('\n✅ Connection test passed! Your bot is ready.\n');
    } else {
      console.log('\n❌ Connection test failed. Check your .env settings.\n');
    }
    return;
  }

  // ---- Read config ----
  let config;
  try {
    config = excel.readConfig();
  } catch (error) {
    console.error(`\n❌ Failed to read config.xlsx: ${error.message}`);
    console.error('   Run: node create-sample.js to create sample files.\n');
    process.exit(1);
  }

  if (config.length === 0) {
    console.error('\n❌ No subjects found in config.xlsx');
    process.exit(1);
  }

  // ---- Send mode: send from all subjects ----
  if (sendAll) {
    console.log(`\n📤 Sending ${count} question(s) from each subject...\n`);

    for (const cfg of config) {
      await sendQuestionsForSubject(cfg, count);
    }

    // Show updated stats after sending
    showStatsOnly();
    return;
  }

  // ---- Send mode: send from a specific subject ----
  if (subject) {
    // Find the subject in config (case-insensitive match)
    const cfg = config.find(c => c.subject.toLowerCase() === subject.toLowerCase());

    if (!cfg) {
      console.error(`\n❌ Subject "${subject}" not found in config.xlsx`);
      console.log(`   Available subjects: ${config.map(c => c.subject).join(', ')}\n`);
      process.exit(1);
    }

    console.log(`\n📤 Sending ${count} question(s) from "${cfg.subject}"...\n`);
    await sendQuestionsForSubject(cfg, count);

    // Show updated stats after sending
    showStatsOnly();
    return;
  }

  // ---- No action specified: show help ----
  console.log('\n📖 Usage:');
  console.log('  node send.js --subject <name> --count <n>   Send n questions from a subject');
  console.log('  node send.js --all --count <n>              Send n questions from ALL subjects');
  console.log('  node send.js --stats                        Show question statistics');
  console.log('  node send.js --test                         Test Telegram bot connection');
  console.log('');
  console.log('📖 Examples:');
  console.log('  node send.js --subject Polity --count 5');
  console.log('  node send.js --subject Economy');
  console.log('  node send.js --all --count 3');
  console.log('  node send.js --stats');
  console.log('');

  // Also show current stats
  showStatsOnly();
}

// Run the main function and handle any unexpected errors
main().catch(error => {
  console.error(`\n💥 Unexpected error: ${error.message}\n`);
  process.exit(1);
});
