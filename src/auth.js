// ============================================================================
// Server-side Firebase Auth verification (src/auth.js)
// ============================================================================
// The dashboard hides itself behind a Firebase login, but that is a *client*
// side control — anything can call the local API directly with curl or from a
// malicious page in another tab. This module is the server-side half: it
// cryptographically verifies the Firebase ID token that the browser sends in
// the Authorization header before any request is allowed to touch the Google
// Sheet or the Telegram bot.
//
// It has no npm dependencies. Firebase ID tokens are RS256 JWTs signed by
// Google, and Google publishes the matching X.509 certificates at a well known
// URL, so verification is: fetch certs (cached), check the signature, then
// check every claim.
// ============================================================================

const crypto = require('crypto');

/** Where Google publishes the public certs for Firebase session tokens. */
const CERT_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

/** Tolerance for clock drift between this machine and Google, in seconds. */
const CLOCK_SKEW_SECONDS = 60;

/** Longest token we will even attempt to parse, as a cheap DoS guard. */
const MAX_TOKEN_LENGTH = 8192;

/** In-memory cert cache: { keys: {kid: pem}, expiresAt: epochMillis }. */
let certCache = { keys: null, expiresAt: 0 };

/** Deduplicates concurrent cert fetches so a burst of requests makes one call. */
let certFetchInFlight = null;

/**
 * getProjectId — the Firebase project this server accepts tokens for.
 * Set FIREBASE_PROJECT_ID in .env; it must match the projectId in the
 * dashboard's firebaseConfig or every token will be rejected.
 */
function getProjectId() {
  return String(process.env.FIREBASE_PROJECT_ID || '').trim();
}

/**
 * getCuratorAllowlist — emails permitted to use the dashboard.
 * Set CURATOR_EMAILS in .env as a comma separated list. An empty list means
 * "any successfully authenticated Firebase user", which is only safe if you
 * have disabled self-registration in the Firebase console.
 */
function getCuratorAllowlist() {
  return String(process.env.CURATOR_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** True when auth is fully configured and will actually be enforced. */
function isConfigured() {
  return Boolean(getProjectId());
}

/**
 * base64UrlDecode — decodes a JWT segment into a Buffer.
 *
 * @param {string} segment base64url encoded JWT part
 * @returns {Buffer}
 */
function base64UrlDecode(segment) {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
}

/**
 * fetchCerts — downloads and caches Google's signing certificates.
 * The cache honours the Cache-Control max-age Google sends, so we refresh
 * roughly once a day rather than on every request.
 *
 * @returns {Promise<Object>} Map of key id to PEM certificate
 */
async function fetchCerts() {
  if (certCache.keys && Date.now() < certCache.expiresAt) {
    return certCache.keys;
  }
  if (certFetchInFlight) return certFetchInFlight;

  certFetchInFlight = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(CERT_URL, { signal: controller.signal });
      if (!res.ok) throw new Error('Certificate fetch failed with status ' + res.status);

      const keys = await res.json();

      // Respect Google's cache lifetime, clamped to a sane window.
      const cacheControl = res.headers.get('cache-control') || '';
      const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
      const maxAgeSeconds = maxAgeMatch ? Math.min(Number(maxAgeMatch[1]), 86400) : 3600;

      certCache = { keys, expiresAt: Date.now() + maxAgeSeconds * 1000 };
      return keys;
    } finally {
      clearTimeout(timer);
      certFetchInFlight = null;
    }
  })();

  return certFetchInFlight;
}

/**
 * verifyIdToken — full verification of a Firebase ID token.
 * Throws with a specific reason on any failure; returns the trusted identity
 * on success. Nothing in the token is trusted until the signature checks out.
 *
 * @param {string} token Raw JWT from the Authorization header
 * @returns {Promise<{uid: string, email: string, name: string, emailVerified: boolean}>}
 */
