// ============================================================================
// Upload dashboard (dashboard/app.js)
// ============================================================================
// Paste a JSON batch, review it as editable cards, push it into the Google
// Sheets question bank. Auth, navigation and the API client live in shared.js;
// this file is only the parse → edit → send flow.
//
// Cards are built with DOM nodes rather than innerHTML, so a question that
// contains angle brackets or quotes renders as text and never as markup.
// ============================================================================

import {
  initDashboard, api, el, replaceChildren, emptyState, showToast, $,
  SUBJECTS, STATUSES, DIFFICULTIES
} from './shared.js';

/** The working set of questions currently rendered as cards. */
let questions = [];

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Shows the inline parse error box. */
function showError(message) {
  const box = $('parseError');
  box.textContent = message;
  box.style.display = 'block';
}

/** Hides the inline parse error box. */
function hideError() {
  const box = $('parseError');
  box.textContent = '';
  box.style.display = 'none';
}

/**
 * normaliseQuestion — accepts the several shapes people paste and returns the
 * single shape the cards and the API use. Batch defaults fill any gap.
 *
 * @param {Object} raw One question from the pasted JSON
 * @param {Object} defaults Values from the batch metadata fields
 */
function normaliseQuestion(raw, defaults) {
  const pick = (...keys) => {
    for (const key of keys) {
      if (raw[key] !== undefined && raw[key] !== null && String(raw[key]).trim()) {
        return String(raw[key]).trim();
      }
    }
    return '';
  };

  // Some sources emit options as an array rather than option_a..option_d.
  const optionArray = Array.isArray(raw.options) ? raw.options : null;

  return {
    question: pick('question', 'question_text', 'text', 'prompt'),
    option_a: optionArray ? String(optionArray[0] ?? '').trim() : pick('option_a', 'optionA', 'a'),
    option_b: optionArray ? String(optionArray[1] ?? '').trim() : pick('option_b', 'optionB', 'b'),
    option_c: optionArray ? String(optionArray[2] ?? '').trim() : pick('option_c', 'optionC', 'c'),
    option_d: optionArray ? String(optionArray[3] ?? '').trim() : pick('option_d', 'optionD', 'd'),
    correct_answer: (pick('correct_answer', 'correctAnswer', 'answer', 'correct') || 'A').toUpperCase().charAt(0),
    explanation: pick('explanation', 'exp', 'rationale'),
    date: pick('date') || defaults.date,
    newspaper: pick('newspaper', 'source') || defaults.newspaper,
    topic: pick('topic', 'sub_topic', 'subtopic') || defaults.topic,
    difficulty: pick('difficulty', 'level') || defaults.difficulty,
    tags: pick('tags', 'keywords') || defaults.tags,
    source_url: pick('source_url', 'sourceUrl', 'url', 'link') || defaults.sourceUrl,
    status: pick('status') || defaults.status
  };
}

/** Reads the batch metadata inputs into a defaults object. */
function readDefaults() {
  return {
    date: $('defaultDate').value.trim(),
    newspaper: $('defaultNewspaper').value.trim(),
    topic: $('defaultTopic').value.trim(),
    difficulty: $('defaultDifficulty').value,
    tags: $('defaultTags').value.trim(),
    sourceUrl: $('defaultSourceUrl').value.trim(),
    status: $('defaultStatus').value
  };
}

/** Parses the textarea and rebuilds the card list. */
function parseJson() {
  hideError();
  const raw = $('jsonInput').value.trim();

  if (!raw) {
    showError('Paste some JSON first.');
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    showError('That is not valid JSON: ' + err.message);
    return;
  }

  const defaults = readDefaults();

  // Accept { questions: [...] }, a bare array, or a single question object.
  let list;
  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (Array.isArray(parsed.questions)) {
    list = parsed.questions;
    // An object wrapper may also carry batch-level metadata.
    if (parsed.subject && SUBJECTS.includes(parsed.subject)) $('subjectSelect').value = parsed.subject;
    if (parsed.date && !defaults.date) defaults.date = String(parsed.date).trim();
    if (parsed.newspaper && !defaults.newspaper) defaults.newspaper = String(parsed.newspaper).trim();
  } else if (parsed.question || parsed.question_text) {
    list = [parsed];
  } else {
    showError('Expected an array of questions, or an object with a "questions" array.');
    return;
  }

  if (!list.length) {
    showError('The JSON parsed fine but contains no questions.');
    return;
  }

  questions = list
    .filter((q) => q && typeof q === 'object')
    .map((q) => normaliseQuestion(q, defaults));

  const empties = questions.filter((q) => !q.question).length;
  if (empties) {
    showToast('warn', `${empties} entr${empties === 1 ? 'y has' : 'ies have'} no question text — fill them in or delete the cards.`);
  }

  renderCards();
  showToast('success', `Parsed ${questions.length} question(s). Review and edit before sending.`);
}

