# Sadhana APPSC — Telegram Quiz Automation

Curate APPSC exam questions in a browser, track them in Google Sheets, and publish
them to Telegram forum topics as quiz polls.

Five dashboards, one Google Sheet with 30 tracked columns per question, and a Telegram
bot that posts on a schedule or on demand.

---

## The five dashboards

Run `npm run dashboard` and open <http://localhost:3000>.

| | Dashboard | What it is for |
|---|---|---|
| 📤 | **Upload** (`/`) | Paste a JSON batch, review it as editable cards, push it into the sheet. Duplicates are detected and skipped. |
| 📊 | **Analytics** (`/analytics.html`) | How many questions exist per subject, how many are posted, what is pending, the workflow and difficulty mix, curator contributions, posting timeline, and how many days of content each subject has left. |
| 📚 | **Questions** (`/questions.html`) | Browse and search the whole bank. Filter by subject, status, difficulty or posted state. Edit any question in place, approve or reject in bulk, delete. |
| 🤖 | **Automation** (`/automation.html`) | Post to Telegram straight from the browser. Queue batches for a planned time. See every subject's cron cadence and remaining runway. |
| 🩺 | **Health** (`/health.html`) | Is the server, the sheet and the bot reachable — and are the security controls that protect them actually switched on. |

---

## Setup

### 1. Install

```bash
npm install
```

### 2. Telegram bot

1. Message **@BotFather**, send `/newbot`, copy the token.
2. Create a group, enable **Topics** in settings, add the bot as an **admin** with
   Manage Topics, Post Messages and Send Polls.
3. Add **@raw_data_bot** to the group to learn the chat id (it starts with `-100`).

### 3. Google Sheet backend

1. Create a Google Sheet.
2. **Extensions → Apps Script**, delete `Code.gs`, paste all of `google_apps_script.js`.
3. Run **`setupSpreadsheet`** from the function dropdown (first time), or
   **`upgradeSpreadsheet`** if you already have questions in an older layout — it
   migrates every row by header name, so nothing is lost.
4. Generate a shared secret and register it in **both** places:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   - Apps Script → **Project Settings → Script properties** → add `API_TOKEN`
   - your `.env` → `SHEET_API_TOKEN`

   Without this, the `/exec` URL alone grants full access to your question bank.
5. **Deploy → Manage deployments → Edit → New version.**
   Execute as **Me**, Who has access **Anyone**. Copy the `/exec` URL.

### 4. Configure

```bash
cp .env.example .env
```

Fill in `TELEGRAM_BOT_TOKEN`, `TELEGRAM_GROUP_ID`, `GOOGLE_SHEET_WEBAPP_URL`,
`SHEET_API_TOKEN`, `FIREBASE_PROJECT_ID` and `CURATOR_EMAILS`. Every variable is
documented inline in `.env.example`.

> `FIREBASE_PROJECT_ID` is required. Without it the server cannot verify logins and
> refuses every data request with HTTP 503.

### 5. Create the Telegram topics

```bash
node setup.js
```

Creates a forum topic per subject and writes the thread ids into the Config tab.

### 6. Run

```bash
npm run dashboard
```

---

## The 30-column schema

Each subject gets its own sheet tab. Columns A–AD:

| Col | Field | What it gives you |
|---|---|---|
| A | S.No | Serial number within the subject |
| B | **Question ID** | Stable unique id (`POL-20260905-0007`) — the handle for editing, deleting and cross-referencing |
| C | Date | Publication date; becomes the `#DD_MM_YYYY` hashtag on the post |
| D | Newspaper | Source publication; becomes the `#Newspaper` hashtag |
| E | Subject | Mirrors the tab name |
| F | **Topic** | Sub-topic inside the subject, so revision can be filtered finer than "Polity" |
| G | Question | Full question text and statements |
| H–K | Option A–D | The four choices |
| L | Correct Answer | A / B / C / D |
| M | Explanation | Shown on the quiz poll and in the spoiler message |
| N | **Difficulty** | Easy / Medium / Hard — dropdown, colour coded |
| O | **Tags** | Comma-separated keywords for search and revision sets |
| P | **Source URL** | Link back to the article or PIB release |
| Q | **Status** | Draft → Review → Approved → Scheduled → Posted, plus Rejected and Archived |
| R | Posted | YES / NO |
| S | Posted At | IST timestamp of the Telegram post |
| T | **Scheduled For** | Planned posting time |
| U | **Thread ID** | Which forum topic it went to |
| V | Telegram Msg ID | Message id of the poll |
| W | **Poll ID** | Telegram poll id, for attributing votes later |
| X | **Times Posted** | Repost counter |
| Y | Added At | When it was uploaded |
| Z | Added By | Curator email, taken from the verified login |
| AA | **Updated At** | Last edit |
| AB | **Updated By** | Who made the last edit |
| AC | **Dup Hash** | Normalised fingerprint of the question text — how duplicates are caught |
| AD | **Review Notes** | Free-text QA remarks |

