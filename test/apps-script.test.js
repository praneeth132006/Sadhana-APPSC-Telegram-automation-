// ============================================================================
// Tests for the Google Apps Script backend (test/apps-script.test.js)
// ============================================================================
// google_apps_script.js runs inside Google's runtime, so it cannot simply be
// required. Here it is evaluated in a vm sandbox with minimal stubs for the
// Google globals it touches (Utilities, PropertiesService, SpreadsheetApp),
// which lets the pure logic be tested directly: header resolution and the v2
// and v4 aliases the migration depends on, the duplicate hash, the runway
// arithmetic behind the Analytics dashboard, and the token comparison.
//
// The sheet-mutating functions are covered by the fake spreadsheet below, which
// implements just enough of the Range/Sheet API for appendQuestionsToSheet and
// listQuestions to run end to end.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');

// ---------------------------------------------------------------------------
// Minimal Google Apps Script runtime
// ---------------------------------------------------------------------------

/** Script properties the stubbed PropertiesService serves. */
const scriptProperties = {};

/** A tiny stand-in for a Google Sheet backed by a 2-D array. */
class FakeSheet {
  constructor(name, values = []) {
    this.name = name;
    this.values = values;          // Row-major, including the header row.
    this.validations = [];
    this.formatRules = [];
  }

  getName() { return this.name; }
  getLastRow() { return this.values.length; }
  getLastColumn() { return this.values.reduce((max, row) => Math.max(max, row.length), 0); }
  getMaxRows() { return Math.max(this.values.length, 1000); }

  /** Returns a range object over the requested block, padding short rows. */
  getRange(row, col, numRows = 1, numCols = 1) {
    const sheet = this;
    return {
      getValues() {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const source = sheet.values[row - 1 + r] || [];
          const line = [];
          for (let c = 0; c < numCols; c++) line.push(source[col - 1 + c] ?? '');
          out.push(line);
        }
        return out;
      },
      getValue() { return (sheet.values[row - 1] || [])[col - 1] ?? ''; },
      setValue(value) {
        while (sheet.values.length < row) sheet.values.push([]);
        const target = sheet.values[row - 1];
        while (target.length < col) target.push('');
        target[col - 1] = value;
        return this;
      },
      setValues(block) {
        block.forEach((line, r) => {
          while (sheet.values.length < row + r) sheet.values.push([]);
          sheet.values[row - 1 + r] = line.slice();
        });
        return this;
      },
      setDataValidation(v) { sheet.validations.push(v); return this; },
      // Formatting calls are chainable no-ops in these tests.
      setFontWeight() { return this; }, setFontColor() { return this; },
      setBackground() { return this; }, setVerticalAlignment() { return this; },
      setHorizontalAlignment() { return this; }, setWrap() { return this; }
    };
  }

  clear() { this.values = []; return this; }
  deleteRow(row) { this.values.splice(row - 1, 1); return this; }
  setFrozenRows() { return this; }
  setFrozenColumns() { return this; }
  setRowHeight() { return this; }
  setColumnWidth() { return this; }
  setConditionalFormatRules(rules) { this.formatRules = rules; return this; }
}

/** A stand-in spreadsheet holding several FakeSheets. */
class FakeSpreadsheet {
  constructor(sheets = []) { this.sheets = sheets; }
  getSheets() { return this.sheets; }
  getSheetByName(name) { return this.sheets.find((s) => s.name === name) || null; }
  insertSheet(name) { const s = new FakeSheet(name); this.sheets.push(s); return s; }
  toast() {}
}

