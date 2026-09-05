// ============================================================================
// Google Apps Script — APPSC Telegram Quiz Automation Backend (v5)
// ============================================================================
// DEPLOY / UPGRADE INSTRUCTIONS
// 1. Open your Google Sheet ("Sadhana APPSC Questions Tracker")
// 2. Extensions > Apps Script, delete Code.gs contents, paste this whole file.
// 3. FIRST TIME ONLY: run `setupSpreadsheet` from the function dropdown.
//    UPGRADING FROM v4 (16 columns): run `upgradeSpreadsheet` instead. It
//    migrates every existing row into the new 30-column layout BY HEADER NAME,
//    so no data is lost and nothing is written into the wrong column.
// 4. Set a shared secret so the Web App is not world-writable:
//    Project Settings > Script properties > add `API_TOKEN` = <long random string>
//    Put the same value in the Node .env as SHEET_API_TOKEN.
//    (If API_TOKEN is unset the script still works but logs a warning in ping.)
// 5. Deploy > Manage deployments > Edit > New version
//    Execute as: Me | Who has access: Anyone  -> Deploy
// ============================================================================
//
// 30-COLUMN TRACKING SCHEMA (A .. AD)
//  A  S.No             Serial number within the subject sheet
//  B  Question ID      Stable unique id, e.g. POL-20260905-0007 (never reused)
//  C  Date             Publication / current-affairs date (DD-MM-YYYY)
//  D  Newspaper        Source publication (The Hindu, Indian Express, ...)
//  E  Subject          Subject category (mirrors the tab name)
//  F  Topic            Sub-topic inside the subject (e.g. "Fundamental Rights")
//  G  Question         Full question text and statements
//  H  Option A         Option A text
//  I  Option B         Option B text
//  J  Option C         Option C text
//  K  Option D         Option D text
//  L  Correct Answer   A / B / C / D
//  M  Explanation      Detailed rationale
//  N  Difficulty       Easy / Medium / Hard  (dropdown)
//  O  Tags             Comma separated keywords for search & revision
//  P  Source URL       Link to the article / PIB release the question came from
//  Q  Status           Draft/Review/Approved/Scheduled/Posted/Rejected/Archived
//  R  Posted           YES / NO (dropdown, colour coded)
//  S  Posted At        IST timestamp of the Telegram post
//  T  Scheduled For    Planned posting time (fills before it goes out)
//  U  Thread ID        Telegram forum topic thread the question went to
//  V  Telegram Msg ID  Message id of the poll (deep-link / audit trail)
//  W  Poll ID          Telegram poll id, used to attribute votes later
//  X  Times Posted     How many times this question has been sent (re-posts)
//  Y  Added At         IST timestamp of dashboard upload
//  Z  Added By         Curator email from Firebase Auth
//  AA Updated At       IST timestamp of the last edit
//  AB Updated By       Who made the last edit
//  AC Dup Hash         Normalised hash of the question text (duplicate guard)
//  AD Review Notes     Free-text QA remarks
// ============================================================================

/** Canonical header row shared by every subject tab. */
var QUESTION_HEADERS = [
  'S.No',            // A
  'Question ID',     // B
  'Date',            // C
  'Newspaper',       // D
  'Subject',         // E
  'Topic',           // F
  'Question',        // G
  'Option A',        // H
  'Option B',        // I
  'Option C',        // J
  'Option D',        // K
  'Correct Answer',  // L
  'Explanation',     // M
  'Difficulty',      // N
  'Tags',            // O
  'Source URL',      // P
  'Status',          // Q
  'Posted',          // R
  'Posted At',       // S
  'Scheduled For',   // T
  'Thread ID',       // U
  'Telegram Msg ID', // V
  'Poll ID',         // W
  'Times Posted',    // X
  'Added At',        // Y
  'Added By',        // Z
  'Updated At',      // AA
  'Updated By',      // AB
  'Dup Hash',        // AC
  'Review Notes'     // AD
];

/** Number of columns in the canonical schema. */
var COL_COUNT = QUESTION_HEADERS.length;

/** Allowed values for the Status workflow column. */
var STATUS_VALUES = ['Draft', 'Review', 'Approved', 'Scheduled', 'Posted', 'Rejected', 'Archived'];

/** Allowed values for the Difficulty column. */
var DIFFICULTY_VALUES = ['Easy', 'Medium', 'Hard'];

/** Sheet tabs that are configuration, not question banks. */
var RESERVED_SHEETS = ['Config', 'Dashboard', 'README'];

/** Master subject list with default Telegram thread ids and cron schedules. */
var SUBJECT_CONFIG_LIST = [
  { subject: 'History',                threadId: 6,  cron: '0 9,18 * * *',    count: 5, code: 'HIS' },
  { subject: 'AP History',             threadId: 7,  cron: '0 */3 * * *',     count: 5, code: 'APH' },
  { subject: 'Geography',              threadId: 8,  cron: '0 */3 * * *',     count: 5, code: 'GEO' },
  { subject: 'AP Geography',           threadId: 9,  cron: '0 */3 * * *',     count: 5, code: 'APG' },
  { subject: 'Economy',                threadId: 10, cron: '0 */3 * * *',     count: 5, code: 'ECO' },
  { subject: 'AP Economy',             threadId: 11, cron: '0 */3 * * *',     count: 5, code: 'APE' },
  { subject: 'Polity',                 threadId: 12, cron: '0 */2 * * *',     count: 5, code: 'POL' },
  { subject: 'Society',                threadId: 13, cron: '0 */4 * * *',     count: 5, code: 'SOC' },
  { subject: 'Current Affairs',        threadId: 14, cron: '0 8,14,20 * * *', count: 5, code: 'CUR' },
  { subject: 'Science and Technology', threadId: 15, cron: '0 */3 * * *',     count: 5, code: 'SCI' },
  { subject: 'Biology',                threadId: 16, cron: '0 */4 * * *',     count: 5, code: 'BIO' },
  { subject: 'Chemistry',              threadId: 17, cron: '0 */4 * * *',     count: 5, code: 'CHE' },
  { subject: 'Physics',                threadId: 18, cron: '0 */4 * * *',     count: 5, code: 'PHY' },
  { subject: 'Environment',            threadId: 19, cron: '0 */3 * * *',     count: 5, code: 'ENV' },
  { subject: 'General Studies',        threadId: 20, cron: '0 */3 * * *',     count: 5, code: 'GEN' },
  { subject: 'Disaster Management',    threadId: 21, cron: '0 */4 * * *',     count: 5, code: 'DIS' }
];

// ============================================================================
// Request routing
// ============================================================================

/**
 * doGet — read-only API surface.
 * Actions: ping, getConfig, getQuestions, getStats, getAnalytics, listQuestions,
 *          checkDuplicates, getSubjects.
 */
