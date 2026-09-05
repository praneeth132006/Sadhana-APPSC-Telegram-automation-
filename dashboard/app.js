// ============================================================================
// Sadhana APPSC Question Dashboard — Client Application Logic (v3)
// ============================================================================
// What this file does:
// 1. Manages Firebase Authentication (Google 1-click & Email/Password).
// 2. Parses APPSC question batches from JSON into standardized question objects.
// 3. Renders interactive vertical question cards with stacked options.
// 4. Supports real-time inline editing of questions, dates, newspapers, and options.
// 5. Connects via local proxy server to batch-append questions into Google Sheets.
// 6. Tracks the authenticated user's email into the "Added By" sheet column.
//
// What it brings:
// - User attribution and security via Firebase Auth.
// - High-readability vertical cards designed specifically for long multi-statement exam questions.
// - 100% CORS-free data transmission to Google Sheets.
//
// Where changes can be seen:
// - Header user chip, auth modal, and vertical question cards rendered on http://localhost:3000.
// ============================================================================

// Import Firebase App initializer from official Google CDN
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
// Import Firebase Authentication functions from official Google CDN
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
// Firebase configuration credentials provided for ap-gurukul-43050 project
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
const firebaseApp = initializeApp(firebaseConfig);
// Initialize the Firebase Auth service
const auth = getAuth(firebaseApp);
// Google OAuth provider instance for 1-click sign-in
const googleProvider = new GoogleAuthProvider();

// Global variable tracking currently authenticated user object (null when logged out)
let currentUser = null;

// ============================================================================
// 2. DOM Elements References
// ============================================================================
// Header controls
const sheetUrlInput = document.getElementById('sheetUrl');              // Sheet API URL input
const connectionStatus = document.getElementById('connectionStatus');    // Connection status dot
const openAuthBtn = document.getElementById('openAuthBtn');              // Open Auth modal button
const userProfileChip = document.getElementById('userProfileChip');      // User profile chip container
const userAvatar = document.getElementById('userAvatar');                // User avatar element
const userEmail = document.getElementById('userEmail');                  // User email text
const signOutBtn = document.getElementById('signOutBtn');                // Sign out button

// Left panel inputs
const subjectSelect = document.getElementById('subjectSelect');          // Subject dropdown
const defaultDate = document.getElementById('defaultDate');              // Default publication date input
const defaultNewspaper = document.getElementById('defaultNewspaper');    // Default newspaper input
const jsonInput = document.getElementById('jsonInput');                  // JSON raw text area
const parseBtn = document.getElementById('parseBtn');                    // Parse JSON button
const clearBtn = document.getElementById('clearBtn');                    // Clear all button
const sampleBtn = document.getElementById('sampleBtn');                  // Load sample JSON button
const parseError = document.getElementById('parseError');                // Error message container

// Right panel outputs
const cardCount = document.getElementById('cardCount');                  // Question count badge
const cardsContainer = document.getElementById('cardsContainer');        // Vertical cards container
const sendToSheetBtn = document.getElementById('sendToSheetBtn');        // Push to Google Sheets button
const toastContainer = document.getElementById('toastContainer');        // Toast notification container

// Auth modal elements
const authModal = document.getElementById('authModal');                  // Auth modal backdrop
const closeAuthModal = document.getElementById('closeAuthModal');        // Modal close button
const googleSignInBtn = document.getElementById('googleSignInBtn');      // Google sign-in button
const tabSignIn = document.getElementById('tabSignIn');                  // Tab: Sign In
const tabRegister = document.getElementById('tabRegister');              // Tab: Register
const authForm = document.getElementById('authForm');                    // Email/password form
const authEmail = document.getElementById('authEmail');                  // Auth email input
const authPassword = document.getElementById('authPassword');            // Auth password input
const authSubmitBtn = document.getElementById('authSubmitBtn');          // Auth submit button
const authError = document.getElementById('authError');                  // Auth error message

