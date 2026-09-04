// ============================================================================
// app.js — Question Dashboard JavaScript Application Logic
// ============================================================================
// This script powers the Sadhana APPSC Question Dashboard web interface:
// - Parses user-pasted JSON question batches into structured data
// - Renders editable question cards with date, newspaper, options, and explanation
// - Supports inline editing of all fields directly on cards
// - Pushes finalized questions to Google Sheets via the Apps Script Web App URL
// ============================================================================

// ---- DOM Element References ----
// Capture references to all interactive HTML elements used throughout the app
const jsonInput = document.getElementById('jsonInput');               // JSON textarea for pasting question data
const subjectSelect = document.getElementById('subjectSelect');       // Subject dropdown selector
const defaultDate = document.getElementById('defaultDate');           // Default date input for all questions
const defaultNewspaper = document.getElementById('defaultNewspaper'); // Default newspaper input for all questions
const parseBtn = document.getElementById('parseBtn');                 // Button to parse JSON and generate cards
const clearBtn = document.getElementById('clearBtn');                 // Button to clear all inputs and cards
const sendToSheetBtn = document.getElementById('sendToSheetBtn');     // Button to push cards to Google Sheets
const cardsContainer = document.getElementById('cardsContainer');     // Container div for rendered question cards
const cardCount = document.getElementById('cardCount');               // Span showing current number of cards
const emptyState = document.getElementById('emptyState');             // Placeholder shown when no cards exist
const parseError = document.getElementById('parseError');             // Error display div for JSON parse failures
const sheetUrlInput = document.getElementById('sheetUrl');            // Input for Google Sheet Web App URL
const connectionStatus = document.getElementById('connectionStatus');  // Visual dot indicator for connection status
const toastContainer = document.getElementById('toastContainer');     // Container for toast notification messages

// ---- Application State ----
// Array to hold the current set of parsed question objects being displayed as cards
let questions = [];

// ---- Local Storage Keys ----
// Persist user's Sheet URL across browser sessions for convenience
const STORAGE_KEY_URL = 'sadhana_sheet_url';

// ---- Initialize on Page Load ----
// Restore previously saved Sheet URL from localStorage if available
(function init() {
  // Read stored URL value from browser's localStorage
  const savedUrl = localStorage.getItem(STORAGE_KEY_URL);
  // If a URL was previously saved, populate the input field and test the connection
  if (savedUrl) {
    sheetUrlInput.value = savedUrl;
    testConnection(savedUrl);
  }
})();

// ---- Event: Save Sheet URL on change ----
// Persist the Sheet URL every time the user modifies it in the config input
sheetUrlInput.addEventListener('change', function() {
  // Get the current trimmed value of the URL input
  const url = sheetUrlInput.value.trim();
  // Save to localStorage for persistence across page reloads
  localStorage.setItem(STORAGE_KEY_URL, url);
  // Test whether the URL is reachable and valid
  if (url) {
    testConnection(url);
  } else {
    // Clear connection indicator if URL is removed
    connectionStatus.className = 'status-dot offline';
    connectionStatus.title = 'Not connected';
  }
});

// ---- Event: Parse Button Click ----
// Parse the JSON textarea content and generate editable question cards
parseBtn.addEventListener('click', function() {
  // Clear any previous error messages
  parseError.style.display = 'none';
  parseError.textContent = '';

  // Get the raw JSON string from the textarea
  const raw = jsonInput.value.trim();
  // Validate that the textarea is not empty
  if (!raw) {
    showError('Please paste some JSON content first.');
    return;
  }

  try {
    // Attempt to parse the raw string as JSON
    const parsed = JSON.parse(raw);
    // Extract questions from the parsed JSON structure
    processJSON(parsed);
  } catch (e) {
    // Display detailed parse error for debugging
    showError('Invalid JSON: ' + e.message);
  }
});

// ---- Event: Clear Button Click ----
// Reset all inputs, cards, and state to initial empty values
clearBtn.addEventListener('click', function() {
  // Clear the JSON textarea
  jsonInput.value = '';
  // Reset the questions state array
  questions = [];
  // Re-render the cards container (will show empty state)
  renderCards();
  // Hide any visible error messages
  parseError.style.display = 'none';
});

