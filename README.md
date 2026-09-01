# Sadhana APPSC Telegram Automation

Simple, Excel-based automation to post APPSC exam quiz questions to Telegram forum topics. No databases, no web servers — just Excel files and command-line scripts.

## ✨ Features

- 📊 **Excel-based** — All questions and tracking live in `.xlsx` files
- 📝 **One Excel, multiple sheets** — Each subject gets its own sheet
- ✅ **Tracks posted questions** — Marks "Posted" column with timestamp directly in Excel
- 🧠 **Quiz polls with 💡 explanation** — Sends Telegram quiz-type polls with correct answer + explanation
- 📌 **Forum topics** — Each subject gets its own topic thread in a single Telegram supergroup
- ⏰ **Scheduled posting** — Auto-post questions at regular intervals using cron
- 🎯 **Manual control** — Send specific counts from specific subjects via CLI
- 🚫 **No duplicates** — Only sends questions where "Posted" column is empty

## 📁 Project Structure

```
├── config.xlsx         # Subject config (names, emojis, topic IDs, schedules)
├── questions.xlsx      # All questions (one sheet per subject)
├── send.js             # CLI: manually send questions
├── setup.js            # CLI: create Telegram forum topics
├── schedule.js         # CLI: run automated scheduled posting
├── create-sample.js    # Utility: generate sample Excel files
├── src/
│   ├── excel.js        # Excel read/write operations
│   └── telegram.js     # Telegram Bot API interactions
├── .env                # Your bot token & group ID (not committed)
└── .env.example        # Template for .env
```

## 📋 Excel File Format

### config.xlsx (Config sheet)

| Subject         | Emoji | Topic_Thread_ID | Schedule_Cron    | Questions_Per_Batch | Active |
|-----------------|-------|-----------------|------------------|---------------------|--------|
| Polity          | ⚖️    | (auto-filled)   | 0 */2 * * *      | 5                   | YES    |
| Economy         | 💰    |                 | 0 */3 * * *      | 5                   | YES    |

### questions.xlsx (Each subject = separate sheet)

| Question                          | Option A    | Option B       | Option C    | Option D    | Correct Answer | Explanation           | Posted              |
|-----------------------------------|-------------|----------------|-------------|-------------|----------------|-----------------------|---------------------|
| Who is the Father of...           | Gandhi      | Ambedkar       | Nehru       | Patel       | B              | Dr. Ambedkar chaired..| YES \| 1/9/2026...  |
| The Preamble was amended by...    | 42nd        | 44th           | 52nd        | 61st        | A              | 42nd Amendment...     |                     |

> **Note:** The "Posted" column is automatically updated to `YES | <timestamp>` when a question is sent.

## 🚀 Setup Guide

### Step 1: Install Dependencies

```bash
npm install
```

### Step 2: Create a Telegram Bot

1. Open Telegram, search for **@BotFather**
2. Send `/newbot`, choose a name and username
3. Copy the **bot token**

### Step 3: Create a Supergroup with Topics

1. Create a Telegram group
2. Go to Settings → enable **Topics**
3. Add your bot as a **member**
4. Make the bot an **Admin** with: Manage Topics, Post Messages, Send Polls
5. Get the Group ID: add **@raw_data_bot** to the group, it replies with the ID

### Step 4: Configure .env

```bash
cp .env.example .env
```

Edit `.env`:
```
TELEGRAM_BOT_TOKEN=123456:ABCdef...
TELEGRAM_GROUP_ID=-100xxxxxxxxxx
```

### Step 5: Generate Sample Files

```bash
node create-sample.js
```

This creates `config.xlsx` and `questions.xlsx` with sample data.

### Step 6: Create Telegram Topics

```bash
node setup.js
```

This creates a forum topic for each subject and saves the Thread IDs to `config.xlsx`.

### Step 7: Add Your Questions

Edit `questions.xlsx` in Excel/Google Sheets. Add your real APPSC questions to each subject sheet.

## 📖 Usage

### Send Questions Manually

```bash
# Send 5 questions from Polity
node send.js --subject Polity --count 5

# Send 1 question from Economy (default count = 1)
node send.js --subject Economy

# Send 3 questions from ALL subjects
node send.js --all --count 3

# Show question statistics
node send.js --stats

# Test Telegram connection
node send.js --test
```

### Run Scheduled Auto-Posting

```bash
# Start scheduler (runs based on config.xlsx cron settings)
node schedule.js

# Preview schedules without starting
node schedule.js --dry-run
```

### Common Cron Expressions

| Expression        | Meaning                      |
|-------------------|------------------------------|
| `*/30 * * * *`    | Every 30 minutes             |
| `0 * * * *`       | Every hour                   |
| `0 */2 * * *`     | Every 2 hours                |
| `0 */3 * * *`     | Every 3 hours                |
| `0 9 * * *`       | Daily at 9:00 AM             |
| `0 9,18 * * *`    | Daily at 9 AM and 6 PM       |
| `0 8,14,20 * * *` | 8 AM, 2 PM, and 8 PM daily   |

## 🔧 NPM Scripts

```bash
npm run send          # Same as: node send.js
npm run setup         # Same as: node setup.js
npm run schedule      # Same as: node schedule.js
npm run create-sample # Same as: node create-sample.js
```

## ⚠️ Important Notes

- **Telegram quiz explanation limit**: Max 200 characters. Longer explanations are auto-truncated.
- **Rate limiting**: 1.5 second delay between messages to avoid Telegram API limits.
- **Excel must be closed**: Close the Excel file before running scripts that write to it (Windows locks open files).
- **Backup your Excel**: The scripts modify `questions.xlsx` directly. Keep backups.

## 📄 License

ISC
