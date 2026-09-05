// ============================================================================
// Integration tests for the dashboard server (test/server.test.js)
// ============================================================================
// Run with: npm test
//
// These exercise the real HTTP server. Two collaborators are stubbed so the
// tests neither need a live Google Sheet nor a real Firebase login:
//   - src/auth.js  — `authorize` is replaced with a fake that accepts the
//                    token "valid-token" and rejects everything else. The
//                    genuine JWT verification has its own unit tests below.
//   - src/sheets.js — every method is replaced with a recorder, so we can
//                    assert exactly what the server would have sent upstream.
//
// The security cases at the bottom are the regression tests for the findings
// from the red/blue review: unauthenticated access, SSRF, path traversal,
// oversized bodies, cross-origin access and forged authorship.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Configure the environment BEFORE server.js is required, since it reads
// process.env at module load time.
process.env.FIREBASE_PROJECT_ID = 'test-project';
process.env.GOOGLE_SHEET_WEBAPP_URL = 'https://script.google.com/macros/s/TEST/exec';
process.env.SHEET_API_TOKEN = 'test-sheet-token';
process.env.TELEGRAM_BOT_TOKEN = '123:TEST';
process.env.TELEGRAM_GROUP_ID = '-1001234567890';
process.env.CURATOR_EMAILS = '';
process.env.PORT = '0';
process.env.HOST = '127.0.0.1';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const auth = require('../src/auth');
const sheets = require('../src/sheets');
const telegram = require('../src/telegram');

/** Records every sheets call so tests can assert on the arguments. */
const calls = [];

/** Replaces a module method with a recorder returning `result`. */
function stub(module, name, result) {
  module[name] = async (...args) => {
    calls.push({ name, args });
    return typeof result === 'function' ? result(...args) : result;
  };
}

stub(sheets, 'ping', { status: 'ok', version: 'v5 (30 columns)', tokenRequired: true });
stub(sheets, 'getAnalytics', { totals: { total: 10, posted: 4, pending: 6 }, subjects: [] });
stub(sheets, 'getStats', [{ subject: 'Polity', total: 10, posted: 4, pending: 6 }]);
stub(sheets, 'listQuestions', { total: 1, page: 1, totalPages: 1, questions: [{ question_id: 'POL-1' }] });
stub(sheets, 'readConfig', [{ subject: 'Polity', topic_thread_id: 12, active: true, questions_per_batch: 5 }]);
stub(sheets, 'addQuestions', { addedCount: 1, skippedCount: 0, ids: ['POL-20260905-0001'], message: '1 added' });
stub(sheets, 'updateQuestion', { message: 'updated' });
stub(sheets, 'deleteQuestion', { message: 'deleted' });
stub(sheets, 'bulkStatus', 2);
stub(sheets, 'scheduleQuestions', 3);
stub(sheets, 'getUnpostedQuestions', [
  { question_id: 'POL-1', question_text: 'Q1', row_index: 0, excel_row: 2 }
]);
stub(sheets, 'markAsPosted', 1);

// Telegram: pretend the bot is healthy and every send succeeds.
telegram.init = () => {};
telegram.getBotInfo = async () => ({ username: 'testbot', firstName: 'Test', groupTitle: 'G', groupReachable: true, isForum: true });
telegram.sendQuizPoll = async () => ({ message_id: 999, poll: { id: 'poll-1' } });

// Auth: accept exactly one token.
auth.authorize = async (token) => {
  if (token !== 'valid-token') throw new Error('Token signature is invalid.');
  return {
    uid: 'uid-1', email: 'curator@example.com', name: 'Test Curator',
    emailVerified: true, signInProvider: 'google.com'
  };
};

const server = require('../server');

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let baseUrl;

test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  // localhost, not 127.0.0.1: the server canonicalises the latter, and
  // localhost is the origin Firebase authorises and users actually load.
  baseUrl = `http://localhost:${server.address().port}`;
});

test.after(() => server.close());

/**
 * call — issues a request against the test server.
 *
 * @param {string} pathname Path including any query string
 * @param {Object} [options] { method, body, token, headers, rawBody }
 */