// ---- Event: Send to Sheet Button Click ----
// Collect all card data and push to Google Sheets via HTTP POST
sendToSheetBtn.addEventListener('click', async function() {
  // Get the configured Sheet API URL
  const url = sheetUrlInput.value.trim();
  // Validate URL is configured
  if (!url) {
    showToast('error', 'Please configure the Sheet API URL first.');
    return;
  }

  // Get the selected subject from the dropdown
  const subject = subjectSelect.value;
  // Validate a subject is selected
  if (!subject) {
    showToast('error', 'Please select a subject from the dropdown.');
    return;
  }

  // Validate that there are cards to send
  if (questions.length === 0) {
    showToast('error', 'No question cards to send. Parse JSON first.');
    return;
  }

  // Collect the latest data from all rendered card input fields
  const payload = collectCardData();

  // Disable the button and show loading state during the request
  sendToSheetBtn.disabled = true;
  sendToSheetBtn.classList.add('loading');
  sendToSheetBtn.textContent = 'Sending...';

  try {
    // Send HTTP POST request to the Google Apps Script Web App
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'addQuestions',   // Action identifier for the Apps Script doPost handler
        subject: subject,         // Target subject tab name in Google Sheets
        questions: payload        // Array of question objects with all 9 data fields
      })
    });

    // Parse the JSON response from the Apps Script backend
    const result = await response.json();

    // Check if the operation was successful
    if (result.success) {
      // Show success toast with count of added questions
      showToast('success', `✅ ${result.addedCount} question(s) added to "${subject}" sheet!`);
      // Clear the cards after successful push
      questions = [];
      renderCards();
      // Clear JSON textarea for next batch
      jsonInput.value = '';
    } else {
      // Show error toast with the backend error message
      showToast('error', 'Failed: ' + (result.error || 'Unknown error'));
    }
  } catch (e) {
    // Show network or fetch error
    showToast('error', 'Network error: ' + e.message);
  } finally {
    // Re-enable the button and restore original label
    sendToSheetBtn.disabled = questions.length === 0;
    sendToSheetBtn.classList.remove('loading');
    sendToSheetBtn.textContent = 'Send to Sheet';
  }
});

/**
 * processJSON — Extracts questions from various JSON structures.
 * What it does: Handles both { subject, date, newspaper, questions: [...] } and plain [...] array formats.
 * What it brings: Flexibility for users to paste questions in different JSON layouts.
 * Where changes can be seen: Cards rendered in the right panel of the dashboard.
 *
 * @param {Object|Array} parsed — The parsed JSON data
 */
function processJSON(parsed) {
  // Array to accumulate extracted question objects
  let extracted = [];

  // Case 1: Top-level object with a "questions" array property
  if (parsed && !Array.isArray(parsed) && parsed.questions && Array.isArray(parsed.questions)) {
    // Auto-fill subject dropdown from JSON if specified
    if (parsed.subject) {
      subjectSelect.value = parsed.subject;
    }
    // Auto-fill default date from JSON if specified
    if (parsed.date) {
      defaultDate.value = parsed.date;
    }
    // Auto-fill default newspaper from JSON if specified
    if (parsed.newspaper) {
      defaultNewspaper.value = parsed.newspaper;
    }
    // Use the questions array from the object
    extracted = parsed.questions;
  }
  // Case 2: Plain array of question objects
  else if (Array.isArray(parsed)) {
    extracted = parsed;
  }
  // Case 3: Single question object
  else if (parsed && parsed.question) {
    extracted = [parsed];
  }
  // Case 4: Unrecognized format
  else {
    showError('Unrecognized JSON format. Expected { "questions": [...] } or an array of question objects.');
    return;
  }

  // Validate that at least one question was found
  if (extracted.length === 0) {
    showError('No questions found in the JSON data.');
    return;
  }

  // Map raw JSON question objects to standardized internal format
  questions = extracted.map(function(q, i) {
    return {
      id: i,                                                              // Internal index for DOM identification
      date: q.date || defaultDate.value || '',                           // Publication date (per-question or default)
      newspaper: q.newspaper || defaultNewspaper.value || '',            // Source newspaper (per-question or default)
      question: q.question || q.question_text || '',                     // Full question text
      option_a: q.option_a || q.optionA || q.a || '',                    // Option A text
      option_b: q.option_b || q.optionB || q.b || '',                    // Option B text
      option_c: q.option_c || q.optionC || q.c || '',                    // Option C text
      option_d: q.option_d || q.optionD || q.d || '',                    // Option D text
      correct_answer: (q.correct_answer || q.answer || 'A').toUpperCase(), // Correct answer letter
      explanation: q.explanation || ''                                     // Detailed explanation text
    };
  });

  // Render the extracted questions as interactive cards
  renderCards();
  // Show success toast with count
  showToast('info', `Parsed ${questions.length} question(s). Review and click "Send to Sheet".`);
}