// ============================================================================
// 3. Application State & Storage
// ============================================================================
// In-memory array of parsed question objects
let questions = [];
// LocalStorage key for persisting the Sheet API URL across sessions
const STORAGE_KEY_URL = 'sadhana_sheet_url';
// Auth mode state ('signin' or 'register')
let authMode = 'signin';

// ============================================================================
// 4. Initialization & Server Auto-Configuration
// ============================================================================
(async function init() {
  // Read previously saved Sheet URL from browser's localStorage
  const savedUrl = localStorage.getItem(STORAGE_KEY_URL);
  if (savedUrl) {
    // Populate input field with saved URL
    sheetUrlInput.value = savedUrl;
    // Test connectivity
    testConnection(savedUrl);
  }

  // Attempt to fetch server-side configuration from local dashboard server (/api/config)
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const cfg = await res.json();
      // If server has GOOGLE_SHEET_WEBAPP_URL configured in .env, pre-fill it
      if (cfg.sheetUrl && (!sheetUrlInput.value || sheetUrlInput.value === savedUrl)) {
        sheetUrlInput.value = cfg.sheetUrl;
        localStorage.setItem(STORAGE_KEY_URL, cfg.sheetUrl);
        testConnection(cfg.sheetUrl);
      }
    }
  } catch (err) {
    // Silently continue if running without local server
  }
})();

// ============================================================================
// 5. Firebase Auth State Listener & Handlers
// ============================================================================
// Listen for Firebase authentication state changes in real time
onAuthStateChanged(auth, function(user) {
  if (user) {
    // User is signed in
    currentUser = user;
    // Hide sign-in trigger button
    openAuthBtn.style.display = 'none';
    // Display user profile chip in header
    userProfileChip.style.display = 'flex';

    // Populate user avatar with photo if available, otherwise display initial
    if (user.photoURL) {
      userAvatar.innerHTML = '<img src="' + escapeAttr(user.photoURL) + '" alt="Avatar">';
    } else {
      userAvatar.textContent = (user.displayName || user.email || 'U').charAt(0).toUpperCase();
    }

    // Display user's name or email
    userEmail.textContent = user.displayName || user.email;
    // Dismiss auth modal if open
    hideAuthModal();
    // Show welcoming toast notification
    showToast('info', 'Signed in as ' + (user.displayName || user.email));
  } else {
    // User is signed out
    currentUser = null;
    // Show sign-in trigger button
    openAuthBtn.style.display = 'flex';
    // Hide user profile chip
    userProfileChip.style.display = 'none';
  }
});

// Open Auth Modal
openAuthBtn.addEventListener('click', showAuthModal);
// Close Auth Modal via X button
closeAuthModal.addEventListener('click', hideAuthModal);

// Close Auth Modal when clicking the dark backdrop
authModal.addEventListener('click', function(e) {
  if (e.target === authModal) hideAuthModal();
});

// Helper: Show Auth Modal
function showAuthModal() {
  authModal.style.display = 'flex';
  authError.style.display = 'none';
  authError.textContent = '';
}

// Helper: Hide Auth Modal
function hideAuthModal() {
  authModal.style.display = 'none';
}

// Google 1-Click Sign-In
googleSignInBtn.addEventListener('click', async function() {
  authError.style.display = 'none';
  try {
    // Open Google Sign-In popup
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    // Display authentication error in modal
    authError.textContent = 'Google sign-in error: ' + err.message;
    authError.style.display = 'block';
  }
});

// Switch to Sign In Tab
tabSignIn.addEventListener('click', function() {
  authMode = 'signin';
  tabSignIn.classList.add('active');
  tabRegister.classList.remove('active');
  authSubmitBtn.textContent = 'Sign In';
  authError.style.display = 'none';
});

// Switch to Register Tab
tabRegister.addEventListener('click', function() {
  authMode = 'register';
  tabRegister.classList.add('active');
  tabSignIn.classList.remove('active');
  authSubmitBtn.textContent = 'Create Account';
  authError.style.display = 'none';
});

