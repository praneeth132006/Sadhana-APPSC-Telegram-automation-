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
async function getUnpostedQuestions(subject, count) {
  // If Google Sheets is enabled, delegate to sheets.getUnpostedQuestions()
  if (isGoogleSheetsEnabled()) {
    return await sheets.getUnpostedQuestions(subject, count);
  }
  // Otherwise, delegate to local excel.getUnpostedQuestions()
  return excel.getUnpostedQuestions(subject, count);
}

/**
 * markAsPosted — Marks questions as posted in Google Sheets or local Excel.
 *
 * @param {string} subject — Subject name
 * @param {Array<number>} rowIndices — Row indices to mark as posted
 * @returns {Promise<number>} Number of marked rows
 */
async function markAsPosted(subject, rowIndices) {
  // If Google Sheets is enabled, delegate to sheets.markAsPosted()
  if (isGoogleSheetsEnabled()) {
    return await sheets.markAsPosted(subject, rowIndices);
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
