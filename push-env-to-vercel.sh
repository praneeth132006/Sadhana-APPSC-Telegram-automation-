#!/usr/bin/env bash
# ============================================================================
# Push the group configuration to Vercel (push-env-to-vercel.sh)
# ============================================================================
# The dashboard on Vercel reads its groups from Vercel's own environment
# variables, not from .env on your laptop. Without them every group shows as
# "not configured" — which looks like a broken deploy rather than a missing
# setting, because the page renders perfectly and simply has nothing to offer.
#
# This copies the variables the app needs from .env into the Vercel project,
# then redeploys. Existing values are overwritten (--force), so it is safe to
# re-run after changing anything.
#
#   ./push-env-to-vercel.sh
# ============================================================================

set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "❌ No .env here. Nothing to push."
  exit 1
fi

# Every variable the deployed server reads. Per-group ones are derived from
# groups.config.json, so adding a group to that file adds it here too.
VARS=$(node -e "
require('dotenv').config();
const g = require('./src/groups');
const need = new Set([
  'TELEGRAM_BOT_TOKEN','RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET',
  'PUBLIC_BASE_URL','EXAM_PASS_END_DATE','FIREBASE_PROJECT_ID','CURATOR_EMAILS','CRON_SECRET'
]);
g.listGroups().forEach((x) => {
  need.add('SHEET_URL_' + x.envPrefix);
  need.add('SHEET_TOKEN_' + x.envPrefix);
  need.add('TELEGRAM_GROUP_' + x.envPrefix);
  need.add(x.paymentBotEnv);
  if (x.razorpayPlanId) need.add('RAZORPAY_PLAN_' + x.envPrefix);
});
console.log([...need].sort().join(' '));
")

pushed=0
skipped=0

for name in $VARS; do
  # Read straight from .env rather than the shell, so a value with spaces or
  # an equals sign in it survives intact.
  value=$(node -e "
    require('dotenv').config();
    process.stdout.write(String(process.env['$name'] || ''));
  ")

  if [ -z "$value" ]; then
    echo "  ⏭  $name — empty in .env, skipped"
    skipped=$((skipped + 1))
    continue
  fi

  printf '%s' "$value" | vercel env add "$name" production --force > /dev/null 2>&1
  echo "  ✅ $name"
  pushed=$((pushed + 1))
done

echo
echo "Pushed $pushed, skipped $skipped."
echo "Redeploying so the new values take effect…"
echo

# Environment variables only reach the running app on the next deployment.
vercel --prod
