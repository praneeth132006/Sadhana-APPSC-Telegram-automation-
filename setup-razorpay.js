// ============================================================================
// setup-razorpay.js — one-time Razorpay setup
// ============================================================================
// Creates the recurring plan each group's Monthly Auto-Pay option needs, and
// prints the ids and webhook settings to put into .env and the Razorpay
// dashboard.
//
//   node setup-razorpay.js
//
// One plan PER GROUP, because Razorpay bakes the amount into the plan and the
// groups do not all charge the same. src/groups.js reads the id back as
// RAZORPAY_PLAN_<ENV PREFIX>; this used to create a single global plan and
// print RAZORPAY_MONTHLY_PLAN_ID, which no group but the legacy one ever read,
// so Monthly Auto-Pay could not be bought anywhere else.
//
// Safe to re-run: a group whose id is already in .env is skipped, and its
// price is checked against groups.config.json so a stale plan cannot quietly
// keep charging the old amount.
// ============================================================================

require('dotenv').config();

const razorpay = require('./src/razorpay');
const plans = require('./src/plans');
const groups = require('./src/groups');

/** The env var src/groups.js reads this group's recurring plan id from. */
function planEnvName(group) {
  return `RAZORPAY_PLAN_${group.envPrefix}`;
}

/**
 * checkExistingPlan — warns when a live plan no longer matches the configured
 * price. Razorpay cannot re-price a plan, so the only fix is a new one; saying
 * nothing would mean the button advertises one amount and charges another.
 */
async function checkExistingPlan(planId, expectedPaise, envName) {
  let live;
  try {
    live = await razorpay.getPlan(planId);
  } catch (err) {
    console.log(`   ⚠️  Could not read ${planId} back from Razorpay: ${err.message}`);
    return;
  }

  const actual = Number(live.item && live.item.amount);
  if (actual === Number(expectedPaise)) return;

  console.log(
    `   ❌ ${planId} charges ${plans.formatAmount(actual)} but groups.config.json ` +
    `says ${plans.formatAmount(expectedPaise)}.`
  );
  console.log(
    `      Razorpay cannot re-price a plan. Remove ${envName} from .env and re-run ` +
    'this script to create one at the new price.'
  );
}

async function main() {
  if (!razorpay.isConfigured()) {
    console.error('❌ Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env first.');
    process.exit(1);
  }

  console.log('════════════════════════════════════════════════════');
  console.log(`🔑 Razorpay — ${razorpay.isTestMode() ? 'TEST mode' : 'LIVE mode'}`);
  console.log('════════════════════════════════════════════════════\n');

  const toAdd = [];

  // Read the account once so a re-run can recognise its own earlier work.
  let existingPlans = [];
  try {
    existingPlans = await razorpay.listPlans();
  } catch (err) {
    console.log(`⚠️  Could not list existing plans (${err.message}); duplicates are possible.\n`);
  }

  for (const group of groups.listGroups()) {
    const recurring = groups.plansFor(group.id)
      .filter((plan) => plan.type === 'recurring');
    if (!recurring.length) continue;

    console.log(`── ${group.displayName} ──`);

    for (const plan of recurring) {
      const envName = planEnvName(group);
      const existing = String(process.env[envName] || '').trim();

      if (existing) {
        console.log(`   ✅ ${plan.label} already has a plan: ${existing}`);
        await checkExistingPlan(existing, plan.amountPaise, envName);
        continue;
      }

      // Reuse a plan this script already made for this group at this price.
      // Without this, running the script again before the printed id reaches
      // .env mints another identical plan every time — and Razorpay has no way
      // to delete one, so the account fills up with duplicates.
      const reusable = existingPlans.find((live) =>
        live.notes &&
        String(live.notes.group_id) === group.id &&
        String(live.notes.plan_id) === plan.id &&
        Number(live.item && live.item.amount) === Number(plan.amountPaise)
      );

      if (reusable) {
        console.log(
          `   ♻️  Reusing ${reusable.id} — already on this account at ` +
          `${plans.formatAmount(plan.amountPaise)}/month.`
        );
        toAdd.push(`${envName}=${reusable.id}`);
        continue;
      }

      console.log(`   Creating "${plan.label}" at ${plans.formatAmount(plan.amountPaise)}/month…`);
      const created = await razorpay.createPlan(Object.assign({}, plan, {
        // Name it after the group, so five plans are distinguishable in the
        // Razorpay dashboard instead of five rows all called "Monthly Auto-Pay".
        label: `${plan.label} — ${group.displayName}`
      }));
      console.log(`   ✅ Created ${created.id}`);
      existingPlans.unshift(created);
      toAdd.push(`${envName}=${created.id}`);
    }
    console.log('');
  }

  if (toAdd.length) {
    console.log('────────────────────────────────────────────────────');
    console.log('Add these lines to your .env (and to Vercel):');
    console.log('────────────────────────────────────────────────────');
    toAdd.forEach((line) => console.log('  ' + line));
    console.log('');
  }

  const base = String(process.env.PUBLIC_BASE_URL || 'https://YOUR-DOMAIN').replace(/\/+$/, '');
  const secret = String(process.env.RAZORPAY_WEBHOOK_SECRET || '(set RAZORPAY_WEBHOOK_SECRET in .env)');

  console.log('────────────────────────────────────────────────────');
  console.log('Next: register the webhook in the Razorpay dashboard');
  console.log('────────────────────────────────────────────────────');
  console.log('  Settings → Webhooks → Add New Webhook\n');
  console.log(`  URL          : ${base}/api/payments/webhook`);
  console.log(`  Secret       : ${secret}`);
  console.log('  Active events:');
  console.log('     payment_link.paid');
  console.log('     subscription.charged');
  console.log('     subscription.cancelled');
  console.log('     subscription.halted\n');
  console.log('  The secret must match RAZORPAY_WEBHOOK_SECRET exactly, or every');
  console.log('  webhook is rejected and nobody gets access after paying.\n');
}

main().catch((err) => {
  console.error('❌ ' + err.message);
  process.exit(1);
});
