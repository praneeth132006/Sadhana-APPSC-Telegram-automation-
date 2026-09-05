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
// COLUMN LAYOUT (v3) — 14 columns per subject sheet:
// A: S.No | B: Date | C: Newspaper | D: Question | E: Option A | F: Option B |
// G: Option C | H: Option D | I: Correct Answer | J: Explanation | K: Posted |
// L: Posted At | M: Added At | N: Added By
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
      // Extract user identification who uploaded the questions (from Firebase Auth)
      const addedBy = payload.added_by || payload.addedBy || 'Dashboard User';

      // Validate that subject and questions exist
      if (!subject) {
        return jsonResponse({ success: false, error: 'Missing "subject" field in payload' });
      }
      if (questions.length === 0) {
        return jsonResponse({ success: false, error: 'No questions provided in the payload' });
      }

      // Append questions to the correct subject tab with S.No, timestamps, and uploader email
      const addedCount = appendQuestionsToSheet(subject, questions, addedBy);
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
 * fetchUnpostedQuestions — Reads a subject sheet and returns questions where Posted (Col K, index 10) is not 'YES'.
 * v3 column layout (14 cols):
 * S.No(0) | Date(1) | Newspaper(2) | Question(3) | OptA(4) | OptB(5) | OptC(6) | OptD(7) | Answer(8) | Explanation(9) | Posted(10) | Posted At(11) | Added At(12) | Added By(13)
 *
 * @param {string} subject - Name of the subject tab (e.g., "Polity")
 * @param {number} limit - Maximum number of questions to return
 * @returns {Array<Object>} List of unposted questions with 1-based sheet row index
 */