function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    var action = params.action || 'ping';

    // ping is deliberately unauthenticated: it is the liveness probe the
    // dashboard status pill uses, and it returns no spreadsheet data.
    if (action === 'ping') {
      return jsonResponse({
        success: true,
        status: 'ok',
        version: 'v5 (30 columns)',
        tokenRequired: Boolean(getApiToken()),
        message: 'Google Sheets API is running with 30-column enhanced tracking'
      });
    }

    var authError = requireToken(params.token);
    if (authError) return authError;

    if (action === 'getConfig') {
      return jsonResponse({ success: true, data: fetchConfigFromSheet() });
    }

    if (action === 'getSubjects') {
      return jsonResponse({ success: true, data: listSubjectSheets() });
    }

    // Unposted questions for the Telegram sender.
    if (action === 'getQuestions') {
      var subject = params.subject;
      if (!subject) return jsonResponse({ success: false, error: 'Missing "subject" query parameter' });
      var limit = clampInt(params.limit, 1, 1, 100);
      // Only Approved/Draft-ish rows are eligible unless the caller opts out.
      var requireApproved = String(params.requireApproved || '') === 'true';
      return jsonResponse({ success: true, data: fetchUnpostedQuestions(subject, limit, requireApproved) });
    }

    if (action === 'getStats') {
      return jsonResponse({ success: true, data: fetchSummaryStats() });
    }

    if (action === 'getAnalytics') {
      return jsonResponse({ success: true, data: buildAnalytics() });
    }

    if (action === 'listQuestions') {
      return jsonResponse({ success: true, data: listQuestions(params) });
    }

    if (action === 'checkDuplicates') {
      var hashes = String(params.hashes || '').split(',').filter(function (h) { return h; });
      return jsonResponse({ success: true, data: findExistingHashes(hashes) });
    }

    return jsonResponse({ success: false, error: 'Unknown GET action: ' + action });
  } catch (err) {
    return jsonResponse({ success: false, error: String(err && err.message ? err.message : err) });
  }
}

/**
 * doPost — mutating API surface.
 * Actions: addQuestions, markPosted, updateConfig, updateQuestion,
 *          deleteQuestion, bulkStatus, scheduleQuestions.
 */
function doPost(e) {
  try {
    var payload = {};
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    }

    var authError = requireToken(payload.token);
    if (authError) return authError;

    var action = payload.action;

    if (action === 'markPosted') {
      if (!payload.subject || !(payload.rowIndices || []).length) {
        return jsonResponse({ success: false, error: 'Missing subject or rowIndices array' });
      }
      var updated = markRowsAsPostedInSheet(
        payload.subject,
        payload.rowIndices,
        payload.messageId || payload.message_id || '',
        payload.threadId || '',
        payload.pollIds || {}
      );
      return jsonResponse({ success: true, updatedCount: updated });
    }

    if (action === 'updateConfig') {
      var configData = payload.config || [];
      if (!configData.length) return jsonResponse({ success: false, error: 'Missing config array' });
      updateConfigInSheet(configData);
      return jsonResponse({ success: true, message: 'Config updated successfully' });
    }

    if (action === 'addQuestions') {
      var subject = payload.subject;
      var questions = payload.questions || [];
      if (!subject) return jsonResponse({ success: false, error: 'Missing "subject" in payload' });
      if (!questions.length) return jsonResponse({ success: false, error: 'No questions provided in payload' });
      var result = appendQuestionsToSheet(
        subject,
        questions,
        payload.added_by || payload.addedBy || 'Dashboard User',
        payload.skipDuplicates !== false
      );
      return jsonResponse({
        success: true,
        addedCount: result.added,
        skippedCount: result.skipped,
        skipped: result.skippedQuestions,
        ids: result.ids,
        message: result.added + ' question(s) added to "' + subject + '"' +
                 (result.skipped ? ', ' + result.skipped + ' duplicate(s) skipped' : '')
      });
    }

    if (action === 'updateQuestion') {
      if (!payload.subject || !payload.questionId) {
        return jsonResponse({ success: false, error: 'Missing subject or questionId' });
      }
      var ok = updateQuestionRow(
        payload.subject, payload.questionId, payload.fields || {},
        payload.updated_by || payload.updatedBy || 'Dashboard User'
      );
      return jsonResponse(ok
        ? { success: true, message: 'Question ' + payload.questionId + ' updated' }
        : { success: false, error: 'Question ' + payload.questionId + ' not found in "' + payload.subject + '"' });
    }

    if (action === 'deleteQuestion') {
      if (!payload.subject || !payload.questionId) {
        return jsonResponse({ success: false, error: 'Missing subject or questionId' });
      }
      var deleted = deleteQuestionRow(payload.subject, payload.questionId);
      return jsonResponse(deleted
        ? { success: true, message: 'Question ' + payload.questionId + ' deleted' }
        : { success: false, error: 'Question ' + payload.questionId + ' not found' });
    }

    if (action === 'bulkStatus') {
      if (!payload.subject || !(payload.questionIds || []).length || !payload.status) {
        return jsonResponse({ success: false, error: 'Missing subject, questionIds or status' });
      }
      var count = bulkSetStatus(
        payload.subject, payload.questionIds, payload.status,
        payload.updated_by || 'Dashboard User'
      );
      return jsonResponse({ success: true, updatedCount: count });
    }

    if (action === 'scheduleQuestions') {
      if (!payload.subject || !(payload.questionIds || []).length) {
        return jsonResponse({ success: false, error: 'Missing subject or questionIds' });
      }
      var scheduled = scheduleQuestionRows(
        payload.subject, payload.questionIds, payload.scheduledFor || '',
        payload.updated_by || 'Dashboard User'
      );
      return jsonResponse({ success: true, updatedCount: scheduled });
    }

    return jsonResponse({ success: false, error: 'Unknown POST action: ' + action });
  } catch (err) {
    return jsonResponse({ success: false, error: String(err && err.message ? err.message : err) });
  }
}

// ============================================================================
// Authentication
// ============================================================================

/** Reads the shared secret from Script Properties (empty string when unset). */
function getApiToken() {
  try {
    return String(PropertiesService.getScriptProperties().getProperty('API_TOKEN') || '').trim();
  } catch (err) {
    return '';
  }
}

/**
 * requireToken — rejects the request unless the caller presented the shared
 * secret. Returns null when the call may proceed, or a JSON error response.
 * Comparison is length-safe and constant-time to avoid a timing oracle.
 */
function requireToken(supplied) {
  var expected = getApiToken();
  if (!expected) return null; // Token not configured — open mode (ping warns about it).
  if (!constantTimeEquals(String(supplied || ''), expected)) {
    return jsonResponse({ success: false, error: 'Unauthorized: missing or invalid API token' });
  }
  return null;
}

/** Constant-time string comparison so a wrong token leaks no length/prefix info. */
function constantTimeEquals(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ============================================================================
// Column helpers
// ============================================================================

/**
 * headerMap — builds a { canonicalHeader: zeroBasedIndex } lookup for a sheet.
 * Every read and write goes through this, so a sheet with extra or reordered
 * columns still works and older layouts keep resolving correctly.
 *
 * A header that is genuinely absent maps to -1 rather than to its canonical
 * position. That distinction matters: an older 16-column sheet has no
 * "Question ID" column, and falling back to canonical index 1 would have made
 * every read of Question ID return that sheet's Date instead — quietly
 * corrupting the migration. Reads treat -1 as empty; writes resolve it through
 * canonicalIndex(), which is safe because writes only ever run against a sheet
 * whose headers have already been made canonical.
 */
function headerMap(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), COL_COUNT);
  var raw = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var normalised = raw.map(function (h) { return normaliseHeader(h); });
  var map = {};

  for (var i = 0; i < QUESTION_HEADERS.length; i++) {
    var canonical = QUESTION_HEADERS[i];
    var aliases = headerAliases(canonical);
    var found = -1;
    for (var a = 0; a < aliases.length && found === -1; a++) {
      found = normalised.indexOf(aliases[a]);
    }
    map[canonical] = found;
  }
  return map;
}