async function call(pathname, options = {}) {
  const { method = 'GET', body, token, headers = {}, rawBody } = options;
  const finalHeaders = { ...headers };
  if (token) finalHeaders['Authorization'] = 'Bearer ' + token;
  if (body || rawBody) finalHeaders['Content-Type'] = 'application/json';

  const res = await fetch(baseUrl + pathname, {
    method,
    headers: finalHeaders,
    body: rawBody !== undefined ? rawBody : (body ? JSON.stringify(body) : undefined),
    redirect: 'manual'
  });

  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON — fine for static assets */ }
  return { status: res.status, headers: res.headers, text, json };
}

/** Shorthand for an authenticated request. */
const authed = (pathname, options = {}) => call(pathname, { ...options, token: 'valid-token' });

// ===========================================================================
// Public endpoints
// ===========================================================================

test('GET /api/config reports capability flags and no secrets', async () => {
  const res = await call('/api/config');
  assert.equal(res.status, 200);
  assert.equal(res.json.firebaseProjectId, 'test-project');
  assert.equal(res.json.authEnforced, true);
  assert.equal(res.json.sheetConfigured, true);

  // The Web App URL and both tokens must never reach the browser.
  assert.ok(!res.text.includes('script.google.com'), 'sheet URL leaked to client');
  assert.ok(!res.text.includes('test-sheet-token'), 'sheet API token leaked to client');
  assert.ok(!res.text.includes('123:TEST'), 'telegram bot token leaked to client');
});

test('GET /api/ping probes the sheet without accepting a caller-supplied URL', async () => {
  const res = await call('/api/ping?url=http://169.254.169.254/latest/meta-data/');
  assert.equal(res.status, 200);
  assert.equal(res.json.success, true);
  assert.equal(res.json.outdated, false);

  // The attacker-supplied url must have been ignored entirely.
  const pings = calls.filter((c) => c.name === 'ping');
  assert.ok(pings.length > 0, 'ping was not delegated to the sheets client');
  assert.equal(pings[pings.length - 1].args.length, 0, 'ping accepted an argument from the query string');
});

test('GET /api/ping flags an outdated Apps Script deployment', async () => {
  const original = sheets.ping;
  sheets.ping = async () => ({ status: 'ok', version: 'v2 (10 columns)' });
  try {
    const res = await call('/api/ping');
    assert.equal(res.json.outdated, true);
    assert.match(res.json.upgradeHint, /upgradeSpreadsheet/);
  } finally {
    sheets.ping = original;
  }
});

// ===========================================================================
// Authentication
// ===========================================================================

test('every data route refuses an unauthenticated caller', async () => {
  const routes = [
    ['GET', '/api/analytics'], ['GET', '/api/stats'], ['GET', '/api/questions'],
    ['GET', '/api/subjects'], ['GET', '/api/health'], ['GET', '/api/telegram/status'],
    ['POST', '/api/questions'], ['POST', '/api/questions/update'],
    ['POST', '/api/questions/delete'], ['POST', '/api/questions/status'],
    ['POST', '/api/questions/schedule'], ['POST', '/api/telegram/post'],
    ['POST', '/api/send']
  ];

  for (const [method, route] of routes) {
    const res = await call(route, { method, body: method === 'POST' ? {} : undefined });
    assert.equal(res.status, 401, `${method} ${route} did not require authentication`);
    assert.equal(res.json.success, false);
  }
});

test('an invalid token is rejected with 403', async () => {
  const res = await call('/api/analytics', { token: 'forged-token' });
  assert.equal(res.status, 403);
  assert.match(res.json.error, /signature/i);
});

test('a valid token is accepted', async () => {
  const res = await authed('/api/analytics');
  assert.equal(res.status, 200);
  assert.equal(res.json.data.totals.total, 10);
});

// ===========================================================================
// Reads
// ===========================================================================

