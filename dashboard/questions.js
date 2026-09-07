// ============================================================================
// Question bank dashboard (dashboard/questions.js)
// ============================================================================
// Browse, search, filter, edit, approve/reject and delete questions across
// every subject. Reads go through /api/questions (server-side paging so a
// 10,000-row bank never lands in the browser at once); writes go through the
// allowlisted update / delete / bulk-status endpoints.
// ============================================================================

import {
  initDashboard, api, el, replaceChildren, statCard, emptyState, pill,
  ASSIGNABLE_STATUSES, statusTone, difficultyTone, num, truncate, showToast, $,
  SUBJECTS, STATUSES, DIFFICULTIES
} from './shared.js';

/** Current filter state; mirrored into the query string of /api/questions. */
const filters = {
  subject: 'all',
  status: '',
  posted: '',
  difficulty: '',
  search: '',
  page: 1,
  pageSize: 50
};

/** The rows currently on screen. */
let rows = [];

/** Question IDs the curator has ticked, for bulk actions. */
const selected = new Set();

/** Pagination metadata from the last response. */
let pageInfo = { total: 0, page: 1, totalPages: 1 };

// ---------------------------------------------------------------------------
// Filter controls
// ---------------------------------------------------------------------------

/** Fills a <select> with options, including a leading "any" choice. */
function fillSelect(select, values, anyLabel) {
  replaceChildren(select,
    anyLabel ? el('option', { value: '', text: anyLabel }) : null,
    ...values.map((v) => el('option', { value: v, text: v }))
  );
}

/** Wires every filter control up to the loader. */
function initFilters() {
  const subjectSelect = $('filterSubject');
  replaceChildren(subjectSelect,
    el('option', { value: 'all', text: 'All subjects' }),
    ...SUBJECTS.map((s) => el('option', { value: s, text: s }))
  );

  fillSelect($('filterStatus'), STATUSES, 'Any status');
  fillSelect($('filterDifficulty'), DIFFICULTIES, 'Any difficulty');
  fillSelect($('bulkStatus'), ASSIGNABLE_STATUSES, null);
  $('bulkStatus').value = 'Approved';

  $('applyBtn').addEventListener('click', () => { readFilters(); filters.page = 1; load(); });
  $('resetBtn').addEventListener('click', () => {
    subjectSelect.value = 'all';
    $('filterStatus').value = '';
    $('filterPosted').value = '';
    $('filterDifficulty').value = '';
    $('filterSearch').value = '';
    readFilters();
    filters.page = 1;
    load();
  });

  // Enter in the search box applies immediately.
  $('filterSearch').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { readFilters(); filters.page = 1; load(); }
  });

  $('filterPageSize').addEventListener('change', () => { readFilters(); filters.page = 1; load(); });

  $('prevBtn').addEventListener('click', () => {
    if (filters.page > 1) { filters.page--; load(); }
  });
  $('nextBtn').addEventListener('click', () => {
    if (filters.page < pageInfo.totalPages) { filters.page++; load(); }
  });

  $('bulkApplyBtn').addEventListener('click', applyBulkStatus);
  $('bulkDeleteBtn').addEventListener('click', applyBulkDelete);
}

/** Copies the current control values into the filter state. */
function readFilters() {
  filters.subject = $('filterSubject').value;
  filters.status = $('filterStatus').value;
  filters.posted = $('filterPosted').value;
  filters.difficulty = $('filterDifficulty').value;
  filters.search = $('filterSearch').value.trim();
  filters.pageSize = Number($('filterPageSize').value) || 50;
}

// ---------------------------------------------------------------------------
// Table rendering
// ---------------------------------------------------------------------------

/** Recomputes the selection counter and enables/disables the bulk button. */
function refreshSelectionUi() {
  $('selectionCount').textContent = `${selected.size} selected`;

  // Only an empty selection disables these. They used to be disabled whenever
  // the subject filter was "All subjects", because the API writes one sheet tab
  // at a time — so with 30 rows ticked the buttons sat there looking usable and
  // did nothing at all when clicked, with the reason in small grey text. Every
  // row already knows its own subject, so the selection is grouped by subject
  // and sent as one call per tab instead.
  const unusable = selected.size === 0;
  $('bulkApplyBtn').disabled = unusable;
  $('bulkDeleteBtn').disabled = unusable;
  $('bulkDeleteBtn').textContent = selected.size
    ? `🗑 Delete ${selected.size} selected`
    : '🗑 Delete selected';
}