/** Position a header occupies in the canonical 30-column layout. */
function canonicalIndex(header) {
  return QUESTION_HEADERS.indexOf(header);
}

/**
 * writeIndex — zero-based column to WRITE a header to.
 * Uses the sheet's actual position when the column exists, otherwise the
 * canonical one.
 */
function writeIndex(map, header) {
  var idx = map[header];
  return (idx === undefined || idx < 0) ? canonicalIndex(header) : idx;
}

/** Lowercases and strips punctuation so "Posted At" and "posted_at" both match. */
function normaliseHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/[\s._-]+/g, ' ');
}

/** Accepted spellings for each canonical header, including the v4 names. */
function headerAliases(canonical) {
  var table = {
    'S.No': ['s no', 'sno', 'sl no', 'serial'],
    'Question ID': ['question id', 'qid', 'id'],
    'Date': ['date'],
    'Newspaper': ['newspaper', 'source'],
    'Subject': ['subject'],
    'Topic': ['topic', 'sub topic', 'subtopic'],
    'Question': ['question', 'question text', 'prompt'],
    'Option A': ['option a', 'opt a'],
    'Option B': ['option b', 'opt b'],
    'Option C': ['option c', 'opt c'],
    'Option D': ['option d', 'opt d'],
    'Correct Answer': ['correct answer', 'answer', 'correct'],
    'Explanation': ['explanation', 'exp'],
    'Difficulty': ['difficulty', 'level'],
    'Tags': ['tags', 'keywords'],
    'Source URL': ['source url', 'url', 'link', 'reference'],
    'Status': ['status', 'workflow'],
    'Posted': ['posted'],
    'Posted At': ['posted at'],
    'Scheduled For': ['scheduled for', 'schedule at'],
    'Thread ID': ['thread id', 'topic thread id'],
    'Telegram Msg ID': ['telegram msg id', 'message id', 'msg id'],
    'Poll ID': ['poll id'],
    'Times Posted': ['times posted', 'post count'],
    'Added At': ['added at'],
    'Added By': ['added by', 'uploader'],
    'Updated At': ['updated at', 'modified at'],
    'Updated By': ['updated by', 'modified by'],
    'Dup Hash': ['dup hash', 'hash', 'fingerprint'],
    'Review Notes': ['review notes', 'notes', 'remarks']
  };
  return table[canonical] || [normaliseHeader(canonical)];
}

/** Reads a cell from a row array using the header map, always as trimmed text. */
function cell(row, map, header) {
  var idx = map[header];
  if (idx === undefined || idx < 0 || idx >= row.length) return '';
  var v = row[idx];
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Kolkata', 'dd-MM-yyyy');
  return String(v === null || v === undefined ? '' : v).trim();
}

/** 1-based sheet column number for a canonical header, safe for writes. */
function colNum(map, header) {
  return writeIndex(map, header) + 1;
}

// ============================================================================
// Reads
// ============================================================================

/** Names of every sheet tab that holds questions (excludes Config etc). */
function listSubjectSheets() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets()
    .map(function (s) { return s.getName(); })
    .filter(function (n) { return RESERVED_SHEETS.indexOf(n) === -1; });
}

/** Reads the Config tab into structured objects. */
function fetchConfigFromSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Config');
  if (!sheet) throw new Error('Sheet named "Config" not found. Run setupSpreadsheet() first.');

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  return sheet.getRange(2, 1, lastRow - 1, 6).getValues()
    .map(function (row) {
      return {
        subject: String(row[0] || '').trim(),
        emoji: String(row[1] || '').trim(),
        topic_thread_id: Number(row[2]) || null,
        schedule_cron: String(row[3] || '').trim(),
        questions_per_batch: Number(row[4]) || 5,
        active: String(row[5] || '').trim().toUpperCase() === 'YES'
      };
    })
    .filter(function (item) { return item.subject.length > 0; });
}

/** Converts one sheet row into the question object the rest of the app uses. */
function rowToQuestion(row, map, subject, dataIndex) {
  return {
    s_no: cell(row, map, 'S.No') || (dataIndex + 1),
    question_id: cell(row, map, 'Question ID'),
    date: cell(row, map, 'Date'),
    newspaper: cell(row, map, 'Newspaper'),
    subject: cell(row, map, 'Subject') || subject,
    topic: cell(row, map, 'Topic'),
    question_text: cell(row, map, 'Question'),
    option_a: cell(row, map, 'Option A'),
    option_b: cell(row, map, 'Option B'),
    option_c: cell(row, map, 'Option C'),
    option_d: cell(row, map, 'Option D'),
    correct_answer: cell(row, map, 'Correct Answer').toUpperCase() || 'A',
    explanation: cell(row, map, 'Explanation'),
    difficulty: cell(row, map, 'Difficulty') || 'Medium',
    tags: cell(row, map, 'Tags'),
    source_url: cell(row, map, 'Source URL'),
    status: cell(row, map, 'Status') || 'Draft',
    posted: cell(row, map, 'Posted') || 'NO',
    posted_at: cell(row, map, 'Posted At'),
    scheduled_for: cell(row, map, 'Scheduled For'),
    thread_id: cell(row, map, 'Thread ID'),
    telegram_msg_id: cell(row, map, 'Telegram Msg ID'),
    poll_id: cell(row, map, 'Poll ID'),
    times_posted: Number(cell(row, map, 'Times Posted')) || 0,
    added_at: cell(row, map, 'Added At'),
    added_by: cell(row, map, 'Added By'),
    updated_at: cell(row, map, 'Updated At'),
    updated_by: cell(row, map, 'Updated By'),
    dup_hash: cell(row, map, 'Dup Hash'),
    review_notes: cell(row, map, 'Review Notes'),
    row_index: dataIndex,
    excel_row: dataIndex + 2
  };
}

/**
 * fetchUnpostedQuestions — rows where Posted !== YES, skipping Rejected and
 * Archived so a rejected question can never leak onto the channel.
 *
 * @param {boolean} requireApproved When true only Status=Approved rows qualify.
 */
function fetchUnpostedQuestions(subject, limit, requireApproved) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(subject);
  if (!sheet) throw new Error('Sheet tab "' + subject + '" not found in spreadsheet.');

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  var map = headerMap(sheet);
  var lastCol = Math.max(sheet.getLastColumn(), COL_COUNT);
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var results = [];

  for (var i = 0; i < data.length && results.length < limit; i++) {
    var q = rowToQuestion(data[i], map, subject, i);
    if (!q.question_text) continue;
    if (q.posted.toUpperCase() === 'YES') continue;
    if (q.status === 'Rejected' || q.status === 'Archived') continue;
    if (requireApproved && q.status !== 'Approved' && q.status !== 'Scheduled') continue;
    results.push(q);
  }
  return results;
}

