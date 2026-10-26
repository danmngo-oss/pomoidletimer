// Breaks, started by clicking the "You" hub. They never cost anything: idle
// generation keeps running, and any focus session in progress just pauses.
// A finished break boosts idle output for foci in the break's categories;
// breaks in the sweet spot (5-10 min) earn the longest boost.
import { store } from './state.js';
import { $, el, chime, notify, primeAudio, requestNotifications, toast } from './ui.js';
import { fmtClock, fmtDuration, uid } from './format.js';
import { BREAK_BUFF_MULT, BREAK_SWEET_SPOT_MIN, BUFF_CAP_MS, MAX_HISTORY, breakBonus } from './economy.js';
import { CATEGORIES, CATEGORY_IDS, categoryIcons } from './categories.js';
import { focusElapsed, pauseFocusTimer } from './timer.js';

const [SWEET_LO, SWEET_HI] = BREAK_SWEET_SPOT_MIN;
const SWEET_TEXT = `${SWEET_LO}–${SWEET_HI} min`;

const tickListeners = new Set();
export const onBreakTick = (fn) => tickListeners.add(fn);

const presetLength = (p) => (p.durationMs ? fmtDuration(p.durationMs) : 'Open-ended');

const bonusText = (categories, ms) =>
  (categories.length && ms > 0 ? `${categoryIcons(categories)} ×${BREAK_BUFF_MULT} for ${fmtDuration(ms)}` : 'no bonus');

function sweetSpotNote(ms) {
  const m = ms / 60_000;
  if (m < SWEET_LO) return 'short breaks earn less';
  return m <= SWEET_HI ? '✓ sweet spot' : 'long breaks earn less';
}

// Snapshot of the active break for display, or null when not on a break.
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
function grantBonus(categories, deltaMs) {
  if (!deltaMs || !categories.length) return;
  store.update('currency', (s) => {
    const now = Date.now();
    for (const c of categories) {
      s.buffs[c] = Math.min(now + BUFF_CAP_MS, Math.max(now, s.buffs[c] ?? 0) + deltaMs);
    }
  });
}

