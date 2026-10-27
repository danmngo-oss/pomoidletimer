// ============================================================================
// goals.js — the pace card in the Focus Session panel: last session's
// per-minute efficiency and progress toward the selected focus's daily goal,
// compared against an even pace across the goal's time window (e.g. 3h
// between 6:00 and 14:05).
//
// The pace maths, using that example at 10:21:
//   window      = 6:00 → 14:05             (8h 5m long)
//   elapsed     = 6:00 → 10:21             (4h 21m so far)
//   expected    = 3h × (4h 21m ÷ 8h 5m)    ≈ 1h 37m by now at an even pace
//   done        = 1h 23m                   → "▼ 13m behind" (rounded down)
//   projection  = done ÷ elapsed × window  → where you'll end up at this pace
//
// The card also lets the player correct today's progress by hand ("Adjust
// progress"), either by adding/removing an amount or by typing running totals
// (e.g. a document's character count). Those corrections only change this
// goal display: they never touch XP, Momentum, currency, productivity or the
// session log.
// ============================================================================
import { store } from './state.js';
import { $, el, toast } from './ui.js';
import { fmtDuration, fmtNum, uid } from './format.js';
import { getSkill, openSkillEditor, updateSkill } from './skills.js';
import { focusElapsed } from './timer.js';

// Formats a moment as e.g. "2:05 PM" in the visitor's own locale.
const clockFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

// "14:05" -> epoch ms for 14:05 (local time) on the same day as `base`.
function atTime(hhmm, base) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

// How much of `metric` a logged session recorded. Matches by metric id, or
// by name for sessions logged before ids were stored.
const sessionMetric = (session, metric) =>
  session.metrics.find((m) => m.metricId === metric.id || (!m.metricId && m.label === metric.label))?.value ?? 0;

// "1h 23m" for time goals (amounts in ms), "4,200 chars" for metric goals.
const fmtAmount = (p, v) => (p.isTime ? fmtDuration(v) : `${fmtNum(v)} ${p.unit}`);

// ---- Manual adjustments ----------------------------------------------------
// Stored on the focus as goalAdjust = { day, measure, amount, rows }:
//   amount — a signed correction from "Add / remove" or "Set from rate"
//            (ms for time goals, metric units otherwise)
//   rows   — "Running totals": [{ id, label, start, current }], one per
//            document/counter, in the units the player types (minutes for
//            time goals). Each row adds current − start to today's progress.
// It only counts for the same goal measure, and only on the day it was made,
// except that rows carry over to the next day (see todaysAdjust).

