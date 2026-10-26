// Pace card in the Focus Session panel: last session's per-minute efficiency
// and progress toward the selected focus's daily goal, compared against an
// even pace across the goal's time window (e.g. 3h between 6:00 and 14:05).
import { store } from './state.js';
import { $, el } from './ui.js';
import { fmtDuration, fmtNum } from './format.js';
import { getSkill, openSkillEditor } from './skills.js';
import { focusElapsed } from './timer.js';

const clockFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function atTime(hhmm, base) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

const sessionMetric = (session, metric) =>
  session.metrics.find((m) => m.metricId === metric.id || (!m.metricId && m.label === metric.label))?.value ?? 0;

// Today's progress toward a focus's goal, or null if it has none.
export function goalProgress(skill, state, now = Date.now()) {
  const goal = skill.goal;
  if (!goal) return null;
  const isTime = goal.measure === 'time';
  const metric = isTime ? null : skill.metrics.find((m) => m.id === goal.measure);
  if (!isTime && !metric) return null;

  const today = state.sessions.filter((s) => s.skillId === skill.id && s.at >= atTime('00:00', now));
  // A time goal also counts the unlogged session on the timer for this focus.
  const live = isTime && state.selectedSkillId === skill.id ? focusElapsed() : 0;
  const done = isTime
    ? today.reduce((sum, s) => sum + s.focusMs, 0) + live
    : today.reduce((sum, s) => sum + sessionMetric(s, metric), 0);

  const start = atTime(goal.start, now);
  const end = atTime(goal.end, now);
  const span = end - start;
  const elapsed = Math.min(span, Math.max(0, now - start));
  const target = isTime ? goal.target * 3_600_000 : goal.target;
  return {
    isTime,
    unit: metric?.unit ?? '',
    done,
    live,
    target,
    expected: (target * elapsed) / span,   // where an even pace would be by now
    start,
    end,
    span,
    elapsed,
    phase: now < start ? 'before' : now >= end ? 'after' : 'during',
  };
}

export function initGoalCard() {
  const card = $('pace-card');
  const lastValue = el('strong');
  const lastSub = el('span', { class: 'muted small' });
  const goalTitle = el('span', { class: 'muted small' });
  const main = el('strong', { class: 'pace-main' });
  const status = el('span', { class: 'pace-status' });
  const fill = el('div', { class: 'pace-fill' });
  const marker = el('div', { class: 'pace-marker', title: 'Where an even pace would be by now' });
  const detail = el('div', { class: 'muted small' });
  const edit = () => { if (store.state.selectedSkillId) openSkillEditor(store.state.selectedSkillId); };

  const goalBox = el('div', { class: 'pace-goal' },
    el('div', { class: 'row' }, goalTitle, el('span', { class: 'grow' }), el('button', { type: 'button', class: 'ghost chip', onclick: edit }, 'Edit goal')),
    el('div', { class: 'row pace-line' }, main, el('span', { class: 'grow' }), status),
    el('div', { class: 'pace-bar', 'aria-hidden': 'true' }, fill, marker),
    detail);
  const setGoalBtn = el('button', { type: 'button', class: 'ghost chip', onclick: edit }, '🎯 Set a daily goal');
  card.append(
    el('div', { class: 'row pace-last' }, el('span', { class: 'muted small' }, 'Last session'), lastValue, lastSub),
    goalBox,
    setGoalBtn);

  function update() {
    const skill = getSkill(store.state.selectedSkillId);
    card.hidden = !skill;
    if (!skill) return;

    const last = store.state.sessions.find((s) => s.skillId === skill.id);
    const lastMin = last ? Math.max(1 / 60, last.focusMs / 60_000) : 1;
    lastValue.textContent = !last ? '—'
      : last.metrics.length ? last.metrics.map((m) => `${fmtNum(m.value / lastMin)} ${m.unit}/min`).join(' · ')
        : 'time only';
    lastSub.textContent = last ? `over ${fmtDuration(last.focusMs)}` : 'no sessions yet';

    const p = goalProgress(skill, store.state);
    goalBox.hidden = !p;
    setGoalBtn.hidden = !!p;
    if (!p) return;

    const amt = (v) => (p.isTime ? fmtDuration(v) : `${fmtNum(v)} ${p.unit}`);
    const rate = (amount, ms) => (p.isTime
      ? `${Math.round((amount / ms) * 60)} min/hr`
      : `${fmtNum(amount / (ms / 60_000))} ${p.unit}/min`);
    const clock = (t) => clockFmt.format(t);
    const met = p.done >= p.target;

    goalTitle.textContent = `🎯 ${amt(p.target)}${p.isTime ? ' focused' : ''} · ${clock(p.start)}–${clock(p.end)}`;
    fill.style.width = `${Math.min(100, (p.done / p.target) * 100)}%`;
    marker.style.left = `${Math.min(100, (p.expected / p.target) * 100)}%`;
    marker.hidden = p.phase !== 'during';
    status.className = 'pace-status';

    if (p.phase === 'before') {
      main.textContent = `${amt(p.done)} so far`;
      status.textContent = `Starts ${clock(p.start)}`;
      detail.textContent = `Even pace: ${rate(p.target, p.span)}`;
    } else if (p.phase === 'after') {
      main.textContent = `${amt(p.done)} of ${amt(p.target)}`;
      status.textContent = met ? '✓ Goal met' : 'Window closed';
      status.classList.add(met ? 'ahead' : 'behind');
      detail.textContent = met ? 'Nice work today.' : `${amt(p.target - p.done)} short of the goal`;
    } else {
      // e.g. "1h 23m / 4h 21m": done so far vs time elapsed in the window
      main.textContent = `${amt(p.done)} / ${fmtDuration(p.elapsed)}`;
      const diff = p.done - p.expected;
      const tolerance = p.isTime ? 60_000 : p.target * 0.01;
      if (met) {
        status.textContent = '✓ Goal met';
        status.classList.add('ahead');
      } else if (Math.abs(diff) < tolerance) {
        status.textContent = 'On pace';
      } else {
        status.textContent = diff > 0 ? `▲ ${amt(diff)} ahead` : `▼ ${amt(-diff)} behind`;
        status.classList.add(diff > 0 ? 'ahead' : 'behind');
      }
      detail.textContent = (p.elapsed < 60_000 ? `Need ${rate(p.target, p.span)}`
        : `Pace ${rate(p.done, p.elapsed)} · need ${rate(p.target, p.span)} · on track for ${amt((p.done / p.elapsed) * p.span)} by ${clock(p.end)}`)
        + (p.live ? ' (incl. current session)' : '');
    }
  }

  store.subscribe(['selection', 'skills', 'sessions', 'timer'], update);
  update();
  setInterval(update, 1000);
}
