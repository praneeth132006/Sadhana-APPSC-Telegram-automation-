// ============================================================================
// Google Apps Script — APPSC Telegram Quiz Automation Backend
// ============================================================================
// INSTRUCTIONS TO DEPLOY:
// 1. Open your Google Sheet in a browser
// 2. Go to: Extensions > Apps Script
// 3. Delete any code in Code.gs and paste this entire file
// 4. Click the blue "Deploy" button (top right) > "New deployment"
// 5. Select type: "Web app" (click the gear icon > Web app)
// 6. Set Description: "APPSC Telegram Bot API"
// 7. Set "Execute as": "Me"
// 8. Set "Who has access": "Anyone"  <-- CRITICAL so the bot can connect!
// 9. Click "Deploy", authorize permissions when prompted
// 10. Copy the "Web app URL" and paste it into your .env file as:
//     GOOGLE_SHEET_WEBAPP_URL=https://script.google.com/macros/s/.../exec
// ============================================================================

/**
 * doGet — Handles HTTP GET requests sent from the Node.js automation bot.
 * Actions supported:
 * - action=getConfig: Returns subject config list with topic IDs & schedules
 * - action=getQuestions: Returns unposted questions for a specific subject
 * - action=getStats: Returns question counts (total, posted, pending) per subject
 *
 * @param {Object} e - Event parameter containing HTTP query string parameters
 * @returns {TextOutput} JSON response payload
 */
function doGet(e) {
  try {
    // Extract query parameters from the request URL
    const params = (e && e.parameter) || {};
    // Determine the requested action (default to 'ping' for health checks)
    const action = params.action || 'ping';

    // Handle health check action to verify script deployment
    if (action === 'ping') {
      return jsonResponse({ status: 'ok', message: 'Google Sheets API is running' });
    }

    // Handle fetching subject configuration from the "Config" sheet
    if (action === 'getConfig') {
      const config = fetchConfigFromSheet();
      return jsonResponse({ success: true, data: config });
    }

    // Handle fetching unposted questions for a specific subject
    if (action === 'getQuestions') {
      const subject = params.subject;
      // Parse requested question count (defaults to 1 if not provided)
      const limit = parseInt(params.limit || '1', 10);

      // Validate that a subject name was provided
      if (!subject) {
        return jsonResponse({ success: false, error: 'Missing "subject" query parameter' });
      }

      // Fetch unposted questions from the subject tab
      const questions = fetchUnpostedQuestions(subject, limit);
      return jsonResponse({ success: true, data: questions });
    }

    // Handle fetching summary statistics for all subjects
    if (action === 'getStats') {
      const stats = fetchSummaryStats();
      return jsonResponse({ success: true, data: stats });
    }

    // Return error if action parameter is unrecognized
    return jsonResponse({ success: false, error: 'Unknown action: ' + action });
  } catch (err) {
    // Catch and return any unexpected runtime errors
    return jsonResponse({ success: false, error: err.toString() });
  }
}

/**
 * doPost — Handles HTTP POST requests sent from the Node.js automation bot.
 * Actions supported:
 * - action=markPosted: Marks question rows as posted with timestamp in column H
 * - action=updateConfig: Updates Topic Thread IDs in the Config sheet
 *
 * @param {Object} e - Event parameter containing HTTP POST body data
 * @returns {TextOutput} JSON response payload
 */