async function verifyIdToken(token) {
  const projectId = getProjectId();
  if (!projectId) {
    throw new Error('FIREBASE_PROJECT_ID is not set — refusing to accept any token.');
  }
  if (typeof token !== 'string' || !token || token.length > MAX_TOKEN_LENGTH) {
    throw new Error('Malformed authentication token.');
  }

  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed authentication token.');

  let header;
  let claims;
  try {
    header = JSON.parse(base64UrlDecode(parts[0]).toString('utf8'));
    claims = JSON.parse(base64UrlDecode(parts[1]).toString('utf8'));
  } catch (err) {
    throw new Error('Malformed authentication token.');
  }

  // Pin the algorithm. Without this an attacker could present alg:none or an
  // HMAC token signed with the (public) certificate as the key.
  if (header.alg !== 'RS256') throw new Error('Unexpected token algorithm.');
  if (!header.kid) throw new Error('Token is missing a key id.');

  const certs = await fetchCerts();
  const certPem = certs[header.kid];
  if (!certPem) throw new Error('Token was signed with an unknown key.');

  const publicKey = new crypto.X509Certificate(certPem).publicKey;
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(parts[0] + '.' + parts[1]);
  verifier.end();

  if (!verifier.verify(publicKey, base64UrlDecode(parts[2]))) {
    throw new Error('Token signature is invalid.');
  }

  // Signature is good — now the claims must match this project and be current.
  const now = Math.floor(Date.now() / 1000);

  if (claims.aud !== projectId) throw new Error('Token was issued for a different project.');
  if (claims.iss !== 'https://securetoken.google.com/' + projectId) {
    throw new Error('Token has an unexpected issuer.');
  }
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < now) {
    throw new Error('Token has expired — sign in again.');
  }
  if (typeof claims.iat !== 'number' || claims.iat - CLOCK_SKEW_SECONDS > now) {
    throw new Error('Token was issued in the future.');
  }
  if (typeof claims.auth_time === 'number' && claims.auth_time - CLOCK_SKEW_SECONDS > now) {
    throw new Error('Token authentication time is in the future.');
  }
  if (!claims.sub || typeof claims.sub !== 'string') {
    throw new Error('Token has no subject.');
  }

  return {
    uid: claims.sub,
    email: String(claims.email || '').toLowerCase(),
    name: String(claims.name || ''),
    emailVerified: Boolean(claims.email_verified),
    signInProvider: (claims.firebase && claims.firebase.sign_in_provider) || 'unknown'
  };
}

/**
 * authorize — verifies the token and applies the curator allowlist.
 *
 * @param {string} token Raw JWT
 * @returns {Promise<Object>} The authorized identity
 */
async function authorize(token) {
  const identity = await verifyIdToken(token);
  const allowlist = getCuratorAllowlist();

  if (allowlist.length > 0 && allowlist.indexOf(identity.email) === -1) {
    throw new Error('Account ' + (identity.email || identity.uid) + ' is not on the curator allowlist.');
  }

  // Password accounts can be created by anyone who reaches the sign-in page,
  // so an unverified email is not enough on its own. Google sign-in always
  // arrives verified.
  if (allowlist.length === 0 && !identity.emailVerified) {
    throw new Error('Email address is not verified. Verify it or add the account to CURATOR_EMAILS.');
  }

  return identity;
}

/**
 * extractBearerToken — pulls the JWT out of an Authorization header.
 *
 * @param {http.IncomingMessage} req
 * @returns {string} The token, or '' when absent
 */
function extractBearerToken(req) {
  const header = req.headers['authorization'] || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : '';
}

/** A short description of the auth posture, for the health dashboard. */
function describeConfig() {
  const allowlist = getCuratorAllowlist();
  return {
    projectId: getProjectId() || null,
    enforced: isConfigured(),
    allowlistSize: allowlist.length,
    allowlistMode: allowlist.length > 0 ? 'allowlist' : 'any-verified-user'
  };
}

module.exports = {
  isConfigured,
  authorize,
  verifyIdToken,
  extractBearerToken,
  describeConfig,
  getCuratorAllowlist,
  getProjectId
};
