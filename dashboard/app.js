// ============================================================================
// Sadhana APPSC Question Dashboard — Client Application Logic (v4)
// ============================================================================
// What this file does:
// 1. Enforces a strict Authentication Gate: Hides the entire dashboard until the user is logged in.
// 2. Integrates Firebase Auth (Google 1-click & Email/Password) with automatic profile chip updates.
// 3. Eliminates internal scrollbars: Dynamically auto-expands question prompt & explanation textareas.
// 4. Connects via embedded Google Sheets API URL without exposing an editable URL input field.
// 5. Batches and pushes questions to Google Sheets via backend proxy with uploader email tracking.
//
// What it brings:
// - Absolute dashboard security prior to authentication.
// - Superior readability for multi-statement exam questions without cramped scrollbars.
// - Zero user configuration needed for Google Sheets API URL.
//
// Where changes can be seen:
// - Browser interface at http://localhost:3000 (Auth Gate, Auto-Expanding Cards, Status Pill).
// ============================================================================

// Import Firebase App initializer from Google official CDN
// What it brings: Initializes client-side Firebase runtime
// Where changes can be seen: In browser network tab loading Firebase SDK
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';

// Import Firebase Authentication functions from Google official CDN
// What it brings: Provides popup OAuth, credential login, sign-out, and auth state observer
// Where changes can be seen: User authentication flows on the login gate
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';

// ============================================================================
// 1. Firebase Configuration & Initialization
// ============================================================================
// Configuration credentials for project ap-gurukul-43050
// What this block does: Connects the web client to the designated Firebase project
// What it brings: Validates identity with Google Identity platform
// Where changes can be seen: Google OAuth consent popup identifying ap-gurukul-43050
const firebaseConfig = {
  apiKey: "AIzaSyDlL3dw-FY2bdNQDCm4Rtp0ZhrDTCSJHfQ",
  authDomain: "ap-gurukul-43050.firebaseapp.com",
  projectId: "ap-gurukul-43050",
  storageBucket: "ap-gurukul-43050.firebasestorage.app",
  messagingSenderId: "797079176348",
  appId: "1:797079176348:web:f20cccdedb8f1ca3fa9959",
  measurementId: "G-DE6FB5QSZD"
};

// Initialize the Firebase app instance
// What it brings: Core SDK handle for service bindings
// Where changes can be seen: Internal Firebase state in the browser console
const firebaseApp = initializeApp(firebaseConfig);

// Initialize Firebase Auth service
// What it brings: Authentication state management and token persistence
// Where changes can be seen: LocalStorage token cache and auth observer triggers
const auth = getAuth(firebaseApp);

// Initialize Google OAuth provider for 1-click popup login
// What it brings: Easy popup sign-in without requiring user to type credentials
// Where changes can be seen: In the Google OAuth popup window
const googleProvider = new GoogleAuthProvider();

// Global tracking variable for authenticated user object (null when logged out)
// What it brings: Guard checks before publishing questions to Google Sheets
// Where changes can be seen: Attached to added_by column payload when pushing data
let currentUser = null;

// Embedded Google Sheets API Web App URL stored in memory
// What it brings: Removes need for editable URL input in UI
// Where changes can be seen: Used seamlessly by background proxy requests
let embeddedSheetUrl = '';

// ============================================================================
// 2. DOM Elements References
// ============================================================================
// Top Header elements
// What this line does: References the live connection status dot in the header
const connectionStatus = document.getElementById('connectionStatus');
// What this line does: References the descriptive status text inside the header pill
const connectionStatusText = document.getElementById('connectionStatusText');
// What this line does: References the user profile chip displayed when logged in
const userProfileChip = document.getElementById('userProfileChip');
// What this line does: References the avatar circle holding image or user initial
const userAvatar = document.getElementById('userAvatar');
// What this line does: References the user email span in the top header
const userEmail = document.getElementById('userEmail');
// What this line does: References the sign out button inside the profile chip
const signOutBtn = document.getElementById('signOutBtn');