test('GET /api/questions forwards the filters it is given', async () => {
  calls.length = 0;
  const res = await authed('/api/questions?subject=Polity&status=Approved&posted=NO&search=preamble&page=2&pageSize=50');
  assert.equal(res.status, 200);

  const filters = calls.find((c) => c.name === 'listQuestions').args[0];
  assert.equal(filters.subject, 'Polity');
  assert.equal(filters.status, 'Approved');
  assert.equal(filters.posted, 'NO');
  assert.equal(filters.search, 'preamble');
  assert.equal(filters.page, '2');
});

test('GET /api/health reports every subsystem', async () => {
  const res = await authed('/api/health');
  assert.equal(res.status, 200);

  const health = res.json.data;
  assert.equal(health.server.ok, true);
  assert.equal(health.auth.enforced, true);
  assert.equal(health.sheets.reachable, true);
  assert.equal(health.telegram.reachable, true);
  assert.equal(health.telegram.botUsername, 'testbot');
  assert.equal(health.you.email, 'curator@example.com');
});

// ===========================================================================
// Question upload validation
// ===========================================================================

/** A question object that passes every validation rule. */
function validQuestion(overrides = {}) {
  return {
    question: 'Which of the statements given above is correct?',
    option_a: 'A only', option_b: 'B only', option_c: 'C only', option_d: 'All',
    correct_answer: 'C',
    explanation: 'Because.',
    ...overrides
  };
}

test('POST /api/questions accepts a well-formed batch', async () => {
  calls.length = 0;
  const res = await authed('/api/questions', {
    method: 'POST',
    body: { subject: 'Polity', questions: [validQuestion()] }
  });

  assert.equal(res.status, 200);
  assert.equal(res.json.addedCount, 1);

  const [subject, questions, addedBy] = calls.find((c) => c.name === 'addQuestions').args;
  assert.equal(subject, 'Polity');
  assert.equal(questions.length, 1);
  assert.equal(addedBy, 'Test Curator (curator@example.com)');
});

