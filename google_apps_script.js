// ============================================================================
// Google Apps Script — APPSC Telegram Quiz Automation Backend (v4)
// ============================================================================
// INSTRUCTIONS TO DEPLOY:
// 1. Open your Google Sheet in a browser ("Sadhana APPSC Questions Tracker")
// 2. Go to: Extensions > Apps Script
// 3. Delete any old code in Code.gs and paste this entire file
// 4. To upgrade your existing sheet with all 16 columns and keep existing questions:
//    - Select "upgradeSpreadsheet" from the function dropdown at the top and click "Run"!
// 5. To deploy Web App:
//    - Click the blue "Deploy" button (top right) > "Manage deployments" > Edit (pencil icon)
//    - Select Version: "New version"
//    - Set "Execute as": "Me"
//    - Set "Who has access": "Anyone"  <-- CRITICAL so dashboard and bot can connect!
//    - Click "Deploy"
// ============================================================================
//
// 16-COLUMN ENHANCED TRACKING SCHEMA (Columns A through P):
// 1.  S.No              (Col A) - Serial number (1, 2, 3...)
// 2.  Date              (Col B) - Publication/exam date (e.g., 05-09-2026)
// 3.  Newspaper         (Col C) - Source publication (e.g., The Hindu)
// 4.  Subject           (Col D) - Subject category (e.g., Environment)
// 5.  Question          (Col E) - Full question text and statements
// 6.  Option A          (Col F) - Option A choice text
// 7.  Option B          (Col G) - Option B choice text
// 8.  Option C          (Col H) - Option C choice text
// 9.  Option D          (Col I) - Option D choice text
// 10. Correct Answer    (Col J) - Correct option letter (A, B, C, D)
// 11. Explanation       (Col K) - Detailed rationale/statement analysis
// 12. Posted            (Col L) - Strictly 'YES' or 'NO' (Dropdown & Color-coded)
// 13. Posted At         (Col M) - Timestamp when published to Telegram
// 14. Added At          (Col N) - Timestamp when uploaded via Dashboard
// 15. Added By          (Col O) - Curator name/email from Firebase Auth
// 16. Telegram Msg ID   (Col P) - Telegram message link/ID for easy tracking
// ============================================================================

// Header definitions for all 16 subject tabs
// What this line does: Defines standard 16 column headers for tracking questions
// What it brings: Unifies the schema across all subject sheets with complete metadata
// Where changes can be seen: Row 1 of every subject sheet in Google Spreadsheet
const QUESTION_HEADERS = [
  'S.No',
  'Date',
  'Newspaper',
  'Subject',
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
  'Added By',
  'Telegram Msg ID'
];

