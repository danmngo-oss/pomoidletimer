// ============================================================================
// history.js — the Session Log panel: a table of recent sessions plus a
// one-line summary of today (sessions, time focused, productivity, breaks).
// Read-only: it just displays state.sessions and state.breaks.
// ============================================================================
import { store } from './state.js';
import { $, el } from './ui.js';
import { fmtDuration, fmtNum } from './format.js';

// Formats a session's timestamp as e.g. "Oct 26, 5:31 PM".
const when = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// Midnight today (local time), as epoch ms. Anything after it is "today".
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function initHistory() {
  const body = $('history-body');

  function render() {
    const { sessions } = store.state;

    // -- Today's summary line --
    const today = sessions.filter((s) => s.at >= startOfToday());
    const focusMs = today.reduce((sum, s) => sum + s.focusMs, 0);
    // Productivity only counts sessions where metrics were entered;
    // time-only sessions would drag the average down unfairly.
    const measured = today.filter((s) => !s.timeOnly);
    const outputPts = measured.reduce((sum, s) => sum + s.points, 0);
    const measuredHours = measured.reduce((sum, s) => sum + s.focusMs, 0) / 3_600_000;
    const breaks = store.state.breaks.filter((b) => b.at >= startOfToday());
    const breakMs = breaks.reduce((sum, b) => sum + b.durationMs, 0);
    // Build the parts, drop the empty ones (false/0), and join with " · ".
    $('history-summary').textContent = [
      today.length ? `Today: ${today.length} session${today.length > 1 ? 's' : ''} · ${fmtDuration(focusMs)} focused` : 'No sessions today yet',
      measuredHours && `${fmtNum(outputPts / measuredHours)} pts/hr`,
      breaks.length && `${breaks.length} break${breaks.length > 1 ? 's' : ''} (${fmtDuration(breakMs)})`,
    ].filter(Boolean).join(' · ');

    // -- The table (newest 50 sessions) --
    if (!sessions.length) {
      body.replaceChildren(el('tr', {}, el('td', { colSpan: 6, class: 'muted empty' }, 'Finish a focus session to see it here.')));
      return;
    }
    body.replaceChildren(...sessions.slice(0, 50).map((s) => el('tr', {},
      el('td', { class: 'muted' }, when.format(s.at)),
      el('td', {}, el('span', { class: 'dot', style: `background:${s.color}` }), `${s.icon} ${s.skillName}`),
      el('td', {}, fmtDuration(s.focusMs)),
      // Hovering the Output cell shows the session's note as a tooltip.
      el('td', { title: s.note || '' },
        s.metrics.length ? s.metrics.map((m) => `${fmtNum(m.value)} ${m.unit}`).join(', ') : el('span', { class: 'muted' }, 'time only')),
      el('td', {}, s.timeOnly ? '—' : `${fmtNum(s.productivity)} pts/hr`),
      el('td', {}, `+${fmtNum(s.xp)} XP · +${fmtNum(s.momentum)} ◆`))));
  }

  // 'break' too, because the summary line counts today's breaks.
  store.subscribe(['sessions', 'break'], render);
  render();
}