// Local calendar date of `now`, e.g. "2026-10-27".
const dayKey = (now) => {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

// Today's adjustment for a focus as { amount, rows }. Rows saved on an
// earlier day carry over with start = their last total, so a document you
// keep working on starts each new day at +0 instead of vanishing.
function todaysAdjust(skill, now = Date.now()) {
  const a = skill.goalAdjust;
  if (!a || a.measure !== skill.goal?.measure) return { amount: 0, rows: [] };
  if (a.day === dayKey(now)) return { amount: a.amount ?? 0, rows: a.rows ?? [] };
  return { amount: 0, rows: (a.rows ?? []).map((r) => ({ ...r, start: r.current })) };
}

// How far a running-total row has moved since its start (typed units).
const rowGain = (r) => (Number(r.current) || 0) - (Number(r.start) || 0);
// Typed units -> internal units (time goals are typed in minutes, kept in ms).
const toInternal = (isTime, v) => (isTime ? v * 60_000 : v);

// Today's corrections in internal units: the Add/remove amount and the sum
// of all running-total rows.
function currentAdjustment(skill, now) {
  const { amount, rows } = todaysAdjust(skill, now);
  const rowsTotal = toInternal(skill.goal.measure === 'time', rows.reduce((sum, r) => sum + rowGain(r), 0));
  return { amount, rowsTotal };
}

// Edits today's adjustment for a focus. `change` receives { amount, rows }
// and modifies it; the result is saved as today's.
export function updateGoalAdjust(skillId, change) {
  store.update('skills', (s) => {
    const sk = s.skills.find((x) => x.id === skillId);
    const adj = todaysAdjust(sk);
    change(adj);
    sk.goalAdjust = { day: dayKey(Date.now()), measure: sk.goal.measure, amount: adj.amount, rows: adj.rows };
  });
}

// Today's progress toward a focus's goal, or null if it has none.
// All amounts are in ms for time goals, or in the metric's unit otherwise.
export function goalProgress(skill, state, now = Date.now()) {
  const goal = skill.goal;
  if (!goal) return null;
  const isTime = goal.measure === 'time';
  const metric = isTime ? null : skill.metrics.find((m) => m.id === goal.measure);
  if (!isTime && !metric) return null;

  // Everything logged for this focus since midnight (not just since the
  // window opened, so early-bird work still counts).
  const today = state.sessions.filter((s) => s.skillId === skill.id && s.at >= atTime('00:00', now));
  // A time goal also counts the unlogged session on the timer for this focus.
  const live = isTime && state.selectedSkillId === skill.id ? focusElapsed() : 0;
  const logged = isTime
    ? today.reduce((sum, s) => sum + s.focusMs, 0) + live
    : today.reduce((sum, s) => sum + sessionMetric(s, metric), 0);
  // Manual adjustments can lower progress, but never below zero.
  const { amount: adjustAmount, rowsTotal } = currentAdjustment(skill, now);
  const adjust = adjustAmount + rowsTotal;
  const done = Math.max(0, logged + adjust);

  const start = atTime(goal.start, now);
  const end = atTime(goal.end, now);
  const span = end - start;
  // How far into the window we are, clamped to 0 before it and to the full
  // span after it.
  const elapsed = Math.min(span, Math.max(0, now - start));
  const target = isTime ? goal.target * 3_600_000 : goal.target;
  return {
    isTime,
    unit: metric?.unit ?? '',
    done,                                  // logged + adjust (what the card shows)
    logged,                                // from sessions and the live timer only
    adjust,                                // adjustAmount + rowsTotal
    adjustAmount,                          // from Add / remove and Set from rate
    rowsTotal,                             // from Running totals rows
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
  // Build the card's elements once; update() only changes their text, so the
  // "Edit goal" button doesn't get replaced (and lose clicks) every second.
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

  // -- "Adjust progress" controls --
  // Each handler re-reads the selected focus and its progress, so it always
  // works from the latest numbers rather than ones captured earlier.
  const current = () => {
    const skill = getSkill(store.state.selectedSkillId);
    return { skill, p: skill && goalProgress(skill, store.state) };
  };
  const adjAmount = el('input', { type: 'number', min: '0', step: 'any', placeholder: '0', 'aria-label': 'Amount to add or remove' });
  const adjUnit = el('span', { class: 'unit small' });
  const rateInput = el('input', { type: 'number', min: '0', step: 'any', placeholder: '0', 'aria-label': 'Your average rate over the goal window' });
  const rateUnit = el('span', { class: 'unit small' });
  const ratePreview = el('span', { class: 'muted small' });
  const rateBtn = el('button', { type: 'button', class: 'chip', onclick: applyRate }, 'Set');
  const adjNote = el('span', { class: 'muted small' });
  const resetBtn = el('button', {
    type: 'button', class: 'ghost chip',
    onclick: () => {
      const { skill } = current();
      if (!skill) return;
      if (todaysAdjust(skill).rows.length && !confirm('Clear today\'s adjustments, including the running-total rows?')) return;
      updateGoalAdjust(skill.id, (a) => { a.amount = 0; a.rows = []; });
    },
  }, 'Reset');
  const adjNoteRow = el('div', { class: 'row' }, adjNote, el('span', { class: 'grow' }), resetBtn);

  // + Add (sign 1) or − Remove (sign -1). Time goals are entered in minutes.
  function applyDelta(sign) {
    const { skill, p } = current();
    const v = Number(adjAmount.value);
    if (!p || !(v > 0)) return toast('Enter an amount above 0 first.');
    const delta = p.isTime ? v * 60_000 : v;
    // Removing more than was logged would push progress below zero; cap it.
    const next = Math.max(p.adjustAmount + sign * delta, -(p.logged + p.rowsTotal));
    updateGoalAdjust(skill.id, (a) => { a.amount = next; });
    adjAmount.value = '';
    toast(`Goal progress ${sign > 0 ? '+' : '−'}${fmtAmount(p, Math.abs(next - p.adjustAmount))}. Your scores are unchanged.`);
  }

  // What a rate entered for the whole window so far adds up to: min/hr for
  // time goals (e.g. 20 min/hr over 4h = 1h 20m), unit/min for metrics.
  function totalFromRate(p, v) {
    return p.isTime ? (v / 60) * p.elapsed : v * (p.elapsed / 60_000);
  }

  // Sets today's progress to rate × time elapsed in the window, by choosing
  // the amount that makes logged + rows + amount equal that total.
  function applyRate() {
    const { skill, p } = current();
    if (!p || rateInput.value === '' || !(Number(rateInput.value) >= 0)) return toast('Enter your rate first.');
    if (!p.elapsed) return toast('The goal window hasn\'t started yet.');
    const total = totalFromRate(p, Number(rateInput.value));
    updateGoalAdjust(skill.id, (a) => { a.amount = total - p.logged - p.rowsTotal; });
    rateInput.value = '';
    ratePreview.textContent = '';
    toast(`Goal progress set to ${fmtAmount(p, total)}. Your scores are unchanged.`);
  }

  adjAmount.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyDelta(1); });
  rateInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyRate(); });
  // Live preview of what the entered rate works out to.
  rateInput.addEventListener('input', () => {
    const { p } = current();
    const v = Number(rateInput.value);
    ratePreview.textContent = p && p.elapsed && rateInput.value !== '' && v >= 0 ? `= ${fmtAmount(p, totalFromRate(p, v))} so far` : '';
  });

  // -- Running totals: one row per document/counter --
  // Instead of working out "how much did I add?", the player types each
  // document's current total and the row adds Now − Start.
  const totalsRows = el('div', { class: 'totals-rows' });
  const totalsSum = el('span', { class: 'muted small' });
  // Remembers which rows are on screen, so renderTotals() can skip rebuilding.
  let totalsKey = '';

  // Applies `fn` to today's rows for the selected focus and saves them.
  const editRows = (fn) => { const { skill } = current(); if (skill) updateGoalAdjust(skill.id, (a) => fn(a.rows)); };
  // Signed amount for display, e.g. "+1,220 chars" or "−5m".
  const signed = (p, v) => `${v < 0 ? '−' : '+'}${fmtAmount(p, Math.abs(v))}`;

  function addTotalsRow() {
    editRows((rows) => rows.push({ id: uid(), label: '', start: 0, current: 0 }));
  }

  // Rebuilds the rows, but only when their structure changes (another focus,
  // goal or day, or a row added/removed), so the per-second refresh never
  // wipes what's being typed. Values are saved when a field loses focus or
  // Enter is pressed; the Gain column updates live while typing.
  function renderTotals(skill, p) {
    const { rows } = todaysAdjust(skill);
    const key = [skill.id, skill.goal.measure, dayKey(Date.now()), ...rows.map((r) => r.id)].join('|');
    if (key === totalsKey) return;
    totalsKey = key;
    const unit = p.isTime ? 'min' : p.unit;
    totalsRows.replaceChildren(
      ...(rows.length
        ? [el('div', { class: 'totals-row totals-head muted small' },
          el('span', {}, 'Name'), el('span', {}, `Start (${unit})`), el('span', {}, `Now (${unit})`), el('span', {}, 'Gain'), el('span'))]
        : [el('p', { class: 'muted small' }, 'No rows yet. Add one for each document or counter you track.')]),
      ...rows.map((r) => {
        const gain = el('span', { class: 'row-gain' });
        const startIn = el('input', { type: 'number', step: 'any', value: r.start, 'aria-label': 'Starting total' });
        const nowIn = el('input', { type: 'number', step: 'any', value: r.current, 'aria-label': 'Current total' });
        const showGain = () => { gain.textContent = signed(p, toInternal(p.isTime, rowGain({ start: startIn.value, current: nowIn.value }))); };
        const saveField = (field, value) => editRows((rs) => {
          const row = rs.find((x) => x.id === r.id);
          if (row) row[field] = value;
        });
        const nameIn = el('input', { value: r.label, placeholder: 'e.g. Essay draft', 'aria-label': 'Row name' });
        nameIn.addEventListener('change', () => saveField('label', nameIn.value));
        for (const [field, input] of [['start', startIn], ['current', nowIn]]) {
          input.addEventListener('input', showGain);
          input.addEventListener('change', () => saveField(field, Number(input.value) || 0));
        }
        // Enter leaves the field, which fires 'change' and saves it.
        for (const input of [nameIn, startIn, nowIn]) {
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
        }
        showGain();
        return el('div', { class: 'totals-row' },
          nameIn, startIn, nowIn, gain,
          el('button', {
            type: 'button', class: 'ghost icon', title: 'Remove row',
            onclick: () => editRows((rs) => {
              const i = rs.findIndex((x) => x.id === r.id);
              if (i >= 0) rs.splice(i, 1);
            }),
          }, '✕'));
      }),
    );
  }

  // The two ways to adjust, shown one at a time. Both keep counting whichever
  // is visible; the choice is remembered per focus (skill.goalAdjustMode).
  const amountPane = el('div', { class: 'adjust-pane' },
    el('div', { class: 'row adjust-row' },
      adjAmount, adjUnit,
      el('button', { type: 'button', class: 'chip', onclick: () => applyDelta(1) }, '+ Add'),
      el('button', { type: 'button', class: 'chip', onclick: () => applyDelta(-1) }, '− Remove')),
    el('div', { class: 'muted small' }, 'Or set your average rate over the whole window so far:'),
    el('div', { class: 'row adjust-row' }, rateInput, rateUnit, rateBtn, ratePreview));
  const totalsPane = el('div', { class: 'adjust-pane' },
    el('p', { class: 'muted small' },
      'Type the current total from wherever you track it (e.g. a document\'s character count). Each row adds Now − Start to today\'s progress. Add a row per document.'),
    totalsRows,
    el('div', { class: 'row' },
      el('button', { type: 'button', class: 'chip', onclick: addTotalsRow }, '+ Add row'),
      el('span', { class: 'grow' }),
      totalsSum));
  const modeToggle = el('div', { class: 'segmented adjust-mode', role: 'group', 'aria-label': 'Adjustment method' },
    ...[['amount', 'Add / remove'], ['totals', 'Running totals']].map(([mode, label]) => el('button', {
      type: 'button',
      dataset: { mode },
      onclick: () => { const { skill } = current(); if (skill) updateSkill(skill.id, { goalAdjustMode: mode }); },
    }, label)));

  // A <details> element is collapsed until its <summary> is clicked.
  const adjustBox = el('details', { class: 'pace-adjust' },
    el('summary', {}, '✎ Adjust progress'),
    el('p', { class: 'muted small' },
      'Correct today\'s progress by hand, e.g. for work done away from the timer. This only changes the goal display; your XP, Momentum and currency are not affected.'),
    modeToggle,
    amountPane,
    totalsPane,
    adjNoteRow);

  const goalBox = el('div', { class: 'pace-goal' },
    el('div', { class: 'row' }, goalTitle, el('span', { class: 'grow' }), el('button', { type: 'button', class: 'ghost chip', onclick: edit }, 'Edit goal')),
    el('div', { class: 'row pace-line' }, main, el('span', { class: 'grow' }), status),
    el('div', { class: 'pace-bar', 'aria-hidden': 'true' }, fill, marker),
    detail,
    adjustBox);
  // Shown instead of goalBox when the focus has no goal.
  const setGoalBtn = el('button', { type: 'button', class: 'ghost chip', onclick: edit }, '🎯 Set a daily goal');
  card.append(
    el('div', { class: 'row pace-last' }, el('span', { class: 'muted small' }, 'Last session'), lastValue, lastSub),
    goalBox,
    setGoalBtn);

  // Refreshes all the text. Runs every second (time moves even if nothing
  // else changes) and whenever the selection, foci, sessions or timer change.
  function update() {
    const skill = getSkill(store.state.selectedSkillId);
    card.hidden = !skill;
    if (!skill) return;

    // "Last session": each metric divided by the session's minutes.
    // (Sessions are stored newest first, so find() gets the latest one.)
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

    // Small helpers so the same code works for time goals ("1h 23m",
    // "19 min/hr") and metric goals ("4,200 chars", "17.5 chars/min").
    const amt = (v) => fmtAmount(p, v);
    const rate = (amount, ms) => (p.isTime
      ? `${Math.round((amount / ms) * 60)} min/hr`
      : `${fmtNum(amount / (ms / 60_000))} ${p.unit}/min`);
    const clock = (t) => clockFmt.format(t);
    const met = p.done >= p.target;

    goalTitle.textContent = `🎯 ${amt(p.target)}${p.isTime ? ' focused' : ''} · ${clock(p.start)}–${clock(p.end)}`;
    // The bar fills with work done; the marker shows where an even pace
    // would be right now. Fill past the marker = ahead.
    fill.style.width = `${Math.min(100, (p.done / p.target) * 100)}%`;
    marker.style.left = `${Math.min(100, (p.expected / p.target) * 100)}%`;
    marker.hidden = p.phase !== 'during';
    status.className = 'pace-status';

    // Adjustment controls: units follow the goal type; only labels are
    // touched here, so anything being typed survives the per-second refresh.
    adjUnit.textContent = p.isTime ? 'min' : p.unit;
    rateUnit.textContent = p.isTime ? 'min/hr' : `${p.unit}/min`;
    rateBtn.disabled = !p.elapsed;
    adjNoteRow.hidden = !p.adjust;
    adjNote.textContent = `Includes ${p.adjust > 0 ? '+' : '−'}${amt(Math.abs(p.adjust))} adjusted by hand today.`;
    const mode = skill.goalAdjustMode ?? 'amount';
    amountPane.hidden = mode !== 'amount';
    totalsPane.hidden = mode !== 'totals';
    for (const btn of modeToggle.children) btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode));
    renderTotals(skill, p);
    // Rate for the rows combined, over the window so far.
    totalsSum.textContent = todaysAdjust(skill).rows.length
      ? `Rows: ${signed(p, p.rowsTotal)}${p.elapsed >= 60_000 ? ` · ${rate(p.rowsTotal, p.elapsed)} over the window` : ''}`
      : '';

    // The text depends on whether we're before, during or after the window.
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
      // Within a minute (or 1% of a metric goal) counts as "on pace", so the
      // label doesn't flicker between ahead and behind.
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
      // In the first minute of the window there's no meaningful pace yet.
      detail.textContent = (p.elapsed < 60_000 ? `Need ${rate(p.target, p.span)}`
        : `Pace ${rate(p.done, p.elapsed)} · need ${rate(p.target, p.span)} · on track for ${amt((p.done / p.elapsed) * p.span)} by ${clock(p.end)}`)
        + (p.live ? ' (incl. current session)' : '');
    }
  }

  store.subscribe(['selection', 'skills', 'sessions', 'timer'], update);
  update();
  setInterval(update, 1000);
}