function doPost(e) {
  try {
    // Parse the incoming JSON body from postData contents
    let payload = {};
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    }

    // Determine the requested POST action
    const action = payload.action;

    // Handle marking questions as posted after sending to Telegram
    if (action === 'markPosted') {
      const subject = payload.subject;
      const rowIndices = payload.rowIndices || []; // 1-based row numbers in sheet

      // Validate required inputs
      if (!subject || !rowIndices.length) {
        return jsonResponse({ success: false, error: 'Missing subject or rowIndices array' });
      }

      // Mark the rows in the Google Sheet
      const updatedCount = markRowsAsPostedInSheet(subject, rowIndices);
      return jsonResponse({ success: true, updatedCount: updatedCount });
    }

    // Handle saving created Topic Thread IDs into the Config sheet
    if (action === 'updateConfig') {
      const configData = payload.config || [];
      // Update thread IDs in the Config sheet
      updateConfigInSheet(configData);
      return jsonResponse({ success: true, message: 'Config updated successfully' });
    }

    // Return error if action is unrecognized
    return jsonResponse({ success: false, error: 'Unknown POST action: ' + action });
  } catch (err) {
    // Catch and return any unexpected runtime errors
    return jsonResponse({ success: false, error: err.toString() });
  }
}

/**
 * fetchConfigFromSheet — Reads the "Config" sheet tab and extracts configuration rows.
 * Expected columns: Subject | Emoji | Topic_Thread_ID | Schedule_Cron | Questions_Per_Batch | Active
 *
 * @returns {Array<Object>} Array of subject configuration objects
 */
function fetchConfigFromSheet() {
  // Open active spreadsheet
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // Get the Config tab
  const sheet = ss.getSheetByName('Config');
  if (!sheet) {
    throw new Error('Sheet named "Config" was not found in spreadsheet.');
  }

  // Get all data rows (excluding row 1 header)
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  // Read range A2:F[lastRow]
  const values = sheet.getRange(2, 1, lastRow - 1, 6).getValues();

  // Map each row to a structured config object
  return values
    .map(function(row) {
      return {
        // Subject name without leading or trailing whitespace
        subject: String(row[0] || '').trim(),
        // Emoji icon column left empty or clean string if specified
        emoji: String(row[1] || '').trim(),
        // Topic thread ID parsed as numeric value
        topic_thread_id: row[2] ? Number(row[2]) : null,
        // Scheduling cron pattern string
        schedule_cron: String(row[3] || '').trim(),
        // Number of questions dispatched in batch
        questions_per_batch: Number(row[4]) || 5,
        // Active status flag parsed as boolean
        active: String(row[5] || 'YES').trim().toUpperCase() === 'YES'
      };
    })
    .filter(function(item) {
      // Exclude empty subject rows
      return item.subject.length > 0;
    });
}

/**
 * fetchUnpostedQuestions — Reads a subject sheet and returns questions where Posted (Col H) is blank.
 *
 * @param {string} subject - Name of the subject tab (e.g., "Polity")
 * @param {number} limit - Maximum number of questions to return
 * @returns {Array<Object>} List of unposted questions with 1-based sheet row index
 */
function fetchUnpostedQuestions(subject, limit) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(subject);
  if (!sheet) {
    throw new Error('Sheet tab "' + subject + '" not found in spreadsheet.');
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  // Read columns A to H (8 columns) from row 2 onwards
  const data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  const results = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const postedValue = String(row[7] || '').trim(); // Column H is index 7

    // If "Posted" does not start with YES, this question is pending
    if (!postedValue.toUpperCase().startsWith('YES')) {
      const qText = String(row[0] || '').trim();
      // Skip blank rows where question text is empty
      if (qText.length > 0) {
        results.push({
          question_text: qText,
          option_a: String(row[1] || '').trim(),
          option_b: String(row[2] || '').trim(),
          option_c: String(row[3] || '').trim(),
          option_d: String(row[4] || '').trim(),
          correct_answer: String(row[5] || 'A').trim().toUpperCase(),
          explanation: String(row[6] || '').trim(),
          row_index: i,     // 0-based question index within data rows
          excel_row: i + 2  // 1-based row number in Google Sheets
        });

        // Break once limit is reached
        if (results.length >= limit) {
          break;
        }
      }
    }
  }

  return results;
}

/**
 * markRowsAsPostedInSheet — Updates the "Posted" column (Column H) with a timestamp.
 * Supports both 0-based row_index (0, 1...) and 1-based sheet row numbers (2, 3...).
 *
 * @param {string} subject - Name of the subject tab
 * @param {Array<number>} rowIndices - List of row numbers or indices to update
 * @returns {number} Number of rows successfully updated
 */