// Auth Gate Hero elements (Displayed when logged out)
// What this line does: References the full hero container covering the screen before login
const authGate = document.getElementById('authGate');
// What this line does: References the Google 1-Click sign-in button in the login card
const gateGoogleSignInBtn = document.getElementById('gateGoogleSignInBtn');
// What this line does: References the Sign In tab button
const gateTabSignIn = document.getElementById('gateTabSignIn');
// What this line does: References the Register tab button
const gateTabRegister = document.getElementById('gateTabRegister');
// What this line does: References the email/password form in the login card
const gateAuthForm = document.getElementById('gateAuthForm');
// What this line does: References the email input field in the login card
const gateAuthEmail = document.getElementById('gateAuthEmail');
// What this line does: References the password input field in the login card
const gateAuthPassword = document.getElementById('gateAuthPassword');
// What this line does: References the submit button in the login card
const gateAuthSubmitBtn = document.getElementById('gateAuthSubmitBtn');
// What this line does: References the error text box in the login card
const gateAuthError = document.getElementById('gateAuthError');

// Main Content Workspace (Kept strictly hidden until authenticated)
// What this line does: References the main grid layout container holding questions workspace
const mainDashboard = document.getElementById('mainDashboard');
// What this line does: References the subject dropdown selector
const subjectSelect = document.getElementById('subjectSelect');
// What this line does: References default publication date input field
const defaultDate = document.getElementById('defaultDate');
// What this line does: References default source newspaper input field
const defaultNewspaper = document.getElementById('defaultNewspaper');
// What this line does: References the raw JSON textarea on the left panel
const jsonInput = document.getElementById('jsonInput');
// What this line does: References the Parse & Preview button
const parseBtn = document.getElementById('parseBtn');
// What this line does: References the Clear All inputs button
const clearBtn = document.getElementById('clearBtn');
// What this line does: References the Load Sample JSON button
const sampleBtn = document.getElementById('sampleBtn');
// What this line does: References the JSON parse error message container
const parseError = document.getElementById('parseError');

// Right panel outputs
// What this line does: References the badge displaying total active question cards
const cardCount = document.getElementById('cardCount');
// What this line does: References the scrollable container holding rendered question cards
const cardsContainer = document.getElementById('cardsContainer');
// What this line does: References the primary button pushing questions to Google Sheets
const sendToSheetBtn = document.getElementById('sendToSheetBtn');
// What this line does: References the fixed container rendering toast alerts
const toastContainer = document.getElementById('toastContainer');

// ============================================================================
// 3. Application State & Storage
// ============================================================================
// In-memory array of parsed question objects
// What it brings: Stores sanitized questions ready for inline editing and export
// Where changes can be seen: Reflected in rendered cards and final payload
let questions = [];

// Track auth mode inside the login gate ('signin' or 'register')
// What it brings: Controls whether form calls signInWithEmailAndPassword or createUserWithEmailAndPassword
// Where changes can be seen: Changes button text between "Sign In" and "Create Account"
let gateAuthMode = 'signin';

// ============================================================================
// 4. Textarea Dynamic Auto-Expansion Helper (No Internal Scrollbars!)
// ============================================================================
/**
 * autoResizeTextarea — Dynamically adjusts textarea height based on its content scrollHeight.
 * What it does: Resets height to 'auto', calculates full scrollHeight, and sets height explicitly.
 * What it brings: Eliminates internal scrollbars so multi-statement questions and explanations are 100% visible.
 * Where changes can be seen: Question prompt and explanation textareas expand smoothly without any inner scrolling.
 *
 * @param {HTMLElement} textarea - The textarea DOM element to auto-resize
 */
function autoResizeTextarea(textarea) {
  // If element is not defined, return safely
  if (!textarea) return;
  // Reset height to auto first so scrollHeight shrinks if text is deleted
  textarea.style.height = 'auto';
  // Define generous minimum heights: 140px for prompt, 110px for explanation
  const minHeight = textarea.classList.contains('question-textarea-vertical') ? 140 : 110;
  // Calculate target height with 6px buffer to avoid any text clipping
  const targetHeight = Math.max(textarea.scrollHeight + 6, minHeight);
  // Apply calculated pixel height
  textarea.style.height = targetHeight + 'px';
}

