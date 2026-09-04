// ============================================================================
// Google Apps Script — APPSC Telegram Quiz Automation Backend (v2)
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
//
// COLUMN LAYOUT (v2) — 10 columns per subject sheet:
// A: Date | B: Newspaper | C: Question | D: Option A | E: Option B |
// F: Option C | G: Option D | H: Correct Answer | I: Explanation | J: Posted
// ============================================================================

/**
 * doGet — Handles HTTP GET requests sent from the Node.js automation bot.
 * Actions supported:
 * - action=ping: Health check to verify deployment
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
      return jsonResponse({ status: 'ok', message: 'Google Sheets API is running (v2 — 10 columns)' });
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
 * doPost — Handles HTTP POST requests sent from the Node.js automation bot and the web dashboard.
 * Actions supported:
 * - action=markPosted: Marks question rows as posted with timestamp in column J (10th column)
 * - action=updateConfig: Updates Topic Thread IDs in the Config sheet
 * - action=addQuestions: Appends new questions from the web dashboard to a subject tab
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
      // 1-based row numbers in sheet pointing to column J (Posted)
      const rowIndices = payload.rowIndices || [];

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

    // Handle adding new questions from the web dashboard
    if (action === 'addQuestions') {
      // Extract subject name from the payload
      const subject = payload.subject;
      // Extract array of question objects
      const questions = payload.questions || [];

      // Validate that subject and questions exist
      if (!subject) {
        return jsonResponse({ success: false, error: 'Missing "subject" field in payload' });
      }
      if (questions.length === 0) {
        return jsonResponse({ success: false, error: 'No questions provided in the payload' });
      }

      // Append questions to the correct subject tab
      const addedCount = appendQuestionsToSheet(subject, questions);
      return jsonResponse({ success: true, addedCount: addedCount, message: addedCount + ' questions added to ' + subject });
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

  // Read range A2:F[lastRow] — 6 columns for config
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
 * fetchUnpostedQuestions — Reads a subject sheet and returns questions where Posted (Col J, index 9) is blank.
 * v2 column layout: Date(0) | Newspaper(1) | Question(2) | OptA(3) | OptB(4) | OptC(5) | OptD(6) | Answer(7) | Explanation(8) | Posted(9)
 *
 * @param {string} subject - Name of the subject tab (e.g., "Polity")
 * @param {number} limit - Maximum number of questions to return
 * @returns {Array<Object>} List of unposted questions with 1-based sheet row index
 */
function fetchUnpostedQuestions(subject, limit) {
  // Open active spreadsheet
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // Locate the subject-specific sheet tab
  const sheet = ss.getSheetByName(subject);
  if (!sheet) {
    throw new Error('Sheet tab "' + subject + '" not found in spreadsheet.');
  }

  // Count total rows including header
  const lastRow = sheet.getLastRow();
  // Return empty if only header or empty
  if (lastRow <= 1) return [];

  // Read all 10 columns (A through J) starting from row 2
  const data = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  // Array to collect unposted question objects
  const results = [];

  // Iterate over each data row checking posted status
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    // Column J (index 9) holds the posted status timestamp
    const postedValue = String(row[9] || '').trim();

    // If "Posted" does not start with YES, this question is pending
    if (!postedValue.toUpperCase().startsWith('YES')) {
      // Column C (index 2) holds the question text
      const qText = String(row[2] || '').trim();
      // Skip blank rows where question text is empty
      if (qText.length > 0) {
        // Build structured question object with all metadata fields
        results.push({
          date: String(row[0] || '').trim(),              // Column A: Publication date string
          newspaper: String(row[1] || '').trim(),          // Column B: Source newspaper name
          question_text: qText,                             // Column C: Full question prompt
          option_a: String(row[3] || '').trim(),           // Column D: Option A text
          option_b: String(row[4] || '').trim(),           // Column E: Option B text
          option_c: String(row[5] || '').trim(),           // Column F: Option C text
          option_d: String(row[6] || '').trim(),           // Column G: Option D text
          correct_answer: String(row[7] || 'A').trim().toUpperCase(), // Column H: Correct option letter
          explanation: String(row[8] || '').trim(),         // Column I: Detailed explanation
          row_index: i,                                     // 0-based data row index within sheet
          excel_row: i + 2                                  // 1-based sheet row number (header offset)
        });

        // Break once limit is reached to prevent fetching excess data
        if (results.length >= limit) {
          break;
        }
      }
    }
  }

  // Return collected unposted question objects
  return results;
}