function markRowsAsPostedInSheet(subject, rowIndices) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(subject);
  if (!sheet) {
    throw new Error('Sheet tab "' + subject + '" not found in spreadsheet.');
  }

  // Format Indian Standard Time (IST) timestamp
  const now = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd/MM/yyyy, hh:mm:ss a');
  const postedStamp = 'YES | ' + now;

  // Update Column 8 (Column H) for each specified row
  for (let i = 0; i < rowIndices.length; i++) {
    // If index is less than 2, it's 0-based, so add 2 to convert to sheet row number
    const rowNumber = rowIndices[i] < 2 ? rowIndices[i] + 2 : rowIndices[i];
    sheet.getRange(rowNumber, 8).setValue(postedStamp);
  }

  return rowIndices.length;
}

/**
 * updateConfigInSheet — Updates Topic Thread IDs in the "Config" sheet.
 *
 * @param {Array<Object>} configData - Array of config objects containing topic_thread_id
 */
function updateConfigInSheet(configData) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Config');
  if (!sheet) {
    throw new Error('Sheet named "Config" was not found in spreadsheet.');
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  // Read current subjects from column A
  const subjects = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

  // Match each config item and update Column C (Topic_Thread_ID)
  for (let r = 0; r < subjects.length; r++) {
    const subjectName = String(subjects[r][0] || '').trim().toLowerCase();
    const matched = configData.find(function(c) {
      return String(c.subject || '').trim().toLowerCase() === subjectName;
    });

    if (matched && matched.topic_thread_id) {
      // Row is r + 2 (1-indexed + header offset), Column 3 is Topic_Thread_ID
      sheet.getRange(r + 2, 3).setValue(matched.topic_thread_id);
    }
  }
}

/**
 * fetchSummaryStats — Computes total, posted, and pending questions across all subjects.
 *
 * @returns {Array<Object>} Array of statistics objects per subject
 */
function fetchSummaryStats() {
  const configs = fetchConfigFromSheet();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const stats = [];

  for (let i = 0; i < configs.length; i++) {
    const subject = configs[i].subject;
    const sheet = ss.getSheetByName(subject);

    if (!sheet) {
      stats.push({ subject: subject, total: 0, posted: 0, pending: 0 });
      continue;
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      stats.push({ subject: subject, total: 0, posted: 0, pending: 0 });
      continue;
    }

    // Read question column (A) and posted column (H)
    const values = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
    let total = 0;
    let posted = 0;

    for (let j = 0; j < values.length; j++) {
      const qText = String(values[j][0] || '').trim();
      if (qText.length > 0) {
        total++;
        const postedVal = String(values[j][7] || '').trim();
        if (postedVal.toUpperCase().startsWith('YES')) {
          posted++;
        }
      }
    }

    stats.push({
      subject: subject,
      total: total,
      posted: posted,
      pending: total - posted
    });
  }

  return stats;
}

/**
 * jsonResponse — Helper to format a JavaScript object into a JSON TextOutput response.
 *
 * @param {Object} data - Payload to serialize as JSON
 * @returns {TextOutput} Configured TextOutput object
 */
function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * setupSpreadsheet — One-click initialization for your Google Spreadsheet.
 * What it does: Creates the "Config" tab and 16 subject tabs with headers and pre-mapped thread IDs (6 to 21).
 * What it brings: Fully automated configuration of the online spreadsheet without manually typing 16 sheet names.
 * Where changes can be seen: Direct creation of sheets and rows in your Google Spreadsheet.
 *
 * HOW TO RUN:
 * 1. In Apps Script, select "setupSpreadsheet" from the function dropdown at the top.
 * 2. Click "Run".
 * 3. Look at your Google Sheet — all 16 subjects are now created with headers ready for your questions!
 */