/**
 * groupSelectionBySubject — the ticked questions, split by the tab they live in.
 *
 * Bulk writes address one sheet tab per call. Rather than making the curator
 * narrow the filter first, the selection is split here.
 *
 * @returns {{groups: Map<string, Array<string>>, unknown: Array<string>}}
 *   `unknown` holds ids whose row is no longer on screen, so they can be
 *   reported rather than quietly dropped from the count.
 */
function groupSelectionBySubject() {
  const bySubject = new Map();
  const unknown = [];

  for (const id of selected) {
    const row = rows.find((q) => q.question_id === id);
    if (!row || !row.subject) { unknown.push(id); continue; }
    if (!bySubject.has(row.subject)) bySubject.set(row.subject, []);
    bySubject.get(row.subject).push(id);
  }
  return { groups: bySubject, unknown };
}

/** Builds one table row for a question. */
function questionRow(q) {
  const checkbox = el('input', {
    type: 'checkbox',
    checked: selected.has(q.question_id),
    title: 'Select for bulk action',
    onchange: (event) => {
      if (event.target.checked) selected.add(q.question_id);
      else selected.delete(q.question_id);
      refreshSelectionUi();
    }
  });

  const answerText = q['option_' + q.correct_answer.toLowerCase()] || '';

  return el('tr', {}, [
    el('td', {}, [checkbox]),
    el('td', {}, [
      el('div', { class: 'inline-code', text: q.question_id || '—' }),
      el('div', { class: 'muted', style: 'font-size:0.74rem;margin-top:4px', text: q.subject })
    ]),
    el('td', { class: 'wrap' }, [
      // The full text, never an excerpt. A multi-statement APPSC question is
      // routinely longer than 230 characters, and cutting it off hid the very
      // part a curator needs to read before approving: the statements, and the
      // "which of the above" line that decides the answer. white-space:pre-wrap
      // keeps the line breaks the question was written with.
      el('div', { text: q.question_text, style: 'line-height:1.55; white-space:pre-wrap' }),
      el('div', { class: 'muted', style: 'font-size:0.76rem;margin-top:5px; white-space:pre-wrap',
        text: `✔ ${q.correct_answer} — ${answerText}` }),
      q.tags ? el('div', { class: 'muted', style: 'font-size:0.74rem;margin-top:3px', text: '🏷️ ' + q.tags }) : null
    ]),
    el('td', {}, [q.topic ? el('span', { text: q.topic }) : el('span', { class: 'muted', text: '—' })]),
    el('td', {}, [pill(q.difficulty, difficultyTone(q.difficulty))]),
    el('td', {}, [pill(q.status, statusTone(q.status))]),
    el('td', {}, [
      pill(q.posted === 'YES' ? 'Posted' : 'Pending', q.posted === 'YES' ? 'ok' : 'muted'),
      q.posted_at ? el('div', { class: 'muted', style: 'font-size:0.72rem;margin-top:4px', text: q.posted_at }) : null
    ]),
    el('td', { class: 'muted', style: 'font-size:0.76rem' }, [
      el('div', { text: q.added_by || '—' }),
      el('div', { text: q.added_at || '' })
    ]),
    el('td', {}, [
      el('div', { class: 'row-actions' }, [
        el('button', { class: 'btn-icon', title: 'Edit this question', text: '✏️', onclick: () => openEditor(q) }),
        el('button', { class: 'btn-icon danger', title: 'Delete this question', text: '🗑️', onclick: () => confirmDelete(q) })
      ])
    ])
  ]);
}

/** Renders the table body from the current `rows`. */
function renderTable() {
  const area = $('tableArea');

  if (!rows.length) {
    replaceChildren(area, emptyState('🔍', 'No questions match these filters.',
      'Try clearing the search box or switching to All subjects.'));
    return;
  }

  const selectAll = el('input', {
    type: 'checkbox',
    title: 'Select every row on this page',
    onchange: (event) => {
      rows.forEach((q) => {
        if (event.target.checked) selected.add(q.question_id);
        else selected.delete(q.question_id);
      });
      renderTable();
      refreshSelectionUi();
    }
  });

  replaceChildren(area, el('table', { class: 'data-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', {}, [selectAll]),
        ...['Question ID', 'Question', 'Topic', 'Difficulty', 'Status', 'Posted', 'Added By', ''].map((h) => el('th', { text: h }))
      ])
    ]),
    el('tbody', {}, rows.map(questionRow))
  ]));
}