/**
 * markRowsAsPostedInSheet — Updates the "Posted" column (Column J, 10th col) with a timestamp.
 * Supports both 0-based row_index (0, 1...) and 1-based sheet row numbers (2, 3...).
 *
 * @param {string} subject - Name of the subject tab
 * @param {Array<number>} rowIndices - List of row numbers or indices to update
 * @returns {number} Number of rows successfully updated
 */
function markRowsAsPostedInSheet(subject, rowIndices) {
  // Open active spreadsheet
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // Locate the subject sheet tab
  const sheet = ss.getSheetByName(subject);
  if (!sheet) {
    throw new Error('Sheet tab "' + subject + '" not found in spreadsheet.');
  }

  // Format Indian Standard Time (IST) timestamp for posted status
  const now = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd/MM/yyyy, hh:mm:ss a');
  // Combine YES flag with human-readable timestamp
  const postedStamp = 'YES | ' + now;

  // Update Column 10 (Column J — Posted) for each specified row
  for (let i = 0; i < rowIndices.length; i++) {
    // If index is less than 2, it's 0-based, so add 2 to convert to sheet row number
    const rowNumber = rowIndices[i] < 2 ? rowIndices[i] + 2 : rowIndices[i];
    // Write the posted timestamp stamp to Column J (column 10)
    sheet.getRange(rowNumber, 10).setValue(postedStamp);
  }

  // Return the count of rows that were marked
  return rowIndices.length;
}

/**
 * updateConfigInSheet — Updates Topic Thread IDs in the "Config" sheet.
 *
 * @param {Array<Object>} configData - Array of config objects containing topic_thread_id
 */
function updateConfigInSheet(configData) {
  // Open active spreadsheet
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // Locate Config sheet tab
  const sheet = ss.getSheetByName('Config');
  if (!sheet) {
    throw new Error('Sheet named "Config" was not found in spreadsheet.');
  }

  // Count total data rows
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  // Read current subjects from column A
  const subjects = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

  // Match each config item and update Column C (Topic_Thread_ID)
  for (let r = 0; r < subjects.length; r++) {
    // Normalize subject names for case-insensitive comparison
    const subjectName = String(subjects[r][0] || '').trim().toLowerCase();
    // Find matching config entry from the incoming payload
    const matched = configData.find(function(c) {
      return String(c.subject || '').trim().toLowerCase() === subjectName;
    });

    // Write matched topic thread ID to Column C (3rd column)
    if (matched && matched.topic_thread_id) {
      // Row is r + 2 (1-indexed + header offset), Column 3 is Topic_Thread_ID
      sheet.getRange(r + 2, 3).setValue(matched.topic_thread_id);
    }
  }
}

/**
 * appendQuestionsToSheet — Appends new questions from the web dashboard to a subject tab.
 * What it does: Takes an array of question objects and writes them as new rows in 10-column layout.
 * What it brings: Enables the web dashboard "Send to Sheet" button to batch-push questions.
 * Where changes can be seen: New rows appended at the bottom of the subject-specific Google Sheet tab.
 *
 * @param {string} subject - Name of the subject sheet tab (e.g., "Polity")
 * @param {Array<Object>} questions - Array of question objects with date, newspaper, question, options, answer, explanation
 * @returns {number} Count of questions successfully appended
 */
function appendQuestionsToSheet(subject, questions) {
  // Open active spreadsheet
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // Locate the subject-specific sheet tab
  const sheet = ss.getSheetByName(subject);
  if (!sheet) {
    throw new Error('Sheet tab "' + subject + '" not found. Run setupSpreadsheet() first.');
  }

  // Track number of successfully appended questions
  let addedCount = 0;

  // Iterate through each question object and append as a new row
  for (let i = 0; i < questions.length; i++) {
    var q = questions[i];
    // Build the 10-column row array matching the v2 column layout
    var newRow = [
      String(q.date || '').trim(),             // Column A: Date (e.g., "05-09-2026")
      String(q.newspaper || '').trim(),        // Column B: Newspaper source name
      String(q.question || '').trim(),         // Column C: Full question text
      String(q.option_a || '').trim(),         // Column D: Option A
      String(q.option_b || '').trim(),         // Column E: Option B
      String(q.option_c || '').trim(),         // Column F: Option C
      String(q.option_d || '').trim(),         // Column G: Option D
      String(q.correct_answer || 'A').trim().toUpperCase(), // Column H: Correct answer letter
      String(q.explanation || '').trim(),       // Column I: Detailed explanation
      ''                                        // Column J: Posted — left blank for pending
    ];
    // Append the row to the bottom of the sheet
    sheet.appendRow(newRow);
    // Increment the count of successfully added questions
    addedCount++;
  }

  // Return the total number of questions appended
  return addedCount;
}

