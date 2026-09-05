// ============================================================================
// Analytics dashboard (dashboard/analytics.js)
// ============================================================================
// Answers "how many questions do we have, where, and how long will they last".
// One /api/analytics call returns everything; this file only renders it.
//
// Every value is written with textContent (via the `el` helper), so a question
// or curator name containing HTML can never become markup on this page.
// ============================================================================

import {
  initDashboard, api, el, replaceChildren, panel, statCard, barRow,
  emptyState, pill, statusTone, difficultyTone, num, pct, showToast, $
} from './shared.js';

/** Latest analytics payload, kept so re-renders do not need a refetch. */
let analytics = null;

/** Renders a centred spinner into a container. */
function loading(container, message) {
  replaceChildren(container, el('div', { class: 'loading-row' }, [
    el('div', { class: 'spinner' }),
    el('span', { text: message })
  ]));
}

/** Top-of-page headline metrics. */
function renderStats(data) {
  const t = data.totals;

  // Subjects with fewer than 10 pending questions are the ones about to run dry.
  const lowStockTone = t.lowStockSubjects > 0 ? 'warn' : 'ok';
  const emptyTone = t.emptySubjects > 0 ? 'danger' : 'ok';

  replaceChildren($('statGrid'),
    statCard('Total Questions', num(t.total), { sub: `across ${t.subjects} subject sheets` }),
    statCard('Posted', num(t.posted), { tone: 'ok', sub: `${t.completionPct}% of the bank` }),
    statCard('Pending', num(t.pending), { tone: 'warn', sub: 'not yet sent to Telegram' }),
    statCard('Approved & Ready', num(t.approved), { tone: 'ok', sub: 'cleared for posting' }),
    statCard('Scheduled', num(t.scheduled), { tone: 'info', sub: 'queued with a target time' }),
    statCard('Low Stock Subjects', num(t.lowStockSubjects), { tone: lowStockTone, sub: 'fewer than 10 pending' }),
    statCard('Empty Subjects', num(t.emptySubjects), { tone: emptyTone, sub: 'no questions at all' }),
    statCard('Active Subjects', num(t.activeSubjects), { tone: 'info', sub: 'marked Active in Config' })
  );
}

/**
 * subjectTable — the core per-subject breakdown: totals, posted, pending, a
 * visual posted/pending split, workflow counts and estimated days of runway.
 */
function subjectTable(subjects) {
  const rows = subjects
    .slice()
    .sort((a, b) => b.total - a.total)
    .map((s) => {
      const postedWidth = s.total ? (s.posted / s.total) * 100 : 0;

      // Runway is null when the subject is inactive or has no cron cadence.
      const runwayCell = s.daysOfRunway === null
        ? el('span', { class: 'muted', text: '—' })
        : pill(
            s.daysOfRunway < 1 ? '<1 day' : `${s.daysOfRunway} days`,
            s.daysOfRunway < 2 ? 'danger' : s.daysOfRunway < 7 ? 'warn' : 'ok'
          );

      return el('tr', {}, [
        el('td', {}, [
          el('div', { text: s.subject, style: 'font-weight:600' }),
          el('div', { class: 'muted', style: 'font-size:0.76rem;margin-top:2px',
            text: s.active
              ? `Active · cron ${s.cron || 'not set'} · ${s.batchSize} per batch`
              : 'Paused — Active is not YES in the Config tab' })
        ]),
        el('td', { class: 'num', text: num(s.total) }),
        el('td', { class: 'num', text: num(s.posted) }),
        el('td', { class: 'num', text: num(s.pending) }),
        el('td', { style: 'min-width:150px' }, [
          el('div', { class: 'stack-track', title: `${s.posted} posted · ${s.pending} pending` }, [
            el('div', { class: 'stack-seg posted', style: `width:${postedWidth}%` }),
            el('div', { class: 'stack-seg pending', style: `width:${100 - postedWidth}%` })
          ]),
          el('div', { class: 'muted', style: 'font-size:0.74rem;margin-top:4px',
            text: `${pct(s.posted, s.total)} complete` })
        ]),
        el('td', { class: 'num', text: num(s.approved) }),
        el('td', { class: 'num', text: num(s.draft) }),
        el('td', {}, [runwayCell]),
        el('td', { class: 'muted', style: 'font-size:0.78rem', text: s.lastPostedAt || '—' })
      ]);
    });

  return el('div', { class: 'table-wrap' }, [
    el('table', { class: 'data-table' }, [
      el('thead', {}, [
        el('tr', {}, [
          'Subject', 'Total', 'Posted', 'Pending', 'Progress', 'Approved', 'Draft', 'Runway', 'Last Posted'
        ].map((h) => el('th', { text: h })))
      ]),
      el('tbody', {}, rows.length ? rows : [
        el('tr', {}, [el('td', { colspan: '9' }, [emptyState('📭', 'No subjects found in the spreadsheet.')])])
      ])
    ])
  ]);
}