export function startBreak(preset) {
  primeAudio();
  requestNotifications();
  if (store.state.activeBreak) endBreak({ quiet: true });
  const pausedFocus = pauseFocusTimer();
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
export function endBreak({ quiet = false, finished = false } = {}) {
  const b = store.state.activeBreak;
  if (!b) return;
  const durationMs = Math.min(Date.now() - b.startedAt, b.durationMs ?? Infinity);
  const { quality, ms } = breakBonus({ durationMs });
  const record = { id: uid(), at: b.startedAt, name: b.name, icon: b.icon, categories: b.categories, durationMs, quality, bonusMs: ms };
  store.update('break', (s) => {
    s.activeBreak = null;
    s.breaks.unshift(record);
    s.breaks.length = Math.min(s.breaks.length, MAX_HISTORY);
  });
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

function openBreakSummary(b, record, finished) {
  const dlg = $('break-dialog');
  let rating = 3;
  let metricValue = '';
  const compute = () => breakBonus({ durationMs: record.durationMs, metricValue: Number(metricValue), metricTarget: b.metric?.target, rating });

  const preview = el('div', { class: 'bonus-list' });
  function updatePreview() {
    const { ms } = compute();
    if (!record.categories.length) {
      preview.replaceChildren(el('p', { class: 'muted' }, 'This break has no categories, so it doesn\'t boost any foci. You can add some in Manage presets.'));
    } else if (!ms) {
      preview.replaceChildren(el('p', { class: 'muted' }, `No bonus this time. Breaks of ${SWEET_TEXT} earn the most.`));
    } else {
      preview.replaceChildren(...record.categories.map((c) => el('div', { class: 'bonus-chip' },
        el('strong', {}, `${CATEGORIES[c].icon} ×${BREAK_BUFF_MULT}`),
        el('span', {}, `${CATEGORIES[c].label} idle output`),
        el('span', { class: 'muted' }, `for ${fmtDuration(ms)}`))));
    }
  }

  const ratingGroup = el('div', { class: 'rating', role: 'radiogroup', 'aria-label': 'How refreshed do you feel?' },
    ...[1, 2, 3, 4, 5].map((n) => el('label', {},
      el('input', { type: 'radio', name: 'break-rating', value: n, checked: n === rating, onchange: () => { rating = n; updatePreview(); } }),
      el('span', {}, n))));

  dlg.replaceChildren(el('form', { class: 'dialog-body', method: 'dialog' },
    el('h3', {}, finished ? 'Break complete' : 'Break ended'),
    el('p', {}, `${b.icon} ${b.name} · ${fmtDuration(record.durationMs)}`),
    el('div', { class: 'quality' },
      el('div', { class: 'row' },
        el('span', { class: 'muted small' }, 'Length quality'),
        el('strong', {}, `${Math.round(record.quality * 100)}%`),
        el('span', { class: 'muted small' }, `${sweetSpotNote(record.durationMs)} (ideal ${SWEET_TEXT})`)),
      el('div', { class: 'progress' }, el('div', { style: `width:${record.quality * 100}%` }))),
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
  dlg.addEventListener('close', () => {
    const { ms } = compute();
    const alreadyGranted = record.bonusMs;
    store.update('break', (s) => {
      const rec = s.breaks.find((x) => x.id === record.id);
      if (rec) Object.assign(rec, { bonusMs: ms, rating, metricValue: Number(metricValue) || null });
    });
    grantBonus(record.categories, ms - alreadyGranted);
    if (ms > 0 && record.categories.length) toast(`${bonusText(record.categories, ms)}: idle output boosted!`, { kind: 'success' });
  }, { once: true });

  updatePreview();
  if (!dlg.open) dlg.showModal();
}

// ---- Picker / preset manager dialog ---------------------------------------

export function openBreakPicker() {
  const dlg = $('break-dialog');

  function showPicker() {
    const current = breakStatus();
    const focusRunning = store.state.timer.startedAt != null;
    const presets = store.state.breakPresets;
    dlg.replaceChildren(el('div', { class: 'dialog-body' },
      el('h3', {}, current ? 'On a break' : 'Take a break'),
      el('p', { class: 'muted small' },
        `Breaks never cost you anything, and your foci keep generating while you rest. A ${SWEET_TEXT} break earns the biggest bonus: ×${BREAK_BUFF_MULT} idle output for foci in the break's categories.`),
      current && el('div', { class: 'break-current' },
        el('span', { class: 'break-icon' }, current.icon),
        el('div', { class: 'grow' },
          el('strong', {}, current.name),
          el('div', { class: 'muted small' }, current.remaining != null ? `${current.text} left` : `${current.text} so far`)),
        el('button', { type: 'button', class: 'primary', onclick: () => endBreak() }, 'End break')),
      focusRunning && el('p', { class: 'muted small' }, 'Your running focus session will pause and wait for you.'),
      current && el('h4', {}, 'Switch to'),
      presets.length
        ? el('div', { class: 'preset-grid' }, presets.map((p) => el('button', {
          type: 'button',
          class: `preset${current?.presetId === p.id ? ' active' : ''}`,
          onclick: () => { startBreak(p); dlg.close(); },
        },
          el('span', { class: 'preset-icon' }, p.icon),
          el('span', { class: 'preset-name' }, p.name),
          el('span', { class: 'muted small' }, presetLength(p)),
          el('span', { class: 'preset-cats', title: (p.categories ?? []).map((c) => CATEGORIES[c].label).join(' + ') || 'No categories' },
            categoryIcons(p.categories) || '—'))))
        : el('p', { class: 'muted' }, 'No break presets yet. Add some with "Manage presets".'),
      el('div', { class: 'row dialog-actions' },
        el('button', { type: 'button', class: 'ghost', onclick: showManager }, 'Manage presets'),
        el('span', { class: 'grow' }),
        el('button', { type: 'button', class: 'ghost', onclick: () => dlg.close() }, 'Close'))));
  }

  function showManager() {
    const draft = store.state.breakPresets.map((p) => ({
      ...p,
      categories: [...(p.categories ?? [])],
      minutes: p.durationMs ? p.durationMs / 60_000 : '',
      metricUnit: p.metric?.unit ?? '',
      metricTarget: p.metric?.target ?? '',
    }));
    const rows = el('div', { class: 'preset-rows' });

    function renderRows() {
      rows.replaceChildren(
        ...(draft.length ? [] : [el('p', { class: 'muted' }, 'No presets. Add one below.')]),
        ...draft.map((p, i) => el('div', { class: 'preset-card' },
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
          el('div', { class: 'row preset-extra' },
            ...CATEGORY_IDS.map((c) => el('label', { class: 'cat-toggle', title: CATEGORIES[c].hint },
              el('input', {
                type: 'checkbox', checked: p.categories.includes(c),
                onchange: (e) => { p.categories = e.target.checked ? [...p.categories, c] : p.categories.filter((x) => x !== c); },
              }),
              el('span', {}, `${CATEGORIES[c].icon} ${CATEGORIES[c].label}`)))),
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
        store.update('break', (s) => {
          s.breakPresets = draft.filter((p) => p.name.trim()).map((p) => ({
            id: p.id,
            name: p.name.trim(),
            icon: p.icon.trim() || '☕',
            durationMs: Number(p.minutes) > 0 ? Math.round(Number(p.minutes) * 60_000) : null,
            categories: CATEGORY_IDS.filter((c) => p.categories.includes(c)),
            metric: p.metricUnit.trim() && Number(p.metricTarget) > 0 ? { unit: p.metricUnit.trim(), target: Number(p.metricTarget) } : null,
          }));
        });
        toast('Break presets saved');
        showPicker();
      },
    },
      el('h3', {}, 'Break presets'),
      el('p', { class: 'muted small' },
        `Set minutes for a countdown, or leave them blank for an open-ended break that counts up. Categories decide which foci get the bonus (pick more than one for a hybrid break). An optional measure, like steps, adds up to +25% to the bonus when you hit its target.`),
      rows,
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'ghost', onclick: () => { draft.push({ id: uid(), name: '', icon: '☕', minutes: 5, categories: ['mental'], metricUnit: '', metricTarget: '' }); renderRows(); } }, '+ Add preset')),
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

  function render() {
    const st = breakStatus();
    banner.hidden = !st;
    if (st) {
      icon.textContent = st.icon;
      name.textContent = st.name;
    }
    tick();
  }

  function tick() {
    const st = breakStatus();
    if (st) {
      const soFar = Math.min(st.elapsed, st.durationMs ?? Infinity);
      time.textContent = st.text;
      bonus.textContent = `Stop now: ${bonusText(st.categories, breakBonus({ durationMs: soFar }).ms)} · ${sweetSpotNote(soFar)}`;
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