/**
 * fetchSummaryStats — Computes total, posted, and pending questions across all subjects.
 * v2: Reads 10 columns; Posted status is in Column J (index 9).
 *
 * @returns {Array<Object>} Array of statistics objects per subject
 */
function fetchSummaryStats() {
  // Fetch the list of configured subjects
  const configs = fetchConfigFromSheet();
  // Open active spreadsheet
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // Array to collect stats for each subject
  const stats = [];

  // Iterate through each configured subject
  for (let i = 0; i < configs.length; i++) {
    var subject = configs[i].subject;
    // Attempt to find the subject's sheet tab
    var sheet = ss.getSheetByName(subject);

    // If sheet doesn't exist, report zero counts
    if (!sheet) {
      stats.push({ subject: subject, total: 0, posted: 0, pending: 0 });
      continue;
    }

    // Get total row count
    var lastRow = sheet.getLastRow();
    // If only header or empty, report zero counts
    if (lastRow <= 1) {
      stats.push({ subject: subject, total: 0, posted: 0, pending: 0 });
      continue;
    }

    // Read all 10 columns: question in Col C (index 2), posted in Col J (index 9)
    var values = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
    var total = 0;
    var posted = 0;

    // Count valid questions and posted status
    for (var j = 0; j < values.length; j++) {
      // Check Column C (index 2) for non-empty question text
      var qText = String(values[j][2] || '').trim();
      if (qText.length > 0) {
        total++;
        // Check Column J (index 9) for posted timestamp
        var postedVal = String(values[j][9] || '').trim();
        if (postedVal.toUpperCase().startsWith('YES')) {
          posted++;
        }
      }
    }

    // Push computed stats for this subject
    stats.push({
      subject: subject,
      total: total,
      posted: posted,
      pending: total - posted
    });
  }

  // Return the complete stats array
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
 * setupSpreadsheet — One-click initialization for your Google Spreadsheet (v2 — 10 columns).
 * What it does: Creates the "Config" tab and 16 subject tabs with 10-column headers and pre-mapped thread IDs (6 to 21).
 * What it brings: Fully automated configuration of the online spreadsheet with Date and Newspaper metadata fields.
 * Where changes can be seen: Direct creation of sheets and rows in your Google Spreadsheet.
 *
 * HOW TO RUN:
 * 1. In Apps Script, select "setupSpreadsheet" from the function dropdown at the top.
 * 2. Click "Run".
 * 3. Look at your Google Sheet — all 16 subjects are now created with 10-column headers!
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

  // v2 question column headers — now 10 columns with Date and Newspaper at the start
  const questionHeaders = ['Date', 'Newspaper', 'Question', 'Option A', 'Option B', 'Option C', 'Option D', 'Correct Answer', 'Explanation', 'Posted'];

  // Create or refresh each of the 16 subject question tabs
  for (let i = 0; i < configList.length; i++) {
    const subjName = configList[i].subject;
    // Check if the subject sheet already exists
    let subjSheet = ss.getSheetByName(subjName);
    if (!subjSheet) {
      // Insert new sheet tab with the clean subject name
      subjSheet = ss.insertSheet(subjName);
    } else {
      // Clear existing sheet to apply new column layout
      subjSheet.clear();
    }

    // Write the 10-column header row
    subjSheet.appendRow(questionHeaders);
    // Style header row with bold font and light background
    subjSheet.getRange(1, 1, 1, questionHeaders.length).setFontWeight('bold').setBackground('#F0F4F8');
    // Freeze the top header row for easy scrolling
    subjSheet.setFrozenRows(1);

    // Set column widths for comfortable viewing
    subjSheet.setColumnWidth(1, 120);   // Date
    subjSheet.setColumnWidth(2, 150);   // Newspaper
    subjSheet.setColumnWidth(3, 400);   // Question
    subjSheet.setColumnWidth(4, 200);   // Option A
    subjSheet.setColumnWidth(5, 200);   // Option B
    subjSheet.setColumnWidth(6, 200);   // Option C
    subjSheet.setColumnWidth(7, 200);   // Option D
    subjSheet.setColumnWidth(8, 120);   // Correct Answer
    subjSheet.setColumnWidth(9, 350);   // Explanation
    subjSheet.setColumnWidth(10, 200);  // Posted
  }

  // Remove the default blank "Sheet1" tab if it exists
  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet) {
    ss.deleteSheet(defaultSheet);
  }

  // Log completion message in Apps Script execution log
  Logger.log('✅ Spreadsheet setup complete! Config and 16 subject tabs created with v2 (10-column) layout.');
}