/** Summary tiles above the table, computed from the current page + total. */
function renderStats() {
  const postedOnPage = rows.filter((q) => q.posted === 'YES').length;
  const approvedOnPage = rows.filter((q) => q.status === 'Approved').length;
  const needsWork = rows.filter((q) => !q.explanation || !q.topic).length;

  replaceChildren($('statGrid'),
    statCard('Matching Questions', num(pageInfo.total), { sub: 'across all pages of this filter' }),
    statCard('On This Page', num(rows.length), { tone: 'info', sub: `page ${pageInfo.page} of ${pageInfo.totalPages}` }),
    statCard('Posted (page)', num(postedOnPage), { tone: 'ok' }),
    statCard('Approved (page)', num(approvedOnPage), { tone: 'ok' }),
    statCard('Needs Detail (page)', num(needsWork), { tone: needsWork ? 'warn' : 'ok', sub: 'missing explanation or topic' })
  );
}

/** Updates the pagination footer. */
function renderPagination() {
  const from = pageInfo.total === 0 ? 0 : (pageInfo.page - 1) * filters.pageSize + 1;
  const to = Math.min(pageInfo.page * filters.pageSize, pageInfo.total);

  $('paginationInfo').textContent = `Showing ${num(from)}–${num(to)} of ${num(pageInfo.total)}`;
  $('pageLabel').textContent = `Page ${pageInfo.page} / ${pageInfo.totalPages}`;
  $('prevBtn').disabled = pageInfo.page <= 1;
  $('nextBtn').disabled = pageInfo.page >= pageInfo.totalPages;
  $('resultSummary').textContent = `${num(pageInfo.total)} question(s) match`;
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

/** Fetches the current page of questions and repaints everything. */
async function load() {
  const area = $('tableArea');
  replaceChildren(area, el('div', { class: 'loading-row' }, [
    el('div', { class: 'spinner' }),
    el('span', { text: 'Loading questions…' })
  ]));

  try {
    const data = await api('/api/questions', { query: filters });
    rows = data.questions || [];
    pageInfo = { total: data.total || 0, page: data.page || 1, totalPages: data.totalPages || 1 };

    // Drop selections that are no longer visible so a bulk action cannot hit
    // a row the curator can no longer see.
    const visible = new Set(rows.map((q) => q.question_id));
    [...selected].forEach((id) => { if (!visible.has(id)) selected.delete(id); });

    renderStats();
    renderTable();
    renderPagination();
    refreshSelectionUi();
  } catch (err) {
    replaceChildren(area, emptyState('⚠️', 'Could not load questions.', err.message));
    showToast('error', err.message, 9000);
  }
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

/** Builds a labelled input for the editor modal. */
function editorField(label, input, full = false) {
  return el('div', { class: 'editor-field' + (full ? ' full' : '') }, [
    el('label', { text: label }),
    input
  ]);
}

/**
 * openEditor — modal for correcting one question.
 * Only the fields the server allowlists are sent; Posted, timestamps and the
 * audit columns are deliberately not editable from here.
 */
function openEditor(q) {
  const inputs = {
    question: el('textarea', { class: 'field-input', text: q.question_text }),
    option_a: el('input', { class: 'field-input', value: q.option_a }),
    option_b: el('input', { class: 'field-input', value: q.option_b }),
    option_c: el('input', { class: 'field-input', value: q.option_c }),
    option_d: el('input', { class: 'field-input', value: q.option_d }),
    correct_answer: el('select', { class: 'field-select' },
      ['A', 'B', 'C', 'D'].map((l) => el('option', { value: l, text: 'Option ' + l, selected: q.correct_answer === l }))),
    explanation: el('textarea', { class: 'field-input', text: q.explanation }),
    topic: el('input', { class: 'field-input', value: q.topic, placeholder: 'e.g. Fundamental Rights' }),
    difficulty: el('select', { class: 'field-select' },
      DIFFICULTIES.map((d) => el('option', { value: d, text: d, selected: q.difficulty === d }))),
    // Posted and Sending are the poster's to write — it sets them together with
    // the Posted column and the message id. Offering them here let a curator
    // set Status alone, leaving the row claiming to be posted while still
    // eligible, so it went out again. The current one is shown when it IS one
    // of those, disabled, so the editor still tells the truth about the row.
    status: el('select', { class: 'field-select' },
      (ASSIGNABLE_STATUSES.includes(q.status) ? ASSIGNABLE_STATUSES : [q.status, ...ASSIGNABLE_STATUSES])
        .map((s) => el('option', {
          value: s,
          text: ASSIGNABLE_STATUSES.includes(s) ? s : `${s} (set by the poster)`,
          selected: q.status === s,
          disabled: !ASSIGNABLE_STATUSES.includes(s)
        }))),
    tags: el('input', { class: 'field-input', value: q.tags, placeholder: 'comma, separated, keywords' }),
    date: el('input', { class: 'field-input', value: q.date, placeholder: 'DD-MM-YYYY' }),
    newspaper: el('input', { class: 'field-input', value: q.newspaper, placeholder: 'The Hindu' }),
    source_url: el('input', { class: 'field-input', value: q.source_url, placeholder: 'https://…' }),
    review_notes: el('input', { class: 'field-input', value: q.review_notes, placeholder: 'QA remarks' })
  };

  // Selects need their value set after construction for reliability.
  inputs.correct_answer.value = q.correct_answer;
  inputs.difficulty.value = q.difficulty;
  inputs.status.value = q.status;

  const saveBtn = el('button', { class: 'btn btn-primary', text: 'Save Changes' });
  const backdrop = el('div', { class: 'editor-backdrop' });
  const close = () => backdrop.remove();

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const fields = {};
      Object.entries(inputs).forEach(([key, input]) => { fields[key] = input.value.trim(); });

      await api('/api/questions/update', {
        method: 'POST',
        body: {
          subject: q.subject,
          questionId: q.question_id,
          fields,
          // Fallback addressing for rows with no Question ID. The sheet only
          // uses these when the text at that row still matches.
          rowNumber: q.excel_row,
          verifyText: q.question_text
        }
      });

      showToast('success', `Saved ${q.question_id}`);
      close();
      await load();
    } catch (err) {
      showToast('error', err.message, 9000);
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  });

  const card = el('div', { class: 'editor-card' }, [
    el('div', { class: 'editor-head' }, [
      el('div', {}, [
        el('h3', { class: 'panel-title', text: 'Edit Question' }),
        el('p', { class: 'panel-subtitle', text: `${q.question_id} · ${q.subject}` })
      ]),
      el('button', { class: 'btn-icon', text: '×', title: 'Close', onclick: close })
    ]),
    el('div', { class: 'editor-body' }, [
      el('div', { class: 'editor-grid' }, [
        editorField('Question Text', inputs.question, true),
        editorField('Option A', inputs.option_a),
        editorField('Option B', inputs.option_b),
        editorField('Option C', inputs.option_c),
        editorField('Option D', inputs.option_d),
        editorField('Correct Answer', inputs.correct_answer),
        editorField('Explanation', inputs.explanation, true),
        editorField('Topic', inputs.topic),
        editorField('Difficulty', inputs.difficulty),
        editorField('Status', inputs.status),
        editorField('Tags', inputs.tags),
        editorField('Date', inputs.date),
        editorField('Newspaper', inputs.newspaper),
        editorField('Source URL', inputs.source_url),
        editorField('Review Notes', inputs.review_notes, true)
      ]),
      q.posted === 'YES'
        ? el('p', { class: 'hint-text',
            text: `⚠️ This question was already posted on ${q.posted_at}. Editing it will not change the Telegram poll that is already live.` })
        : null
    ]),
    el('div', { class: 'editor-foot' }, [
      el('button', { class: 'btn btn-ghost', text: 'Cancel', onclick: close }),
      saveBtn
    ])
  ]);

  // Clicking the dimmed area or pressing Escape closes the modal.
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });
  document.addEventListener('keydown', function onEsc(event) {
    if (event.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
  });

  backdrop.append(card);
  $('editorHost').append(backdrop);
}