// ---------------------------------------------------------------------------
// Card rendering
// ---------------------------------------------------------------------------

/** Grows a textarea to fit its content so nothing needs an inner scrollbar. */
function autoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.max(textarea.scrollHeight + 2, 70) + 'px';
}

/**
 * wireAutoResize — keeps a textarea sized to its content as it is edited.
 * The initial measurement is NOT done here: scrollHeight is only meaningful
 * once the node is in the document, and a requestAnimationFrame callback never
 * runs at all while the tab is in the background — which would leave a curator
 * who opened the dashboard in a background tab with the scrollbars this layout
 * exists to avoid. renderCards() does the first pass instead, after appending.
 */
function wireAutoResize(textarea) {
  ['input', 'change'].forEach((event) => textarea.addEventListener(event, () => autoResize(textarea)));
}

/** Sizes every textarea in the card list to fit its content. */
function resizeAllTextareas() {
  $('cardsContainer')
    .querySelectorAll('.question-textarea-vertical, .explanation-textarea-vertical')
    .forEach(autoResize);
}

/** A small labelled input inside the card's metadata row. */
function metaInput(question, field, placeholder, title) {
  return el('input', {
    type: 'text',
    class: 'card-meta-input',
    value: question[field] || '',
    placeholder,
    title,
    oninput: (event) => { question[field] = event.target.value; }
  });
}

/** A small labelled select inside the card's metadata row. */
function metaSelect(question, field, values, title) {
  const select = el('select', { class: 'card-meta-input', title },
    values.map((v) => el('option', { value: v, text: v })));
  select.value = values.includes(question[field]) ? question[field] : values[0];
  question[field] = select.value;
  select.addEventListener('change', (event) => { question[field] = event.target.value; });
  return select;
}