/** Horizontal bar chart of pending questions per subject. */
function pendingChart(subjects) {
  const sorted = subjects.filter((s) => s.total > 0).sort((a, b) => b.pending - a.pending);
  if (!sorted.length) return emptyState('📊', 'No question data to chart yet.');

  const max = Math.max(...sorted.map((s) => s.pending), 1);
  return el('div', {}, sorted.map((s) =>
    barRow(s.subject, s.pending, max, {
      tone: s.pending === 0 ? 'danger' : s.pending < 10 ? 'warn' : 'ok'
    })
  ));
}

/** Status and difficulty distributions, side by side. */
function breakdownPanels(data) {
  const statusEntries = Object.entries(data.statusBreakdown).filter(([, v]) => v > 0);
  const statusMax = Math.max(...statusEntries.map(([, v]) => v), 1);

  const diffEntries = Object.entries(data.difficultyBreakdown).filter(([, v]) => v > 0);
  const diffMax = Math.max(...diffEntries.map(([, v]) => v), 1);

  const statusBody = statusEntries.length
    ? el('div', {}, statusEntries.map(([status, count]) =>
        barRow(status, count, statusMax, { tone: statusTone(status) })))
    : emptyState('🗂️', 'No status data yet.');

  const diffBody = diffEntries.length
    ? el('div', {}, diffEntries.map(([level, count]) =>
        barRow(level, count, diffMax, { tone: difficultyTone(level) })))
    : emptyState('🎚️', 'No difficulty data yet.');

  return el('div', { class: 'two-col' }, [
    panel('Workflow Status', 'Where questions sit in the Draft → Approved → Posted pipeline', statusBody),
    panel('Difficulty Mix', 'Balance of Easy, Medium and Hard questions in the bank', diffBody)
  ]);
}

/**
 * timelineChart — column chart of questions posted (or added) per day.
 * Both series come back as [{day, count}] sorted chronologically.
 */
function timelineChart(series, tone) {
  if (!series.length) return emptyState('📈', 'No dated activity recorded yet.');

  const max = Math.max(...series.map((p) => p.count), 1);
  const columns = series.map((point) => el('div', {
    class: 'spark-col' + (tone === 'added' ? ' added' : ''),
    style: `height:${Math.max(2, (point.count / max) * 100)}%`,
    title: `${point.day}: ${point.count}`
  }));

  return el('div', {}, [
    el('div', { class: 'spark' }, columns),
    el('div', { class: 'spark-axis' }, [
      el('span', { text: series[0].day }),
      el('span', { text: `peak ${max}/day` }),
      el('span', { text: series[series.length - 1].day })
    ])
  ]);
}

/** Curator contribution leaderboard. */
function curatorTable(curators) {
  if (!curators.length) return emptyState('👤', 'No curator attribution recorded yet.',
    'The Added By column fills in automatically when questions are uploaded from the dashboard.');

  return el('div', { class: 'table-wrap' }, [
    el('table', { class: 'data-table' }, [
      el('thead', {}, [el('tr', {}, ['Curator', 'Uploaded', 'Of Which Posted', 'Share'].map((h) => el('th', { text: h })))]),
      el('tbody', {}, curators.map((c) => el('tr', {}, [
        el('td', { text: c.curator }),
        el('td', { class: 'num', text: num(c.added) }),
        el('td', { class: 'num', text: num(c.posted) }),
        el('td', { class: 'num', text: pct(c.posted, c.added) })
      ])))
    ])
  ]);
}