// Master list of 16 APPSC subjects with clean names and default Telegram thread IDs
// What this line does: Maps all 16 topics to forum thread IDs created during setup
// What it brings: Central registry for batch scheduling and sheet tab generation
// Where changes can be seen: "Config" tab in Google Spreadsheet
const SUBJECT_CONFIG_LIST = [
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

/**
 * doGet — Handles HTTP GET requests sent from the Node.js automation bot or browser.
 * What it does: Routes actions for ping, getConfig, getQuestions, and getStats.
 * What it brings: Provides read access to unposted questions and subject configurations.
 * Where changes can be seen: Responses to GET requests from server.js and send.js.
 *
 * @param {Object} e - Event parameter containing HTTP query string parameters
 * @returns {TextOutput} JSON response payload
 */
function doGet(e) {
  try {
    // Extract query parameters from request URL
    const params = (e && e.parameter) || {};
    // Extract action parameter (default to ping)
    const action = params.action || 'ping';

    // Health check action
    if (action === 'ping') {
      return jsonResponse({
        status: 'ok',
        version: 'v4 (16 columns)',
        message: 'Google Sheets API is running with 16-column enhanced tracking'
      });
    }

    // Return subject configurations from Config sheet
    if (action === 'getConfig') {
      const config = fetchConfigFromSheet();
      return jsonResponse({ success: true, data: config });
    }

    // Return unposted questions for a specific subject
    if (action === 'getQuestions') {
      const subject = params.subject;
      const limit = parseInt(params.limit || '1', 10);

      if (!subject) {
        return jsonResponse({ success: false, error: 'Missing "subject" query parameter' });
      }

      const questions = fetchUnpostedQuestions(subject, limit);
      return jsonResponse({ success: true, data: questions });
    }

    // Return summary statistics across all subjects
    if (action === 'getStats') {
      const stats = fetchSummaryStats();
      return jsonResponse({ success: true, data: stats });
    }

    return jsonResponse({ success: false, error: 'Unknown GET action: ' + action });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

/**
 * doPost — Handles HTTP POST requests sent from the Node.js automation bot and web dashboard.
 * What it does: Handles markPosted, updateConfig, and addQuestions.
 * What it brings: Persists updates, marks questions as posted, and appends new questions with metadata.
 * Where changes can be seen: In the Google Spreadsheet rows and status flags.
 *
 * @param {Object} e - Event parameter containing HTTP POST body data
 * @returns {TextOutput} JSON response payload
 */
function doPost(e) {
  try {
    // Parse incoming JSON body
    let payload = {};
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    }

    const action = payload.action;

    // Handle marking questions as posted
    if (action === 'markPosted') {
      const subject = payload.subject;
      const rowIndices = payload.rowIndices || [];
      const messageId = payload.messageId || payload.message_id || '';

      if (!subject || !rowIndices.length) {
        return jsonResponse({ success: false, error: 'Missing subject or rowIndices array' });
      }

      const updatedCount = markRowsAsPostedInSheet(subject, rowIndices, messageId);
      return jsonResponse({ success: true, updatedCount: updatedCount });
    }

    // Handle updating topic thread IDs in Config tab
    if (action === 'updateConfig') {
      const configData = payload.config || [];
      if (!configData.length) {
        return jsonResponse({ success: false, error: 'Missing config array' });
      }

      updateConfigInSheet(configData);
      return jsonResponse({ success: true, message: 'Config updated successfully' });
    }

    // Handle appending questions from web dashboard
    if (action === 'addQuestions') {
      const subject = payload.subject;
      const questions = payload.questions || [];
      const addedBy = payload.added_by || payload.addedBy || 'Dashboard User';

      if (!subject) {
        return jsonResponse({ success: false, error: 'Missing "subject" in payload' });
      }
      if (questions.length === 0) {
        return jsonResponse({ success: false, error: 'No questions provided in payload' });
      }

      const addedCount = appendQuestionsToSheet(subject, questions, addedBy);
      return jsonResponse({
        success: true,
        addedCount: addedCount,
        message: addedCount + ' question(s) added to "' + subject + '"'
      });
    }

    return jsonResponse({ success: false, error: 'Unknown POST action: ' + action });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

/**
 * fetchConfigFromSheet — Reads the "Config" tab and returns subject list with topic IDs.
 * What it does: Reads Subject, Emoji, Topic_Thread_ID, Schedule_Cron, Questions_Per_Batch, Active.
 * What it brings: Dynamic configuration data for the bot scheduler.
 * Where changes can be seen: Used by schedule.js and send.js.
 *
 * @returns {Array<Object>} List of subject config objects
 */
function fetchConfigFromSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Config');
  if (!sheet) {
    throw new Error('Sheet named "Config" not found. Run setupSpreadsheet() first.');
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  return data
    .map(function(row) {
      return {
        subject: String(row[0] || '').trim(),
        emoji: String(row[1] || '').trim(),
        topic_thread_id: Number(row[2]) || null,
        schedule_cron: String(row[3] || '').trim(),
        questions_per_batch: Number(row[4]) || 5,
        active: String(row[5] || '').trim().toUpperCase() === 'YES'
      };
    })
    .filter(function(item) {
      return item.subject.length > 0;
    });
}

/**
 * fetchUnpostedQuestions — Reads a subject sheet and returns questions where Posted !== 'YES'.
 * What it does: Reads all 16 columns and returns unposted questions up to limit.
 * What it brings: Accurate fetching of questions that still need to be posted to Telegram.
 * Where changes can be seen: Questions sent to Telegram in send.js.
 *
 * @param {string} subject - Name of the subject tab
 * @param {number} limit - Maximum number of questions to retrieve
 * @returns {Array<Object>} List of unposted question objects
 */
function fetchUnpostedQuestions(subject, limit) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(subject);
  if (!sheet) {
    throw new Error('Sheet tab "' + subject + '" not found in spreadsheet.');
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  // Determine total columns available (at least 16)
  const lastCol = Math.max(sheet.getLastColumn(), 16);
  const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const results = [];

  // Identify column indices based on header row
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) {
    return String(h || '').trim().toLowerCase();
  });

  // Find column positions dynamically for backward compatibility
  const colSNo = findColIndex(headers, ['s.no', 'sno', 'sl.no', 'sl no'], 0);
  const colDate = findColIndex(headers, ['date'], 1);
  const colNews = findColIndex(headers, ['newspaper', 'source'], 2);
  const colSubj = findColIndex(headers, ['subject'], 3);
  const colQues = findColIndex(headers, ['question', 'question text', 'prompt'], 4);
  const colOptA = findColIndex(headers, ['option a', 'opt a', 'a'], 5);
  const colOptB = findColIndex(headers, ['option b', 'opt b', 'b'], 6);
  const colOptC = findColIndex(headers, ['option c', 'opt c', 'c'], 7);
  const colOptD = findColIndex(headers, ['option d', 'opt d', 'd'], 8);
  const colAns  = findColIndex(headers, ['correct answer', 'answer', 'correct'], 9);
  const colExp  = findColIndex(headers, ['explanation', 'exp'], 10);
  const colPost = findColIndex(headers, ['posted'], 11);
  const colPostAt = findColIndex(headers, ['posted at', 'posted_at'], 12);
  const colAddAt  = findColIndex(headers, ['added at', 'added_at'], 13);
  const colAddBy  = findColIndex(headers, ['added by', 'added_by', 'uploader'], 14);
  const colMsgId  = findColIndex(headers, ['telegram msg id', 'message id', 'msg id'], 15);

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const postedVal = String(row[colPost] || '').trim();

    // If not posted, this question is pending
    if (postedVal.toUpperCase() !== 'YES') {
      const qText = String(row[colQues] || '').trim();
      if (qText.length > 0) {
        results.push({
          s_no: row[colSNo] || (i + 1),
          date: String(row[colDate] || '').trim(),
          newspaper: String(row[colNews] || '').trim(),
          subject: String(row[colSubj] || subject).trim(),
          question_text: qText,
          option_a: String(row[colOptA] || '').trim(),
          option_b: String(row[colOptB] || '').trim(),
          option_c: String(row[colOptC] || '').trim(),
          option_d: String(row[colOptD] || '').trim(),
          correct_answer: String(row[colAns] || 'A').trim().toUpperCase(),
          explanation: String(row[colExp] || '').trim(),
          posted: postedVal || 'NO',
          posted_at: String(row[colPostAt] || '').trim(),
          added_at: String(row[colAddAt] || '').trim(),
          added_by: String(row[colAddBy] || '').trim(),
          telegram_msg_id: String(row[colMsgId] || '').trim(),
          row_index: i,
          excel_row: i + 2
        });

        if (results.length >= limit) {
          break;
        }
      }
    }
  }

  return results;
}

/**
 * markRowsAsPostedInSheet — Marks question rows as 'YES' with IST timestamp in Google Sheets.
 * What it does: Updates Column L (Posted) to 'YES' and Column M (Posted At) with IST timestamp.
 * What it brings: Clearly records when questions were sent to Telegram without mixing YES and timestamp into one cell.
 * Where changes can be seen: In Column L and Column M of the subject sheet.
 *
 * @param {string} subject - Name of the subject tab
 * @param {Array<number>} rowIndices - List of 1-based sheet row numbers or 0-based data indices
 * @param {string|number} [messageId] - Optional Telegram message ID
 * @returns {number} Count of marked rows
 */
function markRowsAsPostedInSheet(subject, rowIndices, messageId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(subject);
  if (!sheet) {
    throw new Error('Sheet tab "' + subject + '" not found in spreadsheet.');
  }

  // Format current IST timestamp
  const now = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MM-yyyy, hh:mm:ss a') + ' IST';

  for (let i = 0; i < rowIndices.length; i++) {
    // Determine row number: if < 2, convert 0-based index to 1-based sheet row
    const rowNumber = rowIndices[i] < 2 ? rowIndices[i] + 2 : rowIndices[i];

    // Column L (Col 12): Strictly 'YES'
    sheet.getRange(rowNumber, 12).setValue('YES');
    // Column M (Col 13): Posted At timestamp
    sheet.getRange(rowNumber, 13).setValue(now);
    // Column P (Col 16): Telegram Message ID if available
    if (messageId) {
      sheet.getRange(rowNumber, 16).setValue(String(messageId));
    }
  }

  return rowIndices.length;
}

/**
 * appendQuestionsToSheet — Appends questions from dashboard to a subject tab in 16-column format.
 * What it does: Ensures 16 headers exist, calculates next consecutive S.No, and appends rows.
 * What it brings: Direct integration from web dashboard with S.No, IST timestamps, and uploader attribution.
 * Where changes can be seen: Bottom rows of the subject sheet.
 *
 * @param {string} subject - Subject tab name
 * @param {Array<Object>} questions - Array of question objects
 * @param {string} addedBy - Authenticated user email/name from Firebase Auth
 * @returns {number} Count of added questions
 */
function appendQuestionsToSheet(subject, questions, addedBy) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(subject);

  // If subject tab does not exist, create it with 16-column layout
  if (!sheet) {
    sheet = ss.insertSheet(subject);
    formatSheetHeaders(sheet);
  } else {
    // Ensure 16-column headers are applied if sheet is new or had old layout
    ensureSheetHeaders(sheet);
  }

  // Calculate starting S.No
  const lastRow = sheet.getLastRow();
  let startSNo = 1;
  if (lastRow > 1) {
    const lastSNoVal = sheet.getRange(lastRow, 1).getValue();
    startSNo = (Number(lastSNoVal) || (lastRow - 1)) + 1;
  }

  // Format current IST timestamp for Added At column
  const addedAt = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MM-yyyy, hh:mm:ss a') + ' IST';
  const uploader = String(addedBy || 'Dashboard User').trim();

  let addedCount = 0;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const sNo = startSNo + i;

    // Build 16-column row
    const newRow = [
      sNo,                                                    // Col A (1):  S.No
      String(q.date || '').trim(),                            // Col B (2):  Date
      String(q.newspaper || '').trim(),                       // Col C (3):  Newspaper
      subject,                                                // Col D (4):  Subject
      String(q.question || q.question_text || '').trim(),     // Col E (5):  Question
      String(q.option_a || '').trim(),                        // Col F (6):  Option A
      String(q.option_b || '').trim(),                        // Col G (7):  Option B
      String(q.option_c || '').trim(),                        // Col H (8):  Option C
      String(q.option_d || '').trim(),                        // Col I (9):  Option D
      String(q.correct_answer || 'A').trim().toUpperCase(),   // Col J (10): Correct Answer
      String(q.explanation || '').trim(),                     // Col K (11): Explanation
      'NO',                                                   // Col L (12): Posted ('NO' initially)
      '-',                                                    // Col M (13): Posted At ('-' until posted)
      addedAt,                                                // Col N (14): Added At (when pushed from dashboard)
      uploader,                                               // Col O (15): Added By (who pushed it)
      '-'                                                     // Col P (16): Telegram Msg ID ('-' until posted)
    ];

    sheet.appendRow(newRow);
    addedCount++;
  }

  // Apply YES/NO dropdown validation on Column L for new rows
  applyPostedDataValidation(sheet);

  return addedCount;
}

