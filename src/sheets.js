// ============================================================================
// Google Sheets Service — client for the Apps Script Web App (v5 / 30 columns)
// ============================================================================
// Every call goes through `request()`, which is the single place that:
//   - resolves the Web App URL from the environment (never from user input),
//   - attaches the shared API token from SHEET_API_TOKEN,
//   - enforces a timeout so a hung Apps Script cannot pin a Node worker,
//   - detects the Google sign-in HTML that comes back from a mis-deployed
//     script and turns it into an actionable error instead of a JSON parse
//     failure.
//
// Callers pass an action plus parameters. They never pass a URL — that is what
// made the previous version SSRF-able from the browser.
// ============================================================================

/** Hard ceiling on how long we wait for Apps Script before giving up. */
const REQUEST_TIMEOUT_MS = 30000;

/** Largest upstream response we will buffer (Apps Script pages are far smaller). */
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/**
 * getWebAppUrl — resolves and validates the deployed Apps Script URL.
 * Only script.google.com endpoints are accepted, so a mistyped or hostile
 * value in .env cannot redirect our server-side fetches somewhere else.
 *
 * @returns {string} The validated Web App URL
 */
function getWebAppUrl() {
  const raw = process.env.GOOGLE_SHEET_WEBAPP_URL;
  if (!raw || !raw.trim()) {
    throw new Error(
      'GOOGLE_SHEET_WEBAPP_URL is not defined in .env.\n' +
      'Deploy google_apps_script.js as a Web App and put the /exec URL in .env.'
    );
  }

  const url = raw.trim();
  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    throw new Error('GOOGLE_SHEET_WEBAPP_URL is not a valid URL: ' + url);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('GOOGLE_SHEET_WEBAPP_URL must use https.');
  }
  if (parsed.hostname !== 'script.google.com' && parsed.hostname !== 'script.googleusercontent.com') {
    throw new Error(
      'GOOGLE_SHEET_WEBAPP_URL must point at script.google.com. Got: ' + parsed.hostname
    );
  }
  if (!parsed.pathname.endsWith('/exec')) {
    throw new Error(
      'GOOGLE_SHEET_WEBAPP_URL must end in /exec (the deployment URL), not /edit or /dev.'
    );
  }

  return url;
}

/** Returns the shared secret that authenticates us to the Apps Script. */
function getApiToken() {
  return String(process.env.SHEET_API_TOKEN || '').trim();
}