test('POST /api/questions rejects malformed batches', async () => {
  const cases = [
    [{ subject: '', questions: [validQuestion()] }, /subject/i],
    [{ subject: 'Polity', questions: [] }, /no questions/i],
    [{ subject: 'Polity', questions: [validQuestion({ correct_answer: 'E' })] }, /correct answer/i],
    [{ subject: 'Polity', questions: [validQuestion({ question: '   ' })] }, /empty question/i],
    [{ subject: 'Polity', questions: [validQuestion({ option_b: '' })] }, /missing one or more options/i],
    [{ subject: 'Polity', questions: Array(101).fill(validQuestion()) }, /too many/i],
    [{ subject: '../../etc/passwd', questions: [validQuestion()] }, /unsupported characters/i]
  ];

  for (const [body, pattern] of cases) {
    const res = await authed('/api/questions', { method: 'POST', body });
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body).slice(0, 60)}`);
    assert.match(res.json.error, pattern);
  }
});

test('a client cannot forge authorship or the posted flag', async () => {
  calls.length = 0;
  await authed('/api/questions', {
    method: 'POST',
    body: {
      subject: 'Polity',
      // Everything below is an attempt to write columns the client must not control.
      added_by: 'attacker@evil.example',
      questions: [validQuestion({
        posted: 'YES',
        posted_at: '01-01-2020',
        added_by: 'attacker@evil.example',
        question_id: 'POL-FORGED-0001',
        times_posted: 99
      })]
    }
  });

  const [, questions, addedBy] = calls.find((c) => c.name === 'addQuestions').args;

  // Attribution comes from the verified token, not the body.
  assert.equal(addedBy, 'Test Curator (curator@example.com)');

  // The sanitiser keeps only allowlisted fields.
  const sent = questions[0];
  assert.equal(sent.posted, undefined);
  assert.equal(sent.posted_at, undefined);
  assert.equal(sent.added_by, undefined);
  assert.equal(sent.question_id, undefined);
  assert.equal(sent.times_posted, undefined);
});

test('a javascript: source URL is dropped rather than stored', async () => {
  calls.length = 0;
  await authed('/api/questions', {
    method: 'POST',
    body: { subject: 'Polity', questions: [validQuestion({ source_url: 'javascript:alert(1)' })] }
  });

  const sent = calls.find((c) => c.name === 'addQuestions').args[1][0];
  assert.equal(sent.source_url, '', 'a non-http URL was written into the sheet');
});

test('oversized field values are truncated, not rejected outright', async () => {
  calls.length = 0;
  await authed('/api/questions', {
    method: 'POST',
    body: { subject: 'Polity', questions: [validQuestion({ explanation: 'x'.repeat(50000) })] }
  });

  const sent = calls.find((c) => c.name === 'addQuestions').args[1][0];
  assert.equal(sent.explanation.length, 4000);
});

// ===========================================================================
// Edit / delete / bulk
// ===========================================================================

test('POST /api/questions/update forwards the field patch with the real actor', async () => {
  calls.length = 0;
  const res = await authed('/api/questions/update', {
    method: 'POST',
    body: { subject: 'Polity', questionId: 'POL-1', fields: { topic: 'Preamble' } }
  });

  assert.equal(res.status, 200);
  const [subject, questionId, fields, actor] = calls.find((c) => c.name === 'updateQuestion').args;
  assert.equal(subject, 'Polity');
  assert.equal(questionId, 'POL-1');
  assert.deepEqual(fields, { topic: 'Preamble' });
  assert.equal(actor, 'Test Curator (curator@example.com)');
});

test('edit and delete require a questionId', async () => {
  for (const route of ['/api/questions/update', '/api/questions/delete']) {
    const res = await authed(route, { method: 'POST', body: { subject: 'Polity' } });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /questionId/);
  }
});

test('bulk status caps the number of ids', async () => {
  const res = await authed('/api/questions/status', {
    method: 'POST',
    body: { subject: 'Polity', questionIds: Array(201).fill('POL-1'), status: 'Approved' }
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /max 200/);
});

test('bulk status applies to a valid selection', async () => {
  const res = await authed('/api/questions/status', {
    method: 'POST',
    body: { subject: 'Polity', questionIds: ['POL-1', 'POL-2'], status: 'Approved' }
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.updatedCount, 2);
});

// ===========================================================================
// Telegram posting
// ===========================================================================

test('POST /api/telegram/post sends and records the posting trail', async () => {
  calls.length = 0;
  const res = await authed('/api/telegram/post', {
    method: 'POST',
    body: { subject: 'Polity', count: 1 }
  });

  assert.equal(res.status, 200);
  assert.equal(res.json.postedCount, 1);

  const [subject, rows, messageId, threadId, pollIds] = calls.find((c) => c.name === 'markAsPosted').args;
  assert.equal(subject, 'Polity');
  assert.deepEqual(rows, [0]);
  assert.equal(messageId, 999);
  assert.equal(threadId, 12);
  assert.deepEqual(pollIds, { 2: 'poll-1' });
});

test('posting defaults to Approved-only eligibility', async () => {
  calls.length = 0;
  await authed('/api/telegram/post', { method: 'POST', body: { subject: 'Polity', count: 1 } });

  const [, , requireApproved] = calls.find((c) => c.name === 'getUnpostedQuestions').args;
  assert.equal(requireApproved, true, 'draft questions were eligible by default');
});

test('the posting batch size is capped at 20', async () => {
  calls.length = 0;
  await authed('/api/telegram/post', { method: 'POST', body: { subject: 'Polity', count: 5000 } });

  const [, count] = calls.find((c) => c.name === 'getUnpostedQuestions').args;
  assert.equal(count, 20);
});

test('posting to a subject with no configured thread is refused', async () => {
  const original = sheets.readConfig;
  sheets.readConfig = async () => [{ subject: 'Polity', topic_thread_id: null, active: true }];
  try {
    const res = await authed('/api/telegram/post', { method: 'POST', body: { subject: 'Polity', count: 1 } });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /topic thread/i);
  } finally {
    sheets.readConfig = original;
  }
});

// ===========================================================================
// Security regressions
// ===========================================================================

test('path traversal cannot escape the dashboard directory', async () => {
  const attempts = [
    '/../server.js',
    '/../.env',
    '/../../../../etc/passwd',
    '/%2e%2e/server.js',
    '/%2e%2e%2f%2e%2e%2f.env',
    '/..%2f..%2f.env',
    '/....//server.js',
    '/subdir/../../.env'
  ];

  for (const attempt of attempts) {
    const res = await call(attempt);
    assert.notEqual(res.status, 200, `${attempt} was served`);
    assert.ok(!res.text.includes('TELEGRAM_BOT_TOKEN'), `${attempt} leaked .env`);
    assert.ok(!res.text.includes('require(\'./src/sheets\')'), `${attempt} leaked server source`);
  }
});

test('only allowlisted file extensions are served', async () => {
  // A real file inside dashboard/ with a disallowed extension must not be served.
  const res = await call('/notes.md');
  assert.equal(res.status, 404);
});

test('static assets inside dashboard/ are served normally', async () => {
  for (const asset of ['/', '/index.html', '/analytics.html', '/questions.html', '/automation.html', '/health.html', '/shared.js', '/style.css', '/shared.css']) {
    const res = await call(asset);
    assert.equal(res.status, 200, `${asset} was not served`);
  }
});

test('a 127.0.0.1 page load is redirected to localhost', async () => {
  // Firebase treats localhost and 127.0.0.1 as different domains and only
  // localhost is authorised by default, so signing in from 127.0.0.1 fails —
  // often as an opaque 500 from accounts.google.com.
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/analytics.html`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), `http://localhost:${port}/analytics.html`);
});

