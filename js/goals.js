// ============================================================================
// goals.js — the Goals panel (top right), the goal editor, and the pace card
// in the timer panel.
//
// A goal is { id, name, period, start, end, units, measure, target,
// adjustMode, adjust }:
//   period   'hourly' (each clock hour), 'daily' (a time window like
//            6:00–14:05) or 'weekly' (Monday to Sunday)
//   units    unit ids it counts, or null for every unit
//   measure  'time' (focus time) or a metric unit such as 'chars': any
//            included unit's metric with that unit counts
//   target   hours for time goals, otherwise an amount of the unit
//
// Progress is compared against an even pace across the period's window.
// Using a daily 3h goal from 6:00 to 14:05, at 10:21:
//   window      = 6:00 → 14:05             (8h 5m long)
//   elapsed     = 6:00 → 10:21             (4h 21m so far)
//   expected    = 3h × (4h 21m ÷ 8h 5m)    ≈ 1h 37m by now at an even pace
//   done        = 1h 23m                   → "▼ 13m behind" (rounded down)
//   projection  = done ÷ elapsed × window  → where you'll end up at this pace
//
// Each goal also lets the player correct progress by hand ("Adjust"),
// either by adding/removing an amount (±) or with running totals (e.g. a
// document's character count). Those corrections only change the goal
// display: they never touch XP, Momentum, currency, productivity or the log.
// ============================================================================
import { store } from './state.js';
import { $, el, toast } from './ui.js';
import { fmtDuration, fmtNum, uid } from './format.js';
import { getSkill } from './skills.js';
import { focusElapsed } from './timer.js';

const PERIODS = { hourly: 'Hourly', daily: 'Daily', weekly: 'Weekly' };

// Formats a moment as e.g. "2:05 PM" in the visitor's own locale.
const clockFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

// "14:05" -> epoch ms for 14:05 (local time) on the same day as `base`.
function atTime(hhmm, base) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

