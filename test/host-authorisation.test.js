// ============================================================================
// Tests for the Firebase authorised-domain check (test/host-authorisation.test.js)
// ============================================================================
// A regression suite for a bug that shipped: warnIfOriginNotAuthorised used a
// hardcoded guess at which hosts Firebase allows, so it told a curator that
// sign-in would fail on appscsadhana.vercel.app — a domain that IS authorised
// and works perfectly. A false alarm here is worse than no alarm, because it
// sends people chasing a problem that does not exist.
//
// The rule now comes from the project's real authorizedDomains list, and this
// suite pins the matching semantics.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/**
 * loadIsHostAuthorised — pulls the exported function out of shared.js.
 * shared.js is an ES module that imports the Firebase SDK over the network, so
 * it cannot simply be imported here. The function is self-contained, so the
 * source is extracted and evaluated on its own.
 */
function loadIsHostAuthorised() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'shared.js'), 'utf8');
  const start = source.indexOf('export function isHostAuthorised');
  assert.notEqual(start, -1, 'isHostAuthorised is no longer exported from shared.js');

  // Take up to the closing brace of the function.
  const end = source.indexOf('\n}', start) + 2;
  const body = source.slice(start, end).replace('export function', 'function');

  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(body + '\nthis.fn = isHostAuthorised;', sandbox);
  return sandbox.fn;
}

const isHostAuthorised = loadIsHostAuthorised();

/** The project's real authorised list, as returned by Identity Toolkit. */
const REAL_DOMAINS = [
  'localhost',
  'ap-gurukul-43050.firebaseapp.com',
  'ap-gurukul-43050.web.app',
  'appscsadhana.vercel.app'
];

test('every domain on the real list is accepted', () => {
  for (const domain of REAL_DOMAINS) {
    assert.equal(isHostAuthorised(domain, REAL_DOMAINS), true, `${domain} was rejected`);
  }
});

test('the deployed Vercel host is accepted', () => {
  // The exact false positive that shipped.
  assert.equal(isHostAuthorised('appscsadhana.vercel.app', REAL_DOMAINS), true,
    'the live production host was reported as unable to sign in');
});

test('subdomains of a listed domain are accepted', () => {
  assert.equal(isHostAuthorised('preview.appscsadhana.vercel.app', REAL_DOMAINS), true);
  assert.equal(isHostAuthorised('a.b.ap-gurukul-43050.web.app', REAL_DOMAINS), true);
});

test('unrelated hosts are rejected', () => {
  assert.equal(isHostAuthorised('127.0.0.1', REAL_DOMAINS), false);
  assert.equal(isHostAuthorised('172.16.36.132', REAL_DOMAINS), false);
  assert.equal(isHostAuthorised('example.com', REAL_DOMAINS), false);
  assert.equal(isHostAuthorised('some-other-app.vercel.app', REAL_DOMAINS), false);
});

test('a lookalike host is not accepted by suffix confusion', () => {
  // "notlocalhost" ends with "localhost" as a STRING but is a different host.
  // Matching must be on a domain boundary, not a bare suffix.
  assert.equal(isHostAuthorised('notlocalhost', REAL_DOMAINS), false);
  assert.equal(isHostAuthorised('evil-appscsadhana.vercel.app', REAL_DOMAINS), false);
});

test('missing or malformed input is rejected rather than throwing', () => {
  assert.equal(isHostAuthorised('', REAL_DOMAINS), false);
  assert.equal(isHostAuthorised(null, REAL_DOMAINS), false);
  assert.equal(isHostAuthorised('localhost', null), false);
  assert.equal(isHostAuthorised('localhost', []), false);
});
