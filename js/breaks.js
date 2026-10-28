// ============================================================================
// breaks.js — breaks, started by clicking the Keep on the city map. They never cost
// anything: idle generation keeps running, and any focus session in progress
// just pauses. A finished break boosts output for the break's stats (its
// "categories": INT, STR, DEX, or LIFE, which doubles Life units' buffs); breaks in the sweet spot (5-10 min) earn the longest boost.
//
// A break's life:
//   startBreak()  — pauses the focus timer and stores state.activeBreak
//   tick()        — 4x per second: updates the banner; ends a countdown at 0
//   endBreak()    — logs the break, grants a default bonus right away, then
//                   opens the summary dialog (openBreakSummary)
//   summary close — re-computes the bonus with the steps/rating the user
//                   entered and adjusts the bonus by the difference
//
// Bonuses ("buffs") are stored as state.buffs[stat] = the moment the
// bonus ends. idle.js and economy.js read that to double the output.
//
// This file also builds the break picker and the preset manager dialogs.
// ============================================================================
import { store } from './state.js';
import { $, el, chime, notify, primeAudio, requestNotifications, toast } from './ui.js';
import { fmtClock, fmtDuration, uid } from './format.js';
import { BREAK_BUFF_MULT, BREAK_SWEET_SPOT_MIN, BUFF_CAP_MS, MAX_HISTORY, breakBonus } from './economy.js';
import { STATS, STAT_IDS, statIcons } from './stats.js';
import { focusElapsed, pauseFocusTimer } from './timer.js';

// [5, 10] unpacked into two constants, and "5–10 min" for messages.
const [SWEET_LO, SWEET_HI] = BREAK_SWEET_SPOT_MIN;
const SWEET_TEXT = `${SWEET_LO}–${SWEET_HI} min`;

// Other modules can ask to be called on every break tick (the map's Keep uses
// this to show the countdown). A Set is a list that ignores duplicates.
const tickListeners = new Set();
export const onBreakTick = (fn) => tickListeners.add(fn);

// "10m" for timed presets, "Open-ended" for count-up ones.
const presetLength = (p) => (p.durationMs ? fmtDuration(p.durationMs) : 'Open-ended');

// e.g. "🧠💪 ×2 for 30m", or "no bonus".
const bonusText = (categories, ms) =>
  (categories.length && ms > 0 ? `${statIcons(categories)} ×${BREAK_BUFF_MULT} for ${fmtDuration(ms)}` : 'no bonus');

// A short hint about where a break length sits on the bonus curve.
function sweetSpotNote(ms) {
  const m = ms / 60_000;
  if (m < SWEET_LO) return 'short breaks earn less';
  return m <= SWEET_HI ? '✓ sweet spot' : 'long breaks earn less';
}

// Snapshot of the active break for display, or null when not on a break.
// `remaining` is null for open-ended breaks; `text` is what the clock shows.
export function breakStatus() {
  const b = store.state.activeBreak;
  if (!b) return null;
  const elapsed = Date.now() - b.startedAt;
  const remaining = b.durationMs ? Math.max(0, b.durationMs - elapsed) : null;
  return {
    ...b,
    elapsed,
    remaining,
    text: remaining != null ? fmtClock(remaining, { ceil: true }) : fmtClock(elapsed),
    progress: b.durationMs ? Math.min(1, elapsed / b.durationMs) : null,
  };
}

// Extends (or with a negative delta, shortens) the bonus for each category.
// If a bonus is already running, the new time is added on top of it
// (stacking), but never past BUFF_CAP_MS (60 min) from now.
function grantBonus(categories, deltaMs) {
  if (!deltaMs || !categories.length) return;
  store.update('currency', (s) => {
    const now = Date.now();
    for (const c of categories) {
      s.buffs[c] = Math.min(now + BUFF_CAP_MS, Math.max(now, s.buffs[c] ?? 0) + deltaMs);
    }
  });
}