// Email / Password Form Submission
authForm.addEventListener('submit', async function(e) {
  e.preventDefault();
  const email = authEmail.value.trim();
  const password = authPassword.value;
  authError.style.display = 'none';

  if (!email || !password) {
    authError.textContent = 'Please enter both email and password.';
    authError.style.display = 'block';
    return;
  }

  try {
    if (authMode === 'signin') {
      // Authenticate existing user with email and password
      await signInWithEmailAndPassword(auth, email, password);
    } else {
      // Register new user account with email and password
      await createUserWithEmailAndPassword(auth, email, password);
    }
  } catch (err) {
    // Format friendly error message
    authError.textContent = err.message.replace('Firebase: ', '');
    authError.style.display = 'block';
  }
});

// Sign Out button handler
signOutBtn.addEventListener('click', async function() {
  try {
    await signOut(auth);
    showToast('info', 'Signed out successfully.');
  } catch (err) {
    showToast('error', 'Sign out error: ' + err.message);
  }
});

// ============================================================================
// 6. Sheet URL Validation & Connection Testing
// ============================================================================
sheetUrlInput.addEventListener('change', function() {
  const url = sheetUrlInput.value.trim();

  // Validate that user didn't accidentally paste a Library or Edit URL
  if (url.includes('/macros/library/') || url.includes('/edit')) {
    showToast('error', '⚠️ That is a Library/Edit URL! Please copy the Web App URL ending in /exec.');
    connectionStatus.className = 'status-dot offline';
    connectionStatus.title = 'Invalid URL: Must be Web App URL ending in /exec';
    return;
  }

  // Save to localStorage for persistence
  localStorage.setItem(STORAGE_KEY_URL, url);
  if (url) {
    testConnection(url);
  } else {
    connectionStatus.className = 'status-dot offline';
    connectionStatus.title = 'Not connected';
  }
});

async function testConnection(url) {
  connectionStatus.className = 'status-dot loading';
  connectionStatus.title = 'Testing connection...';

  let result = null;
  // Try checking via local server proxy first
  try {
    const proxyRes = await fetch('/api/ping?url=' + encodeURIComponent(url));
    if (proxyRes.ok) {
      result = await proxyRes.json();
    }
  } catch (proxyErr) {
    result = null;
  }

  // Fallback to direct fetch
  if (!result) {
    try {
      const response = await fetch(url + '?action=ping', { redirect: 'follow' });
      result = await response.json();
    } catch (directErr) {
      connectionStatus.className = 'status-dot offline';
      connectionStatus.title = 'Cannot reach Sheet API: ' + directErr.message;
      return;
    }
  }

  // Check if authentication redirect is required
  if (result.status === 'auth_required') {
    connectionStatus.className = 'status-dot offline';
    connectionStatus.title = result.error;
    showToast('error', '⚠️ Apps Script requires login. Redeploy with "Who has access: Anyone".');
    return;
  }

  // Check if connection was successful
  if (result.status === 'ok') {
    connectionStatus.className = 'status-dot online';
    connectionStatus.title = 'Connected to Google Sheets';
  } else {
    connectionStatus.className = 'status-dot offline';
    connectionStatus.title = result.error || 'Unexpected response from Sheet API';
  }
}