/**
 * fetchSummaryStats — Computes total, posted, and pending counts across all 16 subjects.
 * What it does: Reads Column E (Question) and Column L (Posted) for each subject.
 * What it brings: High-level overview of question inventory.
 * Where changes can be seen: In CLI `node send.js --stats`.
 *
 * @returns {Array<Object>} Summary statistics array
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

    // Read question and posted status
    const values = sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), 16)).getValues();
    let total = 0;
    let posted = 0;

    for (let j = 0; j < values.length; j++) {
      // Check question text (Col 5 / index 4)
      const qText = String(values[j][4] || '').trim();
      if (qText.length > 0) {
        total++;
        // Check posted status (Col 12 / index 11)
        const postedVal = String(values[j][11] || '').trim();
        if (postedVal.toUpperCase() === 'YES') {
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
 * updateConfigInSheet — Updates Topic Thread IDs in the "Config" sheet.
 *
 * @param {Array<Object>} configData - Config items with topic_thread_id
 */
function updateConfigInSheet(configData) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Config');
  if (!sheet) {
    throw new Error('Config sheet not found. Run setupSpreadsheet() first.');
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  const subjects = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

  for (let r = 0; r < subjects.length; r++) {
    const subjectName = String(subjects[r][0] || '').trim().toLowerCase();
    const matched = configData.find(function(c) {
      return String(c.subject || '').trim().toLowerCase() === subjectName;
    });

    if (matched && matched.topic_thread_id) {
      sheet.getRange(r + 2, 3).setValue(matched.topic_thread_id);
    }
  }
}