/** True when the sheet backend is configured well enough to be used. */
function isConfigured() {
  try {
    getWebAppUrl();
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * request — performs one Apps Script call and returns the parsed JSON body.
 *
 * @param {'GET'|'POST'} method HTTP method
 * @param {Object} params Query parameters (GET) or body fields (POST)
 * @returns {Promise<Object>} Parsed response payload
 */
async function request(method, params) {
  const baseUrl = getWebAppUrl();
  const token = getApiToken();

  // AbortController gives us a hard timeout; without it a stalled Apps Script
  // would hold the request open indefinitely.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    if (method === 'GET') {
      const query = new URLSearchParams();
      Object.keys(params).forEach((key) => {
        if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
          query.set(key, String(params[key]));
        }
      });
      if (token) query.set('token', token);

      response = await fetch(`${baseUrl}?${query.toString()}`, {
        redirect: 'follow',
        signal: controller.signal
      });
    } else {
      const body = Object.assign({}, params);
      if (token) body.token = token;

      response = await fetch(baseUrl, {
        method: 'POST',
        redirect: 'follow',
        // Apps Script only receives e.postData.contents intact with text/plain;
        // application/json triggers a CORS preflight it cannot answer.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    }
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error(`Google Sheets request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw new Error('Google Sheets request failed: ' + err.message);
  }
  clearTimeout(timer);

  if (!response.ok) {
    throw new Error(`Google Sheets request failed with status ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new Error('Google Sheets response exceeded the size limit.');
  }

  // A script deployed with "Who has access: Me" answers with a login page.
  if (/accounts\.google\.com|<!doctype html/i.test(text)) {
    throw new Error(
      'Google Apps Script returned a sign-in page. Redeploy the Web App with "Who has access: Anyone".'
    );
  }

  let result;
  try {
    result = JSON.parse(text);
  } catch (err) {
    throw new Error('Google Sheets returned a non-JSON response: ' + text.slice(0, 180));
  }

  if (result.success === false) {
    throw new Error(result.error || 'Unknown Google Sheets API error');
  }
  return result;
}

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/** Liveness probe. Also reports whether the script expects a token. */
async function ping() {
  return request('GET', { action: 'ping' });
}

/** Reads the Config tab (subjects, emojis, thread ids, cron, batch size). */
async function readConfig() {
  const result = await request('GET', { action: 'getConfig' });
  return result.data || [];
}

/** Lists the sheet tabs that hold questions. */
async function getSubjects() {
  const result = await request('GET', { action: 'getSubjects' });
  return result.data || [];
}

/**
 * getUnpostedQuestions — next batch of questions eligible for posting.
 *
 * @param {string} subject Subject tab name
 * @param {number} count Maximum questions to return
 * @param {boolean} requireApproved Only return Approved/Scheduled rows
 */
async function getUnpostedQuestions(subject, count = 1, requireApproved = false) {
  const result = await request('GET', {
    action: 'getQuestions',
    subject,
    limit: count,
    requireApproved: requireApproved ? 'true' : ''
  });
  return result.data || [];
}

/** Per-subject total / posted / pending counts. */
async function getStats() {
  const result = await request('GET', { action: 'getStats' });
  return result.data || [];
}

/** Full analytics payload consumed by the Analytics dashboard. */
async function getAnalytics() {
  const result = await request('GET', { action: 'getAnalytics' });
  return result.data || null;
}

/** Filtered, paginated question browse. */
async function listQuestions(filters = {}) {
  const result = await request('GET', Object.assign({ action: 'listQuestions' }, filters));
  return result.data || { total: 0, questions: [], page: 1, totalPages: 1 };
}

/** Reports which of the supplied duplicate hashes already exist. */
async function checkDuplicates(hashes = []) {
  if (!hashes.length) return { existing: [] };
  const result = await request('GET', { action: 'checkDuplicates', hashes: hashes.join(',') });
  return result.data || { existing: [] };
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

/** Writes topic thread ids back into the Config tab. */
async function writeConfig(configData) {
  await request('POST', { action: 'updateConfig', config: configData });
  return true;
}

/**
 * markAsPosted — records the full posting trail for a batch of rows.
 *
 * @param {string} subject Subject tab name
 * @param {Array<number>} rowIndices Row indices returned by getUnpostedQuestions
 * @param {string|number} [messageId] Telegram message id of the poll
 * @param {string|number} [threadId] Forum topic thread the poll went to
 * @param {Object} [pollIds] Optional { sheetRowNumber: pollId } map
 */
async function markAsPosted(subject, rowIndices, messageId = null, threadId = null, pollIds = null) {
  if (!rowIndices || rowIndices.length === 0) return 0;
  const result = await request('POST', {
    action: 'markPosted',
    subject,
    rowIndices,
    messageId: messageId ? String(messageId) : '',
    threadId: threadId ? String(threadId) : '',
    pollIds: pollIds || {}
  });
  return result.updatedCount || rowIndices.length;
}

/** Appends questions from the dashboard, skipping duplicates by default. */
async function addQuestions(subject, questions, addedBy, skipDuplicates = true) {
  return request('POST', {
    action: 'addQuestions',
    subject,
    questions,
    added_by: addedBy,
    skipDuplicates
  });
}

/**
 * updateQuestion — applies an allowlisted field patch to one question.
 *
 * `rowNumber` and `verifyText` are a fallback for rows that have no Question ID
 * (written before the 30-column migration, or pasted in by hand). The sheet
 * only acts on the row number when the question text there still matches, so a
 * shifted row can never be edited by mistake.
 */
async function updateQuestion(subject, questionId, fields, updatedBy, rowNumber, verifyText) {
  return request('POST', {
    action: 'updateQuestion',
    subject,
    questionId,
    fields,
    updated_by: updatedBy,
    rowNumber: rowNumber || '',
    verifyText: verifyText || ''
  });
}

/** Permanently removes one question row. See updateQuestion for the fallback. */
async function deleteQuestion(subject, questionId, rowNumber, verifyText) {
  return request('POST', {
    action: 'deleteQuestion',
    subject,
    questionId,
    rowNumber: rowNumber || '',
    verifyText: verifyText || ''
  });
}

/** Sets Status on many questions at once. */
async function bulkStatus(subject, questionIds, status, updatedBy) {
  const result = await request('POST', {
    action: 'bulkStatus',
    subject,
    questionIds,
    status,
    updated_by: updatedBy
  });
  return result.updatedCount || 0;
}

/** Stamps Scheduled For and flips Status to Scheduled. */
async function scheduleQuestions(subject, questionIds, scheduledFor, updatedBy) {
  const result = await request('POST', {
    action: 'scheduleQuestions',
    subject,
    questionIds,
    scheduledFor,
    updated_by: updatedBy
  });
  return result.updatedCount || 0;
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

/**
 * getSubscriber — one member by Telegram id.
 *
 * @param {string|number} telegramId
 * @returns {Promise<Object|null>} The member, or null when they have never paid
 */
async function getSubscriber(telegramId) {
  const result = await request('GET', { action: 'getSubscriber', telegramId });
  return result.data || null;
}

/** Filtered, paginated member list for the Members dashboard. */
async function listSubscribers(filters = {}) {
  const result = await request('GET', Object.assign({ action: 'listSubscribers' }, filters));
  return result.data || { total: 0, subscribers: [], page: 1, totalPages: 1 };
}

/**
 * getExpiring — active members whose access ends within `days`.
 * Pass 0 for those already past expiry.
 */
async function getExpiring(days = 0) {
  const result = await request('GET', { action: 'getExpiring', days });
  return result.data || [];
}

/** Revenue and membership totals. */
async function getRevenue() {
  const result = await request('GET', { action: 'getRevenue' });
  return result.data || null;
}

/**
 * upsertSubscriber — creates or updates a member row.
 * Set `is_payment` to also append to the Payments log and advance the
 * lifetime revenue and renewal counters.
 *
 * @param {Object} subscriber Fields to write; telegram_id is required
 * @param {string} [event] Label recorded in the payment log
 */
async function upsertSubscriber(subscriber, event = 'payment') {
  const result = await request('POST', { action: 'upsertSubscriber', subscriber, event });
  return result.data;
}

module.exports = {
  isConfigured,
  getWebAppUrl,
  ping,
  readConfig,
  getSubjects,
  writeConfig,
  getUnpostedQuestions,
  markAsPosted,
  getStats,
  getAnalytics,
  listQuestions,
  checkDuplicates,
  addQuestions,
  updateQuestion,
  deleteQuestion,
  bulkStatus,
  scheduleQuestions,
  getSubscriber,
  listSubscribers,
  getExpiring,
  getRevenue,
  upsertSubscriber
};