/** Asks before permanently removing a row from the sheet. */
async function confirmDelete(q) {
  const ok = window.confirm(
    `Permanently delete this question from the "${q.subject}" sheet?\n\n` +
    `${q.question_id || '(no question id)'} — row ${q.excel_row}\n` +
    `"${truncate(q.question_text, 120)}"\n\n` +
    'The row is removed from Google Sheets and cannot be recovered from here.'
  );
  if (!ok) return;

  try {
    await api('/api/questions/delete', {
      method: 'POST',
      body: {
        subject: q.subject,
        questionId: q.question_id,
        rowNumber: q.excel_row,
        verifyText: q.question_text
      }
    });
    showToast('success', `Deleted ${q.question_id}`);
    selected.delete(q.question_id);
    await load();
  } catch (err) {
    showToast('error', err.message, 9000);
  }
}

/**
 * applyBulkDelete — permanently removes every selected question.
 *
 * Deleting one at a time meant a confirm dialog and a round trip per question,
 * so clearing a page of 29 was not realistically doable. This is one call and
 * one confirmation — which is also why the confirmation is deliberately heavy:
 * it names the count and the subject, and asks the curator to type DELETE.
 * Nothing here can be undone from the dashboard.
 */
async function applyBulkDelete() {
  const ids = [...selected];
  if (!ids.length) return;

  const { groups, unknown } = groupSelectionBySubject();
  if (!groups.size) {
    showToast('warn', 'Could not tell which subject those questions are in. Reload and try again.');
    return;
  }

  // How many of these are already live in Telegram, so the curator knows what
  // they are throwing away: deleting the row does not unsend the poll.
  const postedCount = rows.filter((q) => selected.has(q.question_id) && q.posted === 'YES').length;

  const scope = groups.size === 1
    ? `"${[...groups.keys()][0]}"`
    : `${groups.size} subjects (${[...groups.keys()].join(', ')})`;

  const typed = window.prompt(
    `Permanently delete ${ids.length - unknown.length} question(s) from ${scope}?\n\n` +
    (postedCount
      ? `⚠️ ${postedCount} of them are already posted to Telegram. Deleting the row ` +
        'here does NOT remove the poll from the channel.\n\n'
      : '') +
    'The rows are removed from Google Sheets and cannot be recovered from here.\n\n' +
    'Type DELETE to confirm:'
  );
  if (typed === null) return;
  if (typed.trim().toUpperCase() !== 'DELETE') {
    showToast('info', 'Nothing was deleted.');
    return;
  }

  const button = $('bulkDeleteBtn');
  button.disabled = true;
  button.textContent = 'Deleting…';

  let deleted = 0;
  const missing = [...unknown];
  const failures = [];

  try {
    // One call per tab. Sequential rather than parallel: each one takes a lock
    // on the sheet, so firing them together would just make them queue and
    // risk a timeout.
    for (const [subject, subjectIds] of groups) {
      try {
        const result = await api('/api/questions/bulk-delete', {
          method: 'POST',
          body: { subject, questionIds: subjectIds }
        });
        deleted += result.deletedCount || 0;
        missing.push(...(result.notFound || []));
      } catch (err) {
        // One failing tab must not hide what the others deleted.
        failures.push(`${subject}: ${err.message}`);
      }
    }

    if (failures.length) {
      showToast('error', `Deleted ${deleted}. Failed — ${failures.join('; ')}`, 12000);
    } else if (missing.length) {
      // Named, not counted: a curator who is told "27 of 29" and nothing else
      // has no way to find the two that survived.
      showToast('warn', `Deleted ${deleted}. Not found: ${missing.join(', ')}`, 12000);
    } else {
      showToast('success', `Deleted ${deleted} question(s)`);
    }

    selected.clear();
    await load();
  } finally {
    refreshSelectionUi();
  }
}