/**
 * listQuestions — filtered, paginated browse used by the Questions dashboard.
 * Filters: subject (or "all"), status, posted, difficulty, search, page, pageSize.
 */
function listQuestions(params) {
  var subjectParam = String(params.subject || 'all').trim();
  var subjects = (subjectParam === 'all' || !subjectParam) ? listSubjectSheets() : [subjectParam];

  var statusFilter = String(params.status || '').trim();
  var postedFilter = String(params.posted || '').trim().toUpperCase();
  var difficultyFilter = String(params.difficulty || '').trim();
  var search = String(params.search || '').trim().toLowerCase();
  var page = clampInt(params.page, 1, 1, 100000);
  var pageSize = clampInt(params.pageSize, 25, 1, 200);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var matched = [];

  for (var s = 0; s < subjects.length; s++) {
    var sheet = ss.getSheetByName(subjects[s]);
    if (!sheet) continue;
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) continue;

    var map = headerMap(sheet);
    var lastCol = Math.max(sheet.getLastColumn(), COL_COUNT);
    var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    for (var i = 0; i < data.length; i++) {
      var q = rowToQuestion(data[i], map, subjects[s], i);
      if (!q.question_text) continue;
      if (statusFilter && q.status !== statusFilter) continue;
      if (postedFilter && q.posted.toUpperCase() !== postedFilter) continue;
      if (difficultyFilter && q.difficulty !== difficultyFilter) continue;
      if (search) {
        var haystack = (q.question_text + ' ' + q.explanation + ' ' + q.tags + ' ' +
                        q.topic + ' ' + q.question_id + ' ' + q.newspaper).toLowerCase();
        if (haystack.indexOf(search) === -1) continue;
      }
      matched.push(q);
    }
  }

  var total = matched.length;
  var start = (page - 1) * pageSize;

  return {
    total: total,
    page: page,
    pageSize: pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    questions: matched.slice(start, start + pageSize)
  };
}

/** Summary counts per subject — the shape `node send.js --stats` prints. */
function fetchSummaryStats() {
  var analytics = buildAnalytics();
  return analytics.subjects.map(function (s) {
    return { subject: s.subject, total: s.total, posted: s.posted, pending: s.pending };
  });
}

/**
 * buildAnalytics — one pass over every subject tab producing everything the
 * Analytics dashboard renders: per-subject rollups, status and difficulty
 * breakdowns, curator contributions, a posting timeline and data-quality flags.
 */
function buildAnalytics() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var configs = [];
  try { configs = fetchConfigFromSheet(); } catch (err) { configs = []; }

  // Build the subject list from Config, then add any orphan tabs not in Config.
  var subjectNames = configs.map(function (c) { return c.subject; });
  listSubjectSheets().forEach(function (n) {
    if (subjectNames.indexOf(n) === -1) subjectNames.push(n);
  });

  var configBySubject = {};
  configs.forEach(function (c) { configBySubject[c.subject] = c; });

  var subjects = [];
  var statusTotals = {};
  var difficultyTotals = {};
  var curators = {};
  var postedByDay = {};
  var addedByDay = {};
  var newspapers = {};
  var qualityIssues = { missingExplanation: 0, missingOptions: 0, missingDate: 0, missingTopic: 0, duplicates: 0 };
  var hashSeen = {};

  STATUS_VALUES.forEach(function (s) { statusTotals[s] = 0; });
  DIFFICULTY_VALUES.forEach(function (d) { difficultyTotals[d] = 0; });

  var grand = { total: 0, posted: 0, pending: 0, approved: 0, scheduled: 0 };

  for (var s = 0; s < subjectNames.length; s++) {
    var name = subjectNames[s];
    var sheet = ss.getSheetByName(name);
    var entry = {
      subject: name,
      total: 0, posted: 0, pending: 0, approved: 0, draft: 0, rejected: 0, scheduled: 0,
      easy: 0, medium: 0, hard: 0,
      lastPostedAt: '', lastAddedAt: '',
      threadId: configBySubject[name] ? configBySubject[name].topic_thread_id : null,
      active: configBySubject[name] ? configBySubject[name].active : false,
      cron: configBySubject[name] ? configBySubject[name].schedule_cron : '',
      batchSize: configBySubject[name] ? configBySubject[name].questions_per_batch : 0,
      sheetExists: Boolean(sheet)
    };

    if (sheet) {
      var lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        var map = headerMap(sheet);
        var lastCol = Math.max(sheet.getLastColumn(), COL_COUNT);
        var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

        for (var i = 0; i < data.length; i++) {
          var q = rowToQuestion(data[i], map, name, i);
          if (!q.question_text) continue;

          entry.total++;
          var isPosted = q.posted.toUpperCase() === 'YES';
          if (isPosted) { entry.posted++; } else { entry.pending++; }

          var status = STATUS_VALUES.indexOf(q.status) !== -1 ? q.status : 'Draft';
          statusTotals[status]++;
          if (status === 'Approved') entry.approved++;
          if (status === 'Draft') entry.draft++;
          if (status === 'Rejected') entry.rejected++;
          if (status === 'Scheduled') entry.scheduled++;

          var diff = DIFFICULTY_VALUES.indexOf(q.difficulty) !== -1 ? q.difficulty : 'Medium';
          difficultyTotals[diff]++;
          if (diff === 'Easy') entry.easy++;
          if (diff === 'Medium') entry.medium++;
          if (diff === 'Hard') entry.hard++;

          if (q.added_by) {
            if (!curators[q.added_by]) curators[q.added_by] = { curator: q.added_by, added: 0, posted: 0 };
            curators[q.added_by].added++;
            if (isPosted) curators[q.added_by].posted++;
          }

          if (q.newspaper) newspapers[q.newspaper] = (newspapers[q.newspaper] || 0) + 1;

          var postedDay = dayKey(q.posted_at);
          if (isPosted && postedDay) postedByDay[postedDay] = (postedByDay[postedDay] || 0) + 1;
          var addedDay = dayKey(q.added_at);
          if (addedDay) addedByDay[addedDay] = (addedByDay[addedDay] || 0) + 1;

          if (q.posted_at && q.posted_at !== '-' && q.posted_at > entry.lastPostedAt) entry.lastPostedAt = q.posted_at;
          if (q.added_at && q.added_at !== '-' && q.added_at > entry.lastAddedAt) entry.lastAddedAt = q.added_at;

          if (!q.explanation) qualityIssues.missingExplanation++;
          if (!q.option_a || !q.option_b || !q.option_c || !q.option_d) qualityIssues.missingOptions++;
          if (!q.date || q.date === '-') qualityIssues.missingDate++;
          if (!q.topic) qualityIssues.missingTopic++;

          var h = q.dup_hash || hashQuestion(q.question_text);
          if (hashSeen[h]) { qualityIssues.duplicates++; } else { hashSeen[h] = true; }
        }
      }
    }

    // Runway: at the configured batch size and cron cadence, how many days of
    // pending questions remain before this subject runs dry.
    entry.batchesRemaining = entry.batchSize > 0 ? Math.floor(entry.pending / entry.batchSize) : 0;
    entry.postsPerDay = cronRunsPerDay(entry.cron);
    entry.daysOfRunway = (entry.active && entry.postsPerDay > 0 && entry.batchSize > 0)
      ? Math.round((entry.pending / (entry.postsPerDay * entry.batchSize)) * 10) / 10
      : null;

    grand.total += entry.total;
    grand.posted += entry.posted;
    grand.pending += entry.pending;
    grand.approved += entry.approved;
    grand.scheduled += entry.scheduled;
    subjects.push(entry);
  }

  return {
    generatedAt: Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MM-yyyy, hh:mm:ss a') + ' IST',
    totals: {
      total: grand.total,
      posted: grand.posted,
      pending: grand.pending,
      approved: grand.approved,
      scheduled: grand.scheduled,
      subjects: subjects.length,
      activeSubjects: subjects.filter(function (s) { return s.active; }).length,
      completionPct: grand.total ? Math.round((grand.posted / grand.total) * 1000) / 10 : 0,
      emptySubjects: subjects.filter(function (s) { return s.total === 0; }).length,
      lowStockSubjects: subjects.filter(function (s) { return s.total > 0 && s.pending < 10; }).length
    },
    subjects: subjects,
    statusBreakdown: statusTotals,
    difficultyBreakdown: difficultyTotals,
    curators: Object.keys(curators).map(function (k) { return curators[k]; })
      .sort(function (a, b) { return b.added - a.added; }),
    newspapers: Object.keys(newspapers).map(function (k) { return { newspaper: k, count: newspapers[k] }; })
      .sort(function (a, b) { return b.count - a.count; }).slice(0, 15),
    postedTimeline: toSortedSeries(postedByDay),
    addedTimeline: toSortedSeries(addedByDay),
    qualityIssues: qualityIssues
  };
}