// Local calendar date of `now`, e.g. "2026-10-27".
const dayKey = (now) => {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

// Metric units match regardless of case or stray spaces ("Chars" = "chars").
const sameUnit = (a = '', b = '') => a.trim().toLowerCase() === b.trim().toLowerCase();
const includesUnit = (goal, unitId) => !goal.units || goal.units.includes(unitId);

// The goal's current period as epoch-ms times:
//   key    identifies the period (adjustments reset when it changes)
//   from   sessions logged since this moment count
//   start, end   the window used for pacing
// Daily goals count from midnight (so early work still counts) but pace
// across their own window.
export function periodWindow(goal, now = Date.now()) {
  const d = new Date(now);
  if (goal.period === 'hourly') {
    d.setMinutes(0, 0, 0);
    return { key: `${dayKey(now)}@${new Date(now).getHours()}`, from: +d, start: +d, end: +d + 3_600_000 };
  }
  if (goal.period === 'weekly') {
    d.setHours(0, 0, 0, 0);
    // getDay() is 0 for Sunday; step back to this week's Monday.
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const end = new Date(d);
    end.setDate(end.getDate() + 7);
    return { key: `wk:${dayKey(+d)}`, from: +d, start: +d, end: +end };
  }
  return { key: dayKey(now), from: atTime('00:00', now), start: atTime(goal.start, now), end: atTime(goal.end, now) };
}

// How much of the goal's metric unit a logged session recorded (summing
// every metric with that unit, e.g. two "chars" metrics).
const sessionAmount = (session, goal) =>
  session.metrics.filter((m) => sameUnit(m.unit, goal.measure)).reduce((sum, m) => sum + m.value, 0);

// "1h 23m" for time goals (amounts in ms), "4,200 chars" for metric goals.
const fmtAmount = (p, v) => (p.isTime ? fmtDuration(v) : `${fmtNum(v)} ${p.unit}`);
// Signed amount for display, e.g. "+1,220 chars" or "−5m".
const signed = (p, v) => `${v < 0 ? '−' : '+'}${fmtAmount(p, Math.abs(v))}`;

// ---- Manual adjustments ----------------------------------------------------
// Stored on the goal as adjust = { key, amount, rows }:
//   key    — the period it belongs to (see periodWindow)
//   amount — a signed correction from "±" (add/remove or set from rate),
//            in ms for time goals, metric units otherwise
//   rows   — "Running totals": [{ id, label, start, base, current, updatedAt }],
//            one per document/counter, in the units the player types
//            (minutes for time goals):
//              current — the last total entered
//              start   — the total when the period began ("+X" display)
//              base    — how far a logged session has already counted.
//            Totals entered in the session dialog score as that session's
//            output and move `base` up with them, so the goal adds only
//            current − base and never counts the same work twice.
// When a new period begins, the amount resets and rows carry over with
// start (and base) = their last total.

function periodAdjust(goal, now = Date.now()) {
  const a = goal.adjust;
  if (!a) return { amount: 0, rows: [] };
  if (a.key === periodWindow(goal, now).key) return { amount: a.amount ?? 0, rows: a.rows ?? [] };
  return { amount: 0, rows: (a.rows ?? []).map((r) => ({ ...r, start: r.current, base: r.current })) };
}

// A row's growth this period (what "+X" shows), and the part of it no logged
// session has counted yet (what the goal adjustment adds). Typed units.
const rowGrowth = (r) => (Number(r.current) || 0) - (Number(r.start) || 0);
const rowUncounted = (r) => (Number(r.current) || 0) - (Number(r.base ?? r.start) || 0);
// Typed units -> internal units (time goals are typed in minutes, kept in ms).
const toInternal = (isTime, v) => (isTime ? v * 60_000 : v);

// Edits the current period's adjustment for a goal. `change` receives
// { amount, rows } and modifies it; the result is saved for this period.
export function updateGoalAdjust(goalId, change) {
  store.update('goals', (s) => {
    const g = s.goals.find((x) => x.id === goalId);
    const adj = periodAdjust(g);
    change(adj);
    g.adjust = { key: periodWindow(g).key, amount: adj.amount, rows: adj.rows };
  });
}

// ---- Running totals in the session dialog ---------------------------------

// The running-total rows the "Session complete" dialog should ask about for
// this unit's metric: from the first goal in Running totals mode that counts
// this unit and this metric's unit. Returns { goalId, rows } or null (the
// dialog then asks for an amount instead).
export function sessionTotalsRows(skill, metric) {
  const goal = store.state.goals.find((g) => g.adjustMode === 'totals' && g.measure !== 'time'
    && sameUnit(g.measure, metric.unit) && includesUnit(g, skill.id));
  return goal ? { goalId: goal.id, rows: periodAdjust(goal).rows } : null;
}

// Saves the totals entered when a session is logged. `entries` are
// [{ id, label, total }]; ids not in the rows yet become new rows (a document
// started during the session, counted from 0). Each row's growth was scored
// as the session's output, so `base` moves up by the same amount.
export function recordSessionTotals(goalId, entries) {
  const now = Date.now();
  updateGoalAdjust(goalId, (a) => {
    for (const e of entries) {
      const row = a.rows.find((r) => r.id === e.id);
      if (row) {
        const counted = e.total - (Number(row.current) || 0);
        row.base = (Number(row.base ?? row.start) || 0) + counted;
        row.current = e.total;
        row.updatedAt = now;
      } else {
        a.rows.push({ id: e.id, label: e.label, start: 0, base: e.total, current: e.total, updatedAt: now });
      }
    }
  });
}

// ---- Progress ----------------------------------------------------------------

// A goal's progress in its current period. Amounts are in ms for time goals,
// otherwise in the metric's unit.
export function goalProgress(goal, state, now = Date.now()) {
  const w = periodWindow(goal, now);
  const isTime = goal.measure === 'time';
  const sessions = state.sessions.filter((s) => s.at >= w.from && includesUnit(goal, s.skillId));
  // A time goal also counts the unlogged session on the timer, if the
  // selected unit is one this goal counts.
  const live = isTime && state.selectedSkillId && includesUnit(goal, state.selectedSkillId) ? focusElapsed() : 0;
  const logged = isTime
    ? sessions.reduce((sum, s) => sum + s.focusMs, 0) + live
    : sessions.reduce((sum, s) => sum + sessionAmount(s, goal), 0);
  // Manual adjustments can lower progress, but never below zero.
  const { amount: adjustAmount, rows } = periodAdjust(goal, now);
  const rowsTotal = toInternal(isTime, rows.reduce((sum, r) => sum + rowUncounted(r), 0));
  const adjust = adjustAmount + rowsTotal;
  const done = Math.max(0, logged + adjust);

  const span = w.end - w.start;
  // How far into the window we are, clamped to 0 before it and to the full
  // span after it.
  const elapsed = Math.min(span, Math.max(0, now - w.start));
  const target = isTime ? goal.target * 3_600_000 : goal.target;
  return {
    isTime,
    unit: isTime ? '' : goal.measure,
    done,                                  // logged + adjust (what the card shows)
    logged,                                // from sessions and the live timer only
    adjust,                                // adjustAmount + rowsTotal
    adjustAmount,                          // from ± (add / remove, set from rate)
    rowsTotal,                             // from Running totals rows
    rows,
    live,
    target,
    expected: (target * elapsed) / span,   // where an even pace would be by now
    start: w.start,
    end: w.end,
    span,
    elapsed,
    phase: now < w.start ? 'before' : now >= w.end ? 'after' : 'during',
  };
}

// Pace text helpers for a progress object: "19 min/hr" or "17.5 chars/min".
const rateText = (p, amount, ms) => (p.isTime
  ? `${Math.round((amount / ms) * 60)} min/hr`
  : `${fmtNum(amount / (ms / 60_000))} ${p.unit}/min`);

// The ahead/behind verdict shared by goal cards and the pace card:
// { text, cls } where cls is 'ahead', 'behind' or ''.
function verdict(p) {
  const met = p.done >= p.target;
  if (p.phase === 'before') return { text: `Starts ${clockFmt.format(p.start)}`, cls: '' };
  if (met) return { text: '✓ Goal met', cls: 'ahead' };
  if (p.phase === 'after') return { text: 'Period over', cls: 'behind' };
  const diff = p.done - p.expected;
  // Within a minute (or 1% of a metric goal) counts as "on pace", so the
  // label doesn't flicker between ahead and behind.
  const tolerance = p.isTime ? 60_000 : p.target * 0.01;
  if (Math.abs(diff) < tolerance) return { text: 'On pace', cls: '' };
  return diff > 0
    ? { text: `▲ ${fmtAmount(p, diff)} ahead`, cls: 'ahead' }
    : { text: `▼ ${fmtAmount(p, -diff)} behind`, cls: 'behind' };
}

// "Daily · 6:00 AM–2:05 PM · chars · Note-taking, Lectures"
function goalSummary(goal) {
  const units = goal.units
    ? goal.units.map((id) => getSkill(id)?.name).filter(Boolean).join(', ') || 'no units'
    : 'all units';
  const when = goal.period === 'daily' ? ` ${clockFmt.format(atTime(goal.start, Date.now()))}–${clockFmt.format(atTime(goal.end, Date.now()))}` : '';
  return `${PERIODS[goal.period]}${when} · ${goal.measure === 'time' ? 'focus time' : goal.measure} · ${units}`;
}

// ---- One goal's card in the Goals panel --------------------------------------
// Built once per goal; update() only changes text, so anything being typed
// survives the per-second refresh.

function createGoalCard(goalId) {
  const goal = () => store.state.goals.find((g) => g.id === goalId);
  // Each handler re-reads the goal and its progress, so it always works from
  // the latest numbers rather than ones captured earlier.
  const current = () => {
    const g = goal();
    return { g, p: g && goalProgress(g, store.state) };
  };

  const title = el('strong');
  const summary = el('div', { class: 'muted small goal-summary' });
  const main = el('strong', { class: 'pace-main' });
  const status = el('span', { class: 'pace-status' });
  const fill = el('div', { class: 'pace-fill' });
  const marker = el('div', { class: 'pace-marker', title: 'Where an even pace would be by now' });
  const detail = el('div', { class: 'muted small' });

  // -- ± : add/remove an amount, or set from an average rate --
  const adjAmount = el('input', { type: 'number', min: '0', step: 'any', placeholder: '0', 'aria-label': 'Amount to add or remove' });
  const adjUnit = el('span', { class: 'unit small' });
  const rateInput = el('input', { type: 'number', min: '0', step: 'any', placeholder: '0', 'aria-label': 'Your average rate over the period' });
  const rateUnit = el('span', { class: 'unit small' });
  const ratePreview = el('span', { class: 'muted small' });
  const rateBtn = el('button', { type: 'button', class: 'chip', onclick: applyRate }, 'Set');
  const adjNote = el('span', { class: 'muted small' });
  const resetBtn = el('button', {
    type: 'button', class: 'ghost chip',
    onclick: () => {
      const { g } = current();
      if (!g) return;
      if (periodAdjust(g).rows.length && !confirm('Clear this period\'s adjustments, including the running-total rows?')) return;
      updateGoalAdjust(g.id, (a) => { a.amount = 0; a.rows = []; });
    },
  }, 'Reset');
  const adjNoteRow = el('div', { class: 'row' }, adjNote, el('span', { class: 'grow' }), resetBtn);

  // + Add (sign 1) or − Remove (sign -1). Time goals are entered in minutes.
  function applyDelta(sign) {
    const { g, p } = current();
    const v = Number(adjAmount.value);
    if (!p || !(v > 0)) return toast('Enter an amount above 0 first.');
    const delta = p.isTime ? v * 60_000 : v;
    // Removing more than was logged would push progress below zero; cap it.
    const next = Math.max(p.adjustAmount + sign * delta, -(p.logged + p.rowsTotal));
    updateGoalAdjust(g.id, (a) => { a.amount = next; });
    adjAmount.value = '';
    toast(`${g.name}: ${sign > 0 ? '+' : '−'}${fmtAmount(p, Math.abs(next - p.adjustAmount))}. Your scores are unchanged.`);
  }

  // What a rate entered for the whole period so far adds up to: min/hr for
  // time goals (e.g. 20 min/hr over 4h = 1h 20m), unit/min for metrics.
  const totalFromRate = (p, v) => (p.isTime ? (v / 60) * p.elapsed : v * (p.elapsed / 60_000));

  // Sets progress to rate × time elapsed in the window, by choosing the
  // amount that makes logged + rows + amount equal that total.
  function applyRate() {
    const { g, p } = current();
    if (!p || rateInput.value === '' || !(Number(rateInput.value) >= 0)) return toast('Enter your rate first.');
    if (!p.elapsed) return toast('This goal\'s window hasn\'t started yet.');
    const total = totalFromRate(p, Number(rateInput.value));
    updateGoalAdjust(g.id, (a) => { a.amount = total - p.logged - p.rowsTotal; });
    rateInput.value = '';
    ratePreview.textContent = '';
    toast(`${g.name}: progress set to ${fmtAmount(p, total)}. Your scores are unchanged.`);
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
  // Each row's box shows its last saved total; the player types the new one
  // over it and the difference counts.
  const totalsRows = el('div', { class: 'totals-rows' });
  const totalsSum = el('span', { class: 'muted small' });
  // Remembers which rows are on screen, so renderTotals() can skip rebuilding.
  let totalsKey = '';
  const editRows = (fn) => { const { g } = current(); if (g) updateGoalAdjust(g.id, (a) => fn(a.rows)); };

  // New rows begin from a starting total the player gives once: 0 for a new
  // document, or its current count if it already has work in it, so only
  // work done from now on counts.
  const newRowName = el('input', { placeholder: 'e.g. Essay draft', 'aria-label': 'New row name' });
  const newRowStart = el('input', { type: 'number', step: 'any', placeholder: '0', 'aria-label': 'Starting total' });
  function addTotalsRow() {
    const start = Number(newRowStart.value) || 0;
    editRows((rows) => rows.push({ id: uid(), label: newRowName.value.trim(), start, base: start, current: start, updatedAt: Date.now() }));
    newRowName.value = '';
    newRowStart.value = '';
  }
  for (const input of [newRowName, newRowStart]) {
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addTotalsRow(); });
  }

  // Rebuilds the rows, but only when they change (another period, a row
  // added/removed, or a total saved, e.g. from the session dialog), so the
  // per-second refresh never wipes what's being typed. A total is saved when
  // its box loses focus or Enter is pressed; the "+X" updates while typing.
  function renderTotals(g, p) {
    const key = [periodWindow(g).key, g.measure, ...p.rows.map((r) => `${r.id}:${r.current}`)].join('|');
    if (key === totalsKey) return;
    totalsKey = key;
    const unit = p.isTime ? 'min' : p.unit;
    totalsRows.replaceChildren(
      ...(p.rows.length
        ? [el('div', { class: 'totals-row totals-head muted small' },
          el('span', {}, 'Name'), el('span', {}, `Total (${unit})`), el('span', {}, 'This period'), el('span'))]
        : [el('p', { class: 'muted small' }, 'No rows yet. Add one for each document or counter you track.')]),
      ...p.rows.map((r) => {
        const gain = el('span', { class: 'row-gain' });
        const totalIn = el('input', { type: 'number', step: 'any', value: r.current, 'aria-label': `Latest total for ${r.label || 'this row'}` });
        // "Last updated 10:42 AM" as a tooltip on the total box.
        const showUpdated = (t) => { totalIn.title = t ? `Last updated ${clockFmt.format(t)}` : ''; };
        const showGain = () => { gain.textContent = signed(p, toInternal(p.isTime, rowGrowth({ start: r.start, current: totalIn.value }))); };
        const saveRow = (patch) => editRows((rs) => {
          const row = rs.find((x) => x.id === r.id);
          if (row) Object.assign(row, patch);
        });
        const nameIn = el('input', { value: r.label, placeholder: 'Untitled', 'aria-label': 'Row name' });
        nameIn.addEventListener('change', () => saveRow({ label: nameIn.value }));
        totalIn.addEventListener('input', showGain);
        totalIn.addEventListener('change', () => {
          const now = Date.now();
          saveRow({ current: Number(totalIn.value) || 0, updatedAt: now });
          showUpdated(now);
        });
        // Enter leaves the box, which fires 'change' and saves it.
        for (const input of [nameIn, totalIn]) {
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
        }
        showGain();
        showUpdated(r.updatedAt);
        return el('div', { class: 'totals-row' },
          nameIn, totalIn, gain,
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

  const amountPane = el('div', { class: 'adjust-pane' },
    el('div', { class: 'row adjust-row' },
      adjAmount, adjUnit,
      el('button', { type: 'button', class: 'chip', onclick: () => applyDelta(1) }, '+ Add'),
      el('button', { type: 'button', class: 'chip', onclick: () => applyDelta(-1) }, '− Remove')),
    el('div', { class: 'muted small' }, 'Or set your average rate over the period so far:'),
    el('div', { class: 'row adjust-row' }, rateInput, rateUnit, rateBtn, ratePreview));
  const totalsPane = el('div', { class: 'adjust-pane' },
    el('p', { class: 'muted small' },
      'Each row shows your last total. When it changes, type the new total (e.g. your document\'s character count) and the difference counts. With this on, Finish & log asks for your totals too.'),
    totalsRows,
    el('div', { class: 'totals-add' },
      newRowName, newRowStart,
      el('button', { type: 'button', class: 'chip', onclick: addTotalsRow }, '+ Add row')),
    el('div', { class: 'muted small' }, 'Starting total: 0 for a new document, or its current count if it already has work in it.'),
    totalsSum);

  // A <details> element is collapsed until its <summary> is clicked.
  const adjustBox = el('details', { class: 'pace-adjust' },
    el('summary', {}, '✎ Adjust progress'),
    el('p', { class: 'muted small' }, 'Corrections here only change this goal; XP, Momentum and currency are not affected.'),
    amountPane,
    totalsPane,
    adjNoteRow);

  // The "± | Running total" switch from the sketch. Choosing a method also
  // opens the adjust area.
  const modeToggle = el('div', { class: 'segmented adjust-mode', role: 'group', 'aria-label': 'Adjustment method' },
    ...[['amount', '±'], ['totals', 'Running total']].map(([mode, label]) => el('button', {
      type: 'button',
      dataset: { mode },
      title: mode === 'amount' ? 'Add or remove amounts' : 'Type running totals (e.g. character counts)',
      onclick: () => {
        store.update('goals', (s) => { s.goals.find((x) => x.id === goalId).adjustMode = mode; });
        adjustBox.open = true;
      },
    }, label)));

  const root = el('div', { class: 'goal-card' },
    el('div', { class: 'row' }, title, el('span', { class: 'grow' }), modeToggle,
      el('button', { type: 'button', class: 'ghost icon', title: 'Edit goal', 'aria-label': 'Edit goal', onclick: () => openGoalEditor(goalId) }, '⚙')),
    summary,
    el('div', { class: 'row pace-line' }, main, el('span', { class: 'grow' }), status),
    el('div', { class: 'pace-bar', 'aria-hidden': 'true' }, fill, marker),
    detail,
    adjustBox);

  function update() {
    const { g, p } = current();
    if (!g) return;
    const amt = (v) => fmtAmount(p, v);
    title.textContent = g.name;
    summary.textContent = goalSummary(g);
    // The bar fills with work done; the marker shows where an even pace
    // would be right now. Fill past the marker = ahead.
    fill.style.width = `${Math.min(100, (p.done / p.target) * 100)}%`;
    marker.style.left = `${Math.min(100, (p.expected / p.target) * 100)}%`;
    marker.hidden = p.phase !== 'during';
    const v = verdict(p);
    status.textContent = v.text;
    status.className = `pace-status ${v.cls}`;
    if (p.phase === 'during') {
      // e.g. "1h 23m / 4h 21m": done so far vs time elapsed in the window
      main.textContent = `${amt(p.done)} / ${fmtDuration(p.elapsed)}`;
      // In the first minute there's no meaningful pace yet.
      detail.textContent = (p.elapsed < 60_000 ? `Need ${rateText(p, p.target, p.span)}`
        : `Pace ${rateText(p, p.done, p.elapsed)} · need ${rateText(p, p.target, p.span)} · on track for ${amt((p.done / p.elapsed) * p.span)}`)
        + (p.live ? ' (incl. current session)' : '');
    } else {
      main.textContent = `${amt(p.done)} of ${amt(p.target)}`;
      detail.textContent = p.phase === 'before' ? `Even pace: ${rateText(p, p.target, p.span)}` : '';
    }

    // Adjustment controls: units follow the goal type; only labels are
    // touched here.
    adjUnit.textContent = p.isTime ? 'min' : p.unit;
    rateUnit.textContent = p.isTime ? 'min/hr' : `${p.unit}/min`;
    rateBtn.disabled = !p.elapsed;
    adjNoteRow.hidden = !p.adjust;
    adjNote.textContent = `Includes ${p.adjust > 0 ? '+' : '−'}${amt(Math.abs(p.adjust))} adjusted by hand.`;
    const mode = g.adjustMode ?? 'amount';
    amountPane.hidden = mode !== 'amount';
    totalsPane.hidden = mode !== 'totals';
    for (const btn of modeToggle.children) btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode));
    renderTotals(g, p);
    // The rows' combined growth this period and its rate (including growth
    // already logged through sessions).
    const rowsGrowth = toInternal(p.isTime, p.rows.reduce((sum, r) => sum + rowGrowth(r), 0));
    totalsSum.textContent = p.rows.length
      ? `Rows: ${signed(p, rowsGrowth)}${p.elapsed >= 60_000 ? ` · ${rateText(p, rowsGrowth, p.elapsed)}` : ''}`
      : '';
  }

  return { root, update };
}

// ---- The Goals panel ---------------------------------------------------------

export function initGoals() {
  const list = $('goals-list');
  $('goal-add').addEventListener('click', () => openGoalEditor());
  let cards = new Map();
  let structureKey = '';

  // Rebuilds the cards when goals are added, removed or reconfigured, then
  // refreshes every card's numbers.
  function sync() {
    const goals = store.state.goals;
    const key = goals.map((g) => `${g.id}:${JSON.stringify([g.name, g.period, g.start, g.end, g.units, g.measure, g.target])}`).join('|');
    if (key !== structureKey) {
      structureKey = key;
      cards = new Map(goals.map((g) => [g.id, createGoalCard(g.id)]));
      list.replaceChildren(...(goals.length
        ? [...cards.values()].map((c) => c.root)
        : [el('p', { class: 'muted small' }, 'No goals yet. Add an hourly, daily or weekly target for focus time or a metric like characters typed.')]));
    }
    for (const c of cards.values()) c.update();
  }

  store.subscribe(['goals', 'sessions', 'skills', 'selection', 'timer'], sync);
  sync();
  setInterval(sync, 1000);
}

// ---- Goal editor dialog ------------------------------------------------------
// Opens the editor for an existing goal (goalId) or a new one, optionally
// pre-filled (e.g. { units: [id], name } from the pace card).

export function openGoalEditor(goalId = null, preset = {}) {
  const dlg = $('goal-dialog');
  const existing = goalId ? store.state.goals.find((g) => g.id === goalId) : null;
  const draft = existing
    ? structuredClone(existing)
    : { name: `Goal ${store.state.goals.length + 1}`, period: 'daily', start: '09:00', end: '17:00', units: null, measure: 'time', target: 3, adjustMode: 'amount', adjust: null, ...preset };

  // Every metric unit used by any unit ("chars", "min"…), once each.
  const metricUnits = [];
  for (const u of store.state.skills) {
    for (const m of u.metrics) {
      if (m.unit.trim() && !metricUnits.some((x) => sameUnit(x, m.unit))) metricUnits.push(m.unit.trim());
    }
  }
  if (draft.measure !== 'time' && !metricUnits.some((x) => sameUnit(x, draft.measure))) metricUnits.push(draft.measure);

  const isTime = () => draft.measure === 'time';
  // Time targets are stored in hours; hourly ones are typed in minutes.
  const targetFactor = () => (isTime() && draft.period === 'hourly' ? 60 : 1);
  const targetInput = el('input', { type: 'number', min: '0.01', step: 'any', required: true, 'aria-label': 'Target' });
  targetInput.addEventListener('input', () => { draft.target = Number(targetInput.value) / targetFactor(); });
  const targetUnit = el('span', { class: 'unit' });
  const windowFields = el('div', { class: 'row' },
    el('label', { class: 'field grow' }, 'From', el('input', { type: 'time', value: draft.start, oninput: (e) => { draft.start = e.target.value; } })),
    el('label', { class: 'field grow' }, 'Until', el('input', { type: 'time', value: draft.end, oninput: (e) => { draft.end = e.target.value; } })));

  // Shows the fields that depend on the period and measure.
  function renderDynamic() {
    windowFields.hidden = draft.period !== 'daily';
    targetUnit.textContent = isTime() ? (draft.period === 'hourly' ? 'min' : 'hours') : draft.measure;
    targetInput.value = +(draft.target * targetFactor()).toFixed(2);
  }

  const periodPicker = el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Period' },
    ...Object.entries(PERIODS).map(([id, label]) => el('button', {
      type: 'button',
      dataset: { period: id },
      onclick: () => {
        draft.period = id;
        for (const b of periodPicker.children) b.setAttribute('aria-pressed', String(b.dataset.period === id));
        renderDynamic();
      },
    }, label)));
  for (const b of periodPicker.children) b.setAttribute('aria-pressed', String(b.dataset.period === draft.period));

  const measureSelect = el('select', { 'aria-label': 'What to measure' },
    el('option', { value: 'time' }, 'Focus time'),
    ...metricUnits.map((unit) => el('option', { value: unit }, `Metric: ${unit}`)));
  measureSelect.value = metricUnits.find((x) => sameUnit(x, draft.measure)) ?? 'time';
  measureSelect.addEventListener('change', () => { draft.measure = measureSelect.value; renderDynamic(); });

  // Which units count: all of them, or a chosen few.
  const unitBoxes = el('div', { class: 'row unit-picker' });
  function renderUnits() {
    unitBoxes.replaceChildren(
      el('label', { class: 'cat-toggle' },
        el('input', { type: 'checkbox', checked: !draft.units, onchange: (e) => { draft.units = e.target.checked ? null : []; renderUnits(); } }),
        el('span', {}, 'All units')),
      ...store.state.skills.map((u) => el('label', { class: 'cat-toggle' },
        el('input', {
          type: 'checkbox',
          disabled: !draft.units,
          checked: !draft.units || draft.units.includes(u.id),
          onchange: (e) => {
            draft.units = e.target.checked ? [...draft.units, u.id] : draft.units.filter((id) => id !== u.id);
          },
        }),
        el('span', {}, `${u.icon} ${u.name}`))));
  }

  const form = el('form', {
    class: 'dialog-body',
    onsubmit: (e) => {
      e.preventDefault();
      const name = draft.name.trim();
      if (!name || !(draft.target > 0)) return toast('Give the goal a name and a target above 0.', { kind: 'error' });
      if (draft.period === 'daily' && !(draft.end > draft.start)) return toast('"Until" must be after "From".', { kind: 'error' });
      if (draft.units && !draft.units.length) return toast('Pick at least one unit, or All units.', { kind: 'error' });
      // Running-total rows belong to one measure; a new measure starts fresh.
      const reset = existing && !sameUnit(existing.measure, draft.measure);
      const saved = { ...draft, name, adjust: reset ? null : draft.adjust };
      store.update('goals', (s) => {
        if (existing) s.goals[s.goals.findIndex((g) => g.id === goalId)] = saved;
        else s.goals.push({ ...saved, id: uid() });
      });
      dlg.close();
      toast(existing ? `Updated ${name}` : `Added goal "${name}"`);
    },
  },
    el('h3', {}, existing ? 'Edit goal' : 'New goal'),
    el('label', { class: 'field' }, 'Name', el('input', { value: draft.name, required: true, maxLength: 40, oninput: (e) => { draft.name = e.target.value; } })),
    el('div', { class: 'field' }, 'Period', periodPicker),
    windowFields,
    el('div', { class: 'row' },
      el('label', { class: 'field grow' }, 'Measure', measureSelect),
      el('label', { class: 'field' }, 'Target', el('div', { class: 'input-unit' }, targetInput, targetUnit))),
    el('div', { class: 'field' }, 'Counts these units', unitBoxes),
    el('p', { class: 'muted small' }, 'Metric goals add up every counted unit\'s metrics with that unit name, e.g. all "chars".'),
    el('div', { class: 'row dialog-actions' },
      existing && el('button', {
        type: 'button', class: 'ghost danger',
        onclick: () => {
          if (!confirm(`Delete the goal "${existing.name}"?`)) return;
          store.update('goals', (s) => { s.goals = s.goals.filter((g) => g.id !== goalId); });
          dlg.close();
        },
      }, 'Delete'),
      el('span', { class: 'grow' }),
      el('button', { type: 'button', class: 'ghost', onclick: () => dlg.close() }, 'Cancel'),
      el('button', { type: 'submit', class: 'primary' }, existing ? 'Save' : 'Add goal')),
  );

  renderDynamic();
  renderUnits();
  dlg.replaceChildren(form);
  dlg.showModal();
}

// ---- Pace card in the timer panel ------------------------------------------
// For the selected unit: its last session's rate, plus the overall pace and
// the pace still needed for the first goal that counts it.

export function initPaceCard() {
  const card = $('pace-card');
  const lastValue = el('strong');
  const lastSub = el('span', { class: 'muted small' });
  const goalName = el('span', { class: 'muted small' });
  const status = el('span', { class: 'pace-status' });
  const paceLine = el('div', { class: 'small' });
  const goalRow = el('div', { class: 'pace-goal' }, el('div', { class: 'row' }, goalName, el('span', { class: 'grow' }), status), paceLine);
  const addGoalBtn = el('button', {
    type: 'button', class: 'ghost chip',
    onclick: () => {
      const unit = getSkill(store.state.selectedSkillId);
      if (unit) openGoalEditor(null, { units: [unit.id], name: unit.name });
    },
  }, '🎯 Add a goal for this unit');
  card.append(
    el('div', { class: 'row pace-last' }, el('span', { class: 'muted small' }, 'Last session'), lastValue, lastSub),
    goalRow,
    addGoalBtn);

  function update() {
    const unit = getSkill(store.state.selectedSkillId);
    card.hidden = !unit;
    if (!unit) return;

    // "Last session": each metric divided by the session's minutes.
    // (Sessions are stored newest first, so find() gets the latest one.)
    const last = store.state.sessions.find((s) => s.skillId === unit.id);
    const lastMin = last ? Math.max(1 / 60, last.focusMs / 60_000) : 1;
    lastValue.textContent = !last ? '—'
      : last.metrics.length ? last.metrics.map((m) => `${fmtNum(m.value / lastMin)} ${m.unit}/min`).join(' · ')
        : 'time only';
    lastSub.textContent = last ? `over ${fmtDuration(last.focusMs)}` : 'no sessions yet';

    const goal = store.state.goals.find((g) => includesUnit(g, unit.id));
    goalRow.hidden = !goal;
    addGoalBtn.hidden = !!goal;
    if (!goal) return;
    const p = goalProgress(goal, store.state);
    const v = verdict(p);
    goalName.textContent = `🎯 ${goal.name} (${PERIODS[goal.period].toLowerCase()})`;
    status.textContent = v.text;
    status.className = `pace-status ${v.cls}`;
    // Overall pace so far vs. the pace still needed in the time remaining.
    const remainingMs = p.end - Math.max(Date.now(), p.start);
    const stillNeeded = Math.max(0, p.target - p.done);
    paceLine.textContent = p.phase === 'after' || remainingMs <= 0
      ? `Finished at ${fmtAmount(p, p.done)} of ${fmtAmount(p, p.target)}`
      : `Overall pace ${p.elapsed >= 60_000 ? rateText(p, p.done, p.elapsed) : '—'} · need ${stillNeeded ? rateText(p, stillNeeded, remainingMs) : 'nothing more'} for the goal`;
  }

  store.subscribe(['selection', 'skills', 'sessions', 'timer', 'goals'], update);
  update();
  setInterval(update, 1000);
}
