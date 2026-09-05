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
 * escapeHtml — Escapes special HTML characters (&, <, >) to avoid Telegram parse errors.
 *
 * @param {string} text — Raw unescaped string
 * @returns {string} Sanitized string safe for Telegram HTML parse_mode
 */
function escapeHtml(text) {
  // Replace HTML special characters with their corresponding entities
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * formatDateHashtag — Converts a date string into a Telegram-clickable hashtag.
 * What it does: Parses DD-MM-YYYY, YYYY-MM-DD, or full JS Date strings into #Date_DD_MM_YYYY (e.g. #Date_05_09_2026).
 * What it brings: Telegram requires hashtags to contain letters; prefixing with "Date_" ensures Telegram renders it as a blue clickable hashtag entity rather than plain text.
 * Where changes can be seen: Appended directly to the question prompt message in Telegram forum topics.
 *
 * @param {string|Date} dateStr — Date string or object from Google Sheets
 * @returns {string} Formatted hashtag like "#Date_05_09_2026", or empty string if invalid
 */
function formatDateHashtag(dateStr) {
  // Check if date argument is falsy or null
  if (!dateStr) return '';
  // Convert date input to string and strip surrounding whitespace
  const clean = String(dateStr).trim();
  // Return empty string if cleaned text has zero length
  if (!clean) return '';

  // Case 1: Match DD-MM-YYYY or DD/MM/YYYY format (e.g., "05-09-2026" or "5/9/2026")
  const ddmmyyyy = clean.match(/^(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{4})/);
  // If matched, format into canonical 2-digit day and month
  if (ddmmyyyy) {
    // Zero-pad day component to ensure 2 digits (e.g. "05")
    const day = ddmmyyyy[1].padStart(2, '0');
    // Zero-pad month component to ensure 2 digits (e.g. "09")
    const month = ddmmyyyy[2].padStart(2, '0');
    // Extract full 4-digit year component (e.g. "2026")
    const year = ddmmyyyy[3];
    // Return #Date_DD_MM_YYYY with "Date_" letter prefix for Telegram hashtag entity recognition
    return '#Date_' + day + '_' + month + '_' + year;
  }

  // Case 2: Match YYYY-MM-DD or YYYY/MM/DD ISO format (e.g., "2026-09-05")
  const yyyymmdd = clean.match(/^(\d{4})[\-\/](\d{1,2})[\-\/](\d{1,2})/);
  // If matched, format into canonical 2-digit day and month
  if (yyyymmdd) {
    // Extract full 4-digit year component
    const year = yyyymmdd[1];
    // Zero-pad month component to ensure 2 digits
    const month = yyyymmdd[2].padStart(2, '0');
    // Zero-pad day component to ensure 2 digits
    const day = yyyymmdd[3].padStart(2, '0');
    // Return #Date_DD_MM_YYYY with "Date_" letter prefix for Telegram hashtag entity recognition
    return '#Date_' + day + '_' + month + '_' + year;
  }

  // Case 3: Parse full JavaScript Date string from Google Sheets (e.g., "Sat Sep 05 2026 00:00:00 GMT+0530")
  const parsed = new Date(clean);
  // Validate that the parsed timestamp is a real calendar date
  if (!isNaN(parsed.getTime())) {
    // Zero-pad calendar day of month to 2 digits
    const day = String(parsed.getDate()).padStart(2, '0');
    // Zero-pad 1-based month index to 2 digits
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    // Extract full 4-digit calendar year
    const year = parsed.getFullYear();
    // Return #Date_DD_MM_YYYY with "Date_" letter prefix for Telegram hashtag entity recognition
    return '#Date_' + day + '_' + month + '_' + year;
  }

  // Case 4: Fallback for non-standard formats — strip special symbols and ensure Telegram hashtag compatibility
  const fallback = clean.replace(/[^a-zA-Z0-9_]/g, '_');
  // Check if cleaned fallback text contains any valid characters
  if (!fallback) return '';
  // Check if string contains at least one letter and does not start with a digit
  const startsWithLetter = /^[a-zA-Z]/.test(fallback);
  // Prefix with Date_ if string begins with a number so Telegram parses it as a clickable entity
  const validTag = startsWithLetter ? fallback : 'Date_' + fallback;
  // Return hashtag with hash symbol prefix
  return '#' + validTag;
}

/**
 * formatNewspaperHashtag — Converts a newspaper name to a Telegram-clickable hashtag.
 * What it does: Removes spaces and special characters, joining words in PascalCase.
 * What it brings: Users can tap the hashtag in Telegram to find all questions from that newspaper.
 * Where changes can be seen: Appended as a footer below each quiz poll in Telegram topics.
 *
 * Examples: "The Hindu" → "#TheHindu", "Indian Express" → "#IndianExpress", "Eenadu" → "#Eenadu"
 *
 * @param {string} name — Newspaper name string
 * @returns {string} Formatted hashtag like "#TheHindu", or empty string if invalid
 */
function formatNewspaperHashtag(name) {
  // Return empty if no name provided
  if (!name || !name.trim()) return '';
  // Split into words, capitalize first letter of each, join without spaces
  const words = name.trim().split(/\s+/);
  const pascal = words.map(function(w) {
    // Capitalize first letter, keep rest as-is
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join('');
  // Remove any remaining non-alphanumeric characters (e.g., periods, hyphens)
  const clean = pascal.replace(/[^a-zA-Z0-9]/g, '');
  return clean ? '#' + clean : '';
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
 * getBotInfo — Returns structured bot and group details for the dashboard.
 * What it does: Calls getMe and getChat and returns the results as an object
 * instead of printing them, so the Health and Automation dashboards can show
 * the real values rather than a bare true/false.
 * What it brings: A machine-readable health probe alongside the CLI-oriented
 * testConnection().
 * Where changes can be seen: The Telegram tiles on /health.html and /automation.html.
 *
 * @returns {Promise<Object>} { username, firstName, groupTitle, groupType, isForum }
 * @throws {Error} When the bot is uninitialised or Telegram rejects the call
 */
async function getBotInfo() {
  if (!bot) throw new Error('Bot not initialized');

  // Verify the token is valid and identify the bot.
  const botInfo = await bot.getMe();

  // Group access is a separate permission, so a failure here is reported
  // without hiding the fact that the token itself is fine.
  let chat = null;
  try {
    chat = await bot.getChat(groupId);
  } catch (err) {
    chat = null;
  }

  return {
    username: botInfo.username,
    firstName: botInfo.first_name,
    groupTitle: chat ? chat.title : null,
    groupType: chat ? chat.type : null,
    isForum: chat ? Boolean(chat.is_forum) : false,
    groupReachable: Boolean(chat)
  };
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

  // ---- Format Hashtags: Date and Newspaper metadata ----
  // Format date as #DD_MM_YYYY (e.g. #05_09_2026) and newspaper as #TheHindu
  const dateTag = formatDateHashtag(question.date || '');
  const newspaperTag = formatNewspaperHashtag(question.newspaper || '');
  // Collect available tags with descriptive icons
  const tagParts = [];
  if (dateTag) tagParts.push('📅 ' + dateTag);
  if (newspaperTag) tagParts.push('📰 ' + newspaperTag);
  // Join tags into a single line string
  const tagLine = tagParts.join('  ');

  // Telegram limits poll question text to a maximum of 300 characters.
  // APPSC and competitive exam questions with multiple statements frequently exceed this limit.
  // If the question exceeds 290 characters, we send the full question text with statements
  // AND attached hashtags directly in the topic message, and then follow up with the quiz poll.
  let pollQuestion = question.question_text;
  if (pollQuestion.length > 290) {
    // Construct question message with hashtags attached directly at the end (never sent separately)
    const questionTextWithTags = `📝 <b>Question:</b>\n\n${escapeHtml(question.question_text)}` +
      (tagLine ? `\n\n${tagLine}` : '');

    // Post the complete question and statement list with inline hashtags to the forum topic
    await bot.sendMessage(groupId, questionTextWithTags, {
      message_thread_id: threadId, // Direct message to the specific subject forum topic
      parse_mode: 'HTML'           // Format as HTML for clean readability
    });

    // Extract the concluding prompt if present (e.g. "Which of the statements given above are correct?")
    const lines = question.question_text.trim().split('\n');
    const lastLine = lines[lines.length - 1].trim();
    if (lastLine.endsWith('?') && lastLine.length < 250) {
      pollQuestion = `👆 ${lastLine} (Refer to statements above)`;
    } else {
      pollQuestion = '👆 Choose the correct answer for the question above:';
    }
  } else {
    // If question is short (<= 290 chars):
    // If question + tags fits within Telegram's 300-char poll question limit, attach hashtags directly!
    if (tagLine && (pollQuestion.length + tagLine.length + 2 <= 300)) {
      pollQuestion = `${pollQuestion}\n\n${tagLine}`;
    } else if (tagLine) {
      // If adding hashtags pushes pollQuestion beyond 300 characters,
      // send the question with hashtags as a formatted topic message, then follow up with poll
      const shortQuestionWithTags = `📝 <b>Question:</b>\n\n${escapeHtml(question.question_text)}\n\n${tagLine}`;
      await bot.sendMessage(groupId, shortQuestionWithTags, {
        message_thread_id: threadId,
        parse_mode: 'HTML'
      });
      pollQuestion = '👆 Choose the correct answer for the question above:';
    }
  }

  // Send the quiz poll to the Telegram group, targeting the specific topic
  const sent = await bot.sendPoll(groupId, pollQuestion, options, pollConfig);

  // Send the detailed Answer & Explanation message using Telegram's native <tg-spoiler> tag
  // This guarantees:
  // 1. The full, untruncated explanation is immediately available in the chat thread.
  // 2. The correct answer option is prominently displayed.
  // 3. The answer and explanation remain hidden behind a tap-to-reveal blur so users can attempt the poll first.
  if (question.explanation || question.correct_answer) {
    // Format the correct answer option letter (e.g. "D")
    const answerLetter = String(question.correct_answer || '').toUpperCase();
    // Sanitize the explanation text against HTML entity parsing issues
    const explanationText = escapeHtml(question.explanation || 'No detailed explanation provided.');

    // Construct the formatted spoiler message payload
    const spoilerMessage =
      `💡 <b>Answer &amp; Explanation</b> <i>(Tap below to reveal)</i>:\n` +
      `<tg-spoiler>✅ <b>Correct Answer: Option ${answerLetter}</b>\n\n` +
      `📖 <b>Explanation:</b>\n${explanationText}</tg-spoiler>`;

    // Send the spoiler message to the specific forum topic thread
    await bot.sendMessage(groupId, spoilerMessage, {
      message_thread_id: threadId,
      parse_mode: 'HTML'
    });
  }

  return sent; // Return the sent message object (contains message_id)
}

/**
 * createSingleUseInviteLink — mints a private invite only one person can use.
 * What it does: Calls createChatInviteLink with member_limit 1 and an expiry.
 * What it brings: A paid seat cannot be shared — the link dies on first use, so
 * forwarding it gives away your own place rather than creating a free one.
 * Where changes can be seen: The link DMed to a student after they pay.
 *
 * @param {string|number} chatId — Group to invite into
 * @param {string} name — Label shown in the group's invite-link list
 * @param {number} [expireUnix] — Unix time the unused link stops working
 * @returns {Promise<Object>} The invite link object, with `invite_link`
 */
async function createSingleUseInviteLink(chatId, name, expireUnix) {
  if (!bot) throw new Error('Bot not initialized');

  const options = { member_limit: 1 };
  if (name) options.name = String(name).slice(0, 32);
  if (expireUnix) options.expire_date = expireUnix;

  return bot.createChatInviteLink(chatId, options);
}

/**
 * sendDirectMessage — sends a private message to one user.
 * What it does: Posts to the user's own chat with the bot.
 * What it brings: Invite links, renewal reminders and expiry notices reach the
 * student privately instead of being posted in the group.
 * Where changes can be seen: The student's DM thread with the bot.
 *
 * Note: Telegram forbids a bot from opening a conversation, so this only works
 * after the student has messaged the bot at least once.
 *
 * @param {string|number} userId — Telegram user id
 * @param {string} text — HTML-formatted message
 * @param {Object} [extra] — Extra sendMessage options, e.g. reply_markup
 * @returns {Promise<Object>} The sent message
 */
async function sendDirectMessage(userId, text, extra) {
  if (!bot) throw new Error('Bot not initialized');

  return bot.sendMessage(userId, text, Object.assign({
    parse_mode: 'HTML',
    disable_web_page_preview: true
  }, extra || {}));
}

/**
 * banChatMember — removes a user from a group.
 * Paired with unbanChatMember to kick without a permanent ban.
 *
 * @param {string|number} chatId — Group id
 * @param {string|number} userId — User to remove
 */
async function banChatMember(chatId, userId) {
  if (!bot) throw new Error('Bot not initialized');
  return bot.banChatMember(chatId, userId);
}

/**
 * unbanChatMember — lifts a ban so the user can rejoin later.
 * What it brings: A lapsed subscriber who pays again can come straight back;
 * without this, removal would be permanent.
 *
 * @param {string|number} chatId — Group id
 * @param {string|number} userId — User to unban
 */
async function unbanChatMember(chatId, userId) {
  if (!bot) throw new Error('Bot not initialized');
  return bot.unbanChatMember(chatId, userId, { only_if_banned: true });
}

/**
 * getChatMemberStatus — whether a user is currently in the group.
 *
 * @param {string|number} chatId — Group id
 * @param {string|number} userId — User to check
 * @returns {Promise<string>} 'member', 'administrator', 'left', 'kicked', or 'unknown'
 */
async function getChatMemberStatus(chatId, userId) {
  if (!bot) throw new Error('Bot not initialized');
  try {
    const member = await bot.getChatMember(chatId, userId);
    return member && member.status ? member.status : 'unknown';
  } catch (err) {
    return 'unknown';
  }
}

/**
 * setGroupId — Updates the internal supergroup chat ID in the telegram module.
 * What it does: Replaces the module-level groupId variable with a newly discovered or user-provided ID.
 * What it brings: Allows dynamic runtime configuration of the group ID without restarting the process.
 * Where changes can be seen: In subsequent API calls made by createForumTopic or sendQuizPoll.
 *
 * @param {string|number} newGroupId — The Telegram chat ID (starting with -100)
 */
function setGroupId(newGroupId) {
  // Update the module-level groupId variable
  groupId = String(newGroupId);
}

/**
 * extractGroupIdFromLink — Extracts the standard Telegram chat ID from a web URL or raw ID string.
 * What it does: Parses formats like https://t.me/c/3814998988/3 into the canonical -1003814998988 format.
 * What it brings: Convenience for users who copy/paste browser or app topic links instead of raw chat IDs.
 * Where changes can be seen: Used by setup.js and CLI tools to parse input arguments.
 *
 * @param {string} input — Link or raw string provided by the user
 * @returns {string|null} Canonical chat ID formatted as -100..., or null if unrecognized
 */
function extractGroupIdFromLink(input) {
  // Trim leading and trailing whitespace from the user input string
  const cleanInput = String(input || '').trim();
  // Match standard private supergroup URL format: https://t.me/c/<numeric_id>/...
  const linkMatch = cleanInput.match(/t\.me\/c\/(\d+)/);
  // If matched, prefix with -100 to convert internal telegram channel ID to supergroup chat ID
  if (linkMatch && linkMatch[1]) {
    return `-100${linkMatch[1]}`;
  }
  // If the user already provided a raw ID beginning with -100
  if (cleanInput.startsWith('-100')) {
    return cleanInput;
  }
  // Return null if the string pattern does not match expected Telegram formats
  return null;
}

/**
 * detectGroupId — Scans Telegram Bot API updates to discover supergroup IDs automatically.
 * What it does: Retrieves recent updates from bot.getUpdates() and inspects chat payloads.
 * What it brings: Zero-configuration group discovery when the bot is added to a group or receives /start.
 * Where changes can be seen: Terminal logs during setup.js execution.
 *
 * @returns {Promise<{id: string, title: string}|null>} Discovered chat info or null
 */
async function detectGroupId() {
  // Verify bot instance is initialized before attempting API call
  if (!bot) throw new Error('Bot not initialized. Call init() first.');

  try {
    // Query Telegram Bot API getUpdates endpoint requesting message and membership change events
    const updates = await bot.getUpdates({
      limit: 50,
      allowed_updates: ['message', 'my_chat_member', 'chat_member', 'channel_post']
    });

    // Loop through retrieved updates in reverse to check the most recent events first
    for (let i = updates.length - 1; i >= 0; i--) {
      const u = updates[i];
      // Check message chat object
      const chat = (u.message && u.message.chat) ||
                   (u.my_chat_member && u.my_chat_member.chat) ||
                   (u.channel_post && u.channel_post.chat);

      // Verify that the chat object exists, is a supergroup or group, and has a negative ID
      if (chat && chat.id && (chat.type === 'supergroup' || chat.type === 'group')) {
        // Return the discovered chat ID and group title
        return {
          id: String(chat.id),
          title: chat.title || 'Untitled Group'
        };
      }
    }

    // Return null if no supergroup activity was discovered in the update buffer
    return null;
  } catch (error) {
    // Log warning if update fetch encountered an error
    console.warn(`⚠️ Could not query getUpdates: ${error.message}`);
    return null;
  }
}

// Export all functions for use by send.js, setup.js, and scheduler.js
module.exports = {
  getBotInfo,
  createSingleUseInviteLink,
  sendDirectMessage,
  banChatMember,
  unbanChatMember,
  getChatMemberStatus,
  init,
  testConnection,
  createForumTopic,
  sendQuizPoll,
  setGroupId,
  extractGroupIdFromLink,
  detectGroupId,
  formatDateHashtag,
  formatNewspaperHashtag
};