// Starts a break from a preset. Starting a new break while on one ends the
// old one first (quietly, still granting its bonus).
export function startBreak(preset) {
  primeAudio();
  requestNotifications();
  if (store.state.activeBreak) endBreak({ quiet: true });
  const pausedFocus = pauseFocusTimer();
  // The preset's details are copied in, so editing or deleting the preset
  // mid-break doesn't affect the break already running.
  store.update('break', (s) => {
    s.activeBreak = {
      presetId: preset.id,
      name: preset.name,
      icon: preset.icon,
      durationMs: preset.durationMs,
      categories: [...(preset.categories ?? [])],
      metric: preset.metric ?? null,
      startedAt: Date.now(),
    };
  });
  toast(`${preset.icon} ${preset.name}. Enjoy your break!${pausedFocus ? ' Your focus session is paused until you\'re back.' : ''}`);
}

// Ends the active break and grants its bonus right away (with default
// rating). Unless quiet, a summary lets the user refine it before closing.
//   quiet:    true when focus started or another break replaced this one
//   finished: true when a countdown ran out on its own (plays the chime)
export function endBreak({ quiet = false, finished = false } = {}) {
  const b = store.state.activeBreak;
  if (!b) return;
  // A countdown break can't count longer than its set length.
  const durationMs = Math.min(Date.now() - b.startedAt, b.durationMs ?? Infinity);
  const { quality, ms } = breakBonus({ durationMs });
  const record = { id: uid(), at: b.startedAt, name: b.name, icon: b.icon, categories: b.categories, durationMs, quality, bonusMs: ms };
  store.update('break', (s) => {
    s.activeBreak = null;
    s.breaks.unshift(record);
    s.breaks.length = Math.min(s.breaks.length, MAX_HISTORY);
  });
  // Granted now, so the bonus is safe even if the page is closed before the
  // summary dialog is answered.
  grantBonus(record.categories, record.bonusMs);
  if (finished) {
    chime();
    notify('Break over', 'Ready to focus whenever you are.');
  }
  if (quiet) {
    toast(`${b.icon} Break ended after ${fmtDuration(durationMs)} · ${bonusText(record.categories, record.bonusMs)}`);
  } else {
    openBreakSummary(b, record, finished);
  }
}