/** Builds one editable question card. */
function createCard(question, index) {
  const card = el('div', { class: 'question-card-vertical' });

  // ---- Options with a radio for the correct answer -----------------------
  const optionRows = ['A', 'B', 'C', 'D'].map((letter) => {
    const key = 'option_' + letter.toLowerCase();

    const radio = el('input', {
      type: 'radio',
      name: 'correct_' + index,
      value: letter,
      class: 'option-radio',
      title: `Mark option ${letter} as the correct answer`
    });
    radio.checked = question.correct_answer === letter;

    const row = el('div', {
      class: 'option-row-vertical' + (question.correct_answer === letter ? ' correct' : ''),
      dataset: { letter }
    }, [
      el('label', { class: 'option-radio-label' }, [
        radio,
        el('span', { class: 'option-letter-badge', text: letter })
      ]),
      el('input', {
        type: 'text',
        class: 'option-input-vertical',
        value: question[key] || '',
        placeholder: `Option ${letter} text`,
        oninput: (event) => { question[key] = event.target.value; }
      })
    ]);

    radio.addEventListener('change', () => {
      question.correct_answer = letter;
      card.querySelectorAll('.option-row-vertical').forEach((r) => {
        r.classList.toggle('correct', r.dataset.letter === letter);
      });
      card.querySelector('.correct-letter-display').textContent = letter;
    });

    return row;
  });

  // ---- Question and explanation ------------------------------------------
  const questionArea = el('textarea', {
    class: 'question-textarea-vertical',
    rows: '4',
    placeholder: 'Enter the question text and any statements…',
    oninput: (event) => { question.question = event.target.value; }
  });
  questionArea.value = question.question || '';

  const explanationArea = el('textarea', {
    class: 'explanation-textarea-vertical',
    rows: '3',
    placeholder: 'Enter the detailed explanation…',
    oninput: (event) => { question.explanation = event.target.value; }
  });
  explanationArea.value = question.explanation || '';

  wireAutoResize(questionArea);
  wireAutoResize(explanationArea);

  // ---- Assemble -----------------------------------------------------------
  card.append(
    el('div', { class: 'card-header-bar' }, [
      el('span', { class: 'card-number-badge', text: `Question #${index + 1}` }),
      el('div', { class: 'card-meta-inputs' }, [
        metaInput(question, 'date', 'Date (DD-MM-YYYY)', 'Publication date — becomes the #DD_MM_YYYY hashtag'),
        metaInput(question, 'newspaper', 'Newspaper', 'Source publication — becomes the #Newspaper hashtag'),
        metaInput(question, 'topic', 'Topic', 'Sub-topic inside the subject'),
        metaSelect(question, 'difficulty', DIFFICULTIES, 'Difficulty level'),
        metaSelect(question, 'status', STATUSES, 'Workflow status on upload'),
        metaInput(question, 'tags', 'Tags', 'Comma-separated keywords for search and revision'),
        metaInput(question, 'source_url', 'Source URL', 'Link to the article this came from')
      ]),
      el('button', {
        class: 'btn-card-delete',
        title: 'Remove this question from the batch',
        text: '🗑️ Delete',
        onclick: () => {
          questions.splice(index, 1);
          renderCards();
          showToast('info', 'Question removed from the batch.');
        }
      })
    ]),

    el('div', { class: 'card-section' }, [
      el('label', { class: 'section-label', text: '📝 Question Prompt' }),
      questionArea
    ]),

    el('div', { class: 'card-section' }, [
      el('label', { class: 'section-label', text: '🔘 Options & Correct Answer' }),
      el('div', { class: 'options-vertical-list' }, optionRows)
    ]),

    el('div', { class: 'card-section' }, [
      el('label', { class: 'section-label', text: '💡 Explanation' }),
      explanationArea
    ]),

    el('div', { class: 'card-footer-bar' }, [
      el('span', { class: 'correct-summary-tag' }, [
        '✓ Correct Answer: Option ',
        el('strong', { class: 'correct-letter-display', text: question.correct_answer })
      ]),
      el('span', { text: 'APPSC Format' })
    ])
  );

  return card;
}

/** Repaints the card list and the counter. */
function renderCards() {
  const container = $('cardsContainer');
  $('cardCount').textContent = `(${questions.length})`;
  $('sendToSheetBtn').disabled = questions.length === 0;

  if (!questions.length) {
    replaceChildren(container, emptyState(
      '📋',
      'Paste JSON on the left and click Parse & Preview',
      'Questions appear here as editable cards before anything is written to the sheet'
    ));
    return;
  }

  replaceChildren(container, ...questions.map((q, i) => createCard(q, i)));

  // The cards are in the document now, so scrollHeight is measurable.
  resizeAllTextareas();
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/**
 * validateBatch — client-side pre-flight so obvious problems are caught before
 * a round trip. The server validates independently; this is for fast feedback.
 *
 * @returns {string|null} An error message, or null when the batch is fine
 */
function validateBatch(subject) {
  if (!subject) return 'Choose a target subject first.';
  if (!questions.length) return 'There are no question cards to send.';

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q.question.trim()) return `Question #${i + 1} has no question text.`;
    if (!['A', 'B', 'C', 'D'].includes(q.correct_answer)) return `Question #${i + 1} has no correct answer selected.`;
    for (const letter of ['a', 'b', 'c', 'd']) {
      if (!String(q['option_' + letter] || '').trim()) {
        return `Question #${i + 1} is missing option ${letter.toUpperCase()}.`;
      }
    }
  }
  return null;
}