// ============================================================================
// 5. Initialization & Server Auto-Configuration
// ============================================================================
(async function init() {
  // Fetch embedded Google Sheets Web App URL from local backend server (/api/config)
  // What it brings: Eliminates any manual typing or pasting of the Apps Script URL
  // Where changes can be seen: Read-only status pill in the header
  try {
    // Query local Node server configuration endpoint
    const res = await fetch('/api/config');
    // Check if configuration request succeeded
    if (res.ok) {
      // Parse JSON payload containing sheetUrl
      const cfg = await res.json();
      // If URL is configured in server's .env, save to memory and test connection
      if (cfg.sheetUrl) {
        embeddedSheetUrl = cfg.sheetUrl.trim();
        // Trigger background connectivity test
        testConnection(embeddedSheetUrl);
      } else {
        // Update badge if URL is missing in server .env
        updateStatusBadge('offline', 'Google Sheets: URL Not Configured in .env');
      }
    }
  } catch (err) {
    // If running in standalone mode without server, set offline indicator
    updateStatusBadge('offline', 'Local Server Offline');
  }
})();

/**
 * updateStatusBadge — Updates the read-only Google Sheets status indicator.
 * What it does: Sets CSS class on the dot and updates label text.
 * What it brings: Clear, unambiguous status feedback for the embedded connection.
 * Where changes can be seen: Header status pill.
 *
 * @param {'online'|'loading'|'offline'} state - The visual indicator state
 * @param {string} text - Description label
 */
function updateStatusBadge(state, text) {
  // Set class on the colored dot indicator
  connectionStatus.className = 'status-dot ' + state;
  // Update hover title attribute
  connectionStatus.title = text;
  // Update visible label text
  if (connectionStatusText) {
    connectionStatusText.textContent = text;
  }
}

/**
 * testConnection — Tests connectivity to the embedded Google Sheets Web App endpoint.
 * What it does: Sends ping request via server proxy (/api/ping) or direct fetch.
 * What it brings: Verifies that the deployed Google Apps Script is active and responsive.
 * Where changes can be seen: Indicator turns green (online) or red (offline) in header.
 *
 * @param {string} url - Google Apps Script Web App URL
 */
async function testConnection(url) {
  // Set status badge to loading animation while pinging
  updateStatusBadge('loading', 'Google Sheets: Connecting...');

  let result = null;
  // Attempt ping through local server proxy first to bypass CORS
  try {
    const proxyRes = await fetch('/api/ping?url=' + encodeURIComponent(url));
    if (proxyRes.ok) {
      result = await proxyRes.json();
    }
  } catch (proxyErr) {
    result = null;
  }

  // Fallback to direct fetch if proxy is unavailable
  if (!result) {
    try {
      const response = await fetch(url + '?action=ping', { redirect: 'follow' });
      result = await response.json();
    } catch (directErr) {
      updateStatusBadge('offline', 'Google Sheets: Offline (' + directErr.message + ')');
      return;
    }
  }

  // Verify if Google requires login permissions
  if (result.status === 'auth_required') {
    updateStatusBadge('offline', 'Google Sheets: Auth Required (Redeploy as Anyone)');
    showToast('error', '⚠️ Apps Script requires login. Redeploy with "Who has access: Anyone".');
    return;
  }

  // Handle successful connection
  if (result.status === 'ok') {
    updateStatusBadge('online', 'Google Sheets: Connected 🟢');
  } else {
    updateStatusBadge('offline', 'Google Sheets: Error (' + (result.error || 'Unknown') + ')');
  }
}