/** Most-used source publications. */
function newspaperTable(newspapers) {
  if (!newspapers.length) return emptyState('📰', 'No newspaper sources recorded yet.');
  const max = Math.max(...newspapers.map((n) => n.count), 1);
  return el('div', {}, newspapers.map((n) => barRow(n.newspaper, n.count, max, { tone: 'info' })));
}

/**
 * qualityPanel — data hygiene counters. These are the fields that are easy to
 * forget on upload and painful to backfill later.
 */
function qualityPanel(issues, total) {
  const checks = [
    ['💡', 'Missing explanation', issues.missingExplanation, 'Telegram quiz polls show the explanation on tap — without it the poll teaches nothing.'],
    ['🔘', 'Incomplete options', issues.missingOptions, 'A poll with a blank option cannot be sent to Telegram at all.'],
    ['📅', 'Missing date', issues.missingDate, 'The date drives the #DD_MM_YYYY hashtag on the post.'],
    ['🏷️', 'Missing topic', issues.missingTopic, 'Topic makes revision filtering possible inside a subject.'],
    ['♊', 'Duplicate questions', issues.duplicates, 'Rows whose normalised question text already appears elsewhere in the bank.']
  ];

  return el('div', { class: 'check-list' }, checks.map(([icon, title, count, detail]) => el('div', { class: 'check-item' }, [
    el('span', { class: 'check-icon', text: count > 0 ? icon : '✅' }),
    el('div', {}, [
      el('div', { class: 'check-title', text: title }),
      el('div', { class: 'check-detail', text: detail })
    ]),
    pill(count > 0 ? `${num(count)} of ${num(total)}` : 'clean', count > 0 ? (count > total * 0.2 ? 'danger' : 'warn') : 'ok')
  ])));
}

/** Fetches and renders the whole page. */
async function load() {
  const panels = $('panels');
  loading(panels, 'Reading the whole question bank from Google Sheets…');

  const button = $('refreshBtn');
  button.disabled = true;

  try {
    analytics = await api('/api/analytics');
    if (!analytics) throw new Error('The sheet returned no analytics data.');

    renderStats(analytics);
    $('generatedAt').textContent = 'Generated ' + analytics.generatedAt;

    replaceChildren(panels,
      panel('Subject Breakdown',
        'Total, posted and pending per subject, with the estimated days of content left at the configured cadence',
        subjectTable(analytics.subjects)),

      panel('Pending Questions by Subject',
        'Longest bars have the deepest reserve; short bars need restocking first',
        pendingChart(analytics.subjects)),

      breakdownPanels(analytics),

      el('div', { class: 'two-col' }, [
        panel('Posting Activity', 'Questions sent to Telegram per day (last 60 days with activity)',
          timelineChart(analytics.postedTimeline, 'posted')),
        panel('Upload Activity', 'Questions added through the dashboard per day',
          timelineChart(analytics.addedTimeline, 'added'))
      ]),

      el('div', { class: 'two-col' }, [
        panel('Curator Contributions', 'Who uploaded what, from the Added By column', curatorTable(analytics.curators)),
        panel('Source Publications', 'Where the questions come from', newspaperTable(analytics.newspapers))
      ]),

      panel('Data Quality', 'Fields that are missing or inconsistent across the bank',
        qualityPanel(analytics.qualityIssues, analytics.totals.total))
    );
  } catch (err) {
    replaceChildren(panels, emptyState('⚠️', 'Could not load analytics.', err.message));
    showToast('error', err.message, 9000);
  } finally {
    button.disabled = false;
  }
}

initDashboard({
  page: 'analytics',
  onReady: async () => {
    $('refreshBtn').addEventListener('click', load);
    await load();
  }
});