// ============================================================================
// 7. JSON Parsing & Sample Loading
// ============================================================================
// Sample APPSC Question JSON
const SAMPLE_JSON = {
  "subject": "Environment",
  "date": "05-09-2026",
  "newspaper": "The Hindu",
  "questions": [
    {
      "question": "Consider the following statements regarding the 'AP-Green' initiative and forest data in Andhra Pradesh:\n1. At present, forest area covers 22.96% of the state's total geographical area (37.42 lakh hectares).\n2. AP-Green is set up as an autonomous body to bring all green-cover initiatives onto a single platform.\n3. Funding for AP-Green projects includes sources such as Carbon Finance, Green Bonds, District Mineral Fund, and NABARD.\nWhich of the statements given above are correct?",
      "option_a": "1 and 2 only",
      "option_b": "2 and 3 only",
      "option_c": "1 and 3 only",
      "option_d": "1, 2, and 3",
      "correct_answer": "D",
      "explanation": "Statement 1 is correct: Andhra Pradesh currently has 37.42 lakh hectares under forest cover (22.96%). Statement 2 is correct: AP-Green coordinates multi-departmental efforts to reach 50% green cover by 2047. Statement 3 is correct: Resources are mobilized via State Grants, Central Schemes, NABARD, Carbon Finance, Green Bonds, and DMF."
    },
    {
      "question": "Under the Andhra Pradesh Community Managed Natural Farming (APCNF) framework, which bio-input is primarily utilized for seed treatment?",
      "option_a": "Jeevamrutha",
      "option_b": "Beejamrutha",
      "option_c": "Ghanajeevamrutha",
      "option_d": "Neemastram",
      "correct_answer": "B",
      "explanation": "Beejamrutha is a microbial seed treatment formulation made from cow dung, cow urine, lime, and soil that protects young roots from seed-borne and soil-borne diseases."
    }
  ]
};

// Load Sample JSON button
sampleBtn.addEventListener('click', function() {
  jsonInput.value = JSON.stringify(SAMPLE_JSON, null, 2);
  subjectSelect.value = "Environment";
  defaultDate.value = "05-09-2026";
  defaultNewspaper.value = "The Hindu";
  parseError.style.display = 'none';
  showToast('info', 'Loaded sample JSON. Click "Parse & Preview" to see vertical cards.');
});

// Parse Button Click
parseBtn.addEventListener('click', function() {
  parseError.style.display = 'none';
  parseError.textContent = '';
  const raw = jsonInput.value.trim();
  if (!raw) {
    showError('Please paste some JSON content first or click "Load Sample JSON".');
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    processJSON(parsed);
  } catch (e) {
    showError('Invalid JSON: ' + e.message);
  }
});

// Clear Button Click
clearBtn.addEventListener('click', function() {
  jsonInput.value = '';
  questions = [];
  renderCards();
  parseError.style.display = 'none';
});

// Process Parsed JSON
function processJSON(parsed) {
  let extracted = [];

  // Format 1: Object with questions array
  if (parsed && Array.isArray(parsed.questions)) {
    if (parsed.subject && !subjectSelect.value) {
      subjectSelect.value = parsed.subject;
    }
    if (parsed.date) {
      defaultDate.value = parsed.date;
    }
    if (parsed.newspaper) {
      defaultNewspaper.value = parsed.newspaper;
    }
    extracted = parsed.questions;
  }
  // Format 2: Plain array of questions
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

  renderCards();
  showToast('info', `Parsed ${questions.length} question(s) into vertical card format.`);
}

// ============================================================================
// 8. Vertical Question Card Rendering
// ============================================================================
function renderCards() {
  cardCount.textContent = '(' + questions.length + ')';
  sendToSheetBtn.disabled = questions.length === 0;

  if (questions.length === 0) {
    cardsContainer.innerHTML = '';
    cardsContainer.appendChild(createEmptyState());
    return;
  }

  cardsContainer.innerHTML = '';
  questions.forEach(function(q, index) {
    const card = createCardElement(q, index);
    card.style.animationDelay = (index * 0.05) + 's';
    cardsContainer.appendChild(card);
  });
}

function createEmptyState() {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.innerHTML = '<div class="empty-icon">📋</div>' +
    '<p>Paste JSON on the left and click <strong>Parse &amp; Preview</strong></p>' +
    '<p class="empty-hint">Questions will appear here as rich, editable vertical cards</p>';
  return div;
}

