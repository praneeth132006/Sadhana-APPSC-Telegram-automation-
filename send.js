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

// Load unified data manager — automatically routes to Google Sheets or local Excel
// This brings live cloud sync when GOOGLE_SHEET_WEBAPP_URL is set in .env
const data = require('./src/data');
// Load Telegram bot module to handle API calls to Telegram supergroup
const telegram = require('./src/telegram');

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
  // Format subject display string: prepend emoji only if configured, otherwise use clean name
  const displayTitle = subjectConfig.emoji ? `${subjectConfig.emoji} ${subjectConfig.subject}` : subjectConfig.subject;
  // Print active subject header to console
  console.log(`\n📚 Subject: ${displayTitle}`);
  // Log assigned topic thread ID or warning if not yet assigned
  console.log(`   Topic Thread ID: ${subjectConfig.topic_thread_id || '❌ Not set'}`);

  // Check if this subject has a Telegram topic configured
  if (!subjectConfig.topic_thread_id) {
    console.error(`   ❌ No Topic_Thread_ID set for "${subjectConfig.subject}". Run: node setup.js`);
    return;
  }

  // Fetch unposted questions asynchronously from active data backend (Google Sheets or Excel)
  // This ensures questions that were not yet posted are retrieved up to the requested batch limit
  const questions = await data.getUnpostedQuestions(subjectConfig.subject, questionsCount);

  // If no unposted questions remain, inform the user
  if (questions.length === 0) {
    console.log(`   📭 No unposted questions remaining for "${subjectConfig.subject}"`);
    return;
  }

  console.log(`   📤 Sending ${questions.length} question(s)...`);

  // Track which rows were successfully posted (for marking in Google Sheets / Excel)
  const postedRowIndices = [];

  // Send each question one by one with a delay between them
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];

    try {
      // Send the quiz poll to the subject's Telegram forum topic
      await telegram.sendQuizPoll(subjectConfig.topic_thread_id, q);

      // Track 0-based data row index for marking as posted in Excel or Google Sheets
      // This ensures the exact row is marked with timestamp upon successful delivery
      postedRowIndices.push(q.row_index !== undefined ? q.row_index : q.excel_row);

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

  // Mark all successfully posted questions in Google Sheets or local Excel
  if (postedRowIndices.length > 0) {
    // Call unified markAsPosted to update the "Posted" column with timestamp
    await data.markAsPosted(subjectConfig.subject, postedRowIndices);
    console.log(`   📝 ${postedRowIndices.length} question(s) marked as posted in ${data.getDataSourceName()}`);
  }
}

/**
 * showStatsOnly — Prints a summary of question counts per subject.
 * Fetches stats asynchronously from the active data source (Google Sheets or Excel).
 */
async function showStatsOnly() {
  console.log('\n📊 Question Statistics');
  // Log the active data source so the user knows whether Google Sheets or Excel is in use
  console.log(`📡 Data Source: ${data.getDataSourceName()}`);
  console.log('═══════════════════════════════════════════════');

  // Read the subject configuration asynchronously to get the list of active subjects
  const config = await data.readConfig();

  // If no subjects are configured, inform the user
  if (!config || config.length === 0) {
    console.log('❌ No subjects found in configuration');
    return;
  }

  // Extract subject names from the configuration array
  const subjectNames = config.map(c => c.subject);

  // Retrieve statistics for all subjects asynchronously
  const stats = await data.getStats(subjectNames);

  // Accumulators for overall totals across all subjects
  let totalAll = 0, postedAll = 0, pendingAll = 0;

  // Print each subject's stats in a formatted row
  for (const s of stats) {
    // Find matching configuration to get the optional emoji icon
    const cfg = config.find(c => c.subject === s.subject);
    // Include emoji prefix only if explicitly provided in configuration
    const emojiPrefix = cfg && cfg.emoji ? `${cfg.emoji} ` : '';

    // Print formatted summary line with aligned columns
    console.log(`  ${emojiPrefix}${s.subject.padEnd(25)} │ Total: ${String(s.total).padStart(4)} │ Posted: ${String(s.posted).padStart(4)} │ Pending: ${String(s.pending).padStart(4)}`);

    // Add to running totals
    totalAll += s.total;
    postedAll += s.posted;
    pendingAll += s.pending;
  }

  // Print summary totals footer
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
  // Display active data source at launch
  console.log(`📡 Storage: ${data.getDataSourceName()}`);

  // ---- Stats mode: just show stats and exit ----
  if (showStats) {
    // Await stats output asynchronously before exiting
    await showStatsOnly();
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
    // Fetch configuration asynchronously from Google Sheets or Excel
    config = await data.readConfig();
  } catch (error) {
    console.error(`\n❌ Failed to read configuration: ${error.message}`);
    console.error('   Verify your .env settings or run: node create-sample.js\n');
    process.exit(1);
  }

  // Ensure config has at least one subject
  if (!config || config.length === 0) {
    console.error('\n❌ No subjects found in configuration');
    process.exit(1);
  }

  // ---- Send mode: send from all subjects ----
  if (sendAll) {
    console.log(`\n📤 Sending ${count} question(s) from each subject...\n`);

    // Iterate through all configured subjects and send questions
    for (const cfg of config) {
      await sendQuestionsForSubject(cfg, count);
    }

    // Show updated stats asynchronously after sending
    await showStatsOnly();
    return;
  }

  // ---- Send mode: send from a specific subject ----
  if (subject) {
    // Find the subject in config (case-insensitive match)
    const cfg = config.find(c => c.subject.toLowerCase() === subject.toLowerCase());

    if (!cfg) {
      console.error(`\n❌ Subject "${subject}" not found in configuration`);
      console.log(`   Available subjects: ${config.map(c => c.subject).join(', ')}\n`);
      process.exit(1);
    }

    console.log(`\n📤 Sending ${count} question(s) from "${cfg.subject}"...\n`);
    // Send batch of questions for the selected subject
    await sendQuestionsForSubject(cfg, count);

    // Show updated stats asynchronously after sending
    await showStatsOnly();
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

  // Also show current stats asynchronously
  await showStatsOnly();
}

// Run the main function and handle any unexpected errors
main().catch(error => {
  console.error(`\n💥 Unexpected error: ${error.message}\n`);
  process.exit(1);
});