// The "Break complete" dialog: shows how good the break's length was, asks
// for the optional measure (e.g. steps) and a 1–5 "how refreshed" rating,
// and previews the resulting bonus live.
function openBreakSummary(b, record, finished) {
  const dlg = $('break-dialog');
  let rating = 3;
  let metricValue = '';
  // Bonus for the current inputs (re-run whenever they change).
  const compute = () => breakBonus({ durationMs: record.durationMs, metricValue: Number(metricValue), metricTarget: b.metric?.target, rating });

  const preview = el('div', { class: 'bonus-list' });
  function updatePreview() {
    const { ms } = compute();
    if (!record.categories.length) {
      preview.replaceChildren(el('p', { class: 'muted' }, 'This break has no stats, so it doesn\'t boost anything. You can add some in Manage presets.'));
    } else if (!ms) {
      preview.replaceChildren(el('p', { class: 'muted' }, `No bonus this time. Breaks of ${SWEET_TEXT} earn the most.`));
    } else {
      // One line per stat, e.g. "🧠 ×2  INT output  for 45m".
      preview.replaceChildren(...record.categories.map((c) => el('div', { class: 'bonus-chip' },
        el('strong', {}, `${STATS[c].icon} ×${BREAK_BUFF_MULT}`),
        el('span', {}, c === 'life' ? 'LIFE buffs' : `${STATS[c].label} output`),
        el('span', { class: 'muted' }, `for ${fmtDuration(ms)}`))));
    }
  }

  const ratingGroup = el('div', { class: 'rating', role: 'radiogroup', 'aria-label': 'How refreshed do you feel?' },
    ...[1, 2, 3, 4, 5].map((n) => el('label', {},
      el('input', { type: 'radio', name: 'break-rating', value: n, checked: n === rating, onchange: () => { rating = n; updatePreview(); } }),
      el('span', {}, n))));

  // method: 'dialog' makes the submit button simply close the dialog.
  dlg.replaceChildren(el('form', { class: 'dialog-body', method: 'dialog' },
    el('h3', {}, finished ? 'Break complete' : 'Break ended'),
    el('p', {}, `${b.icon} ${b.name} · ${fmtDuration(record.durationMs)}`),
    el('div', { class: 'quality' },
      el('div', { class: 'row' },
        el('span', { class: 'muted small' }, 'Length quality'),
        el('strong', {}, `${Math.round(record.quality * 100)}%`),
        el('span', { class: 'muted small' }, `${sweetSpotNote(record.durationMs)} (ideal ${SWEET_TEXT})`)),
      el('div', { class: 'progress' }, el('div', { style: `width:${record.quality * 100}%` }))),
    // Only shown if the preset has a measure (e.g. steps for a walk).
    b.metric && el('label', { class: 'field' }, `How many ${b.metric.unit}? (target ${b.metric.target}, optional)`,
      el('div', { class: 'input-unit' },
        el('input', { type: 'number', min: '0', step: 'any', inputMode: 'decimal', placeholder: '0', oninput: (e) => { metricValue = e.target.value; updatePreview(); } }),
        el('span', { class: 'unit' }, b.metric.unit))),
    el('div', { class: 'field' }, 'How refreshed do you feel? (1–5)', ratingGroup),
    preview,
    focusElapsed() > 0 && el('p', { class: 'muted small' }, 'Your focus session is paused. Resume it whenever you\'re ready.'),
    el('div', { class: 'row dialog-actions' },
      el('span', { class: 'grow' }),
      el('button', { type: 'submit', class: 'primary' }, 'Claim bonus'))));

  // However the dialog closes, apply the final numbers (adjusting the
  // default bonus that endBreak already granted).
  // ({ once: true } removes the listener after it runs, so it can't fire again
  // the next time this same <dialog> element is closed.)
  dlg.addEventListener('close', () => {
    const { ms } = compute();
    // Read this BEFORE the update below: `record` is the same object that's
    // stored in state.breaks, so the update overwrites its bonusMs.
    const alreadyGranted = record.bonusMs;
    store.update('break', (s) => {
      const rec = s.breaks.find((x) => x.id === record.id);
      if (rec) Object.assign(rec, { bonusMs: ms, rating, metricValue: Number(metricValue) || null });
    });
    grantBonus(record.categories, ms - alreadyGranted);
    if (ms > 0 && record.categories.length) toast(`${bonusText(record.categories, ms)}: idle output boosted!`, { kind: 'success' });
  }, { once: true });

  updatePreview();
  // If the picker dialog was already open ("End break" clicked inside it), we
  // just replaced its contents; otherwise open it.
  if (!dlg.open) dlg.showModal();
}

// ---- Picker / preset manager dialog ---------------------------------------
// Both views share the one <dialog id="break-dialog">: showPicker() and
// showManager() each replace its contents, so "Manage presets" and "Back"
// swap between them without closing the dialog.