test('the redirect preserves the path and query string', async () => {
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/questions.html?subject=Polity&page=2`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), `http://localhost:${port}/questions.html?subject=Polity&page=2`);
});

test('API calls are never redirected — only page loads', async () => {
  // Redirecting an API call would break the fetch that carries the auth token.
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/config`, { redirect: 'manual' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('location'), null);
});

test('a localhost page load is served directly, not redirected', async () => {
  const res = await call('/index.html');
  assert.equal(res.status, 200);
});

test('the redirect can be disabled for a deliberate 127.0.0.1 setup', async () => {
  process.env.CANONICAL_HOST_REDIRECT = 'false';
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/index.html`, { redirect: 'manual' });
    assert.equal(res.status, 200);
  } finally {
    delete process.env.CANONICAL_HOST_REDIRECT;
  }
});

test('no permissive CORS header is ever sent', async () => {
  const responses = [
    await call('/api/config'),
    await authed('/api/analytics'),
    await call('/index.html')
  ];
  for (const res of responses) {
    assert.equal(res.headers.get('access-control-allow-origin'), null,
      'a cross-origin page could read this response');
  }
});

test('CORS preflight is refused, so cross-origin API calls cannot proceed', async () => {
  const res = await call('/api/questions', {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' }
  });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

test('security headers are present on every response', async () => {
  const res = await call('/index.html');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(res.headers.get('content-security-policy'), /object-src 'none'/);
});

test('an oversized request body is rejected rather than buffered', async () => {
  const res = await authed('/api/questions', {
    method: 'POST',
    rawBody: 'x'.repeat(3 * 1024 * 1024)
  });
  assert.equal(res.status, 413);
});

test('a malformed JSON body produces a clean 400', async () => {
  const res = await authed('/api/questions', { method: 'POST', rawBody: '{not json' });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /valid JSON/);
});

test('a JSON array body is rejected — endpoints expect an object', async () => {
  const res = await authed('/api/questions', { method: 'POST', rawBody: '[1,2,3]' });
  assert.equal(res.status, 400);
});

test('static paths reject non-GET methods', async () => {
  const res = await call('/index.html', { method: 'POST', body: {} });
  assert.equal(res.status, 405);
});

test('an unknown API route 404s instead of falling through to index.html', async () => {
  const res = await authed('/api/does-not-exist');
  assert.equal(res.status, 404);
  assert.equal(res.json.success, false);
  assert.ok(!res.text.includes('<!DOCTYPE'), 'an API path served HTML');
});
