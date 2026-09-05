// ============================================================================
// Google Sheets Service — API client communicating with Google Apps Script Web App
// ============================================================================
// This module provides functions to interact with Google Sheets via the Apps Script Web App URL:
// - readConfig: Fetches subject list, emojis, forum topic thread IDs, and cron settings
// - writeConfig: Updates forum topic thread IDs in Google Sheets
// - getUnpostedQuestions: Retrieves batch of unposted questions for a specific subject
// - markAsPosted: Marks question rows in Google Sheets as posted with an IST timestamp
// - getStats: Fetches counts of total, posted, and pending questions per subject
//
// Changes are reflected in real-time in the user's online Google Spreadsheet.

/**
 * getWebAppUrl — Retrieves and validates the Google Sheets Web App URL from environment variables.
 *
 * @returns {string} The configured Google Apps Script Web App URL
 */
function getWebAppUrl() {
  // Read the environment variable holding the deployed Web App URL
  const url = process.env.GOOGLE_SHEET_WEBAPP_URL;
  // Ensure the variable is set and not empty
  if (!url || !url.trim()) {
    throw new Error(
      'GOOGLE_SHEET_WEBAPP_URL is not defined in .env.\n' +
      'Please deploy the Google Apps Script (see google_apps_script.js) and add the URL to .env.'
    );
  }
  // Return the cleaned URL
  return url.trim();
}

/**
 * readConfig — Reads the "Config" tab in Google Sheets via HTTP GET.
 *
 * @returns {Promise<Array<Object>>} Array of subject configurations
 */
async function readConfig() {
  // Get the base Web App endpoint URL
  const baseUrl = getWebAppUrl();
  // Construct URL with action=getConfig query parameter
  const requestUrl = `${baseUrl}?action=getConfig`;

  // Send HTTP GET request using Node's native fetch API
  const response = await fetch(requestUrl, { redirect: 'follow' });
  // Check for successful HTTP status code
  if (!response.ok) {
    throw new Error(`Google Sheets request failed with status: ${response.status} ${response.statusText}`);
  }

  // Parse JSON response body
  const result = await response.json();
  // Check if the backend reported success
  if (!result.success) {
    throw new Error(`Google Sheets API error: ${result.error || 'Unknown error'}`);
  }

  // Return the array of subject configuration objects
  return result.data || [];
}

/**
 * writeConfig — Updates topic thread IDs in Google Sheets via HTTP POST.
 *
 * @param {Array<Object>} configData — Array of updated config objects
 * @returns {Promise<boolean>} True if update succeeded
 */
async function writeConfig(configData) {
  // Get the base Web App endpoint URL
  const baseUrl = getWebAppUrl();

  // Send HTTP POST request with action=updateConfig and the config payload
  const response = await fetch(baseUrl, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: 'updateConfig',
      config: configData
    })
  });

  // Verify HTTP status code
  if (!response.ok) {
    throw new Error(`Google Sheets updateConfig request failed with status: ${response.status}`);
  }

  // Parse response JSON
  const result = await response.json();
  // Throw error if operation failed
  if (!result.success) {
    throw new Error(`Google Sheets updateConfig failed: ${result.error || 'Unknown error'}`);
  }

  // Return success status
  return true;
}

/**
 * getUnpostedQuestions — Retrieves unposted questions for a subject from Google Sheets.
 *
 * @param {string} subject — Name of the subject tab (e.g., "Polity")
 * @param {number} count — Maximum number of questions to retrieve
 * @returns {Promise<Array<Object>>} Array of question objects with excel_row
 */
async function getUnpostedQuestions(subject, count = 1) {
  // Get base endpoint URL
  const baseUrl = getWebAppUrl();
  // Encode query parameters safely
  const params = new URLSearchParams({
    action: 'getQuestions',
    subject: subject,
    limit: String(count)
  });
  // Build full request URL
  const requestUrl = `${baseUrl}?${params.toString()}`;

  // Execute HTTP GET request
  const response = await fetch(requestUrl, { redirect: 'follow' });
  // Ensure response was successful
  if (!response.ok) {
    throw new Error(`Google Sheets getQuestions failed with status: ${response.status}`);
  }

  // Parse JSON response body
  const result = await response.json();
  // Check for logical success from backend
  if (!result.success) {
    throw new Error(`Google Sheets getQuestions error: ${result.error || 'Unknown error'}`);
  }

  // Return list of unposted questions
  return result.data || [];
}

/**
 * markAsPosted — Marks specified question rows as posted in Google Sheets.
 * What it does: Sends HTTP POST request with action=markPosted, rowIndices, and optional Telegram messageId.
 * What it brings: Records 'YES', IST timestamp, and Telegram Message ID into the 16-column Google Sheet.
 * Where changes can be seen: Columns L, M, and P of the subject Google Sheet tab.
 *
 * @param {string} subject — Subject sheet tab name
 * @param {Array<number>} rowIndices — Array of 1-based row numbers or 0-based data row indices
 * @param {string|number} [messageId] — Optional Telegram message ID from the posted quiz
 * @returns {Promise<number>} Number of updated rows
 */
async function markAsPosted(subject, rowIndices, messageId = null) {
  // If rowIndices array is empty, nothing to update
  if (!rowIndices || rowIndices.length === 0) return 0;

  // Get base endpoint URL from .env
  const baseUrl = getWebAppUrl();

  // Send HTTP POST request with action=markPosted payload
  const response = await fetch(baseUrl, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: 'markPosted',
      subject: subject,
      rowIndices: rowIndices,
      messageId: messageId ? String(messageId) : ''
    })
  });

  // Check HTTP response status
  if (!response.ok) {
    throw new Error(`Google Sheets markPosted failed with status: ${response.status}`);
  }

  // Parse response JSON
  const result = await response.json();
  // Ensure update succeeded on the spreadsheet
  if (!result.success) {
    throw new Error(`Google Sheets markPosted error: ${result.error || 'Unknown error'}`);
  }

  // Return count of updated rows
  return result.updatedCount || rowIndices.length;
}

/**
 * getStats — Fetches summary statistics across all configured subjects.
 *
 * @returns {Promise<Array<Object>>} Array of stats objects: { subject, total, posted, pending }
 */
async function getStats() {
  // Get base endpoint URL
  const baseUrl = getWebAppUrl();
  // Construct URL for stats action
  const requestUrl = `${baseUrl}?action=getStats`;

  // Fetch stats from Google Sheets Web App
  const response = await fetch(requestUrl, { redirect: 'follow' });
  // Verify HTTP status
  if (!response.ok) {
    throw new Error(`Google Sheets getStats failed with status: ${response.status}`);
  }

  // Parse JSON response
  const result = await response.json();
  // Verify logical success
  if (!result.success) {
    throw new Error(`Google Sheets getStats error: ${result.error || 'Unknown error'}`);
  }

  // Return stats list
  return result.data || [];
}

// Export all Google Sheets functions for use by the data layer
module.exports = {
  readConfig,
  writeConfig,
  getUnpostedQuestions,
  markAsPosted,
  getStats
};
