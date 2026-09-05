// ============================================================================
// setup-razorpay.js — one-time Razorpay setup
// ============================================================================
// Creates the recurring plan that the Monthly Auto-Pay option needs, and prints
// the ids and webhook settings to put into .env and the Razorpay dashboard.
//
//   node setup-razorpay.js
//
// Safe to re-run: it only creates the plan if the id is not already in .env.
// ============================================================================

require('dotenv').config();

const razorpay = require('./src/razorpay');
const plans = require('./src/plans');

async function main() {
  if (!razorpay.isConfigured()) {
    console.error('❌ Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env first.');
    process.exit(1);
  }

  console.log('════════════════════════════════════════════════════');
  console.log(`🔑 Razorpay — ${razorpay.isTestMode() ? 'TEST mode' : 'LIVE mode'}`);
  console.log('════════════════════════════════════════════════════\n');

  const recurring = plans.listPlans().filter((p) => p.type === 'recurring');

  for (const plan of recurring) {
    const existing = String(process.env[plan.razorpayPlanIdEnv] || '').trim();

    if (existing) {
      console.log(`✅ ${plan.label} already has a plan id: ${existing}`);
      console.log('   Delete it from .env and re-run if you want a fresh one.\n');
      continue;
    }

    console.log(`Creating Razorpay plan for "${plan.label}" (${plans.formatAmount(plan.amountPaise)}/month)…`);
    const created = await razorpay.createPlan(plan);

    console.log(`✅ Created: ${created.id}\n`);
    console.log('   Add this line to your .env:\n');
    console.log(`   ${plan.razorpayPlanIdEnv}=${created.id}\n`);
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