// ============================================================================
// Spreadsheet Formatting & Upgrade Helpers
// ============================================================================

/**
 * ensureSheetHeaders — Verifies if sheet has the 16 headers; applies them if not.
 *
 * @param {Sheet} sheet - Google Sheet tab
 */
function ensureSheetHeaders(sheet) {
  const lastRow = sheet.getLastRow();
  // If completely empty, format headers
  if (lastRow === 0) {
    formatSheetHeaders(sheet);
    return;
  }

  // Check header in row 1
  const firstRow = sheet.getRange(1, 1, 1, Math.min(sheet.getLastColumn(), 5)).getValues()[0];
  const firstHeader = String(firstRow[0] || '').trim();

  // If first column is not "S.No", upgrade is needed
  if (firstHeader !== 'S.No') {
    formatSheetHeaders(sheet);
  }
}

/**
 * formatSheetHeaders — Formats row 1 with 16 column headers and styling.
 * What it does: Writes QUESTION_HEADERS, freezes row 1, sets widths, and sets conditional formatting.
 * What it brings: Elegant, professional look with dark header and distinct column sizes.
 * Where changes can be seen: Top row of the sheet.
 *
 * @param {Sheet} sheet - Target sheet tab
 */
function formatSheetHeaders(sheet) {
  // Write header values
  sheet.getRange(1, 1, 1, QUESTION_HEADERS.length).setValues([QUESTION_HEADERS]);

  // Style header row: Dark slate background (#1E293B) with white bold text
  sheet.getRange(1, 1, 1, QUESTION_HEADERS.length)
    .setFontWeight('bold')
    .setFontColor('#FFFFFF')
    .setBackground('#1E293B')
    .setHorizontalAlignment('center');

  // Freeze header row
  sheet.setFrozenRows(1);

  // Set optimal column widths
  sheet.setColumnWidth(1, 70);    // S.No
  sheet.setColumnWidth(2, 110);   // Date
  sheet.setColumnWidth(3, 140);   // Newspaper
  sheet.setColumnWidth(4, 140);   // Subject
  sheet.setColumnWidth(5, 420);   // Question
  sheet.setColumnWidth(6, 180);   // Option A
  sheet.setColumnWidth(7, 180);   // Option B
  sheet.setColumnWidth(8, 180);   // Option C
  sheet.setColumnWidth(9, 180);   // Option D
  sheet.setColumnWidth(10, 110);  // Correct Answer
  sheet.setColumnWidth(11, 380);  // Explanation
  sheet.setColumnWidth(12, 100);  // Posted (YES/NO)
  sheet.setColumnWidth(13, 200);  // Posted At
  sheet.setColumnWidth(14, 200);  // Added At
  sheet.setColumnWidth(15, 230);  // Added By
  sheet.setColumnWidth(16, 140);  // Telegram Msg ID

  // Set alignments for data columns
  sheet.getRange('A2:A').setHorizontalAlignment('center');  // S.No centered
  sheet.getRange('B2:B').setHorizontalAlignment('center');  // Date centered
  sheet.getRange('J2:J').setHorizontalAlignment('center');  // Correct Answer centered
  sheet.getRange('L2:L').setHorizontalAlignment('center');  // Posted centered

  // Apply conditional formatting on Column L (Posted: YES = Green, NO = Red)
  applyConditionalFormatting(sheet);

  // Apply Data Validation dropdown (YES, NO) on Column L
  applyPostedDataValidation(sheet);
}