// ============================================================================
// 6. Strict Firebase Auth State Observer (Gatekeeper)
// ============================================================================
// What this observer does: Monitors user login state in real time
// What it brings: Enforces "without logging do not show the dashboard"
// Where changes can be seen: Instant transition between Login Hero Gate and Question Workspace
onAuthStateChanged(auth, function(user) {
  if (user) {
    // ========================================================================
    // USER IS LOGGED IN: Reveal Dashboard Workspace
    // ========================================================================
    currentUser = user;

    // Hide the login gate hero screen completely
    // What it brings: Frees up the full viewport for the question workspace
    // Where changes can be seen: Auth gate fades out
    if (authGate) authGate.style.display = 'none';

    // Show the main dashboard workspace
    // What it brings: Gives authenticated curator full access to JSON parser and card editor
    // Where changes can be seen: Split view workspace appears with smooth fade-in
    if (mainDashboard) mainDashboard.style.display = 'grid';

    // Show authenticated user profile chip in header
    // What it brings: Displays user photo, email, and sign-out button
    // Where changes can be seen: Top right corner of header bar
    if (userProfileChip) userProfileChip.style.display = 'flex';

    // Render avatar: photo if available from Google, otherwise first initial
    if (user.photoURL) {
      userAvatar.innerHTML = '<img src="' + escapeAttr(user.photoURL) + '" alt="Avatar">';
    } else {
      userAvatar.textContent = (user.displayName || user.email || 'U').charAt(0).toUpperCase();
    }

    // Display formatted user name or email
    userEmail.textContent = user.displayName || user.email;

    // Welcoming toast confirmation
    showToast('info', 'Welcome, ' + (user.displayName || user.email) + ' 👋');
  } else {
    // ========================================================================
    // USER IS LOGGED OUT: Strictly Hide Dashboard Workspace
    // ========================================================================
    currentUser = null;

    // Show the login gate hero screen prominently
    // What it brings: Guarantees that unauthenticated visitors cannot access questions
    // Where changes can be seen: Centered glassmorphic login card is visible
    if (authGate) authGate.style.display = 'flex';

    // Hide the main dashboard workspace completely
    // What it brings: Prevents unauthenticated users from seeing or editing questions
    // Where changes can be seen: Main workspace is removed from layout
    if (mainDashboard) mainDashboard.style.display = 'none';

    // Hide user profile chip from header
    if (userProfileChip) userProfileChip.style.display = 'none';

    // Clear any sensitive question cards and input state
    questions = [];
    if (jsonInput) jsonInput.value = '';
    renderCards();
  }
});

// ============================================================================
// 7. Auth Gate Event Handlers (Google 1-Click & Email/Password)
// ============================================================================
// Google 1-Click Sign-In handler on the Login Gate
if (gateGoogleSignInBtn) {
  gateGoogleSignInBtn.addEventListener('click', async function() {
    // Clear any previous error text
    gateAuthError.style.display = 'none';
    try {
      // Trigger Google OAuth popup
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      // Display friendly error message
      gateAuthError.textContent = 'Google sign-in error: ' + err.message;
      gateAuthError.style.display = 'block';
    }
  });
}

// Switch to Sign In Tab on Login Gate
if (gateTabSignIn) {
  gateTabSignIn.addEventListener('click', function() {
    gateAuthMode = 'signin';
    gateTabSignIn.classList.add('active');
    if (gateTabRegister) gateTabRegister.classList.remove('active');
    gateAuthSubmitBtn.textContent = 'Sign In';
    gateAuthError.style.display = 'none';
  });
}

// Switch to Register Tab on Login Gate
if (gateTabRegister) {
  gateTabRegister.addEventListener('click', function() {
    gateAuthMode = 'register';
    gateTabRegister.classList.add('active');
    if (gateTabSignIn) gateTabSignIn.classList.remove('active');
    gateAuthSubmitBtn.textContent = 'Create Account';
    gateAuthError.style.display = 'none';
  });
}