/**
 * renderCards — Generates the HTML for all question cards and inserts them into the DOM.
 * What it does: Clears the cards container and rebuilds it from the current questions array.
 * What it brings: Live visual preview of all questions with inline editing capability.
 * Where changes can be seen: The right panel of the dashboard fills with interactive cards.
 */
function renderCards() {
  // Update the card count badge in the panel header
  cardCount.textContent = '(' + questions.length + ')';
  // Enable/disable the send button based on whether cards exist
  sendToSheetBtn.disabled = questions.length === 0;

  // Show empty state if no questions exist
  if (questions.length === 0) {
    cardsContainer.innerHTML = '';
    cardsContainer.appendChild(createEmptyState());
    return;
  }

  // Clear existing card elements
  cardsContainer.innerHTML = '';

  // Generate and append a card element for each question
  questions.forEach(function(q, index) {
    // Create the card DOM element with staggered animation delay
    const card = createCardElement(q, index);
    // Set animation delay so cards cascade in
    card.style.animationDelay = (index * 0.05) + 's';
    // Append the card to the scrollable container
    cardsContainer.appendChild(card);
  });
}

/**
 * createEmptyState — Returns the placeholder DOM element shown when no cards exist.
 *
 * @returns {HTMLElement} The empty state container div
 */
function createEmptyState() {
  // Create container div for empty state messaging
  const div = document.createElement('div');
  div.className = 'empty-state';
  // Populate with icon and instructional text
  div.innerHTML = '<div class="empty-icon">📋</div>' +
    '<p>Paste JSON on the left and click <strong>Parse & Preview</strong></p>' +
    '<p class="empty-hint">Questions will appear here as editable cards</p>';
  return div;
}

/**
 * createCardElement — Builds a single interactive question card DOM element.
 * What it does: Creates an editable card with date, newspaper, question, 4 options, answer selector, and explanation.
 * What it brings: Visual, interactive question editing before pushing to Google Sheets.
 * Where changes can be seen: Each card in the right panel of the dashboard.
 *
 * @param {Object} q — Question data object
 * @param {number} index — 0-based index in the questions array
 * @returns {HTMLElement} The fully constructed card DOM element
 */