/** Turns a {day: count} map into a chronologically sorted array for charting. */
function toSortedSeries(map) {
  return Object.keys(map)
    .sort()
    .map(function (k) { return { day: k, count: map[k] }; })
    .slice(-60);
}

/**
 * dayKey — extracts a sortable YYYY-MM-DD key from the "dd-MM-yyyy, hh:mm:ss a IST"
 * timestamps this script writes. Returns '' for placeholders like '-'.
 */
function dayKey(ts) {
  if (!ts || ts === '-') return '';
  var m = String(ts).match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (!m) return '';
  return m[3] + '-' + m[2] + '-' + m[1];
}

/**
 * cronRunsPerDay — rough count of daily executions for the simple cron forms
 * used in the Config tab (`0 9,18 * * *`, `0 * / 3 * * *`). Used for runway math.
 */
function cronRunsPerDay(cron) {
  if (!cron) return 0;
  var parts = String(cron).trim().split(/\s+/);
  if (parts.length < 5) return 0;
  var hour = parts[1];
  if (hour === '*') return 24;
  var stepMatch = hour.match(/^\*\/(\d+)$/);
  if (stepMatch) return Math.floor(24 / Math.max(1, Number(stepMatch[1])));
  return hour.split(',').filter(function (h) { return h !== ''; }).length;
}

/** Returns the subset of supplied hashes that already exist anywhere in the book. */
function findExistingHashes(hashes) {
  if (!hashes.length) return { existing: [] };
  var wanted = {};
  hashes.forEach(function (h) { wanted[h] = true; });

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var names = listSubjectSheets();
  var existing = {};

  for (var s = 0; s < names.length; s++) {
    var sheet = ss.getSheetByName(names[s]);
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) continue;
    var map = headerMap(sheet);
    var col = colNum(map, 'Dup Hash');
    if (col > sheet.getLastColumn()) continue;
    var values = sheet.getRange(2, col, lastRow - 1, 1).getValues();
    for (var i = 0; i < values.length; i++) {
      var h = String(values[i][0] || '').trim();
      if (h && wanted[h]) existing[h] = names[s];
    }
  }
  return {
    existing: Object.keys(existing).map(function (h) { return { hash: h, subject: existing[h] }; })
  };
}

// ============================================================================
// Writes
// ============================================================================

/**
 * markRowsAsPostedInSheet — flips Posted to YES and records the full posting
 * trail: timestamp, status, thread id, message id, poll id and repost count.
 *
 * @param {Object} pollIds Optional { rowNumber: pollId } map from the sender.
 */
function markRowsAsPostedInSheet(subject, rowIndices, messageId, threadId, pollIds) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(subject);
  if (!sheet) throw new Error('Sheet tab "' + subject + '" not found in spreadsheet.');

  var map = headerMap(sheet);
  var now = istNow();
  var updated = 0;

  for (var i = 0; i < rowIndices.length; i++) {
    // Callers pass either a 0-based data index or a 1-based sheet row.
    var rowNumber = rowIndices[i] < 2 ? rowIndices[i] + 2 : rowIndices[i];
    if (rowNumber < 2 || rowNumber > sheet.getLastRow()) continue;

    var prior = Number(sheet.getRange(rowNumber, colNum(map, 'Times Posted')).getValue()) || 0;

    sheet.getRange(rowNumber, colNum(map, 'Posted')).setValue('YES');
    sheet.getRange(rowNumber, colNum(map, 'Posted At')).setValue(now);
    sheet.getRange(rowNumber, colNum(map, 'Status')).setValue('Posted');
    sheet.getRange(rowNumber, colNum(map, 'Times Posted')).setValue(prior + 1);
    if (threadId) sheet.getRange(rowNumber, colNum(map, 'Thread ID')).setValue(String(threadId));
    if (messageId) sheet.getRange(rowNumber, colNum(map, 'Telegram Msg ID')).setValue(String(messageId));
    if (pollIds && pollIds[String(rowNumber)]) {
      sheet.getRange(rowNumber, colNum(map, 'Poll ID')).setValue(String(pollIds[String(rowNumber)]));
    }
    updated++;
  }
  return updated;
}

/**
 * appendQuestionsToSheet — writes new questions in one batch, assigning a stable
 * Question ID and duplicate hash to each, and skipping rows whose hash already
 * exists in the target sheet when skipDuplicates is on.
 */
