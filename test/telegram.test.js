// Import the built-in Node.js test runner module
const test = require('node:test');
// Import Node.js strict assertion module for verifying expected outputs
const assert = require('node:assert/strict');
// Import the formatDateHashtag and formatNewspaperHashtag functions from the telegram service module
const { formatDateHashtag, formatNewspaperHashtag } = require('../src/telegram');

// Test suite for Telegram hashtag generation
test('formatDateHashtag converts dates to clickable #Date_DD_MM_YYYY hashtags', () => {
  // Verify DD-MM-YYYY format converts with #Date_ prefix
  assert.equal(formatDateHashtag('05-09-2026'), '#Date_05_09_2026');
  // Verify slash delimiter DD/MM/YYYY converts correctly
  assert.equal(formatDateHashtag('05/09/2026'), '#Date_05_09_2026');
  // Verify unpadded single-digit day/month pads with zeros
  assert.equal(formatDateHashtag('5-9-2026'), '#Date_05_09_2026');
  // Verify ISO format YYYY-MM-DD converts to #Date_DD_MM_YYYY
  assert.equal(formatDateHashtag('2026-09-05'), '#Date_05_09_2026');
  // Verify full JavaScript Date string parses into #Date_DD_MM_YYYY
  assert.equal(formatDateHashtag('Sat Sep 05 2026 00:00:00 GMT+0530'), '#Date_05_09_2026');
  // Verify falsy input returns empty string
  assert.equal(formatDateHashtag(''), '');
  assert.equal(formatDateHashtag(null), '');
  assert.equal(formatDateHashtag(undefined), '');
});

test('formatDateHashtag fallbacks ensure hashtag starts with letter so Telegram parses as clickable entity', () => {
  // When input is an unparseable numeric/symbol string, ensure Date_ prefix is prepended
  assert.equal(formatDateHashtag('123_test'), '#Date_123_test');
  // When input starts with letters and is not a date, preserve it as a clean hashtag
  assert.equal(formatDateHashtag('General_Tag'), '#General_Tag');
});

test('formatNewspaperHashtag formats into PascalCase hashtag', () => {
  // Test common newspaper names
  assert.equal(formatNewspaperHashtag('The Hindu'), '#TheHindu');
  assert.equal(formatNewspaperHashtag('Indian Express'), '#IndianExpress');
  assert.equal(formatNewspaperHashtag('Eenadu'), '#Eenadu');
  // Test empty string handling
  assert.equal(formatNewspaperHashtag(''), '');
});
