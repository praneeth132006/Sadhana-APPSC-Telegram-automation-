import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Lift groupSelectionBySubject out of the dashboard module and run it against
// the `rows` / `selected` shapes the page actually holds.
const src = fs.readFileSync('dashboard/questions.js', 'utf8');
const body = src.slice(src.indexOf('function groupSelectionBySubject()'));
const fnSrc = body.slice(0, body.indexOf('\n}\n') + 3);
const make = new Function('rows', 'selected', `${fnSrc}; return groupSelectionBySubject();`);

const rows = [
  { question_id: 'ENV-1', subject: 'Environment' },
  { question_id: 'GEN-1', subject: 'General Studies' },
  { question_id: 'GEN-2', subject: 'General Studies' },
  { question_id: 'POL-1', subject: 'Polity' },
  { question_id: 'NOSUB', subject: '' }
];

test('a selection spanning subjects is split by sheet tab', () => {
  const { groups, unknown } = make(rows, new Set(['ENV-1', 'GEN-1', 'GEN-2', 'POL-1']));
  assert.equal(groups.size, 3);
  assert.deepEqual(groups.get('General Studies'), ['GEN-1', 'GEN-2']);
  assert.deepEqual(groups.get('Environment'), ['ENV-1']);
  assert.deepEqual(groups.get('Polity'), ['POL-1']);
  assert.deepEqual(unknown, []);
});

test('every selected id lands in exactly one group', () => {
  const ids = ['ENV-1', 'GEN-1', 'GEN-2', 'POL-1'];
  const { groups } = make(rows, new Set(ids));
  const flat = [...groups.values()].flat();
  assert.equal(flat.length, ids.length, 'a selected question was dropped or duplicated');
  assert.deepEqual(flat.slice().sort(), ids.slice().sort());
});

test('an id whose row is off screen is reported, not silently dropped', () => {
  // "Deleted 27" when 30 were ticked, with no explanation, is how a curator
  // loses track of what actually happened.
  const { groups, unknown } = make(rows, new Set(['GEN-1', 'GONE', 'NOSUB']));
  assert.deepEqual(groups.get('General Studies'), ['GEN-1']);
  assert.deepEqual(unknown.sort(), ['GONE', 'NOSUB']);
});

test('an empty selection produces no groups at all', () => {
  const { groups, unknown } = make(rows, new Set());
  assert.equal(groups.size, 0);
  assert.deepEqual(unknown, []);
});

test('a single-subject selection still makes exactly one call', () => {
  const { groups } = make(rows, new Set(['GEN-1', 'GEN-2']));
  assert.equal(groups.size, 1, 'one subject should not be split into several calls');
});