function appendQuestionsToSheet(subject, questions, addedBy, skipDuplicates) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(subject);
  if (!sheet) {
    sheet = ss.insertSheet(subject);
    formatSheetHeaders(sheet);
  } else {
    ensureSheetHeaders(sheet);
  }

  var map = headerMap(sheet);
  var lastRow = sheet.getLastRow();

  // Collect existing hashes once so duplicate checking is O(1) per new row.
  var existingHashes = {};
  if (lastRow > 1) {
    var hashCol = sheet.getRange(2, colNum(map, 'Dup Hash'), lastRow - 1, 1).getValues();
    for (var h = 0; h < hashCol.length; h++) {
      var val = String(hashCol[h][0] || '').trim();
      if (val) existingHashes[val] = true;
    }
  }

  var startSNo = 1;
  if (lastRow > 1) {
    var lastSNoVal = sheet.getRange(lastRow, colNum(map, 'S.No')).getValue();
    startSNo = (Number(lastSNoVal) || (lastRow - 1)) + 1;
  }

  var addedAt = istNow();
  var uploader = String(addedBy || 'Dashboard User').trim();
  var code = subjectCode(subject);
  var stamp = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd');

  var rows = [];
  var ids = [];
  var skippedQuestions = [];
  var seenInBatch = {};

  for (var i = 0; i < questions.length; i++) {
    var q = questions[i] || {};
    var text = String(q.question || q.question_text || '').trim();
    if (!text) continue;

    var hash = hashQuestion(text);
    if (skipDuplicates && (existingHashes[hash] || seenInBatch[hash])) {
      skippedQuestions.push({ question: text.substring(0, 90), reason: 'duplicate' });
      continue;
    }
    seenInBatch[hash] = true;

    var sNo = startSNo + rows.length;
    var questionId = code + '-' + stamp + '-' + padNumber(sNo, 4);
    ids.push(questionId);

    var row = new Array(COL_COUNT).fill('');
    row[writeIndex(map, 'S.No')] = sNo;
    row[writeIndex(map, 'Question ID')] = questionId;
    row[writeIndex(map, 'Date')] = String(q.date || '').trim();
    row[writeIndex(map, 'Newspaper')] = String(q.newspaper || '').trim();
    row[writeIndex(map, 'Subject')] = subject;
    row[writeIndex(map, 'Topic')] = String(q.topic || '').trim();
    row[writeIndex(map, 'Question')] = text;
    row[writeIndex(map, 'Option A')] = String(q.option_a || '').trim();
    row[writeIndex(map, 'Option B')] = String(q.option_b || '').trim();
    row[writeIndex(map, 'Option C')] = String(q.option_c || '').trim();
    row[writeIndex(map, 'Option D')] = String(q.option_d || '').trim();
    row[writeIndex(map, 'Correct Answer')] = String(q.correct_answer || 'A').trim().toUpperCase();
    row[writeIndex(map, 'Explanation')] = String(q.explanation || '').trim();
    row[writeIndex(map, 'Difficulty')] = normaliseChoice(q.difficulty, DIFFICULTY_VALUES, 'Medium');
    row[writeIndex(map, 'Tags')] = String(q.tags || '').trim();
    row[writeIndex(map, 'Source URL')] = String(q.source_url || q.sourceUrl || '').trim();
    row[writeIndex(map, 'Status')] = normaliseChoice(q.status, STATUS_VALUES, 'Draft');
    row[writeIndex(map, 'Posted')] = 'NO';
    row[writeIndex(map, 'Posted At')] = '';
    row[writeIndex(map, 'Scheduled For')] = String(q.scheduled_for || '').trim();
    row[writeIndex(map, 'Thread ID')] = '';
    row[writeIndex(map, 'Telegram Msg ID')] = '';
    row[writeIndex(map, 'Poll ID')] = '';
    row[writeIndex(map, 'Times Posted')] = 0;
    row[writeIndex(map, 'Added At')] = addedAt;
    row[writeIndex(map, 'Added By')] = uploader;
    row[writeIndex(map, 'Updated At')] = addedAt;
    row[writeIndex(map, 'Updated By')] = uploader;
    row[writeIndex(map, 'Dup Hash')] = hash;
    row[writeIndex(map, 'Review Notes')] = String(q.review_notes || '').trim();

    rows.push(row);
  }

  // One setValues call instead of N appendRow calls — far fewer API round trips
  // and no partial writes if the script times out mid-batch.
  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, COL_COUNT).setValues(rows);
    applyPostedDataValidation(sheet);
  }

  return { added: rows.length, skipped: skippedQuestions.length, skippedQuestions: skippedQuestions, ids: ids };
}

/** Finds the sheet row number holding a given Question ID, or -1. */
function findRowByQuestionId(sheet, map, questionId) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return -1;
  var ids = sheet.getRange(2, colNum(map, 'Question ID'), lastRow - 1, 1).getValues();
  var target = String(questionId).trim();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || '').trim() === target) return i + 2;
  }
  return -1;
}

/** Fields the dashboard is allowed to edit — an allowlist, so a crafted payload
 *  can never overwrite Posted, timestamps, or the audit columns (mass assignment). */
var EDITABLE_FIELDS = {
  date: 'Date', newspaper: 'Newspaper', topic: 'Topic', question: 'Question',
  option_a: 'Option A', option_b: 'Option B', option_c: 'Option C', option_d: 'Option D',
  correct_answer: 'Correct Answer', explanation: 'Explanation', difficulty: 'Difficulty',
  tags: 'Tags', source_url: 'Source URL', status: 'Status', review_notes: 'Review Notes',
  scheduled_for: 'Scheduled For'
};

/** Applies an allowlisted field patch to one question row. */
function updateQuestionRow(subject, questionId, fields, updatedBy) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(subject);
  if (!sheet) throw new Error('Sheet tab "' + subject + '" not found.');

  var map = headerMap(sheet);
  var rowNumber = findRowByQuestionId(sheet, map, questionId);
  if (rowNumber === -1) return false;

  Object.keys(fields).forEach(function (key) {
    var header = EDITABLE_FIELDS[key];
    if (!header) return; // Silently ignore anything not on the allowlist.
    var value = fields[key];

    if (key === 'status') value = normaliseChoice(value, STATUS_VALUES, 'Draft');
    if (key === 'difficulty') value = normaliseChoice(value, DIFFICULTY_VALUES, 'Medium');
    if (key === 'correct_answer') {
      value = String(value || 'A').trim().toUpperCase();
      if (['A', 'B', 'C', 'D'].indexOf(value) === -1) value = 'A';
    }
    sheet.getRange(rowNumber, colNum(map, header)).setValue(String(value === null || value === undefined ? '' : value));
  });

  // Editing the question text invalidates the duplicate fingerprint.
  if (fields.question) {
    sheet.getRange(rowNumber, colNum(map, 'Dup Hash')).setValue(hashQuestion(String(fields.question)));
  }

  sheet.getRange(rowNumber, colNum(map, 'Updated At')).setValue(istNow());
  sheet.getRange(rowNumber, colNum(map, 'Updated By')).setValue(String(updatedBy || 'Dashboard User'));
  return true;
}

/** Deletes one question row by Question ID. */
function deleteQuestionRow(subject, questionId) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(subject);
  if (!sheet) throw new Error('Sheet tab "' + subject + '" not found.');
  var map = headerMap(sheet);
  var rowNumber = findRowByQuestionId(sheet, map, questionId);
  if (rowNumber === -1) return false;
  sheet.deleteRow(rowNumber);
  return true;
}

/** Sets Status on many rows at once (approve / reject / archive in bulk). */
function bulkSetStatus(subject, questionIds, status, updatedBy) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(subject);
  if (!sheet) throw new Error('Sheet tab "' + subject + '" not found.');

  var map = headerMap(sheet);
  var clean = normaliseChoice(status, STATUS_VALUES, 'Draft');
  var now = istNow();
  var count = 0;

  for (var i = 0; i < questionIds.length; i++) {
    var rowNumber = findRowByQuestionId(sheet, map, questionIds[i]);
    if (rowNumber === -1) continue;
    sheet.getRange(rowNumber, colNum(map, 'Status')).setValue(clean);
    sheet.getRange(rowNumber, colNum(map, 'Updated At')).setValue(now);
    sheet.getRange(rowNumber, colNum(map, 'Updated By')).setValue(String(updatedBy || 'Dashboard User'));
    count++;
  }
  return count;
}