/**
 * createCardElement — Builds a rich, vertical question card DOM element.
 * Options are stacked vertically with radio selectors for instantaneous correct answer toggling.
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

    // Section 1: Question Text
    '<div class="card-section">' +
      '<label class="section-label">📝 Question Prompt</label>' +
      '<textarea class="question-textarea-vertical" data-field="question" rows="4" placeholder="Enter question text...">' + escapeHtml(q.question) + '</textarea>' +
    '</div>' +

    // Section 2: Vertical Stacked Options
    '<div class="card-section">' +
      '<label class="section-label">🔘 Options &amp; Correct Answer (Click radio to select)</label>' +
      '<div class="options-vertical-list">' + optionsHtml + '</div>' +
    '</div>' +

    // Section 3: Explanation
    '<div class="card-section">' +
      '<label class="section-label">💡 Explanation</label>' +
      '<textarea class="explanation-textarea-vertical" data-field="explanation" rows="3" placeholder="Enter detailed explanation...">' + escapeHtml(q.explanation) + '</textarea>' +
    '</div>' +

    // Card Footer Bar
    '<div class="card-footer-bar">' +
      '<span class="correct-summary-tag">✓ Correct Answer: Option <strong class="correct-letter-display">' + q.correct_answer + '</strong></span>' +
      '<span>APPSC Format</span>' +
    '</div>';

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
// 9. Collect Card Data for Submission
// ============================================================================
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

function getFieldValue(card, fieldName) {
  const el = card.querySelector('[data-field="' + fieldName + '"]');
  return el ? el.value.trim() : '';
}

// ============================================================================
// 10. Push to Google Sheets (Protected by Firebase Auth)
// ============================================================================
sendToSheetBtn.addEventListener('click', async function() {
  // Step 1: Authentication Guard — Require Firebase Auth before uploading!
  if (!currentUser) {
    showToast('error', '⚠️ Please sign in first to upload questions to Google Sheets.');
    showAuthModal();
    return;
  }

  // Step 2: Validate Sheet URL
  const url = sheetUrlInput.value.trim();
  if (!url) {
    showToast('error', 'Please configure the Sheet API URL first.');
    return;
  }

  if (url.includes('/macros/library/') || url.includes('/edit')) {
    showToast('error', '⚠️ You entered a Library/Edit URL! Please copy the Web App URL ending in /exec.');
    return;
  }

  // Step 3: Validate Subject Selection
  const subject = subjectSelect.value;
  if (!subject) {
    showToast('error', 'Please select a subject from the dropdown.');
    return;
  }

  // Step 4: Validate Cards Count
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

    // Try sending through local server proxy first
    try {
      const proxyRes = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url,
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

    // Fallback to direct fetch
    if (!result) {
      const response = await fetch(url, {
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

    if (result.success) {
      showToast('success', `✅ ${result.addedCount} question(s) added to "${subject}" by ${currentUser.email}!`);
      // Clear questions after successful push
      questions = [];
      renderCards();
      jsonInput.value = '';
    } else {
      showToast('error', 'Failed: ' + (result.error || 'Unknown error'));
    }
  } catch (e) {
    showToast('error', 'Network error: ' + e.message);
  } finally {
    sendToSheetBtn.disabled = questions.length === 0;
    sendToSheetBtn.textContent = '🚀 Send to Sheet';
  }
});

// ============================================================================
// 11. Toast Notifications & Helpers
// ============================================================================
function showError(message) {
  parseError.textContent = message;
  parseError.style.display = 'block';
}

function showToast(type, message) {
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  toast.innerHTML = '<span class="toast-icon">' + (icons[type] || 'ℹ️') + '</span>' + escapeHtml(message);
  toastContainer.appendChild(toast);

  setTimeout(function() {
    toast.style.animation = 'toastSlideOut 0.3s ease forwards';
    setTimeout(function() {
      toast.remove();
    }, 300);
  }, 4000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function escapeAttr(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