/**
 * applyPostedDataValidation — Adds a dropdown selector for YES/NO in Column L.
 *
 * @param {Sheet} sheet - Target sheet tab
 */
function applyPostedDataValidation(sheet) {
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['YES', 'NO'], true)
    .setAllowInvalid(false)
    .build();

  sheet.getRange('L2:L500').setDataValidation(rule);
}

/**
 * applyConditionalFormatting — Colors Column L cells (Green for YES, Red for NO).
 *
 * @param {Sheet} sheet - Target sheet tab
 */
function applyConditionalFormatting(sheet) {
  const range = sheet.getRange('L2:L1000');

  // Green rule for YES
  const yesRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('YES')
    .setBackground('#E6F4EA')
    .setFontColor('#137333')
    .setBold(true)
    .setRanges([range])
    .build();

  // Red/Orange rule for NO
  const noRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('NO')
    .setBackground('#FCE8E6')
    .setFontColor('#C5221F')
    .setBold(true)
    .setRanges([range])
    .build();

  sheet.setConditionalFormatRules([yesRule, noRule]);
}

/**
 * findColIndex — Helper to find a column index based on candidate header names.
 *
 * @param {Array<string>} headers - Lowercased header names array
 * @param {Array<string>} candidates - Possible matches
 * @param {number} defaultIndex - Default index if not found
 * @returns {number} 0-based column index
 */
