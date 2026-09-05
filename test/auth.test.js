// ============================================================================
// Unit tests for Firebase ID token verification (test/auth.test.js)
// ============================================================================
// src/auth.js is the control the whole API rests on: it is what makes the
// browser login mean something server-side. These tests generate a throwaway
// RSA key pair, publish it as a self-signed X.509 certificate through a stubbed
// global fetch (standing in for Google's cert endpoint), then mint tokens and
// assert that only genuinely valid ones are accepted.
//
// The attack cases here are the ones that break naive JWT handling: alg:none,
// algorithm confusion, a tampered payload, an expired token, and a token minted
// for a different Firebase project.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.FIREBASE_PROJECT_ID = 'test-project';

const auth = require('../src/auth');

// ---------------------------------------------------------------------------
// Test key material
// ---------------------------------------------------------------------------

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

/** The key id our fake Google cert endpoint publishes. */
const KID = 'test-kid-1';

/**
 * selfSignedCertificate — builds a minimal X.509 certificate wrapping the test
 * public key, because src/auth.js reads certificates rather than raw JWKs.
 * Generated with the openssl CLI so we do not hand-roll DER encoding.
 */
function selfSignedCertificate() {
  const { execFileSync } = require('node:child_process');
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appsc-cert-'));
  const keyPath = path.join(dir, 'key.pem');
  const certPath = path.join(dir, 'cert.pem');

  fs.writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  execFileSync('openssl', [
    'req', '-new', '-x509', '-key', keyPath, '-out', certPath,
    '-days', '1', '-subj', '/CN=securetoken.google.com'
  ]);

  const pem = fs.readFileSync(certPath, 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  return pem;
}

const CERT_PEM = selfSignedCertificate();

// Stand in for Google's certificate endpoint.
const realFetch = globalThis.fetch;
test.before(() => {
  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => 'public, max-age=3600' },
    json: async () => ({ [KID]: CERT_PEM })
  });
});
test.after(() => { globalThis.fetch = realFetch; });

// ---------------------------------------------------------------------------
// Token minting
// ---------------------------------------------------------------------------

/** base64url encodes a Buffer or string. */
function b64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * mintToken — builds a signed JWT with the test key.
 *
 * @param {Object} [claimOverrides] Claims to merge over the valid defaults
 * @param {Object} [headerOverrides] Header fields to merge over the defaults
 * @param {boolean} [sign] Set false to leave the signature empty (alg:none case)
 */
function mintToken(claimOverrides = {}, headerOverrides = {}, sign = true) {
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', kid: KID, typ: 'JWT', ...headerOverrides };
  const claims = {
    iss: 'https://securetoken.google.com/test-project',
    aud: 'test-project',
    sub: 'uid-123',
    email: 'curator@example.com',
    email_verified: true,
    name: 'Test Curator',
    auth_time: now - 10,
    iat: now - 10,
    exp: now + 3600,
    firebase: { sign_in_provider: 'google.com' },
    ...claimOverrides
  };

  const signingInput = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(claims));
  if (!sign) return signingInput + '.';

  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey);
  return signingInput + '.' + b64url(signature);
}

/** Asserts that verification rejects `token` with a message matching `pattern`. */
async function assertRejected(token, pattern, description) {
  await assert.rejects(() => auth.verifyIdToken(token), (err) => {
    assert.match(err.message, pattern, `${description}: unexpected message "${err.message}"`);
    return true;
  }, description);
}

// ===========================================================================
// Happy path
// ===========================================================================

test('a correctly signed, current token is accepted', async () => {
  const identity = await auth.verifyIdToken(mintToken());
  assert.equal(identity.uid, 'uid-123');
  assert.equal(identity.email, 'curator@example.com');
  assert.equal(identity.emailVerified, true);
  assert.equal(identity.signInProvider, 'google.com');
});

test('the email claim is lowercased so allowlist matching is case-insensitive', async () => {
  const identity = await auth.verifyIdToken(mintToken({ email: 'Curator@Example.COM' }));
  assert.equal(identity.email, 'curator@example.com');
});

// ===========================================================================
// Signature attacks
// ===========================================================================

test('an alg:none token is rejected', async () => {
  await assertRejected(mintToken({}, { alg: 'none' }, false), /algorithm/i, 'alg:none');
});

test('an HS256 token is rejected (algorithm confusion)', async () => {
  // The classic attack: sign with HMAC using the public certificate as the key,
  // hoping the verifier treats the algorithm as caller-controlled.
  const header = { alg: 'HS256', kid: KID, typ: 'JWT' };
  const claims = { iss: 'https://securetoken.google.com/test-project', aud: 'test-project', sub: 'uid-123', exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) };
  const signingInput = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(claims));
  const mac = crypto.createHmac('sha256', CERT_PEM).update(signingInput).digest();

  await assertRejected(signingInput + '.' + b64url(mac), /algorithm/i, 'HS256 confusion');
});