/** Pushes the batch to the sheet through the authenticated API. */
async function sendToSheet() {
  const subject = $('subjectSelect').value;
  const button = $('sendToSheetBtn');

  const problem = validateBatch(subject);
  if (problem) {
    showToast('error', problem);
    return;
  }

  button.disabled = true;
  button.textContent = 'Sending…';

  try {
    const result = await api('/api/questions', {
      method: 'POST',
      body: {
        subject,
        questions,
        // Attribution is taken from the verified token server-side, not from here.
        skipDuplicates: $('skipDuplicates').checked
      }
    });

    const added = result.addedCount || 0;
    const skipped = result.skippedCount || 0;

    if (added > 0) {
      showToast('success', `✅ ${added} question(s) added to "${subject}"` + (skipped ? ` · ${skipped} duplicate(s) skipped` : ''));
      questions = [];
      $('jsonInput').value = '';
      renderCards();
    } else if (skipped > 0) {
      showToast('warn', `Nothing added — all ${skipped} question(s) already exist in the bank.`);
    } else {
      showToast('warn', result.message || 'Nothing was added.');
    }

    // Name the duplicates so the curator can see exactly what was dropped.
    (result.skipped || []).forEach((s) => console.info('[skipped duplicate]', s.question));
  } catch (err) {
    showToast('error', err.message, 9000);
  } finally {
    button.disabled = questions.length === 0;
    button.textContent = '🚀 Send to Sheet';
  }
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

/** A realistic two-question batch, so the format is obvious at a glance. */
const SAMPLE_JSON = {
  subject: 'Environment',
  date: '05-09-2026',
  newspaper: 'The Hindu',
  questions: [
    {
      question: 'With reference to wetlands in India, consider the following statements:\n' +
        '1. Wetlands are notified under the Wetlands (Conservation and Management) Rules, 2017.\n' +
        '2. Every Ramsar site in India is also a National Park.\n' +
        '3. Wetlands act as natural buffers against flooding.\n\n' +
        'Which of the statements given above are correct?',
      option_a: '1 and 2 only',
      option_b: '2 and 3 only',
      option_c: '1 and 3 only',
      option_d: '1, 2 and 3',
      correct_answer: 'C',
      explanation: 'Statements 1 and 3 are correct. Statement 2 is wrong — Ramsar designation is independent of ' +
        'protected-area status, and many Ramsar sites in India are not National Parks.',
      topic: 'Biodiversity & Conservation',
      difficulty: 'Medium',
      tags: 'wetlands, ramsar, conservation'
    },
    {
      question: 'The term "Blue Carbon" most appropriately refers to which of the following?',
      option_a: 'Carbon dioxide dissolved in deep ocean trenches',
      option_b: 'Carbon captured and stored by coastal and marine ecosystems',
      option_c: 'Carbon credits traded on international exchanges',
      option_d: 'Carbon emitted by shipping and maritime transport',
      correct_answer: 'B',
      explanation: 'Blue Carbon is the carbon captured and stored by coastal and marine ecosystems such as ' +
        'mangroves, salt marshes and seagrass meadows, which sequester carbon far faster per hectare than forests.',
      topic: 'Climate Change',
      difficulty: 'Easy',
      tags: 'blue carbon, mangroves, climate'
    }
  ]
};

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/** Populates the subject, difficulty and status dropdowns. */
function initSelects() {
  replaceChildren($('subjectSelect'),
    el('option', { value: '', text: '— Select Subject —' }),
    ...SUBJECTS.map((s) => el('option', { value: s, text: s }))
  );
  replaceChildren($('defaultDifficulty'), ...DIFFICULTIES.map((d) => el('option', { value: d, text: d })));
  $('defaultDifficulty').value = 'Medium';

  replaceChildren($('defaultStatus'), ...STATUSES.map((s) => el('option', { value: s, text: s })));
  $('defaultStatus').value = 'Draft';
}

initDashboard({
  page: 'upload',
  onReady: async () => {
    initSelects();
    renderCards();

    $('parseBtn').addEventListener('click', parseJson);

    $('clearBtn').addEventListener('click', () => {
      questions = [];
      $('jsonInput').value = '';
      hideError();
      renderCards();
      showToast('info', 'Cleared.');
    });

    $('sampleBtn').addEventListener('click', () => {
      $('jsonInput').value = JSON.stringify(SAMPLE_JSON, null, 2);
      $('subjectSelect').value = 'Environment';
      hideError();
      showToast('info', 'Sample loaded — click Parse & Preview.');
    });

    $('sendToSheetBtn').addEventListener('click', sendToSheet);

    // Ctrl/Cmd+Enter in the textarea parses, which is the common next action.
    $('jsonInput').addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') parseJson();
    });

    // Text metrics change when the webfont finishes loading, and a tab that was
    // in the background may have been measured before it was ever laid out.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(resizeAllTextareas);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) resizeAllTextareas();
    });
    window.addEventListener('resize', resizeAllTextareas);
  }
});