Bold entries are new in this release.

**Why `Status` matters alongside `Posted`:** `Posted` is a fact about the past.
`Status` is a decision about the future. A question can be written but unreviewed
(`Draft`), reviewed and cleared (`Approved`), or thrown out (`Rejected`) — all three
have `Posted = NO`, and only one of them should ever reach the channel. The Automation
dashboard sends only `Approved` or `Scheduled` questions by default, and `Rejected`
and `Archived` rows are never eligible.

**Why `Dup Hash` matters:** the question text is lowercased and stripped of
punctuation and whitespace before hashing, so re-pasting the same question with
different formatting is still recognised as a duplicate rather than silently doubling
your bank.

---

## Command line

The CLI still does everything it did, and now records the fuller tracking trail.

```bash
node send.js --subject Polity --count 5   # send five Polity questions now
node send.js --all --count 3              # three from every active subject
node send.js --stats                      # totals per subject
node send.js --test                       # check the bot token and group

node schedule.js                          # run the cron scheduler
node schedule.js --dry-run                # show the schedule without sending

node setup.js                             # create the Telegram forum topics
```

Common cron expressions for the Config tab:

| Expression | Meaning |
|---|---|
| `0 */2 * * *` | every 2 hours |
| `0 */3 * * *` | every 3 hours |
| `0 9 * * *` | daily at 9 AM |
| `0 9,18 * * *` | 9 AM and 6 PM |
| `0 8,14,20 * * *` | 8 AM, 2 PM and 8 PM |

---

## Security

The dashboards are protected by Firebase Auth, and — this is the part that actually
matters — **the server verifies that login itself** rather than trusting the browser.
Every API call must carry a Firebase ID token whose RS256 signature is checked against
Google's published certificates before anything touches the sheet or the bot.

On top of that: a curator allowlist, a shared secret between the server and the Apps
Script, loopback-only binding, no cross-origin access, request size caps, rate
limiting, and a strict Content-Security-Policy.

The **Health dashboard** shows which of these are switched on and exactly what to
change for any that are not.

The full review, including what was wrong before this release and how each issue was
proven, is in [SECURITY-REVIEW.md](SECURITY-REVIEW.md).

---

## Tests

```bash
npm test
```

75 tests across three suites:

- `test/server.test.js` — every API route, input validation, and a regression test for
  each security finding (traversal, CORS, SSRF, body limits, forged authorship).
- `test/auth.test.js` — Firebase token verification against real signing attacks:
  `alg:none`, HS256 confusion, tampered payloads, expiry, wrong audience.
- `test/apps-script.test.js` — the Apps Script logic in a sandboxed Google runtime:
  header resolution, the migration, duplicate detection, filtering and the runway math.

---

## Project structure

```
├── server.js                 # dashboard server + JSON API (the security boundary)
├── google_apps_script.js     # Google Sheets backend — paste into Apps Script
├── send.js                   # CLI: post questions now
├── schedule.js               # CLI: cron scheduler
├── setup.js                  # CLI: create Telegram forum topics
├── dashboard/
│   ├── shared.js             # auth gate, nav, API client, shared UI
│   ├── shared.css            # dashboard chrome
│   ├── style.css             # design tokens and the upload workspace
│   ├── index.html/app.js     # Upload
│   ├── analytics.html/.js    # Analytics
│   ├── questions.html/.js    # Question bank
│   ├── automation.html/.js   # Automation
│   └── health.html/.js       # System health
├── src/
│   ├── auth.js               # Firebase ID token verification
│   ├── sheets.js             # Apps Script client
│   ├── data.js               # Sheets / Excel switch
│   ├── excel.js              # local Excel fallback
│   └── telegram.js           # Telegram Bot API
└── test/                     # 75 tests
```

## Notes

- Telegram caps quiz explanations at 200 characters; longer ones are truncated in the
  poll and sent in full as a spoiler message underneath.
- Questions over 290 characters are posted as a message followed by a short poll,
  because Telegram caps poll question text at 300.
- Sends are spaced 1.5 seconds apart to stay well inside Telegram's rate limits.

## License

ISC