function createCardElement(q, index) {
  // Create card container div
  const card = document.createElement('div');
  card.className = 'question-card';
  card.dataset.index = index;

  // Build the full card HTML with unique IDs for each input field
  card.innerHTML =
    // Top row: question number badge, date/newspaper inline inputs, delete button
    '<div class="card-top">' +
      '<span class="card-number">Q' + (index + 1) + '</span>' +
      '<div class="card-meta">' +
        '<input type="text" class="card-meta-input" data-field="date" value="' + escapeAttr(q.date) + '" placeholder="Date">' +
        '<input type="text" class="card-meta-input" data-field="newspaper" value="' + escapeAttr(q.newspaper) + '" placeholder="Newspaper">' +
      '</div>' +
      '<button class="card-delete" data-index="' + index + '" title="Remove this question">✕</button>' +
    '</div>' +

    // Question text editable textarea
    '<textarea class="card-question" data-field="question" rows="3">' + escapeHtml(q.question) + '</textarea>' +

    // 2x2 options grid with correct answer highlighted
    '<div class="options-grid">' +
      buildOptionHTML('A', q.option_a, q.correct_answer === 'A') +
      buildOptionHTML('B', q.option_b, q.correct_answer === 'B') +
      buildOptionHTML('C', q.option_c, q.correct_answer === 'C') +
      buildOptionHTML('D', q.option_d, q.correct_answer === 'D') +
    '</div>' +

    // Correct answer selector row with A/B/C/D circular buttons
    '<div class="answer-row">' +
      '<span class="answer-label">Correct:</span>' +
      '<div class="answer-options">' +
        buildAnswerBtn('A', q.correct_answer === 'A', index) +
        buildAnswerBtn('B', q.correct_answer === 'B', index) +
        buildAnswerBtn('C', q.correct_answer === 'C', index) +
        buildAnswerBtn('D', q.correct_answer === 'D', index) +
      '</div>' +
    '</div>' +

    // Explanation label and textarea
    '<div class="explanation-label">Explanation</div>' +
    '<textarea class="card-explanation" data-field="explanation" rows="2">' + escapeHtml(q.explanation) + '</textarea>';

  // Attach delete button click handler to remove this card
  const deleteBtn = card.querySelector('.card-delete');
  deleteBtn.addEventListener('click', function() {
    // Remove the question from the array at the specified index
    questions.splice(index, 1);
    // Re-render all cards to update numbering and indices
    renderCards();
    // Show feedback toast
    showToast('info', 'Question removed.');
  });

  // Attach click handlers to the A/B/C/D answer selector buttons
  const answerBtns = card.querySelectorAll('.answer-btn');
  answerBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      // Get the selected answer letter from the button's data attribute
      const letter = btn.dataset.letter;
      // Update the question object's correct_answer
      questions[index].correct_answer = letter;
      // Re-render cards to update visual highlighting
      renderCards();
    });
  });

  return card;
}

/**
 * buildOptionHTML — Creates the HTML string for a single option item in the 2x2 grid.
 *
 * @param {string} letter — Option letter (A, B, C, or D)
 * @param {string} text — Option text value
 * @param {boolean} isCorrect — Whether this option is the correct answer
 * @returns {string} HTML string for the option item
 */
function buildOptionHTML(letter, text, isCorrect) {
  // Apply 'correct' CSS class if this is the right answer
  const cls = isCorrect ? 'option-item correct' : 'option-item';
  // Return the option item HTML with letter badge and editable input
  return '<div class="' + cls + '">' +
    '<span class="option-letter">' + letter + '.</span>' +
    '<input type="text" class="option-input" data-field="option_' + letter.toLowerCase() + '" value="' + escapeAttr(text) + '">' +
    '</div>';
}

/**
 * buildAnswerBtn — Creates the HTML string for a single answer selector button.
 *
 * @param {string} letter — Option letter (A, B, C, or D)
 * @param {boolean} isSelected — Whether this button is currently the selected answer
 * @param {number} cardIndex — Index of the parent card in the questions array
 * @returns {string} HTML string for the circular answer button
 */
function buildAnswerBtn(letter, isSelected, cardIndex) {
  // Apply 'selected' CSS class to highlight the current correct answer
  const cls = isSelected ? 'answer-btn selected' : 'answer-btn';
  // Return button HTML with data attributes for letter and card index
  return '<button class="' + cls + '" data-letter="' + letter + '" data-card="' + cardIndex + '">' + letter + '</button>';
}

/**
 * collectCardData — Reads the current values from all rendered card input fields.
 * What it does: Iterates through each card DOM element and extracts the latest edited values.
 * What it brings: Ensures that any inline edits made by the user are captured before sending.
 * Where changes can be seen: The payload sent to Google Sheets reflects the on-screen card state.
 *
 * @returns {Array<Object>} Array of question objects ready for the API payload
 */
function collectCardData() {
  // Get all rendered question card elements from the DOM
  const cards = cardsContainer.querySelectorAll('.question-card');
  // Array to collect the latest data from each card
  const payload = [];

  // Iterate through each card element
  cards.forEach(function(card, i) {
    // Read the latest values from each input/textarea field using data-field attributes
    const q = {
      date: getFieldValue(card, 'date'),                    // Date input value
      newspaper: getFieldValue(card, 'newspaper'),          // Newspaper input value
      question: getFieldValue(card, 'question'),            // Question textarea value
      option_a: getFieldValue(card, 'option_a'),            // Option A input value
      option_b: getFieldValue(card, 'option_b'),            // Option B input value
      option_c: getFieldValue(card, 'option_c'),            // Option C input value
      option_d: getFieldValue(card, 'option_d'),            // Option D input value
      correct_answer: questions[i] ? questions[i].correct_answer : 'A', // Current correct answer letter
      explanation: getFieldValue(card, 'explanation')        // Explanation textarea value
    };
    // Add the collected question object to the payload array
    payload.push(q);
  });

  return payload;
}

