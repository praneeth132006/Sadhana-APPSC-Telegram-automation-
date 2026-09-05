// ============================================================================
// Data Layer Provider — Unified data source manager (Google Sheets / Excel)
// ============================================================================
// This module provides a unified asynchronous interface for accessing quiz data:
// - If GOOGLE_SHEET_WEBAPP_URL is defined in .env, it uses Google Sheets via src/sheets.js
// - If GOOGLE_SHEET_WEBAPP_URL is not defined, it gracefully falls back to local Excel via src/excel.js
//
// This enables seamless switching between online Google Spreadsheets and local Excel files.

// Load the local Excel operations module
const excel = require('./excel');
// Load the Google Sheets Web App operations module
const sheets = require('./sheets');

/**
 * isGoogleSheetsEnabled — Checks if Google Sheets integration is configured.
 *
 * @returns {boolean} true if GOOGLE_SHEET_WEBAPP_URL is present in .env
 */
function isGoogleSheetsEnabled() {
  // Check if GOOGLE_SHEET_WEBAPP_URL environment variable has a non-empty string value
  return Boolean(process.env.GOOGLE_SHEET_WEBAPP_URL && process.env.GOOGLE_SHEET_WEBAPP_URL.trim());
}

/**
 * getDataSourceName — Returns a human-readable name of the active data source.
 *
 * @returns {string} Description of active data backend
 */
function getDataSourceName() {
  // Return Google Sheets when URL is set, otherwise Local Excel
  return isGoogleSheetsEnabled() ? 'Google Sheets (Cloud)' : 'Local Excel (config.xlsx / questions.xlsx)';
}

/**
 * readConfig — Reads subject configuration from Google Sheets or local Excel.
 *
 * @returns {Promise<Array<Object>>} List of subject configurations
 */
async function readConfig() {
  // If Google Sheets is enabled, delegate to sheets.readConfig()
  if (isGoogleSheetsEnabled()) {
    return await sheets.readConfig();
  }
  // Otherwise, wrap synchronous excel.readConfig() in a Promise
  return excel.readConfig();
}

/**
 * writeConfig — Writes updated topic thread IDs back to Google Sheets or local Excel.
 *
 * @param {Array<Object>} configData — Updated configuration array
 * @returns {Promise<void>}
 */
async function writeConfig(configData) {
  // If Google Sheets is enabled, delegate to sheets.writeConfig()
  if (isGoogleSheetsEnabled()) {
    return await sheets.writeConfig(configData);
  }
  // Otherwise, delegate to local excel.writeConfig()
  return excel.writeConfig(configData);
}

/**
 * getUnpostedQuestions — Fetches unposted questions for a subject from Google Sheets or Excel.
 *
 * @param {string} subject — Subject name (e.g., "Polity")
 * @param {number} count — Number of questions to retrieve
 * @returns {Promise<Array<Object>>} Array of unposted question objects
 */
async function getUnpostedQuestions(subject, count, requireApproved = false) {
  // If Google Sheets is enabled, delegate to sheets.getUnpostedQuestions()
  // requireApproved restricts the batch to rows whose Status is Approved or
  // Scheduled, so a Draft or Rejected question can never reach the channel.
  if (isGoogleSheetsEnabled()) {
    return await sheets.getUnpostedQuestions(subject, count, requireApproved);
  }
  // Otherwise, delegate to local excel.getUnpostedQuestions()
  return excel.getUnpostedQuestions(subject, count);
}

/**
 * markAsPosted — Marks questions as posted in Google Sheets or local Excel.
 * What it does: Updates the status of sent questions in cloud Google Sheets or local Excel files.
 * What it brings: Seamless persistence across data backends with optional Telegram message ID tracking.
 * Where changes can be seen: "Posted", "Posted At", and "Telegram Msg ID" columns in spreadsheet.
 *
 * @param {string} subject — Subject name
 * @param {Array<number>} rowIndices — Row indices to mark as posted
 * @param {string|number} [messageId] — Optional Telegram message ID returned by bot API
 * @param {string|number} [threadId] — Optional forum topic thread the poll went to
 * @param {Object} [pollIds] — Optional { sheetRowNumber: pollId } map
 * @returns {Promise<number>} Number of marked rows
 */
async function markAsPosted(subject, rowIndices, messageId = null, threadId = null, pollIds = null) {
  // If Google Sheets is enabled, record the full posting trail: timestamp,
  // status, thread id, message id, poll id and repost count.
  if (isGoogleSheetsEnabled()) {
    return await sheets.markAsPosted(subject, rowIndices, messageId, threadId, pollIds);
  }
  // Otherwise, delegate to local excel.markAsPosted()
  return excel.markAsPosted(subject, rowIndices);
}

/**
 * getStats — Retrieves question statistics (total, posted, pending) per subject.
 *
 * @param {Array<string>} [subjectNames] — Optional list of subject names
 * @returns {Promise<Array<Object>>} Array of statistics objects
 */
async function getStats(subjectNames) {
  // If Google Sheets is enabled, delegate to sheets.getStats()
  if (isGoogleSheetsEnabled()) {
    return await sheets.getStats();
  }
  // Otherwise, delegate to local excel.getStats()
  return excel.getStats(subjectNames);
}

// Export the unified data interface functions
module.exports = {
  isGoogleSheetsEnabled,
  getDataSourceName,
  readConfig,
  writeConfig,
  getUnpostedQuestions,
  markAsPosted,
  getStats
};