export function openBreakPicker() {
  const dlg = $('break-dialog');

  // The grid of presets to choose from (plus the current break, if any).
  function showPicker() {
    const current = breakStatus();
    const focusRunning = store.state.timer.startedAt != null;
    const presets = store.state.breakPresets;
    dlg.replaceChildren(el('div', { class: 'dialog-body' },
      el('h3', {}, current ? 'On a break' : 'Take a break'),
      el('p', { class: 'muted small' },
        `Breaks never cost you anything, and your city keeps producing while you rest. A ${SWEET_TEXT} break earns the biggest bonus: ×${BREAK_BUFF_MULT} output for the break's stats (a LIFE break doubles Life buffs).`),
      current && el('div', { class: 'break-current' },
        el('span', { class: 'break-icon' }, current.icon),
        el('div', { class: 'grow' },
          el('strong', {}, current.name),
          el('div', { class: 'muted small' }, current.remaining != null ? `${current.text} left` : `${current.text} so far`)),
        el('button', { type: 'button', class: 'primary', onclick: () => endBreak() }, 'End break')),
      focusRunning && el('p', { class: 'muted small' }, 'Your running focus session will pause and wait for you.'),
      current && el('h4', {}, 'Switch to'),
      // One button per preset: icon, name, length and category icons.
      presets.length
        ? el('div', { class: 'preset-grid' }, presets.map((p) => el('button', {
          type: 'button',
          class: `preset${current?.presetId === p.id ? ' active' : ''}`,
          onclick: () => { startBreak(p); dlg.close(); },
        },
          el('span', { class: 'preset-icon' }, p.icon),
          el('span', { class: 'preset-name' }, p.name),
          el('span', { class: 'muted small' }, presetLength(p)),
          el('span', { class: 'preset-cats', title: (p.categories ?? []).map((c) => STATS[c].label).join(' + ') || 'No categories' },
            statIcons(p.categories) || '—'))))
        : el('p', { class: 'muted' }, 'No break presets yet. Add some with "Manage presets".'),
      el('div', { class: 'row dialog-actions' },
        el('button', { type: 'button', class: 'ghost', onclick: showManager }, 'Manage presets'),
        el('span', { class: 'grow' }),
        el('button', { type: 'button', class: 'ghost', onclick: () => dlg.close() }, 'Close'))));
  }

  // The preset editor. Edits go into `draft` (a copy), and only reach the
  // real state when "Save presets" is pressed; "Back" throws them away.
  function showManager() {
    // Copy each preset into an editable shape: minutes instead of ms, and
    // the optional measure split into two plain text fields.
    const draft = store.state.breakPresets.map((p) => ({
      ...p,
      categories: [...(p.categories ?? [])],
      minutes: p.durationMs ? p.durationMs / 60_000 : '',
      metricUnit: p.metric?.unit ?? '',
      metricTarget: p.metric?.target ?? '',
    }));
    const rows = el('div', { class: 'preset-rows' });

    // Draws one card per preset. Typing updates `draft` directly; only
    // adding or removing a preset needs a full redraw.
    function renderRows() {
      rows.replaceChildren(
        ...(draft.length ? [] : [el('p', { class: 'muted' }, 'No presets. Add one below.')]),
        ...draft.map((p, i) => el('div', { class: 'preset-card' },
          // Line 1: icon, name, minutes, delete.
          el('div', { class: 'preset-row' },
            el('input', { value: p.icon, maxLength: 4, 'aria-label': 'Icon', oninput: (e) => { p.icon = e.target.value; } }),
            el('input', { value: p.name, required: true, maxLength: 40, placeholder: 'e.g. Take a walk', 'aria-label': 'Name', oninput: (e) => { p.name = e.target.value; } }),
            el('div', { class: 'input-unit' },
              el('input', {
                type: 'number', min: '1', max: '240', step: 'any', value: p.minutes, placeholder: 'open',
                title: 'Leave blank for an open-ended break', 'aria-label': 'Minutes (blank for open-ended)',
                oninput: (e) => { p.minutes = e.target.value; },
              }),
              el('span', { class: 'unit small' }, 'min')),
            el('button', { type: 'button', class: 'ghost icon', title: 'Remove preset', onclick: () => { draft.splice(i, 1); renderRows(); } }, '✕')),
          // Line 2: category toggles (checkboxes styled as chips).
          el('div', { class: 'row preset-extra' },
            ...STAT_IDS.map((c) => el('label', { class: 'cat-toggle', title: STATS[c].hint },
              el('input', {
                type: 'checkbox', checked: p.categories.includes(c),
                onchange: (e) => { p.categories = e.target.checked ? [...p.categories, c] : p.categories.filter((x) => x !== c); },
              }),
              el('span', {}, `${STATS[c].icon} ${STATS[c].label}`)))),
          // Line 3: optional measure, e.g. "steps", target 1000.
          el('div', { class: 'row preset-measure' },
            el('span', { class: 'muted small' }, 'Measure'),
            el('input', { class: 'metric-unit', value: p.metricUnit, placeholder: 'optional, e.g. steps', 'aria-label': 'Optional measure', oninput: (e) => { p.metricUnit = e.target.value; } }),
            el('span', { class: 'muted small' }, 'target'),
            el('input', { type: 'number', class: 'metric-target', min: '0', step: 'any', value: p.metricTarget, placeholder: '—', 'aria-label': 'Measure target', oninput: (e) => { p.metricTarget = e.target.value; } })))),
      );
    }

    dlg.replaceChildren(el('form', {
      class: 'dialog-body',
      onsubmit: (e) => {
        e.preventDefault();
        // Convert the draft back to the saved shape. Unnamed presets are
        // dropped; blank or zero minutes means open-ended (null); a measure
        // needs both a name and a target above 0, otherwise it's left off.
        store.update('break', (s) => {
          s.breakPresets = draft.filter((p) => p.name.trim()).map((p) => ({
            id: p.id,
            name: p.name.trim(),
            icon: p.icon.trim() || '☕',
            durationMs: Number(p.minutes) > 0 ? Math.round(Number(p.minutes) * 60_000) : null,
            categories: STAT_IDS.filter((c) => p.categories.includes(c)),
            metric: p.metricUnit.trim() && Number(p.metricTarget) > 0 ? { unit: p.metricUnit.trim(), target: Number(p.metricTarget) } : null,
          }));
        });
        toast('Break presets saved');
        showPicker();
      },
    },
      el('h3', {}, 'Break presets'),
      el('p', { class: 'muted small' },
        `Set minutes for a countdown, or leave them blank for an open-ended break that counts up. Stats decide what gets the bonus (pick more than one for a hybrid break, like a walk for INT + STR). An optional measure, like steps, adds up to +25% to the bonus when you hit its target.`),
      rows,
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'ghost', onclick: () => { draft.push({ id: uid(), name: '', icon: '☕', minutes: 5, categories: ['int'], metricUnit: '', metricTarget: '' }); renderRows(); } }, '+ Add preset')),
      el('div', { class: 'row dialog-actions' },
        el('span', { class: 'grow' }),
        el('button', { type: 'button', class: 'ghost', onclick: showPicker }, 'Back'),
        el('button', { type: 'submit', class: 'primary' }, 'Save presets'))));
    renderRows();
  }

  showPicker();
  if (!dlg.open) dlg.showModal();
}