/** Loads google_apps_script.js into a sandbox bound to `spreadsheet`. */
function loadScript(spreadsheet) {
  const sandbox = {
    console,
    Logger: { log() {} },

    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      newDataValidation: () => ({
        requireValueInList() { return this; },
        setAllowInvalid() { return this; },
        build: () => ({ kind: 'validation' }),
        // The chained builder returns itself from each call.
        ...(function builder() {
          const self = {
            requireValueInList: () => self,
            setAllowInvalid: () => self,
            build: () => ({ kind: 'validation' })
          };
          return self;
        })()
      }),
      newConditionalFormatRule: () => {
        const self = {
          whenTextEqualTo: () => self,
          setBackground: () => self,
          setFontColor: () => self,
          setRanges: () => self,
          build: () => ({ kind: 'rule' })
        };
        return self;
      }
    },

    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => scriptProperties[k] ?? null })
    },

    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      computeDigest: (_alg, input) => Array.from(crypto.createHash('sha256').update(input).digest()),
      formatDate: (date, _tz, format) => {
        const pad = (n) => String(n).padStart(2, '0');
        if (format === 'yyyyMMdd') return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
        return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}, 10:30:00 AM`;
      }
    },

    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } })
    }
  };

  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(__dirname, '..', 'google_apps_script.js'), 'utf8');
  vm.runInContext(source, sandbox);
  return sandbox;
}

/** Builds a fresh script sandbox over an empty spreadsheet. */
function freshScript(sheets = []) {
  return loadScript(new FakeSpreadsheet(sheets));
}

// ===========================================================================
// Pure helpers
// ===========================================================================

test('cronRunsPerDay understands the cron forms used in the Config tab', () => {
  const s = freshScript();
  assert.equal(s.cronRunsPerDay('0 9,18 * * *'), 2, 'two fixed hours');
  assert.equal(s.cronRunsPerDay('0 8,14,20 * * *'), 3, 'three fixed hours');
  assert.equal(s.cronRunsPerDay('0 */3 * * *'), 8, 'every three hours');
  assert.equal(s.cronRunsPerDay('0 */2 * * *'), 12, 'every two hours');
  assert.equal(s.cronRunsPerDay('0 * * * *'), 24, 'hourly');
  assert.equal(s.cronRunsPerDay(''), 0, 'no schedule');
  assert.equal(s.cronRunsPerDay('nonsense'), 0, 'malformed schedule');
});

test('dayKey turns IST timestamps into sortable ISO days', () => {
  const s = freshScript();
  assert.equal(s.dayKey('05-09-2026, 10:30:00 AM IST'), '2026-09-05');
  assert.equal(s.dayKey('31-12-2025, 11:59:00 PM IST'), '2025-12-31');
  assert.equal(s.dayKey('-'), '', 'placeholder produces no day');
  assert.equal(s.dayKey(''), '', 'empty produces no day');
  assert.equal(s.dayKey('not a date'), '', 'unparseable produces no day');

  // The keys must sort chronologically as plain strings, since the timeline
  // chart relies on a lexicographic sort.
  const keys = ['05-09-2026, 1:00:00 AM', '04-09-2026, 1:00:00 AM', '05-08-2026, 1:00:00 AM'].map(s.dayKey);
  assert.deepEqual(keys.slice().sort(), ['2026-08-05', '2026-09-04', '2026-09-05']);
});

test('hashQuestion ignores cosmetic differences but separates real ones', () => {
  const s = freshScript();
  const base = s.hashQuestion('Who was the first President of India?');

  assert.equal(base, s.hashQuestion('who was the first president of india?'), 'case must not matter');
  assert.equal(base, s.hashQuestion('  Who  was the first President of India?  '), 'whitespace must not matter');
  assert.equal(base, s.hashQuestion('Who was the first President of India!'), 'punctuation must not matter');
  assert.notEqual(base, s.hashQuestion('Who was the first Prime Minister of India?'), 'different questions must differ');
  assert.equal(base.length, 16, 'hash is a stable 16 hex characters');
});

test('normaliseChoice coerces to the allowed set with a fallback', () => {
  const s = freshScript();
  assert.equal(s.normaliseChoice('approved', s.STATUS_VALUES, 'Draft'), 'Approved');
  assert.equal(s.normaliseChoice('  HARD ', s.DIFFICULTY_VALUES, 'Medium'), 'Hard');
  assert.equal(s.normaliseChoice('nonsense', s.STATUS_VALUES, 'Draft'), 'Draft');
  assert.equal(s.normaliseChoice('', s.DIFFICULTY_VALUES, 'Medium'), 'Medium');
  assert.equal(s.normaliseChoice(null, s.STATUS_VALUES, 'Draft'), 'Draft');
});

test('clampInt keeps pagination parameters inside safe bounds', () => {
  const s = freshScript();
  assert.equal(s.clampInt('5', 1, 1, 100), 5);
  assert.equal(s.clampInt('99999', 1, 1, 100), 100, 'clamps above the maximum');
  assert.equal(s.clampInt('-4', 1, 1, 100), 1, 'clamps below the minimum');
  assert.equal(s.clampInt('abc', 7, 1, 100), 7, 'falls back when unparseable');
  assert.equal(s.clampInt(undefined, 7, 1, 100), 7);
});

test('subjectCode produces a stable prefix for Question IDs', () => {
  const s = freshScript();
  assert.equal(s.subjectCode('Polity'), 'POL');
  assert.equal(s.subjectCode('Current Affairs'), 'CUR');
  assert.equal(s.subjectCode('AP Geography'), 'APG');
  assert.equal(s.subjectCode('Some New Subject'), 'SOM', 'derives a code for unlisted subjects');
});

test('constantTimeEquals compares correctly', () => {
  const s = freshScript();
  assert.equal(s.constantTimeEquals('secret', 'secret'), true);
  assert.equal(s.constantTimeEquals('secret', 'secrey'), false);
  assert.equal(s.constantTimeEquals('secret', 'secre'), false, 'length mismatch');
  assert.equal(s.constantTimeEquals('', ''), true);
});

// ===========================================================================
// Header resolution — the basis of a lossless migration
// ===========================================================================

test('headerMap resolves the v5 layout exactly', () => {
  const s = freshScript();
  const sheet = new FakeSheet('Polity', [s.QUESTION_HEADERS.slice()]);
  const map = s.headerMap(sheet);

  s.QUESTION_HEADERS.forEach((header, index) => {
    assert.equal(map[header], index, `${header} resolved to the wrong column`);
  });
});

test('headerMap resolves a legacy v4 16-column sheet by name, not position', () => {
  const s = freshScript();
  const v4Headers = [
    'S.No', 'Date', 'Newspaper', 'Subject', 'Question', 'Option A', 'Option B',
    'Option C', 'Option D', 'Correct Answer', 'Explanation', 'Posted',
    'Posted At', 'Added At', 'Added By', 'Telegram Msg ID'
  ];
  const map = s.headerMap(new FakeSheet('Polity', [v4Headers]));

  // Date sits at index 1 in v4 but index 2 in v5 — resolving by name is what
  // stops the migration writing dates into the Question ID column.
  assert.equal(map['Date'], 1);
  assert.equal(map['Question'], 4);
  assert.equal(map['Posted'], 11);
  assert.equal(map['Telegram Msg ID'], 15);
});

test('headerMap tolerates alternative spellings', () => {
  const s = freshScript();
  const map = s.headerMap(new FakeSheet('Polity', [[
    'Sl. No', 'QID', 'date', 'Source', 'Subject', 'Sub-Topic', 'Question Text',
    'Opt A', 'Opt B', 'Opt C', 'Opt D', 'Answer', 'Exp', 'Level', 'Keywords'
  ]]));

  assert.equal(map['S.No'], 0);
  assert.equal(map['Question ID'], 1);
  assert.equal(map['Newspaper'], 3, '"Source" is an accepted alias for Newspaper');
  assert.equal(map['Topic'], 5, '"Sub-Topic" is an accepted alias for Topic');
  assert.equal(map['Correct Answer'], 11);
  assert.equal(map['Difficulty'], 13, '"Level" is an accepted alias for Difficulty');
});

// ===========================================================================
// Migration
// ===========================================================================

test('a header that is absent maps to -1 rather than to a wrong column', () => {
  // Regression test. headerMap used to fall back to the canonical position for
  // a missing header, so reading "Question ID" (canonical index 1) from a v4
  // sheet returned that sheet's Date column. The migration then wrote dates
  // into the Question ID column of every migrated row.
  const s = freshScript();
  const v4Headers = [
    'S.No', 'Date', 'Newspaper', 'Subject', 'Question', 'Option A', 'Option B',
    'Option C', 'Option D', 'Correct Answer', 'Explanation', 'Posted',
    'Posted At', 'Added At', 'Added By', 'Telegram Msg ID'
  ];
  const sheet = new FakeSheet('Polity', [
    v4Headers,
    [1, '05-09-2026', 'The Hindu', 'Polity', 'Q?', 'a', 'b', 'c', 'd', 'A', 'e', 'NO', '-', '-', 'x@y.com', '-']
  ]);
  const map = s.headerMap(sheet);

  // Columns v4 does not have must report as absent.
  ['Question ID', 'Topic', 'Difficulty', 'Tags', 'Source URL', 'Status',
   'Scheduled For', 'Thread ID', 'Poll ID', 'Times Posted', 'Updated At',
   'Updated By', 'Dup Hash', 'Review Notes'].forEach((header) => {
    assert.equal(map[header], -1, `${header} should be reported absent in a v4 sheet`);
  });

  // Reading an absent column yields empty, never a neighbouring value.
  const row = sheet.values[1];
  assert.equal(s.cell(row, map, 'Question ID'), '', 'absent column leaked the Date value');
  assert.equal(s.cell(row, map, 'Topic'), '', 'absent column leaked Option A');
  assert.equal(s.cell(row, map, 'Difficulty'), '', 'absent column leaked Added At');

  // Writes still resolve to the canonical column so migration can fill them in.
  assert.equal(s.colNum(map, 'Question ID'), 2);
  assert.equal(s.colNum(map, 'Dup Hash'), 29);
});


test('migrateSheetToCanonical moves v4 data into the right v5 columns', () => {
  const s = freshScript();
  const v4Headers = [
    'S.No', 'Date', 'Newspaper', 'Subject', 'Question', 'Option A', 'Option B',
    'Option C', 'Option D', 'Correct Answer', 'Explanation', 'Posted',
    'Posted At', 'Added At', 'Added By', 'Telegram Msg ID'
  ];
  const sheet = new FakeSheet('Polity', [
    v4Headers,
    [1, '05-09-2026', 'The Hindu', 'Polity', 'Old question one?', 'A1', 'B1', 'C1', 'D1', 'B',
     'Because one.', 'YES', '06-09-2026, 09:00:00 AM IST', '05-09-2026, 08:00:00 AM IST', 'curator@x.com', '555'],
    [2, '05-09-2026', 'The Hindu', 'Polity', 'Old question two?', 'A2', 'B2', 'C2', 'D2', 'D',
     'Because two.', '', '-', '05-09-2026, 08:00:00 AM IST', 'curator@x.com', '-']
  ]);

  const spreadsheet = new FakeSpreadsheet([sheet]);
  const script = loadScript(spreadsheet);
  const migrated = script.migrateSheetToCanonical(sheet);

  assert.equal(migrated, 2, 'both rows were migrated');
  assert.deepEqual(Array.from(sheet.values[0]), Array.from(script.QUESTION_HEADERS), 'header row is now canonical');

  const map = script.headerMap(sheet);
  const rowOne = sheet.values[1];
  const rowTwo = sheet.values[2];

  // Every v4 value landed in its v5 column.
  assert.equal(rowOne[map['Date']], '05-09-2026');
  assert.equal(rowOne[map['Question']], 'Old question one?');
  assert.equal(rowOne[map['Correct Answer']], 'B');
  assert.equal(rowOne[map['Explanation']], 'Because one.');
  assert.equal(rowOne[map['Added By']], 'curator@x.com');
  assert.equal(rowOne[map['Telegram Msg ID']], '555');

  // Posted rows gain a consistent Status and a Times Posted count.
  assert.equal(rowOne[map['Posted']], 'YES');
  assert.equal(rowOne[map['Status']], 'Posted');
  assert.equal(rowOne[map['Times Posted']], 1);

  // Unposted rows are normalised to NO / Draft, and '-' placeholders cleared.
  assert.equal(rowTwo[map['Posted']], 'NO');
  assert.equal(rowTwo[map['Status']], 'Draft');
  assert.equal(rowTwo[map['Posted At']], '');
  assert.equal(rowTwo[map['Telegram Msg ID']], '');

  // New columns are populated so nothing is left blank that should not be.
  assert.match(rowOne[map['Question ID']], /^POL-\d{8}-0001$/);
  assert.equal(rowOne[map['Difficulty']], 'Medium', 'defaults applied');
  assert.equal(rowOne[map['Dup Hash']].length, 16, 'duplicate fingerprint computed');

  // Re-running the migration must be safe and must not renumber or duplicate.
  const again = script.migrateSheetToCanonical(sheet);
  assert.equal(again, 2, 'migration is idempotent');
  assert.equal(sheet.values.length, 3, 'no rows were added on the second run');
});

// ===========================================================================
// Appending
// ===========================================================================

test('appendQuestionsToSheet assigns ids, timestamps and skips duplicates', () => {
  const s = freshScript();
  const sheet = new FakeSheet('Polity', [s.QUESTION_HEADERS.slice()]);
  const spreadsheet = new FakeSpreadsheet([sheet]);
  const script = loadScript(spreadsheet);

  const first = script.appendQuestionsToSheet('Polity', [
    { question: 'First question?', option_a: 'a', option_b: 'b', option_c: 'c', option_d: 'd', correct_answer: 'b', explanation: 'e' },
    { question: 'Second question?', option_a: 'a', option_b: 'b', option_c: 'c', option_d: 'd', correct_answer: 'C', difficulty: 'hard' }
  ], 'Curator (curator@x.com)', true);

  assert.equal(first.added, 2);
  assert.equal(first.skipped, 0);
  assert.deepEqual(Array.from(first.ids, (id) => id.slice(-4)), ['0001', '0002']);

  const map = script.headerMap(sheet);
  const row = sheet.values[1];
  assert.equal(row[map['S.No']], 1);
  assert.equal(row[map['Subject']], 'Polity');
  assert.equal(row[map['Correct Answer']], 'B', 'answer is upper-cased');
  assert.equal(row[map['Posted']], 'NO');
  assert.equal(row[map['Status']], 'Draft');
  assert.equal(row[map['Times Posted']], 0);
  assert.equal(row[map['Added By']], 'Curator (curator@x.com)');
  assert.equal(sheet.values[2][map['Difficulty']], 'Hard', 'difficulty is normalised');

  // The same question again is recognised despite different casing and spacing.
  const second = script.appendQuestionsToSheet('Polity', [
    { question: '  FIRST QUESTION!  ', option_a: 'a', option_b: 'b', option_c: 'c', option_d: 'd', correct_answer: 'A' },
    { question: 'Third question?', option_a: 'a', option_b: 'b', option_c: 'c', option_d: 'd', correct_answer: 'A' }
  ], 'Curator', true);

  assert.equal(second.skipped, 1, 'the duplicate was skipped');
  assert.equal(second.added, 1, 'the genuinely new question was added');
  assert.equal(sheet.values[3][map['S.No']], 3, 'S.No continues from the last row');

  // With skipDuplicates off the same question is allowed through.
  const third = script.appendQuestionsToSheet('Polity', [
    { question: 'First question?', option_a: 'a', option_b: 'b', option_c: 'c', option_d: 'd', correct_answer: 'A' }
  ], 'Curator', false);
  assert.equal(third.added, 1);
});

test('updateQuestionRow only writes allowlisted fields', () => {
  const s = freshScript();
  const sheet = new FakeSheet('Polity', [s.QUESTION_HEADERS.slice()]);
  const spreadsheet = new FakeSpreadsheet([sheet]);
  const script = loadScript(spreadsheet);

  const { ids } = script.appendQuestionsToSheet('Polity', [
    { question: 'Editable question?', option_a: 'a', option_b: 'b', option_c: 'c', option_d: 'd', correct_answer: 'A' }
  ], 'Curator', true);

  const map = script.headerMap(sheet);
  const before = sheet.values[1].slice();

  const ok = script.updateQuestionRow('Polity', ids[0], {
    topic: 'Preamble',
    status: 'approved',
    correct_answer: 'z',        // Invalid — must be coerced to A.
    posted: 'YES',              // Not on the allowlist — must be ignored.
    added_by: 'attacker@evil',  // Not on the allowlist — must be ignored.
    question_id: 'FORGED'       // Not on the allowlist — must be ignored.
  }, 'Editor (editor@x.com)');

  assert.equal(ok, true);
  assert.equal(sheet.values[1][map['Topic']], 'Preamble');
  assert.equal(sheet.values[1][map['Status']], 'Approved', 'status normalised to the canonical spelling');
  assert.equal(sheet.values[1][map['Correct Answer']], 'A', 'an invalid answer falls back to A');
  assert.equal(sheet.values[1][map['Updated By']], 'Editor (editor@x.com)');

  // The protected columns are untouched.
  assert.equal(sheet.values[1][map['Posted']], before[map['Posted']], 'Posted was writable from the patch');
  assert.equal(sheet.values[1][map['Added By']], before[map['Added By']], 'Added By was writable from the patch');
  assert.equal(sheet.values[1][map['Question ID']], ids[0], 'Question ID was writable from the patch');
});

test('editing the question text refreshes the duplicate fingerprint', () => {
  const s = freshScript();
  const sheet = new FakeSheet('Polity', [s.QUESTION_HEADERS.slice()]);
  const script = loadScript(new FakeSpreadsheet([sheet]));

  const { ids } = script.appendQuestionsToSheet('Polity', [
    { question: 'Original text?', option_a: 'a', option_b: 'b', option_c: 'c', option_d: 'd', correct_answer: 'A' }
  ], 'Curator', true);

  const map = script.headerMap(sheet);
  const originalHash = sheet.values[1][map['Dup Hash']];

  script.updateQuestionRow('Polity', ids[0], { question: 'Completely different text?' }, 'Editor');
  assert.notEqual(sheet.values[1][map['Dup Hash']], originalHash, 'the fingerprint went stale');
});

// ===========================================================================
// Reading and filtering
// ===========================================================================

test('fetchUnpostedQuestions excludes Rejected and Archived rows', () => {
  const s = freshScript();
  const sheet = new FakeSheet('Polity', [s.QUESTION_HEADERS.slice()]);
  const script = loadScript(new FakeSpreadsheet([sheet]));

  script.appendQuestionsToSheet('Polity', [
    { question: 'Draft one?', option_a: 'a', option_b: 'b', option_c: 'c', option_d: 'd', correct_answer: 'A', status: 'Draft' },
    { question: 'Approved one?', option_a: 'a', option_b: 'b', option_c: 'c', option_d: 'd', correct_answer: 'A', status: 'Approved' },
    { question: 'Rejected one?', option_a: 'a', option_b: 'b', option_c: 'c', option_d: 'd', correct_answer: 'A', status: 'Rejected' },
    { question: 'Archived one?', option_a: 'a', option_b: 'b', option_c: 'c', option_d: 'd', correct_answer: 'A', status: 'Archived' }
  ], 'Curator', true);

  const all = script.fetchUnpostedQuestions('Polity', 50, false);
  assert.deepEqual(Array.from(all, (q) => q.question_text), ['Draft one?', 'Approved one?'],
    'a rejected or archived question must never be eligible for posting');

  const approvedOnly = script.fetchUnpostedQuestions('Polity', 50, true);
  assert.deepEqual(Array.from(approvedOnly, (q) => q.question_text), ['Approved one?']);

  const limited = script.fetchUnpostedQuestions('Polity', 1, false);
  assert.equal(limited.length, 1, 'the limit is respected');
});

test('markRowsAsPostedInSheet records the full posting trail', () => {
  const s = freshScript();
  const sheet = new FakeSheet('Polity', [s.QUESTION_HEADERS.slice()]);
  const script = loadScript(new FakeSpreadsheet([sheet]));

  script.appendQuestionsToSheet('Polity', [
    { question: 'To be posted?', option_a: 'a', option_b: 'b', option_c: 'c', option_d: 'd', correct_answer: 'A' }
  ], 'Curator', true);

  const map = script.headerMap(sheet);
  const updated = script.markRowsAsPostedInSheet('Polity', [0], '9001', '12', { 2: 'poll-abc' });

  assert.equal(updated, 1);
  assert.equal(sheet.values[1][map['Posted']], 'YES');
  assert.equal(sheet.values[1][map['Status']], 'Posted');
  assert.equal(sheet.values[1][map['Thread ID']], '12');
  assert.equal(sheet.values[1][map['Telegram Msg ID']], '9001');
  assert.equal(sheet.values[1][map['Poll ID']], 'poll-abc');
  assert.equal(sheet.values[1][map['Times Posted']], 1);
  assert.ok(sheet.values[1][map['Posted At']], 'a timestamp was written');

  // A repost increments the counter rather than overwriting it.
  script.markRowsAsPostedInSheet('Polity', [0], '9002', '12', {});
  assert.equal(sheet.values[1][map['Times Posted']], 2);
});

test('listQuestions filters and paginates', () => {
  const s = freshScript();
  const sheet = new FakeSheet('Polity', [s.QUESTION_HEADERS.slice()]);
  const script = loadScript(new FakeSpreadsheet([sheet]));

  script.appendQuestionsToSheet('Polity', [
    { question: 'Preamble question?', option_a: 'a', option_b: 'b', option_c: 'c', option_d: 'd', correct_answer: 'A', status: 'Approved', difficulty: 'Hard', tags: 'preamble' },
    { question: 'Monsoon question?', option_a: 'a', option_b: 'b', option_c: 'c', option_d: 'd', correct_answer: 'A', status: 'Draft', difficulty: 'Easy' },
    { question: 'Budget question?', option_a: 'a', option_b: 'b', option_c: 'c', option_d: 'd', correct_answer: 'A', status: 'Approved', difficulty: 'Easy' }
  ], 'Curator', true);

  assert.equal(script.listQuestions({ subject: 'Polity' }).total, 3);
  assert.equal(script.listQuestions({ subject: 'Polity', status: 'Approved' }).total, 2);
  assert.equal(script.listQuestions({ subject: 'Polity', difficulty: 'Easy' }).total, 2);
  assert.equal(script.listQuestions({ subject: 'Polity', posted: 'NO' }).total, 3);
  assert.equal(script.listQuestions({ subject: 'Polity', posted: 'YES' }).total, 0);

  // Search covers question text and tags, case-insensitively.
  assert.equal(script.listQuestions({ subject: 'Polity', search: 'MONSOON' }).total, 1);
  assert.equal(script.listQuestions({ subject: 'Polity', search: 'preamble' }).total, 1);

  const page = script.listQuestions({ subject: 'Polity', pageSize: '2', page: '2' });
  assert.equal(page.questions.length, 1, 'second page holds the remainder');
  assert.equal(page.totalPages, 2);
});

// ===========================================================================
// Authentication
// ===========================================================================

test('requireToken is open when no API_TOKEN is configured', () => {
  delete scriptProperties.API_TOKEN;
  const s = freshScript();
  assert.equal(s.requireToken(''), null, 'requests pass when no token is set');
  assert.equal(s.getApiToken(), '');
});

test('requireToken rejects a wrong or missing token once configured', () => {
  scriptProperties.API_TOKEN = 'the-real-secret';
  try {
    const s = freshScript();
    assert.equal(s.requireToken('the-real-secret'), null, 'the correct token is accepted');

    for (const bad of ['', 'wrong', 'the-real-secre', 'the-real-secrets', undefined]) {
      const response = s.requireToken(bad);
      assert.ok(response, `token ${JSON.stringify(bad)} was accepted`);
      assert.match(JSON.parse(response.text).error, /Unauthorized/);
    }
  } finally {
    delete scriptProperties.API_TOKEN;
  }
});

test('doGet answers ping without a token but gates everything else', () => {
  scriptProperties.API_TOKEN = 'the-real-secret';
  try {
    const s = freshScript();

    const ping = JSON.parse(s.doGet({ parameter: { action: 'ping' } }).text);
    assert.equal(ping.status, 'ok');
    assert.match(ping.version, /^v5/);
    assert.equal(ping.tokenRequired, true);

    const denied = JSON.parse(s.doGet({ parameter: { action: 'getStats' } }).text);
    assert.equal(denied.success, false);
    assert.match(denied.error, /Unauthorized/);
  } finally {
    delete scriptProperties.API_TOKEN;
  }
});

test('doPost refuses a write without the token', () => {
  scriptProperties.API_TOKEN = 'the-real-secret';
  try {
    const s = freshScript();
    const response = JSON.parse(s.doPost({
      postData: { contents: JSON.stringify({ action: 'addQuestions', subject: 'Polity', questions: [{ question: 'x' }] }) }
    }).text);
    assert.equal(response.success, false);
    assert.match(response.error, /Unauthorized/);
  } finally {
    delete scriptProperties.API_TOKEN;
  }
});

test('doGet reports an unknown action instead of throwing', () => {
  const s = freshScript();
  const response = JSON.parse(s.doGet({ parameter: { action: 'definitelyNotAnAction' } }).text);
  assert.equal(response.success, false);
  assert.match(response.error, /Unknown GET action/);
});