/** Stamps Scheduled For and flips Status to Scheduled for the given questions. */
function scheduleQuestionRows(subject, questionIds, scheduledFor, updatedBy) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(subject);
  if (!sheet) throw new Error('Sheet tab "' + subject + '" not found.');

  var map = headerMap(sheet);
  var now = istNow();
  var count = 0;

  for (var i = 0; i < questionIds.length; i++) {
    var rowNumber = findRowByQuestionId(sheet, map, questionIds[i]);
    if (rowNumber === -1) continue;
    sheet.getRange(rowNumber, colNum(map, 'Scheduled For')).setValue(String(scheduledFor || ''));
    sheet.getRange(rowNumber, colNum(map, 'Status')).setValue('Scheduled');
    sheet.getRange(rowNumber, colNum(map, 'Updated At')).setValue(now);
    sheet.getRange(rowNumber, colNum(map, 'Updated By')).setValue(String(updatedBy || 'Dashboard User'));
    count++;
  }
  return count;
}

/** Writes topic thread ids back into the Config tab after `node setup.js`. */
function updateConfigInSheet(configData) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Config');
  if (!sheet) throw new Error('Config sheet not found. Run setupSpreadsheet() first.');

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  var subjects = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

  for (var r = 0; r < subjects.length; r++) {
    var subjectName = String(subjects[r][0] || '').trim().toLowerCase();
    var matched = configData.filter(function (c) {
      return String(c.subject || '').trim().toLowerCase() === subjectName;
    })[0];
    if (matched && matched.topic_thread_id) {
      sheet.getRange(r + 2, 3).setValue(matched.topic_thread_id);
    }
  }
}

// ============================================================================
// Sheet formatting & migration
// ============================================================================

/** Adds the canonical header row to a sheet that is missing or partially set up. */
function ensureSheetHeaders(sheet) {
  var lastCol = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();

  if (lastRow === 0 || lastCol === 0) {
    formatSheetHeaders(sheet);
    return;
  }

  var current = sheet.getRange(1, 1, 1, Math.max(lastCol, 1)).getValues()[0]
    .map(function (h) { return normaliseHeader(h); });

  // If every canonical header is already present we leave the sheet alone.
  var missing = QUESTION_HEADERS.filter(function (h) {
    return headerAliases(h).every(function (alias) { return current.indexOf(alias) === -1; });
  });
  if (!missing.length) return;

  // Otherwise migrate the tab into the canonical layout without losing data.
  migrateSheetToCanonical(sheet);
}

/**
 * migrateSheetToCanonical — rewrites a sheet into the 30-column layout, moving
 * each existing value into its canonical column BY HEADER NAME. Safe to re-run.
 */
function migrateSheetToCanonical(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var map = headerMap(sheet);
  var name = sheet.getName();

  var oldData = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
  var migrated = [];
  var stamp = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd');
  var code = subjectCode(name);

  for (var i = 0; i < oldData.length; i++) {
    var q = rowToQuestion(oldData[i], map, name, i);
    if (!q.question_text) continue;

    // Read Status from the raw cell rather than rowToQuestion, which defaults
    // it to 'Draft'. A v4 sheet has no Status column at all, and that default
    // would otherwise hide the fact that the row was already posted.
    var rawStatus = cell(oldData[i], map, 'Status');
    var wasPosted = q.posted.toUpperCase() === 'YES';

    var row = new Array(COL_COUNT).fill('');
    row[0]  = migrated.length + 1;
    row[1]  = q.question_id || (code + '-' + stamp + '-' + padNumber(migrated.length + 1, 4));
    row[2]  = q.date;
    row[3]  = q.newspaper;
    row[4]  = q.subject || name;
    row[5]  = q.topic;
    row[6]  = q.question_text;
    row[7]  = q.option_a;
    row[8]  = q.option_b;
    row[9]  = q.option_c;
    row[10] = q.option_d;
    row[11] = q.correct_answer;
    row[12] = q.explanation;
    row[13] = normaliseChoice(q.difficulty, DIFFICULTY_VALUES, 'Medium');
    row[14] = q.tags;
    row[15] = q.source_url;
    // A pre-existing posted row gets Status=Posted so the workflow column is
    // consistent with the Posted flag from day one.
    row[16] = STATUS_VALUES.indexOf(rawStatus) !== -1
      ? rawStatus
      : (wasPosted ? 'Posted' : 'Draft');
    row[17] = wasPosted ? 'YES' : 'NO';
    row[18] = q.posted_at === '-' ? '' : q.posted_at;
    row[19] = q.scheduled_for;
    row[20] = q.thread_id;
    row[21] = q.telegram_msg_id === '-' ? '' : q.telegram_msg_id;
    row[22] = q.poll_id;
    row[23] = q.times_posted || (wasPosted ? 1 : 0);
    row[24] = q.added_at === '-' ? '' : q.added_at;
    row[25] = q.added_by;
    row[26] = q.updated_at;
    row[27] = q.updated_by;
    row[28] = q.dup_hash || hashQuestion(q.question_text);
    row[29] = q.review_notes;

    migrated.push(row);
  }

  sheet.clear();
  formatSheetHeaders(sheet);
  if (migrated.length) {
    sheet.getRange(2, 1, migrated.length, COL_COUNT).setValues(migrated);
  }
  applyPostedDataValidation(sheet);
  applyConditionalFormatting(sheet);
  return migrated.length;
}

/** Writes and styles the header row, sets column widths and freezes row 1. */
function formatSheetHeaders(sheet) {
  var headerRange = sheet.getRange(1, 1, 1, COL_COUNT);
  headerRange.setValues([QUESTION_HEADERS]);
  headerRange
    .setFontWeight('bold')
    .setFontColor('#ffffff')
    .setBackground('#1a237e')
    .setVerticalAlignment('middle')
    .setHorizontalAlignment('center')
    .setWrap(true);

  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2); // Keep S.No + Question ID visible while scrolling.
  sheet.setRowHeight(1, 44);

  // Per-column widths tuned for readability of long APPSC statements.
  var widths = [
    55,  140, 100, 130, 130, 150, 460, 190, 190, 190,
    190, 110, 420, 95,  180, 200, 110, 80,  180, 150,
    90,  140, 140, 100, 180, 220, 180, 200, 130, 240
  ];
  for (var c = 0; c < widths.length; c++) {
    sheet.setColumnWidth(c + 1, widths[c]);
  }

  // Long-form text columns wrap; everything else stays on one line.
  var wrapCols = [7, 8, 9, 10, 11, 13, 30];
  for (var w = 0; w < wrapCols.length; w++) {
    sheet.getRange(2, wrapCols[w], Math.max(sheet.getMaxRows() - 1, 1), 1)
      .setWrap(true).setVerticalAlignment('top');
  }

  applyPostedDataValidation(sheet);
  applyConditionalFormatting(sheet);
}

