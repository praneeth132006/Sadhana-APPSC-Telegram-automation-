// ============================================================================
// rename-topics.js — Removes emojis and custom icons from all 16 Telegram topics
// ============================================================================
// This script iterates through all 16 APPSC forum topics and updates their titles
// using Telegram's editForumTopic API method to clean plain text (no emojis)
// and clears any custom icon emojis.
//
// Where changes can be seen:
// - Directly in the Telegram supergroup left sidebar / topic drawer
// ============================================================================

// Load environment variables from .env
require('dotenv').config();
// Import https module to invoke Telegram Bot API directly
const https = require('https');

// Array mapping thread IDs to clean plain-text topic titles without emojis or icons
const topics = [
  { id: 6, name: 'History' },
  { id: 7, name: 'AP History' },
  { id: 8, name: 'Geography' },
  { id: 9, name: 'AP Geography' },
  { id: 10, name: 'Economy' },
  { id: 11, name: 'AP Economy' },
  { id: 12, name: 'Polity' },
  { id: 13, name: 'Society' },
  { id: 14, name: 'Current Affairs' },
  { id: 15, name: 'Science and Technology' },
  { id: 16, name: 'Biology' },
  { id: 17, name: 'Chemistry' },
  { id: 18, name: 'Physics' },
  { id: 19, name: 'Environment' },
  { id: 20, name: 'General Studies' },
  { id: 21, name: 'Disaster Management' }
];

/**
 * editTopic — Calls Telegram Bot API editForumTopic endpoint.
 * What it does: Updates topic name to plain text and resets icon_custom_emoji_id.
 * What it brings: Clean aesthetic in the Telegram client UI without emojis.
 * Where changes can be seen: Telegram iOS/Android/Desktop topics drawer.
 *
 * @param {string} token - Telegram Bot Token
 * @param {string|number} chatId - Telegram Supergroup Chat ID
 * @param {number} threadId - Message thread ID of the forum topic
 * @param {string} newName - Clean topic name without emojis
 * @returns {Promise<Object>} API JSON response
 */
function editTopic(token, chatId, threadId, newName) {
  // Wrap HTTP request inside a Promise for clean async/await syntax
  return new Promise((resolve, reject) => {
    // Construct JSON payload with plain name and empty icon custom emoji id
    const payload = JSON.stringify({
      chat_id: chatId,
      message_thread_id: threadId,
      name: newName,
      icon_custom_emoji_id: ''
    });

    // Configure HTTPS request options targeting Telegram Bot API
    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${token}/editForumTopic`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    // Initiate HTTPS POST request
    const req = https.request(options, res => {
      let body = '';
      // Accumulate response data chunks
      res.on('data', chunk => { body += chunk; });
      // Resolve promise when entire response has been received
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve({ ok: false, error: body });
        }
      });
    });

    // Handle connection or request error
    req.on('error', err => reject(err));
    // Write request body payload to connection stream
    req.write(payload);
    // Terminate request transmission
    req.end();
  });
}

/**
 * main — Iterates through all 16 topics and updates their names.
 * What it does: Sequences API calls with small delay to avoid Telegram rate limits.
 * What it brings: Bulk updates all 16 topics reliably.
 * Where changes can be seen: Telegram supergroup interface.
 */
async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_GROUP_ID;

  console.log(`\n🧹 Renaming ${topics.length} topics to plain text without icons...\n`);

  for (const topic of topics) {
    try {
      const res = await editTopic(token, chatId, topic.id, topic.name);
      if (res.ok) {
        console.log(`   ✅ Thread ID ${String(topic.id).padStart(2)} → "${topic.name}"`);
      } else {
        console.error(`   ❌ Thread ID ${topic.id} failed: ${res.description || JSON.stringify(res)}`);
      }
      // 300ms pause to adhere to Telegram API rate limits
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error(`   ❌ Thread ID ${topic.id} error: ${err.message}`);
    }
  }

  console.log('\n✨ All topic names updated to clean plain text!\n');
}

// Execute main process
main();