// Email & Password Form Submission on Login Gate
if (gateAuthForm) {
  gateAuthForm.addEventListener('submit', async function(e) {
    // Prevent default form submission reload
    e.preventDefault();
    const email = gateAuthEmail.value.trim();
    const password = gateAuthPassword.value;
    gateAuthError.style.display = 'none';

    // Validate inputs
    if (!email || !password) {
      gateAuthError.textContent = 'Please enter both email and password.';
      gateAuthError.style.display = 'block';
      return;
    }

    try {
      if (gateAuthMode === 'signin') {
        // Authenticate existing user with email and password
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        // Register new user account with email and password
        await createUserWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      // Format clean error message removing Firebase internal prefix
      gateAuthError.textContent = err.message.replace('Firebase: ', '');
      gateAuthError.style.display = 'block';
    }
  });
}

// Sign Out button handler in profile chip
if (signOutBtn) {
  signOutBtn.addEventListener('click', async function() {
    try {
      // Sign out from Firebase Auth
      await signOut(auth);
      showToast('info', 'Signed out successfully.');
    } catch (err) {
      showToast('error', 'Sign out error: ' + err.message);
    }
  });
}

// ============================================================================
// 8. JSON Parsing & Sample Loading
// ============================================================================
// Sample APPSC Question JSON showcasing multi-statement format
const SAMPLE_JSON = {
  "subject": "Environment",
  "date": "05-09-2026",
  "newspaper": "The Hindu",
  "questions": [
    {
      "question": "Consider the following statements regarding the 'AP-Green' initiative and forest data in Andhra Pradesh:\n1. At present, forest area covers 22.96% of the state's total geographical area (37.42 lakh hectares).\n2. AP-Green is set up as an autonomous body to bring all green-cover initiatives onto a single platform.\n3. Funding for AP-Green projects includes sources such as Carbon Finance, Green Bonds, District Mineral Fund, and NABARD.\n\nWhich of the statements given above are correct?",
      "option_a": "1 and 2 only",
      "option_b": "2 and 3 only",
      "option_c": "1 and 3 only",
      "option_d": "1, 2, and 3",
      "correct_answer": "D",
      "explanation": "Statement 1 is correct: Andhra Pradesh currently has 37.42 lakh hectares under forest cover, which is 22.96% of the state's geographical area.\n\nStatement 2 is correct: AP-Green is set up as an autonomous body to bring all green-cover initiatives onto a single unified platform to reach 50% green cover by 2047.\n\nStatement 3 is correct: Resources for AP-Green projects are mobilized through State Grants, Central Government Schemes, NABARD, CSR funds, Carbon Finance/Carbon Credits, Green Bonds, District Mineral Fund (DMF), and eco-tourism revenues."
    }
  ]
};

// Load Sample JSON button handler
if (sampleBtn) {
  sampleBtn.addEventListener('click', function() {
    // Populate textarea with sample formatted JSON
    jsonInput.value = JSON.stringify(SAMPLE_JSON, null, 2);
    // Pre-select Environment subject
    subjectSelect.value = 'Environment';
    // Set default date
    defaultDate.value = '05-09-2026';
    // Set default newspaper
    defaultNewspaper.value = 'The Hindu';
    // Clear any previous error box
    hideError();
    // Provide user feedback
    showToast('info', 'Loaded sample APPSC multi-statement question JSON.');
  });
}

// Clear button handler
if (clearBtn) {
  clearBtn.addEventListener('click', function() {
    jsonInput.value = '';
    questions = [];
    renderCards();
    hideError();
    showToast('info', 'All inputs and question cards cleared.');
  });
}

// Parse button handler
if (parseBtn) {
  parseBtn.addEventListener('click', parseQuestionsJson);
}

/**
 * parseQuestionsJson — Parses JSON input and instantiates standardized question objects.
 * What it does: Validates JSON syntax, extracts questions, and triggers vertical card rendering.
 * What it brings: Robust handling of multiple JSON schemas.
 * Where changes can be seen: Question cards appearing in the right panel.
 */
function parseQuestionsJson() {
  hideError();
  const raw = jsonInput.value.trim();

  if (!raw) {
    showError('Please paste your JSON questions in the textarea first.');
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    showError('Invalid JSON syntax: ' + err.message);
    return;
  }

  let extracted = [];

  // Format 1: Object with "questions" array property
  if (parsed && Array.isArray(parsed.questions)) {
    extracted = parsed.questions;
    if (parsed.subject && !subjectSelect.value) {
      subjectSelect.value = parsed.subject;
    }
    if (parsed.date && !defaultDate.value) {
      defaultDate.value = parsed.date;
    }
    if (parsed.newspaper && !defaultNewspaper.value) {
      defaultNewspaper.value = parsed.newspaper;
    }
  }
  // Format 2: Plain array of question objects
  else if (Array.isArray(parsed)) {
    extracted = parsed;
  }
  // Format 3: Single question object
  else if (parsed && parsed.question) {
    extracted = [parsed];
  } else {
    showError('Unrecognized JSON format. Expected { "questions": [...] } or an array of question objects.');
    return;
  }

  if (extracted.length === 0) {
    showError('No questions found in the JSON data.');
    return;
  }

  // Standardize questions into internal model
  questions = extracted.map(function(q, i) {
    return {
      id: i,
      date: q.date || defaultDate.value || '',
      newspaper: q.newspaper || defaultNewspaper.value || '',
      question: q.question || q.question_text || '',
      option_a: q.option_a || q.optionA || q.a || '',
      option_b: q.option_b || q.optionB || q.b || '',
      option_c: q.option_c || q.optionC || q.c || '',
      option_d: q.option_d || q.optionD || q.d || '',
      correct_answer: (q.correct_answer || q.answer || 'A').toUpperCase(),
      explanation: q.explanation || ''
    };
  });

  // Render cards and trigger auto-resizing
  renderCards();
  showToast('info', `Parsed ${questions.length} question(s) into vertical card format.`);
}

// ============================================================================
// 9. Vertical Question Card Rendering & Auto-Expansion
// ============================================================================
/**
 * renderCards — Renders question cards and ensures all textareas auto-expand without scrollbars.
 * What it does: Updates card count, loops through questions, appends cards, and runs autoResizeTextarea.
 * What it brings: Eliminates internal scrollbars so questions are immediately readable.
 * Where changes can be seen: In cardsContainer on http://localhost:3000.
 */
function renderCards() {
  // Update question count badge
  cardCount.textContent = '(' + questions.length + ')';
  // Enable or disable Send to Sheet button based on question count
  sendToSheetBtn.disabled = questions.length === 0;

  // If no questions exist, show empty state placeholder
  if (questions.length === 0) {
    cardsContainer.innerHTML = '';
    cardsContainer.appendChild(createEmptyState());
    return;
  }

  // Clear existing cards
  cardsContainer.innerHTML = '';

  // Render each question card element
  questions.forEach(function(q, index) {
    const card = createCardElement(q, index);
    card.style.animationDelay = (index * 0.05) + 's';
    cardsContainer.appendChild(card);
  });

  // Schedule auto-resizing across all question and explanation textareas
  // What it brings: Guarantees textareas expand to exact scrollHeight after DOM insertion
  // Where changes can be seen: No scrollbars on any question prompt or explanation!
  requestAnimationFrame(function() {
    const allTextareas = cardsContainer.querySelectorAll('.question-textarea-vertical, .explanation-textarea-vertical');
    allTextareas.forEach(function(ta) {
      autoResizeTextarea(ta);
    });
  });

  // Backup timer for pixel-perfect expansion after full CSS layout computation
  setTimeout(function() {
    const allTextareas = cardsContainer.querySelectorAll('.question-textarea-vertical, .explanation-textarea-vertical');
    allTextareas.forEach(function(ta) {
      autoResizeTextarea(ta);
    });
  }, 60);
}

/**
 * createEmptyState — Generates the placeholder element displayed when no cards are active.
 *
 * @returns {HTMLElement} Empty state DOM container
 */
function createEmptyState() {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.innerHTML = '<div class="empty-icon">📋</div>' +
    '<p>Paste JSON on the left and click <strong>Parse &amp; Preview</strong></p>' +
    '<p class="empty-hint">Questions will appear here as rich, auto-expanding vertical cards</p>';
  return div;
}

/**
 * createCardElement — Builds an auto-expanding, vertical question card DOM element.
 * What it does: Stacks options vertically, configures radio switches, and attaches auto-resize listeners.
 * What it brings: Spacious layout without internal scrolling and instant answer toggling.
 * Where changes can be seen: Individual card inside the right panel.
 *
 * @param {Object} q - Question object
 * @param {number} cardIndex - 0-based index of this card
 * @returns {HTMLElement} Card DOM element
 */
function createCardElement(q, cardIndex) {
  const card = document.createElement('div');
  card.className = 'question-card-vertical';
  card.dataset.index = cardIndex;

  // Options letter list
  const letters = ['A', 'B', 'C', 'D'];

  // Build vertical options HTML
  const optionsHtml = letters.map(function(letter) {
    const isCorrect = q.correct_answer === letter;
    const optionKey = 'option_' + letter.toLowerCase();
    const optionText = q[optionKey] || '';
    const rowClass = isCorrect ? 'option-row-vertical correct' : 'option-row-vertical';

    return '<div class="' + rowClass + '" data-letter="' + letter + '">' +
      '<label class="option-radio-label">' +
        '<input type="radio" name="correct_' + cardIndex + '" value="' + letter + '" ' +
               (isCorrect ? 'checked' : '') + ' class="option-radio">' +
        '<span class="option-letter-badge">' + letter + '</span>' +
      '</label>' +
      '<input type="text" class="option-input-vertical" data-field="' + optionKey + '" ' +
             'value="' + escapeAttr(optionText) + '" placeholder="Option ' + letter + ' text">' +
    '</div>';
  }).join('');

  // Populate Card HTML
  card.innerHTML =
    // Card Header Bar: Number Badge + Date/Newspaper overrides + Delete Button
    '<div class="card-header-bar">' +
      '<span class="card-number-badge">Question #' + (cardIndex + 1) + '</span>' +
      '<div class="card-meta-inputs">' +
        '<input type="text" class="card-meta-input" data-field="date" value="' + escapeAttr(q.date) + '" placeholder="Date (DD-MM-YYYY)" title="Publication Date">' +
        '<input type="text" class="card-meta-input" data-field="newspaper" value="' + escapeAttr(q.newspaper) + '" placeholder="Newspaper" title="Newspaper Source">' +
      '</div>' +
      '<button class="btn-card-delete" data-action="delete" title="Delete this question card">🗑️ Delete</button>' +
    '</div>' +

    // Section 1: Question Text (Auto-expanding textarea without scrollbar)
    '<div class="card-section">' +
      '<label class="section-label">📝 Question Prompt (Auto-Expands to Fit Statements)</label>' +
      '<textarea class="question-textarea-vertical" data-field="question" rows="4" placeholder="Enter question text...">' + escapeHtml(q.question) + '</textarea>' +
    '</div>' +

    // Section 2: Vertical Stacked Options
    '<div class="card-section">' +
      '<label class="section-label">🔘 Options &amp; Correct Answer (Click radio to select)</label>' +
      '<div class="options-vertical-list">' + optionsHtml + '</div>' +
    '</div>' +

    // Section 3: Explanation (Auto-expanding textarea without scrollbar)
    '<div class="card-section">' +
      '<label class="section-label">💡 Explanation (Auto-Expands to Fit Full Text)</label>' +
      '<textarea class="explanation-textarea-vertical" data-field="explanation" rows="3" placeholder="Enter detailed explanation...">' + escapeHtml(q.explanation) + '</textarea>' +
    '</div>' +

    // Card Footer Bar
    '<div class="card-footer-bar">' +
      '<span class="correct-summary-tag">✓ Correct Answer: Option <strong class="correct-letter-display">' + q.correct_answer + '</strong></span>' +
      '<span>APPSC Format</span>' +
    '</div>';

  // Attach dynamic auto-resizing listeners to both textareas
  // What it brings: Immediate dynamic expansion as text is typed, pasted, or edited
  // Where changes can be seen: Textarea box automatically expands downward without scrollbars
  const qTextarea = card.querySelector('.question-textarea-vertical');
  const expTextarea = card.querySelector('.explanation-textarea-vertical');

  if (qTextarea) {
    qTextarea.addEventListener('input', function() { autoResizeTextarea(qTextarea); });
    qTextarea.addEventListener('change', function() { autoResizeTextarea(qTextarea); });
  }

  if (expTextarea) {
    expTextarea.addEventListener('input', function() { autoResizeTextarea(expTextarea); });
    expTextarea.addEventListener('change', function() { autoResizeTextarea(expTextarea); });
  }

  // Attach Radio Change Event for Instant Answer Selection
  const radios = card.querySelectorAll('.option-radio');
  radios.forEach(function(radio) {
    radio.addEventListener('change', function() {
      const selectedLetter = radio.value;
      // Update internal state
      if (questions[cardIndex]) {
        questions[cardIndex].correct_answer = selectedLetter;
      }

      // Update UI highlights across options in this card
      const rows = card.querySelectorAll('.option-row-vertical');
      rows.forEach(function(row) {
        if (row.dataset.letter === selectedLetter) {
          row.classList.add('correct');
        } else {
          row.classList.remove('correct');
        }
      });

      // Update footer indicator
      const display = card.querySelector('.correct-letter-display');
      if (display) display.textContent = selectedLetter;
    });
  });

  // Attach Delete Button Handler
  const deleteBtn = card.querySelector('[data-action="delete"]');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', function() {
      // Remove card from array
      questions.splice(cardIndex, 1);
      // Re-render
      renderCards();
      showToast('info', 'Question removed.');
    });
  }

  return card;
}