test('a token with a tampered payload is rejected', async () => {
  const token = mintToken();
  const [header, , signature] = token.split('.');

  // Swap in an elevated payload while keeping the original signature.
  const forgedClaims = b64url(JSON.stringify({
    iss: 'https://securetoken.google.com/test-project',
    aud: 'test-project',
    sub: 'attacker',
    email: 'attacker@evil.example',
    email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000)
  }));

  await assertRejected([header, forgedClaims, signature].join('.'), /signature/i, 'tampered payload');
});

test('a token signed by an unknown key is rejected', async () => {
  await assertRejected(mintToken({}, { kid: 'some-other-kid' }), /unknown key/i, 'unknown kid');
});

test('a token with no key id is rejected', async () => {
  const token = mintToken({}, { kid: undefined });
  await assertRejected(token, /key id/i, 'missing kid');
});

// ===========================================================================
// Claim attacks
// ===========================================================================

test('a token for a different Firebase project is rejected', async () => {
  await assertRejected(mintToken({ aud: 'someone-elses-project' }), /different project/i, 'wrong audience');
});

test('a token with a forged issuer is rejected', async () => {
  await assertRejected(
    mintToken({ iss: 'https://securetoken.google.com/attacker-project' }),
    /issuer/i, 'wrong issuer'
  );
});

test('an expired token is rejected', async () => {
  const past = Math.floor(Date.now() / 1000) - 7200;
  await assertRejected(mintToken({ exp: past, iat: past - 3600 }), /expired/i, 'expired token');
});

test('a token issued in the future is rejected', async () => {
  const future = Math.floor(Date.now() / 1000) + 7200;
  await assertRejected(mintToken({ iat: future, exp: future + 3600 }), /future/i, 'future iat');
});

test('a token with no subject is rejected', async () => {
  await assertRejected(mintToken({ sub: '' }), /subject/i, 'missing sub');
});

// ===========================================================================
// Malformed input
// ===========================================================================

test('malformed tokens are rejected without throwing unexpectedly', async () => {
  const cases = ['', 'not-a-jwt', 'a.b', 'a.b.c.d', '...', 'x'.repeat(9000)];
  for (const token of cases) {
    await assertRejected(token, /malformed/i, `malformed input ${JSON.stringify(token.slice(0, 20))}`);
  }
});

test('non-string tokens are rejected', async () => {
  for (const token of [null, undefined, 42, {}, []]) {
    await assert.rejects(() => auth.verifyIdToken(token), /Malformed/);
  }
});

// ===========================================================================
// Authorisation policy
// ===========================================================================

test('the curator allowlist blocks accounts that are not on it', async () => {
  process.env.CURATOR_EMAILS = 'someone@example.com, other@example.com';
  try {
    await assert.rejects(() => auth.authorize(mintToken()), /not on the curator allowlist/);
  } finally {
    process.env.CURATOR_EMAILS = '';
  }
});

test('the curator allowlist admits accounts that are on it', async () => {
  process.env.CURATOR_EMAILS = 'Curator@Example.com';
  try {
    const identity = await auth.authorize(mintToken());
    assert.equal(identity.email, 'curator@example.com');
  } finally {
    process.env.CURATOR_EMAILS = '';
  }
});

test('with no allowlist, an unverified email is refused', async () => {
  process.env.CURATOR_EMAILS = '';
  await assert.rejects(() => auth.authorize(mintToken({ email_verified: false })), /not verified/);
});

test('an allowlisted account is admitted even if unverified', async () => {
  // The allowlist is the stronger control, so it overrides the verification rule.
  process.env.CURATOR_EMAILS = 'curator@example.com';
  try {
    const identity = await auth.authorize(mintToken({ email_verified: false }));
    assert.equal(identity.uid, 'uid-123');
  } finally {
    process.env.CURATOR_EMAILS = '';
  }
});

test('verification refuses to run at all when the project id is unset', async () => {
  const original = process.env.FIREBASE_PROJECT_ID;
  process.env.FIREBASE_PROJECT_ID = '';
  try {
    await assert.rejects(() => auth.verifyIdToken(mintToken()), /FIREBASE_PROJECT_ID/);
  } finally {
    process.env.FIREBASE_PROJECT_ID = original;
  }
});

// ===========================================================================
// Header extraction
// ===========================================================================

test('the bearer token is extracted only from a well-formed header', async () => {
  assert.equal(auth.extractBearerToken({ headers: { authorization: 'Bearer abc123' } }), 'abc123');
  assert.equal(auth.extractBearerToken({ headers: { authorization: 'bearer abc123' } }), 'abc123');
  assert.equal(auth.extractBearerToken({ headers: {} }), '');
  assert.equal(auth.extractBearerToken({ headers: { authorization: 'Basic abc123' } }), '');
  assert.equal(auth.extractBearerToken({ headers: { authorization: 'abc123' } }), '');
});