function findColIndex(headers, candidates, defaultIndex) {
  for (let c = 0; c < candidates.length; c++) {
    const idx = headers.indexOf(candidates[c]);
    if (idx !== -1) return idx;
  }
  return defaultIndex;
}

// ============================================================================
// One-Click Setup & Migration Functions (Run from Apps Script Editor)
// ============================================================================

/**
 * upgradeSpreadsheet — Safely upgrades existing sheets to 16 columns without losing questions!
 * What it does:
 * 1. Reads existing rows in each subject sheet.
 * 2. Parses previous columns (including splitting "YES | 05/09/2026..." into separate YES and timestamp).
 * 3. Populates S.No consecutively (1, 2, 3...).
 * 4. Writes all data back with 16 columns and applies beautiful styling, dropdowns, and colors.
 *
 * HOW TO RUN:
 * 1. Select "upgradeSpreadsheet" from the dropdown at the top.
 * 2. Click "Run".
 * 3. Check your Google Sheet — all your existing questions are preserved and upgraded to 16 columns!
 */
function upgradeSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  for (let c = 0; c < SUBJECT_CONFIG_LIST.length; c++) {
    const subjName = SUBJECT_CONFIG_LIST[c].subject;
    const sheet = ss.getSheetByName(subjName);
    if (!sheet) continue;

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();

    // If empty or only header, simply apply new headers
    if (lastRow <= 1) {
      sheet.clear();
      formatSheetHeaders(sheet);
      continue;
    }

    // Read existing headers and data
    const existingHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) {
      return String(h || '').trim().toLowerCase();
    });
    const existingData = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    // Map existing columns
    const colDate = findColIndex(existingHeaders, ['date'], 0);
    const colNews = findColIndex(existingHeaders, ['newspaper', 'source'], 1);
    const colSubj = findColIndex(existingHeaders, ['subject'], 2);
    const colQues = findColIndex(existingHeaders, ['question', 'question text', 'prompt'], 3);
    const colOptA = findColIndex(existingHeaders, ['option a', 'opt a', 'a'], 4);
    const colOptB = findColIndex(existingHeaders, ['option b', 'opt b', 'b'], 5);
    const colOptC = findColIndex(existingHeaders, ['option c', 'opt c', 'c'], 6);
    const colOptD = findColIndex(existingHeaders, ['option d', 'opt d', 'd'], 7);
    const colAns  = findColIndex(existingHeaders, ['correct answer', 'answer', 'correct'], 8);
    const colExp  = findColIndex(existingHeaders, ['explanation', 'exp'], 9);
    const colPost = findColIndex(existingHeaders, ['posted'], 10);

    const upgradedRows = [];

    for (let r = 0; r < existingData.length; r++) {
      const oldRow = existingData[r];
      const qText = String(oldRow[colQues] || oldRow[3] || '').trim();
      if (!qText) continue;

      // Extract Posted status and timestamp
      const rawPosted = String(oldRow[colPost] || oldRow[10] || '').trim();
      let postedStatus = 'NO';
      let postedAt = '-';

      if (rawPosted.toUpperCase().includes('YES')) {
        postedStatus = 'YES';
        // Check if timestamp is embedded like "YES | 05/09/2026, 01:16:37 PM"
        if (rawPosted.includes('|')) {
          postedAt = rawPosted.split('|')[1].trim();
        } else {
          postedAt = 'Earlier Post';
        }
      }

      upgradedRows.push([
        r + 1,                                                      // Col A: S.No (consecutive)
        String(oldRow[colDate] || '').trim(),                       // Col B: Date
        String(oldRow[colNews] || '').trim(),                       // Col C: Newspaper
        subjName,                                                   // Col D: Subject
        qText,                                                      // Col E: Question
        String(oldRow[colOptA] || '').trim(),                       // Col F: Option A
        String(oldRow[colOptB] || '').trim(),                       // Col G: Option B
        String(oldRow[colOptC] || '').trim(),                       // Col H: Option C
        String(oldRow[colOptD] || '').trim(),                       // Col I: Option D
        String(oldRow[colAns] || 'A').trim().toUpperCase(),         // Col J: Correct Answer
        String(oldRow[colExp] || '').trim(),                        // Col K: Explanation
        postedStatus,                                               // Col L: Posted ('YES' or 'NO')
        postedAt,                                                   // Col M: Posted At
        'Imported / Initial',                                       // Col N: Added At
        'Initial Import',                                           // Col O: Added By
        '-'                                                         // Col P: Telegram Msg ID
      ]);
    }

    // Clear sheet and rewrite with 16 columns
    sheet.clear();
    formatSheetHeaders(sheet);

    if (upgradedRows.length > 0) {
      sheet.getRange(2, 1, upgradedRows.length, 16).setValues(upgradedRows);
    }
  }

  Logger.log('✅ Spreadsheet upgraded successfully to 16-column enhanced tracking! All existing questions preserved.');
}

