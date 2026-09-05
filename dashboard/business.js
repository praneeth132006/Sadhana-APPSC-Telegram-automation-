// ============================================================================
// Business details shown on the public pages (dashboard/business.js)
// ============================================================================
// Razorpay checks a merchant's site for a real, contactable business before it
// approves live keys, and the same details have to appear on the terms, refund
// and privacy pages. Keeping them here means one edit updates every page, and
// nothing drifts out of sync while a reviewer is reading.
//
// >>> FILL THESE IN BEFORE SUBMITTING THE SITE TO RAZORPAY. <<<
// The placeholders below are deliberately obvious: a reviewer who sees
// "YOUR NAME HERE" rejects the application, which is the loud failure we want
// rather than a plausible-looking wrong phone number sitting there quietly.
// ============================================================================

export const BUSINESS = {
  // Legal or trading name that will appear on the customer's bank statement.
  name: 'REPLACE ME — your business or proprietor name',

  // A real, monitored inbox. Razorpay emails this address during review.
  email: 'REPLACE ME — support@yourdomain.com',

  // Include the country code, e.g. '+91 98765 43210'. Razorpay requires a
  // reachable number; a wrong one is a common rejection reason.
  phone: 'REPLACE ME — +91 XXXXX XXXXX',

  // Operating address. City and state are the minimum a reviewer looks for.
  address: 'REPLACE ME — street, city, state, PIN',

  // Public Telegram handle students message to buy a pass.
  botHandle: '@sadhanamainbot',

  // Shown on the policy pages as the date they last changed.
  policiesUpdated: '5 September 2026'
};

/** Fills every [data-business="key"] element on the page. */
export function applyBusiness() {
  document.querySelectorAll('[data-business]').forEach((node) => {
    const value = BUSINESS[node.getAttribute('data-business')];
    if (value) node.textContent = value;
  });

  document.querySelectorAll('[data-business-href]').forEach((node) => {
    const key = node.getAttribute('data-business-href');
    const value = BUSINESS[key];
    if (!value) return;
    node.textContent = value;
    node.href = key === 'email' ? `mailto:${value}` : `tel:${value.replace(/\s+/g, '')}`;
  });
}