function setupSpreadsheet() {
  // Access the active spreadsheet container
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // All 16 APPSC subjects with clean names (no emojis) and the Telegram thread IDs created earlier
  const configList = [
    { subject: 'History', threadId: 6, cron: '0 9,18 * * *', count: 5 },
    { subject: 'AP History', threadId: 7, cron: '0 */3 * * *', count: 5 },
    { subject: 'Geography', threadId: 8, cron: '0 */3 * * *', count: 5 },
    { subject: 'AP Geography', threadId: 9, cron: '0 */3 * * *', count: 5 },
    { subject: 'Economy', threadId: 10, cron: '0 */3 * * *', count: 5 },
    { subject: 'AP Economy', threadId: 11, cron: '0 */3 * * *', count: 5 },
    { subject: 'Polity', threadId: 12, cron: '0 */2 * * *', count: 5 },
    { subject: 'Society', threadId: 13, cron: '0 */4 * * *', count: 5 },
    { subject: 'Current Affairs', threadId: 14, cron: '0 8,14,20 * * *', count: 5 },
    { subject: 'Science and Technology', threadId: 15, cron: '0 */3 * * *', count: 5 },
    { subject: 'Biology', threadId: 16, cron: '0 */4 * * *', count: 5 },
    { subject: 'Chemistry', threadId: 17, cron: '0 */4 * * *', count: 5 },
    { subject: 'Physics', threadId: 18, cron: '0 */4 * * *', count: 5 },
    { subject: 'Environment', threadId: 19, cron: '0 */3 * * *', count: 5 },
    { subject: 'General Studies', threadId: 20, cron: '0 */3 * * *', count: 5 },
    { subject: 'Disaster Management', threadId: 21, cron: '0 */4 * * *', count: 5 }
  ];

  // Retrieve or create the Config tab
  let configSheet = ss.getSheetByName('Config');
  if (!configSheet) {
    // Insert new sheet named Config as the first tab
    configSheet = ss.insertSheet('Config', 0);
  }
  // Clear any previous formatting or stale data in the Config sheet
  configSheet.clear();

  // Define column headers for configuration
  const configHeaders = ['Subject', 'Emoji', 'Topic_Thread_ID', 'Schedule_Cron', 'Questions_Per_Batch', 'Active'];
  // Append header row to Config sheet
  configSheet.appendRow(configHeaders);
  // Style header row with bold font and subtle blue accent background
  configSheet.getRange(1, 1, 1, configHeaders.length).setFontWeight('bold').setBackground('#E8EEF5');

  // Populate config rows for each subject
  for (let i = 0; i < configList.length; i++) {
    const item = configList[i];
    // Add subject row with empty emoji (clean text) and pre-mapped Telegram thread ID
    configSheet.appendRow([item.subject, '', item.threadId, item.cron, item.count, 'YES']);
  }

  // Freeze the top header row in Config sheet
  configSheet.setFrozenRows(1);

  // Standard question column headers for each subject tab
  const questionHeaders = ['Question', 'Option A', 'Option B', 'Option C', 'Option D', 'Correct Answer', 'Explanation', 'Posted'];

  // Create or refresh each of the 16 subject question tabs
  for (let i = 0; i < configList.length; i++) {
    const subjName = configList[i].subject;
    // Check if the subject sheet already exists
    let subjSheet = ss.getSheetByName(subjName);
    if (!subjSheet) {
      // Insert new sheet tab with the clean subject name
      subjSheet = ss.insertSheet(subjName);
    }

    // If sheet is empty, add the standard headers
    if (subjSheet.getLastRow() === 0) {
      subjSheet.appendRow(questionHeaders);
      subjSheet.getRange(1, 1, 1, questionHeaders.length).setFontWeight('bold').setBackground('#F0F4F8');
      subjSheet.setFrozenRows(1);
    }
  }

  // Log completion message in Apps Script execution log
  Logger.log('✅ Spreadsheet setup complete! Config and 16 subject tabs created.');
}

