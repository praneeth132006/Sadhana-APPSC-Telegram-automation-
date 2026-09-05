// ============================================================================
// membership-cron.js — the daily expiry sweep
// ============================================================================
// Reminds members whose pass is about to run out, and removes those whose pass
// has ended.
//
//   node membership-cron.js --dry-run   # show what would happen, change nothing
//   node membership-cron.js             # run once and exit
//   node membership-cron.js --watch     # stay running, sweep every night
//
// Run it nightly from cron:
//   0 1 * * *  cd /path/to/project && /usr/bin/node membership-cron.js >> logs/membership.log 2>&1
// ============================================================================

require('dotenv').config();

const cron = require('node-cron');
const membership = require('./src/membership');
const telegram = require('./src/telegram');

/** When --watch is used, sweep at this time daily (1:00 AM IST). */
const SCHEDULE = process.env.MEMBERSHIP_CRON || '0 1 * * *';

const isDryRun = process.argv.includes('--dry-run');
const isWatch = process.argv.includes('--watch');

/** Prints a readable summary of one sweep. */
function report(summary) {
  const stamp = new Date().toISOString();
  console.log(`\n[${stamp}] Membership sweep${summary.dryRun ? ' (dry run — nothing changed)' : ''}`);
  console.log(`   Checked           : ${summary.checked} member(s) at or near expiry`);
  console.log(`   Reminders sent    : ${summary.reminded.length}`);
  summary.reminded.forEach((m) =>
    console.log(`      → ${m.telegram_id}${m.username ? ' @' + m.username : ''} — ${m.daysLeft} day(s) left`));

  console.log(`   Removed           : ${summary.removed.length}`);
  summary.removed.forEach((m) =>
    console.log(`      ✂ ${m.telegram_id}${m.username ? ' @' + m.username : ''} — ${m.plan}`));

  if (summary.failed.length) {
    console.log(`   Failed            : ${summary.failed.length}`);
    summary.failed.forEach((f) => console.log(`      ✗ ${f.telegram_id} — ${f.reason}`));
  }
}

/** Runs one sweep, catching errors so --watch survives a bad night. */
async function sweep() {
  try {
    if (process.env.TELEGRAM_BOT_TOKEN) {
      telegram.init(process.env.TELEGRAM_BOT_TOKEN, membership.getPremiumGroupId());
    }
    report(await membership.runDailyCheck({ dryRun: isDryRun }));
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Sweep failed: ${err.message}`);
    if (!isWatch) process.exitCode = 1;
  }
}

async function main() {
  if (!isWatch) {
    await sweep();
    return;
  }

  if (!cron.validate(SCHEDULE)) {
    console.error(`❌ MEMBERSHIP_CRON is not a valid cron expression: "${SCHEDULE}"`);
    process.exit(1);
  }

  console.log('════════════════════════════════════════════════════');
  console.log('⏰ Membership cron running');
  console.log(`   Schedule : ${SCHEDULE} (Asia/Kolkata)`);
  console.log(`   Mode     : ${isDryRun ? 'DRY RUN' : 'live'}`);
  console.log('   Ctrl+C to stop');
  console.log('════════════════════════════════════════════════════');

  cron.schedule(SCHEDULE, sweep, { timezone: 'Asia/Kolkata' });

  // One sweep at startup so a missed night is caught up immediately.
  await sweep();
}

main().catch((err) => {
  console.error('❌ ' + err.message);
  process.exit(1);
});