/**
 * setupSpreadsheet — Full initial setup for your Google Spreadsheet.
 * What it does: Creates Config sheet + all 16 subject tabs with 16-column layout.
 *
 * HOW TO RUN:
 * 1. Select "setupSpreadsheet" from the dropdown.
 * 2. Click "Run".
 */
function setupSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Setup Config sheet
  let configSheet = ss.getSheetByName('Config');
  if (!configSheet) {
    configSheet = ss.insertSheet('Config', 0);
  }
  configSheet.clear();

  const configHeaders = ['Subject', 'Emoji', 'Topic_Thread_ID', 'Schedule_Cron', 'Questions_Per_Batch', 'Active'];
  configSheet.appendRow(configHeaders);
  configSheet.getRange(1, 1, 1, configHeaders.length)
    .setFontWeight('bold')
    .setFontColor('#FFFFFF')
    .setBackground('#1E293B');

  for (let i = 0; i < SUBJECT_CONFIG_LIST.length; i++) {
    const item = SUBJECT_CONFIG_LIST[i];
    configSheet.appendRow([item.subject, '', item.threadId, item.cron, item.count, 'YES']);
  }
  configSheet.setFrozenRows(1);

  // 2. Setup 16 subject sheets
  for (let i = 0; i < SUBJECT_CONFIG_LIST.length; i++) {
    const subjName = SUBJECT_CONFIG_LIST[i].subject;
    let subjSheet = ss.getSheetByName(subjName);
    if (!subjSheet) {
      subjSheet = ss.insertSheet(subjName);
    } else {
      subjSheet.clear();
    }
    formatSheetHeaders(subjSheet);
  }

  // 3. Delete default Sheet1 if present
  const defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }

  Logger.log('✅ setupSpreadsheet complete! Config and all 16 subjects formatted with 16-column layout.');
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