// ============================================================================
// 10. Collect Card Data for Submission
// ============================================================================
/**
 * collectCardData — Scrapes edited field values from all active question cards.
 *
 * @returns {Array<Object>} Array of sanitized question objects
 */
function collectCardData() {
  const cards = cardsContainer.querySelectorAll('.question-card-vertical');
  const payload = [];

  cards.forEach(function(card, i) {
    const q = {
      date: getFieldValue(card, 'date'),
      newspaper: getFieldValue(card, 'newspaper'),
      question: getFieldValue(card, 'question'),
      option_a: getFieldValue(card, 'option_a'),
      option_b: getFieldValue(card, 'option_b'),
      option_c: getFieldValue(card, 'option_c'),
      option_d: getFieldValue(card, 'option_d'),
      correct_answer: questions[i] ? questions[i].correct_answer : 'A',
      explanation: getFieldValue(card, 'explanation')
    };
    payload.push(q);
  });

  return payload;
}

function getFieldValue(card, field) {
  const el = card.querySelector('[data-field="' + field + '"]');
  return el ? el.value.trim() : '';
}

// ============================================================================
// 11. Push to Google Sheets (Protected by Firebase Auth)
// ============================================================================
sendToSheetBtn.addEventListener('click', async function() {
  // Step 1: Authentication Guard — Require Firebase Auth before uploading!
  if (!currentUser) {
    showToast('error', '⚠️ Please sign in first to upload questions to Google Sheets.');
    if (authGate) authGate.style.display = 'flex';
    if (mainDashboard) mainDashboard.style.display = 'none';
    return;
  }

  // Step 2: Validate Target Subject Selection
  const subject = subjectSelect.value;
  if (!subject) {
    showToast('error', 'Please select a target subject from the dropdown.');
    return;
  }

  // Step 3: Validate Cards Count
  if (questions.length === 0) {
    showToast('error', 'No question cards to send. Parse JSON first.');
    return;
  }

  // Collect the latest on-screen edited data
  const payload = collectCardData();

  // Uploader identifier from Firebase Auth
  const addedBy = currentUser.displayName
    ? `${currentUser.displayName} (${currentUser.email})`
    : currentUser.email;

  // Show loading state on button
  sendToSheetBtn.disabled = true;
  sendToSheetBtn.textContent = 'Sending...';

  try {
    let result = null;

    // Try sending through local server proxy first (bypasses browser CORS completely)
    try {
      const proxyRes = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: embeddedSheetUrl,
          subject: subject,
          questions: payload,
          added_by: addedBy
        })
      });

      if (proxyRes.ok) {
        result = await proxyRes.json();
      }
    } catch (proxyErr) {
      result = null;
    }

    // Fallback to direct fetch using embedded URL
    if (!result && embeddedSheetUrl) {
      const response = await fetch(embeddedSheetUrl, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'addQuestions',
          subject: subject,
          questions: payload,
          added_by: addedBy
        })
      });
      result = await response.json();
    }

    if (result && result.success) {
      showToast('success', `✅ ${result.addedCount || payload.length} question(s) added to "${subject}" by ${currentUser.email}!`);
      // Clear questions after successful push
      questions = [];
      renderCards();
      jsonInput.value = '';
    } else {
      showToast('error', 'Failed: ' + (result ? (result.error || 'Unknown error') : 'No response from server'));
    }
  } catch (e) {
    showToast('error', 'Network error: ' + e.message);
  } finally {
    sendToSheetBtn.disabled = questions.length === 0;
    sendToSheetBtn.textContent = '🚀 Send to Sheet';
  }
});

// ============================================================================
// 12. Toast Notifications & Helpers
// ============================================================================
function showError(message) {
  if (!parseError) return;
  parseError.textContent = message;
  parseError.style.display = 'block';
}

function hideError() {
  if (!parseError) return;
  parseError.textContent = '';
  parseError.style.display = 'none';
}

/**
 * showToast — Displays a floating notification toast.
 *
 * @param {'success'|'error'|'info'} type - Visual style
 * @param {string} message - Text to show
 * @param {number} durationMs - Auto-dismiss delay (ms)
 */
function showToast(type, message, durationMs = 4500) {
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;

  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  toast.innerHTML = '<span class="toast-icon">' + (icons[type] || 'ℹ️') + '</span>' +
    '<span class="toast-message">' + escapeHtml(message) + '</span>' +
    '<button class="toast-close" title="Dismiss">&times;</button>';

  const closeBtn = toast.querySelector('.toast-close');
  closeBtn.addEventListener('click', function() {
    toast.remove();
  });

  toastContainer.appendChild(toast);

  setTimeout(function() {
    if (toast.parentElement) {
      toast.style.animation = 'slideOutRight 0.3s ease forwards';
      setTimeout(function() { toast.remove(); }, 300);
    }
  }, durationMs);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