/** Adds the YES/NO, Status and Difficulty dropdowns. */
function applyPostedDataValidation(sheet) {
  var rows = Math.max(sheet.getMaxRows() - 1, 1);
  var map = headerMap(sheet);

  var yesNo = SpreadsheetApp.newDataValidation()
    .requireValueInList(['YES', 'NO'], true).setAllowInvalid(false).build();
  sheet.getRange(2, colNum(map, 'Posted'), rows, 1).setDataValidation(yesNo);

  var status = SpreadsheetApp.newDataValidation()
    .requireValueInList(STATUS_VALUES, true).setAllowInvalid(false).build();
  sheet.getRange(2, colNum(map, 'Status'), rows, 1).setDataValidation(status);

  var difficulty = SpreadsheetApp.newDataValidation()
    .requireValueInList(DIFFICULTY_VALUES, true).setAllowInvalid(false).build();
  sheet.getRange(2, colNum(map, 'Difficulty'), rows, 1).setDataValidation(difficulty);
}

/** Colour codes Posted, Status and Difficulty so state is readable at a glance. */
function applyConditionalFormatting(sheet) {
  var rows = Math.max(sheet.getMaxRows() - 1, 1);
  var map = headerMap(sheet);

  var postedRange = sheet.getRange(2, colNum(map, 'Posted'), rows, 1);
  var statusRange = sheet.getRange(2, colNum(map, 'Status'), rows, 1);
  var diffRange = sheet.getRange(2, colNum(map, 'Difficulty'), rows, 1);

  function rule(range, text, bg, fg) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(text)
      .setBackground(bg)
      .setFontColor(fg)
      .setRanges([range])
      .build();
  }

  sheet.setConditionalFormatRules([
    rule(postedRange, 'YES', '#c8e6c9', '#1b5e20'),
    rule(postedRange, 'NO',  '#ffcdd2', '#b71c1c'),
    rule(statusRange, 'Approved',  '#c8e6c9', '#1b5e20'),
    rule(statusRange, 'Posted',    '#bbdefb', '#0d47a1'),
    rule(statusRange, 'Scheduled', '#fff9c4', '#f57f17'),
    rule(statusRange, 'Review',    '#ffe0b2', '#e65100'),
    rule(statusRange, 'Rejected',  '#ffcdd2', '#b71c1c'),
    rule(statusRange, 'Archived',  '#eceff1', '#455a64'),
    rule(diffRange,   'Easy',      '#dcedc8', '#33691e'),
    rule(diffRange,   'Medium',    '#fff9c4', '#f57f17'),
    rule(diffRange,   'Hard',      '#ffccbc', '#bf360c')
  ]);
}

// ============================================================================
// Setup / migration entry points (run these manually from the editor)
// ============================================================================

/**
 * setupSpreadsheet — first-time setup. Creates the Config tab and one tab per
 * subject with the full 30-column layout. Existing tabs are left untouched
 * apart from having headers ensured.
 */
function setupSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var config = ss.getSheetByName('Config');
  if (!config) config = ss.insertSheet('Config');
  config.clear();

  var configHeaders = ['Subject', 'Emoji', 'Topic_Thread_ID', 'Schedule_Cron', 'Questions_Per_Batch', 'Active'];
  config.getRange(1, 1, 1, configHeaders.length).setValues([configHeaders])
    .setFontWeight('bold').setFontColor('#ffffff').setBackground('#1a237e');
  config.setFrozenRows(1);

  var configRows = SUBJECT_CONFIG_LIST.map(function (s) {
    return [s.subject, '', s.threadId, s.cron, s.count, 'YES'];
  });
  config.getRange(2, 1, configRows.length, configHeaders.length).setValues(configRows);
  [160, 70, 130, 150, 170, 80].forEach(function (w, i) { config.setColumnWidth(i + 1, w); });

  for (var i = 0; i < SUBJECT_CONFIG_LIST.length; i++) {
    var name = SUBJECT_CONFIG_LIST[i].subject;
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      formatSheetHeaders(sheet);
    } else {
      ensureSheetHeaders(sheet);
    }
  }

  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Setup complete — ' + SUBJECT_CONFIG_LIST.length + ' subject tabs on the 30-column schema.',
    'Sadhana APPSC', 10
  );
}

/**
 * upgradeSpreadsheet — run this when moving from the v4 16-column layout.
 * Migrates every existing question tab into the 30-column schema by header
 * name, preserving all data, then reports what it touched.
 */
function upgradeSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var names = listSubjectSheets();
  var report = [];

  for (var i = 0; i < names.length; i++) {
    var sheet = ss.getSheetByName(names[i]);
    var migrated = migrateSheetToCanonical(sheet);
    report.push(names[i] + ': ' + migrated + ' rows');
  }

  // Make sure every configured subject has a tab, even if it was never created.
  for (var j = 0; j < SUBJECT_CONFIG_LIST.length; j++) {
    var wanted = SUBJECT_CONFIG_LIST[j].subject;
    if (!ss.getSheetByName(wanted)) {
      formatSheetHeaders(ss.insertSheet(wanted));
      report.push(wanted + ': created');
    }
  }

  Logger.log('Upgrade report:\n' + report.join('\n'));
  ss.toast('Upgraded ' + report.length + ' tabs to the 30-column schema. See Logs for detail.', 'Sadhana APPSC', 15);
  return report;
}

// ============================================================================
// Small utilities
// ============================================================================

/** Current time formatted the way every timestamp column in this book is stored. */
function istNow() {
  return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MM-yyyy, hh:mm:ss a') + ' IST';
}

/** Three-letter prefix for Question IDs, from the master list or the name itself. */
function subjectCode(subject) {
  for (var i = 0; i < SUBJECT_CONFIG_LIST.length; i++) {
    if (SUBJECT_CONFIG_LIST[i].subject === subject) return SUBJECT_CONFIG_LIST[i].code;
  }
  return String(subject || 'GEN').toUpperCase().replace(/[^A-Z]/g, '').substring(0, 3) || 'GEN';
}

/** Zero-pads a number to the requested width. */
function padNumber(n, width) {
  var s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

/**
 * hashQuestion — stable fingerprint of a question, used to detect duplicates.
 * The text is lowercased and stripped of punctuation and whitespace first, so
 * cosmetic edits do not create a "new" question.
 */
function hashQuestion(text) {
  var normalised = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .substring(0, 4000);
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, normalised);
  var hex = '';
  for (var i = 0; i < 8; i++) {
    var b = (digest[i] + 256) % 256;
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

/** Coerces a value to one of a fixed set, case-insensitively, with a fallback. */
function normaliseChoice(value, allowed, fallback) {
  var v = String(value || '').trim().toLowerCase();
  for (var i = 0; i < allowed.length; i++) {
    if (allowed[i].toLowerCase() === v) return allowed[i];
  }
  return fallback;
}

/** Parses an integer query param, clamped into a safe range. */
function clampInt(value, fallback, min, max) {
  var n = parseInt(value, 10);
  if (isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Wraps any object as a JSON TextOutput response. */
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