/**
 * getFieldValue — Reads the value of a card input/textarea by its data-field attribute.
 *
 * @param {HTMLElement} card — The card DOM element
 * @param {string} fieldName — The data-field attribute value to search for
 * @returns {string} The trimmed value of the field, or empty string if not found
 */
function getFieldValue(card, fieldName) {
  // Find the element within the card that has the matching data-field attribute
  const el = card.querySelector('[data-field="' + fieldName + '"]');
  // Return the trimmed value or empty string if element not found
  return el ? el.value.trim() : '';
}

/**
 * testConnection — Pings the Google Sheet Web App URL to verify connectivity.
 * What it does: Sends a GET request with action=ping and updates the status dot indicator.
 * What it brings: Visual feedback confirming whether the Sheet API is reachable.
 * Where changes can be seen: The colored dot next to the URL input turns green (online) or red (offline).
 *
 * @param {string} url — The Google Apps Script Web App URL to test
 */
async function testConnection(url) {
  // Set status to loading (yellow pulsing dot)
  connectionStatus.className = 'status-dot loading';
  connectionStatus.title = 'Testing connection...';

  try {
    // Send GET request to the ping endpoint
    const response = await fetch(url + '?action=ping', { redirect: 'follow' });
    // Parse JSON response
    const result = await response.json();
    // Check if the ping was successful
    if (result.status === 'ok') {
      // Set status to online (green dot)
      connectionStatus.className = 'status-dot online';
      connectionStatus.title = 'Connected to Google Sheets';
    } else {
      // Set status to offline (red dot) if response was unexpected
      connectionStatus.className = 'status-dot offline';
      connectionStatus.title = 'Unexpected response from Sheet API';
    }
  } catch (e) {
    // Set status to offline on network error
    connectionStatus.className = 'status-dot offline';
    connectionStatus.title = 'Cannot reach Sheet API: ' + e.message;
  }
}

/**
 * showError — Displays an error message in the parse error box below the JSON textarea.
 *
 * @param {string} message — Error message text to display
 */
function showError(message) {
  // Set the error text content
  parseError.textContent = message;
  // Make the error box visible
  parseError.style.display = 'block';
}

/**
 * showToast — Creates and displays a temporary toast notification.
 * What it does: Appends a styled notification element that auto-dismisses after 4 seconds.
 * What it brings: Non-intrusive feedback for user actions (success, error, info).
 * Where changes can be seen: Toast messages appear at the bottom-right of the screen.
 *
 * @param {string} type — Toast type: 'success', 'error', or 'info'
 * @param {string} message — Toast message text
 */
function showToast(type, message) {
  // Create the toast DOM element
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;

  // Set icon based on toast type
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  // Build toast inner HTML with icon and message
  toast.innerHTML = '<span class="toast-icon">' + (icons[type] || 'ℹ️') + '</span>' + escapeHtml(message);

  // Append the toast to the container
  toastContainer.appendChild(toast);

  // Auto-remove the toast after 4 seconds with slide-out animation
  setTimeout(function() {
    toast.style.animation = 'toastSlideOut 0.3s ease forwards';
    // Remove from DOM after animation completes
    setTimeout(function() {
      toast.remove();
    }, 300);
  }, 4000);
}

/**
 * escapeHtml — Sanitizes text for safe HTML insertion.
 *
 * @param {string} text — Raw text that may contain HTML special characters
 * @returns {string} Escaped text safe for innerHTML
 */
function escapeHtml(text) {
  // Create a temporary div to leverage the browser's built-in escaping
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

/**
 * escapeAttr — Sanitizes text for safe HTML attribute value insertion.
 *
 * @param {string} text — Raw text that may contain quotes or special characters
 * @returns {string} Escaped text safe for use in HTML attribute values
 */
function escapeAttr(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