function fetchUnpostedQuestions(subject, limit) {
  // Open active spreadsheet container
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // Locate the subject-specific sheet tab
  const sheet = ss.getSheetByName(subject);
  if (!sheet) {
    throw new Error('Sheet tab "' + subject + '" not found in spreadsheet.');
  }

  // Count total rows including header
  const lastRow = sheet.getLastRow();
  // Return empty array if sheet contains only header or is empty
  if (lastRow <= 1) return [];

  // Read all 14 columns (A through N) starting from row 2
  const data = sheet.getRange(2, 1, lastRow - 1, 14).getValues();
  // Array to collect unposted question objects
  const results = [];

  // Iterate over each data row checking posted status
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    // Column K (index 10) holds the posted status flag ('YES' or 'NO')
    const postedValue = String(row[10] || '').trim();

    // If "Posted" is not "YES", this question is pending
    if (postedValue.toUpperCase() !== 'YES') {
      // Column D (index 3) holds the question text
      const qText = String(row[3] || '').trim();
      // Skip blank rows where question text is empty
      if (qText.length > 0) {
        // Build structured question object with all 14 metadata fields
        results.push({
          s_no: row[0],                                                   // Column A: Serial number
          date: String(row[1] || '').trim(),                              // Column B: Publication date string (e.g. 05-09-2026)
          newspaper: String(row[2] || '').trim(),                         // Column C: Source newspaper name
          question_text: qText,                                           // Column D: Full question text
          option_a: String(row[4] || '').trim(),                          // Column E: Option A text
          option_b: String(row[5] || '').trim(),                          // Column F: Option B text
          option_c: String(row[6] || '').trim(),                          // Column G: Option C text
          option_d: String(row[7] || '').trim(),                          // Column H: Option D text
          correct_answer: String(row[8] || 'A').trim().toUpperCase(),    // Column I: Correct option letter (A, B, C, D)
          explanation: String(row[9] || '').trim(),                       // Column J: Detailed explanation
          posted: String(row[10] || 'NO').trim(),                         // Column K: Posted status ('YES' or 'NO')
          posted_at: String(row[11] || '').trim(),                        // Column L: Posted timestamp
          added_at: String(row[12] || '').trim(),                         // Column M: Added timestamp
          added_by: String(row[13] || '').trim(),                         // Column N: Added by user
          row_index: i,                                                   // 0-based data row index within sheet
          excel_row: i + 2                                                // 1-based sheet row number (header offset)
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
 * markRowsAsPostedInSheet — Updates "Posted" to 'YES' (Column K, col 11) and "Posted At" with timestamp (Column L, col 12).
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

  // Format Indian Standard Time (IST) timestamp for posted timestamp column
  const now = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MM-yyyy, hh:mm:ss a') + ' IST';

  // Update Column 11 (Column K — Posted = 'YES') and Column 12 (Column L — Posted At = timestamp)
  for (let i = 0; i < rowIndices.length; i++) {
    // If index is less than 2, it's 0-based, so add 2 to convert to sheet row number
    const rowNumber = rowIndices[i] < 2 ? rowIndices[i] + 2 : rowIndices[i];
    // Write 'YES' to Column K (column 11)
    sheet.getRange(rowNumber, 11).setValue('YES');
    // Write formatted IST timestamp to Column L (column 12)
    sheet.getRange(rowNumber, 12).setValue(now);
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
 * What it does: Takes an array of question objects and writes them as new rows in 14-column layout.
 * What it brings: Enables the web dashboard "Send to Sheet" button to batch-push questions with S.No, timestamps, and uploader tracking.
 * Where changes can be seen: New rows appended at the bottom of the subject-specific Google Sheet tab.
 *
 * @param {string} subject - Name of the subject sheet tab (e.g., "Polity")
 * @param {Array<Object>} questions - Array of question objects with date, newspaper, question, options, answer, explanation
 * @param {string} addedBy - Email or name of the user who pushed the questions (from Firebase Auth)
 * @returns {number} Count of questions successfully appended
 */
function appendQuestionsToSheet(subject, questions, addedBy) {
  // Open active spreadsheet container
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // Locate the subject-specific sheet tab
  const sheet = ss.getSheetByName(subject);
  if (!sheet) {
    throw new Error('Sheet tab "' + subject + '" not found. Run setupSpreadsheet() first.');
  }

  // Determine starting S.No based on current last row
  const lastRow = sheet.getLastRow();
  let startSNo = 1;
  // If rows already exist past the header, calculate the next consecutive S.No
  if (lastRow > 1) {
    const lastSNoVal = sheet.getRange(lastRow, 1).getValue();
    startSNo = (Number(lastSNoVal) || (lastRow - 1)) + 1;
  }

  // Format current IST timestamp for Added At column
  const addedAt = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MM-yyyy, hh:mm:ss a') + ' IST';
  // Standardize uploader email or display name
  const uploader = String(addedBy || 'Dashboard User').trim();

  // Track number of successfully appended questions
  let addedCount = 0;

  // Iterate through each question object and append as a new row
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const sNo = startSNo + i;

    // Build the 14-column row array matching the v3 column layout
    const newRow = [
      sNo,                                                    // Column A: S.No (Serial Number)
      String(q.date || '').trim(),                            // Column B: Date (e.g., "05-09-2026")
      String(q.newspaper || '').trim(),                       // Column C: Newspaper source name
      String(q.question || '').trim(),                        // Column D: Full question text
      String(q.option_a || '').trim(),                        // Column E: Option A
      String(q.option_b || '').trim(),                        // Column F: Option B
      String(q.option_c || '').trim(),                        // Column G: Option C
      String(q.option_d || '').trim(),                        // Column H: Option D
      String(q.correct_answer || 'A').trim().toUpperCase(),   // Column I: Correct answer letter (A, B, C, D)
      String(q.explanation || '').trim(),                     // Column J: Detailed explanation
      'NO',                                                   // Column K: Posted status ('NO' initially)
      '',                                                     // Column L: Posted At (empty until posted)
      addedAt,                                                // Column M: Added At timestamp (when pushed to sheet)
      uploader                                                // Column N: Added By (who pushed the questions)
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
 * v3: Reads 14 columns; Question text is in Column D (index 3), Posted status is in Column K (index 10).
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

    // Read all 14 columns: question in Col D (index 3), posted in Col K (index 10)
    var values = sheet.getRange(2, 1, lastRow - 1, 14).getValues();
    var total = 0;
    var posted = 0;

    // Count valid questions and posted status
    for (var j = 0; j < values.length; j++) {
      // Check Column D (index 3) for non-empty question text
      var qText = String(values[j][3] || '').trim();
      if (qText.length > 0) {
        total++;
        // Check Column K (index 10) for posted status
        var postedVal = String(values[j][10] || '').trim();
        if (postedVal.toUpperCase() === 'YES') {
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

  // v3 question column headers — 14 columns with S.No, timestamps, and uploader tracking
  const questionHeaders = [
    'S.No',
    'Date',
    'Newspaper',
    'Question',
    'Option A',
    'Option B',
    'Option C',
    'Option D',
    'Correct Answer',
    'Explanation',
    'Posted',
    'Posted At',
    'Added At',
    'Added By'
  ];

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

    // Write the 14-column header row
    subjSheet.appendRow(questionHeaders);
    // Style header row with bold font and clean light blue-gray background
    subjSheet.getRange(1, 1, 1, questionHeaders.length).setFontWeight('bold').setBackground('#F0F4F8');
    // Freeze the top header row for easy scrolling
    subjSheet.setFrozenRows(1);

    // Set column widths for optimal readability
    subjSheet.setColumnWidth(1, 70);    // S.No
    subjSheet.setColumnWidth(2, 120);   // Date
    subjSheet.setColumnWidth(3, 150);   // Newspaper
    subjSheet.setColumnWidth(4, 400);   // Question
    subjSheet.setColumnWidth(5, 200);   // Option A
    subjSheet.setColumnWidth(6, 200);   // Option B
    subjSheet.setColumnWidth(7, 200);   // Option C
    subjSheet.setColumnWidth(8, 200);   // Option D
    subjSheet.setColumnWidth(9, 120);   // Correct Answer
    subjSheet.setColumnWidth(10, 350);  // Explanation
    subjSheet.setColumnWidth(11, 90);   // Posted (YES/NO)
    subjSheet.setColumnWidth(12, 180);  // Posted At
    subjSheet.setColumnWidth(13, 180);  // Added At
    subjSheet.setColumnWidth(14, 220);  // Added By
  }

  // Remove the default blank "Sheet1" tab if it exists
  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet) {
    ss.deleteSheet(defaultSheet);
  }

  // Log completion message in Apps Script execution log
  Logger.log('✅ Spreadsheet setup complete! Config and 16 subject tabs created with v3 (14-column) layout.');
}
