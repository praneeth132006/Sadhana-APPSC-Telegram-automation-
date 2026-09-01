// ============================================
// Telegram Service — Sends quiz polls to Telegram forum topics
// ============================================
// This module handles all Telegram Bot API interactions:
// - Initializing the bot with the token from .env
// - Creating forum topics for each subject in the supergroup
// - Sending quiz-type polls with correct answer + 💡 explanation
// - Testing the bot connection
//
// The bot must be an admin in the supergroup with "Manage topics" permission.
// Changes are visible in the Telegram supergroup as new topics and quiz polls.

const TelegramBot = require('node-telegram-bot-api'); // Telegram Bot API wrapper library

let bot = null;     // Module-level variable to hold the bot instance
let groupId = null;  // Module-level variable to store the supergroup chat ID

/**
 * init — Creates and configures the Telegram bot instance.
 * Uses polling: false because we only SEND messages, never receive commands.
 *
 * @param {string} token — Bot token from @BotFather
 * @param {string} chatGroupId — Supergroup chat ID (starts with -100...)
 */
function init(token, chatGroupId) {
  // Create the bot — polling disabled since we only send, never listen
  bot = new TelegramBot(token, { polling: false });
  // Store the group ID for use in all send functions
  groupId = chatGroupId;
  console.log('🤖 Telegram bot initialized');
}

/**
 * testConnection — Verifies the bot token is valid and the group is accessible.
 * Prints bot info and group info to the console.
 *
 * @returns {Promise<boolean>} true if connection is successful, false otherwise
 */
async function testConnection() {
  // Check if init() was called first
  if (!bot) {
    console.error('❌ Bot not initialized. Call init() first.');
    return false;
  }

  try {
    // Test 1: Verify bot token by calling getMe
    const botInfo = await bot.getMe();
    console.log(`✅ Bot connected: @${botInfo.username} (${botInfo.first_name})`);

    // Test 2: Verify group access by calling getChat
    const chat = await bot.getChat(groupId);
    console.log(`✅ Group found: "${chat.title}" (type: ${chat.type})`);
    console.log(`   Forum topics: ${chat.is_forum ? '✅ Enabled' : '❌ Disabled'}`);

    return true;
  } catch (error) {
    // Print the specific error for debugging
    console.error(`❌ Connection failed: ${error.message}`);
    return false;
  }
}

/**
 * createForumTopic — Creates a new forum topic (thread) in the supergroup.
 * Each APPSC subject gets its own topic so questions are organized.
 *
 * @param {string} name — Topic name (e.g., "⚖️ Polity")
 * @returns {Promise<number>} The message_thread_id of the created topic
 */
async function createForumTopic(name) {
  if (!bot) throw new Error('Bot not initialized');

  // Call Telegram API to create a new forum topic in the supergroup
  // The bot must have "Manage topics" admin permission for this to work
  const topic = await bot.createForumTopic(groupId, name, {
    icon_color: 0x6FB9F0 // Light blue icon color
  });

  // Log the created topic details
  console.log(`📌 Created topic: "${name}" → Thread ID: ${topic.message_thread_id}`);

  // Return the thread ID — needed for sending messages to this topic
  return topic.message_thread_id;
}

/**
 * sendQuizPoll — Sends a quiz-type poll to a specific forum topic.
 * The poll shows 4 options, marks the correct one, and shows
 * an explanation via the 💡 (lightbulb) icon after the user answers.
 *
 * @param {number} threadId — The message_thread_id of the target forum topic
 * @param {Object} question — Question object from the Excel parser
 * @param {string} question.question_text — The question text
 * @param {string} question.option_a — Option A text
 * @param {string} question.option_b — Option B text
 * @param {string} question.option_c — Option C text
 * @param {string} question.option_d — Option D text
 * @param {string} question.correct_answer — Correct answer letter (A/B/C/D)
 * @param {string} question.explanation — Explanation for the 💡 popup
 * @returns {Promise<Object>} The sent message object from Telegram
 */
async function sendQuizPoll(threadId, question) {
  if (!bot) throw new Error('Bot not initialized');

  // Build the array of 4 poll options
  const options = [
    question.option_a,  // Index 0 → Answer A
    question.option_b,  // Index 1 → Answer B
    question.option_c,  // Index 2 → Answer C
    question.option_d   // Index 3 → Answer D
  ];

  // Map correct answer letter (A/B/C/D) to 0-based index
  const correctMap = { 'A': 0, 'B': 1, 'C': 2, 'D': 3 };
  const correctIndex = correctMap[question.correct_answer];

  // Truncate explanation to 200 chars (Telegram's hard limit for quiz explanations)
  let explanation = question.explanation || '';
  if (explanation.length > 200) {
    explanation = explanation.substring(0, 197) + '...'; // Truncate with ellipsis
  }

  // Build poll configuration
  const pollConfig = {
    type: 'quiz',                       // Quiz mode — shows correct/incorrect after answering
    correct_option_id: correctIndex,     // Which option is the correct answer (0-based index)
    is_anonymous: false,                 // Show who voted (not anonymous)
    message_thread_id: threadId          // Send to specific forum topic thread
  };

  // Only add explanation if there's actual text to show
  if (explanation) {
    pollConfig.explanation = explanation;           // Text shown when user taps 💡
    pollConfig.explanation_parse_mode = 'HTML';     // Allow basic HTML formatting
  }

  // Send the quiz poll to the Telegram group, targeting the specific topic
  const sent = await bot.sendPoll(groupId, question.question_text, options, pollConfig);

  return sent; // Return the sent message object (contains message_id)
}

// Export all functions for use by send.js, setup.js, and scheduler.js
module.exports = { init, testConnection, createForumTopic, sendQuizPoll };
