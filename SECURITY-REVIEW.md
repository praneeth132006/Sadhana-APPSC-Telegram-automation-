# Security Review — Sadhana APPSC Telegram Automation

**Date:** 5 September 2026
**Scope:** `server.js`, `dashboard/`, `google_apps_script.js`, `src/`, `.env` handling
**Method:** Source review driven by the [RedBlueSkills](https://github.com/praneeth132006/RedBlueSkills)
skill matrix (`web-app` and `api` surfaces), followed by live probing of the running
server and regression tests for every finding.
**Authorisation:** The repository owner requested this review of their own project.
No third-party systems were probed; the only network calls made were to the owner's
own Apps Script deployment.

---

## Summary

Eleven findings. All eleven are fixed in this release, and each one has a regression
test in `test/` so it cannot silently come back.

The single most important point: **before this release the browser login was the only
thing standing between the internet and your question bank.** Firebase Auth ran
entirely in the page, and the local API trusted anyone who could send it an HTTP
request. Anything that could reach `http://localhost:3000` — a script, a `curl`
command, or any website you happened to have open in another tab — could add
questions, read the sheet, and post to your Telegram channel. That is now closed.

| # | Finding | Severity | Skill | Status |
|---|---------|----------|-------|--------|
| 1 | API had no server-side authentication | **Critical** | `api-broken-authentication` | Fixed |
| 2 | Wildcard CORS allowed any website to drive the API | **Critical** | `api-security-misconfiguration` | Fixed |
| 3 | SSRF via caller-supplied `url` on `/api/ping` and `/api/send` | **Critical** | `api-ssrf` / `web-ssrf` | Fixed |
| 4 | Apps Script Web App world-readable and world-writable | **High** | `api-bola` / `api-bfla` | Fixed (needs one manual step) |
| 5 | Unbounded request body | **High** | `api-unrestricted-resource-consumption` | Fixed |
| 6 | Open self-registration created curator accounts | **High** | `web-broken-authentication` | Fixed |
| 7 | Client could forge `Added By` and other tracking columns | **Medium** | `api-mass-assignment` | Fixed |
| 8 | Path-traversal prefix check was not separator-anchored | **Medium** | `web-path-traversal` | Fixed |
| 9 | Server bound to all interfaces | **Medium** | `api-security-misconfiguration` | Fixed |
| 10 | No rate limiting | **Medium** | `api-rate-limit-hardening` | Fixed |
| 11 | Missing security response headers | **Low** | `api-security-configuration-hardening` | Fixed |

A twelfth issue — a **data-integrity bug in the schema migration** — was found by the
tests written during this work and is documented at the end.

---

## Findings

### 1. The API had no server-side authentication — Critical

**Was:** `dashboard/app.js` checked `if (!currentUser)` before calling `/api/send`.
That check lives in the browser, so it only inconveniences someone using the UI.
`server.js` itself accepted every request.

**Proof:** with the dashboard running and nobody signed in:

```
curl -X POST http://localhost:3000/api/send \
  -H 'Content-Type: application/json' \
  -d '{"subject":"Polity","questions":[{"question":"anything"}],"added_by":"whoever"}'
```

This wrote straight into the production Google Sheet.

**Now:** every data route requires a Firebase ID token in an `Authorization: Bearer`
header. `src/auth.js` verifies it properly — RS256 signature against Google's published
certificates, with the algorithm pinned, plus `aud`, `iss`, `exp`, `iat` and `sub`
checks. Unauthenticated requests get `401`; invalid tokens get `403`.

`test/auth.test.js` covers `alg:none`, HS256 algorithm confusion, a tampered payload,
an unknown key id, a wrong audience, a forged issuer and expiry.

### 2. Wildcard CORS let any website drive the API — Critical

**Was:** `Access-Control-Allow-Origin: *` on every API response, with no
authentication. Any page you visited while the dashboard was running could
`fetch('http://localhost:3000/api/send', …)` and both write to your sheet and read
back the response.

**Now:** no CORS headers are sent at all. The dashboards are served from the same
origin, so they need none. `OPTIONS` returns `405`, so a cross-origin preflight for an
`Authorization` header fails and the request never happens.

### 3. Server-side request forgery — Critical

**Was:** `/api/ping?url=…` and the `url` field in the `/api/send` body were fetched
server-side with no validation:

```
curl 'http://localhost:3000/api/ping?url=http://169.254.169.254/latest/meta-data/'
```

The server fetched whatever you named — cloud metadata endpoints, services bound to
localhost, anything on the local network — and returned the response body in `data`.

**Now:** callers cannot supply a URL at all. The endpoint comes from
`GOOGLE_SHEET_WEBAPP_URL` only, and `src/sheets.js` validates it must be HTTPS, on
`script.google.com`, ending in `/exec`. A `url` query parameter is ignored, which
`test/server.test.js` asserts explicitly.

### 4. The Apps Script Web App was world-readable and world-writable — High

**Was:** the Web App is deployed with *Who has access: Anyone*, which is required for
the bot to reach it, but the script authenticated nobody. The `/exec` URL was
effectively the password to the entire question bank: anyone holding it could read
every question and mark rows as posted.

**Now:** `doGet` and `doPost` require a shared secret (`API_TOKEN` in Script
properties, `SHEET_API_TOKEN` in `.env`), compared in constant time. `ping` stays open
so the status indicator works, and it reports whether a token is configured — the
Health dashboard turns that into a visible red row when it is not.

> **One manual step is still on you.** Add `API_TOKEN` in Apps Script → Project
> Settings → Script properties, using the value already generated in your `.env`,
> then redeploy. Until then the script runs in open mode and this finding is only
> half-closed. The Health dashboard will keep telling you so.

### 5. Unbounded request body — High

**Was:** `req.on('data', chunk => body += chunk)` with no limit. A single large POST
could exhaust memory.

**Now:** 2 MB cap, enforced both on the declared `Content-Length` and on the actual
stream (because `Content-Length` can lie). Over-limit requests get `413` and the
socket is destroyed.

### 6. Anyone could create a curator account — High

**Was:** the sign-in gate offered "Create Account", wired to
`createUserWithEmailAndPassword`. Anyone reaching the page could self-register and get
a "Verified" badge.

**Now:** three layers. Registration is hidden unless `ALLOW_SELF_REGISTRATION=true`.
The server enforces a `CURATOR_EMAILS` allowlist. With no allowlist configured, the
server refuses accounts whose email is unverified.

### 7. Clients could forge tracking columns — Medium

**Was:** `added_by` came from the request body, and question objects were passed
through to the sheet largely as-is. A caller could set their own authorship, or write
`Posted: YES` on arrival.

**Now:** attribution is derived from the verified token, never the body. The server
sanitiser rebuilds each question from an explicit allowlist of fields, and the Apps
Script `updateQuestion` has its own `EDITABLE_FIELDS` allowlist so `Posted`, the
timestamps, `Question ID` and the audit columns cannot be patched.

### 8. Path-traversal prefix check — Medium

**Was:** `filePath.startsWith(DASHBOARD_DIR)` with no trailing separator, so a sibling
directory such as `dashboard-backup/` would satisfy the check. Percent-encoded input
was never decoded before normalisation.

**Now:** the path is decoded, rejected if it contains a null byte, resolved, and
required to sit strictly inside `dashboard/` compared *with* a trailing separator.
Only allowlisted extensions are served. Eight traversal variants are tested.

### 9. Server bound to every interface — Medium

**Was:** `server.listen(PORT)` binds `0.0.0.0`, exposing an unauthenticated API that
posts to a public Telegram channel to every device on the network.

**Now:** binds `127.0.0.1` by default. Overriding it via `HOST` prints a startup
warning and shows an amber row on the Health dashboard.

### 10. No rate limiting — Medium

**Now:** 240 requests per minute per client address, `429` with `Retry-After` beyond
that. Telegram posting is separately capped at 20 questions per call with a 1.5 s gap
between sends.

### 11. Missing security headers — Low

**Now:** every response carries a Content-Security-Policy that allowlists only the
Google origins Firebase Auth actually needs, plus `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` and
`frame-ancestors 'none'`.

---

## Also fixed: a data-integrity bug in the schema migration

Not a security finding, but it would have quietly corrupted your spreadsheet.

`headerMap()` resolved column positions by header name, falling back to the *canonical
position* when a header was missing. On an older sheet that has no `Question ID`
column, reading `Question ID` (canonical index 1) therefore returned whatever sat at
index 1 in that sheet — the `Date`. Running `upgradeSpreadsheet` would have written
dates into the Question ID column of every migrated row, and the same confusion
applied to `Topic`, `Difficulty`, `Status` and every other new column.

A missing header now maps to `-1`; reads treat that as empty, and writes resolve it to
the canonical column. `test/apps-script.test.js` has a dedicated regression test.

---

## Things to keep an eye on

- **`.env` holds your bot token.** It is gitignored and was never committed — verified
  against the full history. If it ever leaks, revoke with `/revoke` in @BotFather.
- **The Firebase `apiKey` in `dashboard/shared.js` is public by design.** It is an
  identifier, not a secret. What protects you is the server-side token check plus the
  curator allowlist. Do keep the Firebase console's authorised-domains list tight.
  GitHub secret scanning flags it anyway — see below before acting on that alert.
- **The `Anyone` deployment is inherent to Apps Script Web Apps.** The shared token is
  the mitigation; rotate it if you ever paste the `/exec` URL somewhere public.
- **This is a localhost tool.** If you ever put it on a real host, add TLS and revisit
  the rate limits, which are tuned for a single curator.

## GitHub secret scanning: "Google API Key" on the Firebase `apiKey`

GitHub opens a `google_api_key` alert for `dashboard/shared.js`, tagged **Publicly
leaked secret**, and offers four steps beginning "Rotate the secret".

**Do not follow those steps here, and do not rotate this key.** The alert is a true
positive about the *pattern* and a false positive about the *risk*: `AIza…` is the
format Google uses for both billable server keys and Firebase web-app identifiers, and
the scanner cannot tell them apart. A Firebase web `apiKey` is shipped to every browser
that loads the page — it is not withheld from anyone, so it cannot leak. Rotating it
means editing the code and redeploying, and the replacement is equally public.

This was verified rather than assumed, on 2026-09-09:

```bash
KEY=...   # the apiKey from dashboard/shared.js

# 1. What the key can reach, called with no referrer at all.
curl -s "https://identitytoolkit.googleapis.com/v1/projects?key=$KEY"

# 2. Whether any billable API is reachable with it.
curl -s "https://maps.googleapis.com/maps/api/geocode/json?address=Hyderabad&key=$KEY"
```

- Authorised domains are already tight: `localhost`,
  `ap-gurukul-43050.firebaseapp.com`, `ap-gurukul-43050.web.app`,
  `appscsadhana.vercel.app`. A sign-in popup cannot be driven from anyone else's site.
- No billable API is activated — the Maps call returns *"This API is not activated on
  your API project"*. There is no billing to run up.
- Email/password sign-up **is** enabled, and authorised domains do not gate the REST
  API, so someone holding this key can call `accounts:signUp` and create an account in
  the project. That grants nothing: `authorize()` in `src/auth.js` rejects any email
  outside `CURATOR_EMAILS`, which is a four-address allowlist. The cost of the abuse is
  junk rows in the Firebase user table, not access.

So the correct response to the alert is to **close it as a false positive** ("used in
tests" is the closest reason GitHub offers; leave a comment saying it is a public
Firebase web identifier). If you want defence in depth against the sign-up path, the
fix is in the Google console, not in this repository: enable **Firebase App Check**, or
add an HTTP-referrer restriction to the key. Neither requires a code change.

**If you ever want the key out of the repository anyway**, note that it still has to
reach the browser, so this buys no security — only the ability to point a build at a
different Firebase project and to keep the scanner quiet. It means serving the config
from `/api/config` (already fetched during bootstrap) and moving `initializeApp` out of
module scope in `dashboard/shared.js` into `initDashboard`. That is a change to the
auth path for every page, so it needs a real sign-in test, not just a page load.