// ---- Banner + ticking -----------------------------------------------------
// The green "On a break" banner in the Focus Session panel. Its elements are
// built once here; render() shows/hides it and tick() updates the numbers.

export function initBreaks() {
  const banner = $('break-banner');
  const icon = el('span', { class: 'break-icon' });
  const name = el('strong');
  const time = el('span', { class: 'break-time' });
  const bonus = el('div', { class: 'muted small break-bonus' });
  const bar = el('div');
  banner.append(
    icon,
    el('div', { class: 'grow' },
      el('div', { class: 'row' }, el('span', { class: 'muted small' }, 'On a break'), name),
      bonus,
      el('div', { class: 'progress break-progress' }, bar)),
    time,
    el('button', { type: 'button', onclick: () => endBreak() }, 'End break'),
  );

  // Runs when a break starts or ends.
  function render() {
    const st = breakStatus();
    banner.hidden = !st;
    if (st) {
      icon.textContent = st.icon;
      name.textContent = st.name;
    }
    tick();
  }

  // Runs 4x per second, break or not (it's cheap when there's no break).
  function tick() {
    const st = breakStatus();
    if (st) {
      const soFar = Math.min(st.elapsed, st.durationMs ?? Infinity);
      time.textContent = st.text;
      // Live preview of the bonus you'd get by stopping right now.
      bonus.textContent = `Stop now: ${bonusText(st.categories, breakBonus({ durationMs: soFar }).ms)} · ${sweetSpotNote(soFar)}`;
      // Open-ended breaks have no end, so their bar is just shown full and faded.
      bar.style.width = st.progress == null ? '100%' : `${st.progress * 100}%`;
      bar.parentElement.classList.toggle('open-ended', st.progress == null);
      if (st.remaining === 0) endBreak({ finished: true });
    }
    for (const fn of tickListeners) fn(st);
  }

  store.subscribe('break', render);
  render();
  setInterval(tick, 250);
}
