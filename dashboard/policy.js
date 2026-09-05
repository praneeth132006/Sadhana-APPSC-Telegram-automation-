// ============================================================================
// Public policy pages (dashboard/policy.js)
// ============================================================================
// Shared by terms.html, refund.html and privacy.html. It lives in a file rather
// than inline because the server's Content-Security-Policy allows scripts only
// from 'self', and a blocked inline script would leave the contact details on
// a policy page blank — the exact thing a Razorpay reviewer checks for.
// ============================================================================

import { applyBusiness } from './business.js';

applyBusiness();

document.querySelectorAll('.year').forEach((node) => {
  node.textContent = String(new Date().getFullYear());
});
