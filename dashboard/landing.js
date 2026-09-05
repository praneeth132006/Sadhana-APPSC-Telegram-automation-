// ============================================================================
// Public landing page (dashboard/landing.js)
// ============================================================================
// Kept in its own file rather than inline in index.html because the server's
// Content-Security-Policy allows scripts only from 'self'. An inline <script>
// is blocked outright — silently, as far as the visitor is concerned, which
// would leave a Razorpay reviewer looking at an empty pricing section.
// ============================================================================

import { applyBusiness, BUSINESS } from './business.js';

applyBusiness();

const yearNode = document.getElementById('year');
if (yearNode) yearNode.textContent = String(new Date().getFullYear());

const handle = String(BUSINESS.botHandle || '').replace(/^@/, '');
const botLink = document.getElementById('botLink');
if (handle && botLink) botLink.href = `https://t.me/${handle}`;

/** Wording for the recurring plan's billing period. */
const RECURRING_NOTE = 'per month, auto-renewing';

/**
 * Builds one pricing card.
 *
 * @param {Object} plan     A plan as returned by /api/plans
 * @param {boolean} featured Whether to highlight it
 * @returns {HTMLElement}
 */
function planCard(plan, featured) {
  const card = document.createElement('div');
  card.className = 'pub-plan' + (featured ? ' is-featured' : '');

  const period = plan.type === 'recurring'
    ? RECURRING_NOTE
    : (plan.durationDays ? `one-time, ${plan.durationDays} days access` : 'one-time payment');

  card.innerHTML = `
    ${featured ? '<span class="pub-plan-badge">Most popular</span>' : ''}
    <div class="pub-plan-emoji"></div>
    <h3 class="pub-plan-name"></h3>
    <p class="pub-plan-tagline"></p>
    <div><span class="pub-plan-price"></span></div>
    <div class="pub-plan-period"></div>
    <p class="pub-plan-desc"></p>
    <p class="pub-plan-gst">Price shown is the total payable. No additional charges at checkout.</p>
  `;

  // Plan text is written with textContent, never interpolated into the markup
  // above, so a label edited in src/plans.js can never inject HTML here.
  card.querySelector('.pub-plan-emoji').textContent = plan.emoji || '';
  card.querySelector('.pub-plan-name').textContent = plan.label;
  card.querySelector('.pub-plan-tagline').textContent = plan.tagline || '';
  card.querySelector('.pub-plan-price').textContent = plan.price;
  card.querySelector('.pub-plan-period').textContent = period;
  card.querySelector('.pub-plan-desc').textContent = plan.description || '';
  return card;
}

// Prices come from /api/plans, which reads src/plans.js — the same source the
// bot and the webhook use. A price shown here therefore cannot disagree with
// the amount a student is actually charged.
(async () => {
  const target = document.getElementById('plans');
  if (!target) return;

  try {
    const res = await fetch('/api/plans');
    const body = await res.json();
    const list = (body && body.data && body.data.plans) || [];
    if (!list.length) throw new Error('no plans returned');

    target.innerHTML = '';
    list.forEach((plan) => {
      target.appendChild(planCard(plan, plan.type === 'recurring'));
    });
  } catch (err) {
    // A visitor must never meet a blank pricing section, so point at the bot
    // rather than showing nothing at all.
    target.textContent =
      `Prices are shown in the Telegram bot — send /plans to ${BUSINESS.botHandle || 'our bot'}.`;
    target.className = 'pub-loading';
  }
})();