/** Applies the chosen status to every selected question in the current subject. */
async function applyBulkStatus() {
  const status = $('bulkStatus').value;
  const ids = [...selected];
  if (!ids.length) return;

  const { groups } = groupSelectionBySubject();
  if (!groups.size) {
    showToast('warn', 'Could not tell which subject those questions are in. Reload and try again.');
    return;
  }

  const button = $('bulkApplyBtn');
  button.disabled = true;
  button.textContent = 'Applying…';

  let updated = 0;
  const failures = [];

  try {
    // One call per tab, sequentially — each takes a lock on the sheet.
    for (const [subject, subjectIds] of groups) {
      try {
        const result = await api('/api/questions/status', {
          method: 'POST',
          body: { subject, questionIds: subjectIds, status }
        });
        updated += result.updatedCount ?? subjectIds.length;
      } catch (err) {
        failures.push(`${subject}: ${err.message}`);
      }
    }

    if (failures.length) {
      showToast('error', `${updated} set to ${status}. Failed — ${failures.join('; ')}`, 12000);
    } else {
      showToast('success', `${updated} question(s) set to ${status}`);
    }

    selected.clear();
    await load();
  } finally {
    button.textContent = 'Apply to selection';
    refreshSelectionUi();
  }
}

initDashboard({
  page: 'questions',
  onReady: async () => {
    initFilters();
    readFilters();
    await load();
  }
});
