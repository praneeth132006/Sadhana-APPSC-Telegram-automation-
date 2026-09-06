#!/usr/bin/env node
// ============================================================================
// Group verifier (verify-groups.js)
// ============================================================================
// Checks every group end to end and says plainly what is wrong.
//
// Five groups times four things that can each be misconfigured is twenty ways
// to be quietly broken, and most of them look fine from the outside — a sheet
// answers, a bot exists, a group has an id. This actually exercises each one.
//
//   node verify-groups.js
// ============================================================================

require('dotenv').config();

const groups = require('./src/groups');
const sheets = require('./src/sheets');
const paybot = require('./src/paybot');

const PASS = '✅';
const FAIL = '❌';
const WARN = '⚠️ ';

let problems = 0;

/** Records and prints one check. */
function check(ok, label, detail) {
  if (!ok) problems += 1;
  console.log(`   ${ok ? PASS : FAIL} ${label}${detail ? ' — ' + detail : ''}`);
}

/** Prints a warning that does not count as a failure. */
function warn(label, detail) {
  console.log(`   ${WARN}${label}${detail ? ' — ' + detail : ''}`);
}

async function verifyGroup(group) {
  console.log(`\n${group.displayName}  (${group.id})`);
  console.log('─'.repeat(56));

  if (!group.ready) {
    check(false, 'configuration', 'missing ' + group.missing.join(', '));
    return;
  }

  // ---- the sheet ----------------------------------------------------------
  let ping = null;
  try {
    ping = await sheets.forGroup(group.id).ping();
    check(true, 'sheet reachable', ping.spreadsheetName);
  } catch (err) {
    check(false, 'sheet reachable', err.message.split('\n')[0]);
    return;
  }

  // An unlocked sheet is readable and writable by anyone holding the URL, and
  // nothing about it looks wrong until somebody finds it.
  check(ping.tokenRequired === true, 'sheet is locked',
    ping.tokenRequired ? 'API_TOKEN is set' : 'NO API_TOKEN — anyone with the URL can read and write');

  check(ping.boundToSpreadsheet !== false, 'script is bound to a sheet',
    ping.boundToSpreadsheet === false ? 'standalone project, not created from the Sheet' : '');

  // ---- the subjects -------------------------------------------------------
  try {
    const tabs = await sheets.forGroup(group.id).getSubjects();
    const expected = group.subjects || [];
    const missing = expected.filter((s) => !tabs.includes(s));
    const extra = tabs.filter((t) => !expected.includes(t));

    check(missing.length === 0, `subjects present (${tabs.length} tabs)`,
      missing.length ? 'missing: ' + missing.join(', ') : '');
    if (extra.length) {
      // Usually the default "Sheet1", which would otherwise appear in the
      // dashboard as a subject nobody meant to create.
      warn('extra tabs', extra.join(', ') + ' — delete these, they show up as subjects');
    }
  } catch (err) {
    check(false, 'subjects readable', err.message.split('\n')[0]);
  }

  // ---- the payment bot ----------------------------------------------------
  let me = null;
  try {
    me = await paybot.getMe(group.paymentBotEnv);
    check(true, 'payment bot', '@' + me.username);
  } catch (err) {
    check(false, 'payment bot', err.message.split('\n')[0]);
    return;
  }

  // Being in the group is not enough: without these rights it cannot create an
  // invite or remove a lapsed member, and both fail only at the moment they
  // matter — after somebody has paid.
  try {
    const status = await paybot.getMemberStatus(group.paymentBotEnv, group.telegramGroupId, me.id);
    if (status === null) {
      check(false, 'payment bot is in the group', 'cannot read its membership — is it added?');
    } else {
      check(status === 'administrator', 'payment bot is an admin', `status: ${status}`);
    }
  } catch (err) {
    check(false, 'payment bot membership', err.message);
  }

  // ---- the posting bot ----------------------------------------------------
  const postingToken = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!postingToken) {
    check(false, 'posting bot', 'TELEGRAM_BOT_TOKEN is not set');
  } else {
    try {
      const info = await (await fetch(`https://api.telegram.org/bot${postingToken}/getMe`)).json();
      const botId = info.result && info.result.id;
      const res = await (await fetch(
        `https://api.telegram.org/bot${postingToken}/getChatMember` +
        `?chat_id=${encodeURIComponent(group.telegramGroupId)}&user_id=${botId}`
      )).json();

      if (!res.ok) {
        check(false, 'posting bot is in the group', res.description || 'not a member');
      } else {
        const m = res.result || {};
        check(m.status === 'administrator', 'posting bot is an admin', `status: ${m.status}`);
        // Manage Topics is the one that matters: without it the subject topics
        // cannot be created and there is nowhere to post.
        if (m.status === 'administrator') {
          check(m.can_manage_topics === true, 'posting bot can manage topics',
            m.can_manage_topics ? '' : 'turn ON "Manage Topics" — subject topics cannot be created without it');
        }
      }
    } catch (err) {
      check(false, 'posting bot membership', err.message);
    }
  }
}

(async () => {
  console.log('\nVerifying every group end to end…');

  for (const group of groups.listGroups()) {
    await verifyGroup(group);
  }

  console.log('\n' + '═'.repeat(56));
  if (problems === 0) {
    console.log('All groups are ready. ✅');
  } else {
    console.log(`${problems} problem(s) to fix. Each ${FAIL} above says what.`);
  }
  console.log('');
  process.exit(problems === 0 ? 0 : 1);
})();
