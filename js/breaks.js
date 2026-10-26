// Breaks, started by clicking the "You" hub. They never cost anything: idle
// generation keeps running, and any focus session in progress just pauses.
import { store } from './state.js';
import { $, el, chime, notify, primeAudio, requestNotifications, toast } from './ui.js';
import { fmtClock, fmtDuration, uid } from './format.js';
import { MAX_HISTORY } from './economy.js';
import { focusElapsed, pauseFocusTimer } from './timer.js';

const tickListeners = new Set();
export const onBreakTick = (fn) => tickListeners.add(fn);

const presetLength = (p) => (p.durationMs ? fmtDuration(p.durationMs) : 'Open-ended');

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

export function startBreak(preset) {
  primeAudio();
  requestNotifications();
  if (store.state.activeBreak) endBreak({ quiet: true });
  const pausedFocus = pauseFocusTimer();
  store.update('break', (s) => {
    s.activeBreak = { presetId: preset.id, name: preset.name, icon: preset.icon, durationMs: preset.durationMs, startedAt: Date.now() };
  });
  toast(`${preset.icon} ${preset.name}. Enjoy your break!${pausedFocus ? ' Your focus session is paused until you\'re back.' : ''}`);
}

export function endBreak({ quiet = false, finished = false } = {}) {
  const b = store.state.activeBreak;
  if (!b) return;
  const durationMs = Math.min(Date.now() - b.startedAt, b.durationMs ?? Infinity);
  store.update('break', (s) => {
    s.activeBreak = null;
    s.breaks.unshift({ id: uid(), at: b.startedAt, name: b.name, icon: b.icon, durationMs });
    s.breaks.length = Math.min(s.breaks.length, MAX_HISTORY);
  });
  if (finished) {
    chime();
    notify('Break over', 'Ready to focus whenever you are.');
  }
  if (!quiet) {
    const resume = focusElapsed() > 0 ? ' Resume your focus session when you\'re ready.' : '';
    toast(`${b.icon} ${finished ? 'Break over' : 'Break ended'} after ${fmtDuration(durationMs)}.${resume}`, { kind: 'success' });
  }
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
        'Breaks never cost you anything. Your skills keep generating while you rest, and it\'s a good time to adjust your timer or rearrange your skill map.'),
      current && el('div', { class: 'break-current' },
        el('span', { class: 'break-icon' }, current.icon),
        el('div', { class: 'grow' },
          el('strong', {}, current.name),
          el('div', { class: 'muted small' }, current.remaining != null ? `${current.text} left` : `${current.text} so far`)),
        el('button', { type: 'button', class: 'primary', onclick: () => { endBreak(); dlg.close(); } }, 'End break')),
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
          el('span', { class: 'muted small' }, presetLength(p)))))
        : el('p', { class: 'muted' }, 'No break presets yet. Add some with "Manage presets".'),
      el('div', { class: 'row dialog-actions' },
        el('button', { type: 'button', class: 'ghost', onclick: showManager }, 'Manage presets'),
        el('span', { class: 'grow' }),
        el('button', { type: 'button', class: 'ghost', onclick: () => dlg.close() }, 'Close'))));
  }

  function showManager() {
    const draft = store.state.breakPresets.map((p) => ({ ...p, minutes: p.durationMs ? p.durationMs / 60_000 : '' }));
    const rows = el('div', { class: 'preset-rows' });

    function renderRows() {
      rows.replaceChildren(
        ...(draft.length
          ? [el('div', { class: 'preset-row preset-head muted' }, el('span', {}, 'Icon'), el('span', {}, 'Name'), el('span', {}, 'Minutes'), el('span'))]
          : [el('p', { class: 'muted' }, 'No presets. Add one below.')]),
        ...draft.map((p, i) => el('div', { class: 'preset-row' },
          el('input', { value: p.icon, maxLength: 4, 'aria-label': 'Icon', oninput: (e) => { p.icon = e.target.value; } }),
          el('input', { value: p.name, required: true, maxLength: 40, placeholder: 'e.g. Take a walk', 'aria-label': 'Name', oninput: (e) => { p.name = e.target.value; } }),
          el('input', {
            type: 'number', min: '1', max: '240', step: 'any', value: p.minutes, placeholder: 'open',
            title: 'Leave blank for an open-ended break', 'aria-label': 'Minutes (blank for open-ended)',
            oninput: (e) => { p.minutes = e.target.value; },
          }),
          el('button', { type: 'button', class: 'ghost icon', title: 'Remove preset', onclick: () => { draft.splice(i, 1); renderRows(); } }, '✕'))),
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
          }));
        });
        toast('Break presets saved');
        showPicker();
      },
    },
      el('h3', {}, 'Break presets'),
      el('p', { class: 'muted small' }, 'Set minutes for a countdown, or leave them blank for an open-ended break that counts up.'),
      rows,
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'ghost', onclick: () => { draft.push({ id: uid(), name: '', icon: '☕', minutes: 5 }); renderRows(); } }, '+ Add preset')),
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
  const bar = el('div');
  banner.append(
    icon,
    el('div', { class: 'grow' },
      el('div', { class: 'row' }, el('span', { class: 'muted small' }, 'On a break'), name),
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
      time.textContent = st.text;
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
