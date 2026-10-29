// ============================================================================
// devMode.js — a developer/testing window for handing yourself currency.
//
// Turning it on and off:
//   • open the game with ?dev at the end of the address, e.g.
//       https://danmngo-oss.github.io/pomoidletimer/?dev
//     It stays on in this browser (remembered in localStorage) until you
//     press "Turn off dev mode" in the Dev window, or visit with ?dev=0.
//   • from the browser console: focusIdle.dev(true) / focusIdle.dev(false)
//
// While it's on, a 🛠 Dev button appears in the dock. The Dev window adds
// (or, with a negative number, removes) ◆ Momentum and INT/STR/DEX. Amounts
// never go below zero. Like the dock layout, the on/off switch is a browser
// preference, not part of the save file; the currency you add is saved.
// ============================================================================
import { store } from './state.js';
import { $, el, toast } from './ui.js';
import { fmtNum } from './format.js';
import { PRODUCING_STATS, STATS } from './stats.js';
import { createWindow, getWindow } from './windows.js';

const KEY = 'focusIdle.dev';
const QUICK = [100, 1000, 10000];

// Every currency the window can change: where it lives in the state, and
// how it's shown.
const CURRENCIES = [
  { id: 'momentum', label: '◆ Momentum', get: (s) => s.momentum, set: (s, v) => { s.momentum = v; } },
  ...PRODUCING_STATS.map((stat) => ({
    id: stat,
    label: `${STATS[stat].icon} ${STATS[stat].label}`,
    get: (s) => s.currencies[stat],
    set: (s, v) => { s.currencies[stat] = v; },
  })),
];

// Adds `amount` to each of the given currencies (clamped at 0).
function grant(ids, amount) {
  if (!Number.isFinite(amount) || amount === 0) return;
  store.update('currency', (s) => {
    for (const c of CURRENCIES.filter((x) => ids.includes(x.id))) c.set(s, Math.max(0, c.get(s) + amount));
  });
}

const readFlag = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
function writeFlag(on) {
  try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}

export function initDevMode() {
  // The dock button exists from the start but stays hidden while dev mode is off.
  const dockBtn = el('button', { class: 'chip', type: 'button', dataset: { windowToggle: 'dev' }, hidden: true }, '🛠 Dev');
  document.querySelector('.dock').append(dockBtn);

  // The window is only built the first time dev mode is switched on.
  let amounts = null;
  function buildWindow() {
    amounts = {};
    const rows = CURRENCIES.map((c) => {
      amounts[c.id] = el('strong', { class: 'dev-amount' });
      const input = el('input', { type: 'number', step: 'any', value: 100, 'aria-label': `Amount of ${c.label} to add` });
      const add = () => grant([c.id], Number(input.value));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
      const row = el('div', { class: 'dev-row' },
        el('span', { class: 'dev-name' }, c.label),
        amounts[c.id],
        el('div', { class: 'row' },
          input,
          el('button', { type: 'button', class: 'primary', onclick: add }, 'Add'),
          ...QUICK.map((n) => el('button', { type: 'button', class: 'chip', onclick: () => grant([c.id], n) }, `+${fmtNum(n)}`)),
          el('button', { type: 'button', class: 'chip', title: 'Set to zero', onclick: () => grant([c.id], -c.get(store.state)) }, '0')));
      if (STATS[c.id]) row.style.setProperty('--stat-color', STATS[c.id].color);
      return row;
    });
    const all = CURRENCIES.map((c) => c.id);
    const body = el('div', {},
      el('p', { class: 'muted small' }, 'Testing tool: add currency freely. A negative amount takes some away.'),
      ...rows,
      el('div', { class: 'row' },
        el('span', { class: 'muted small grow' }, 'Everything:'),
        ...QUICK.map((n) => el('button', { type: 'button', class: 'chip', onclick: () => grant(all, n) }, `+${fmtNum(n)}`))),
      el('div', { class: 'row' },
        el('span', { class: 'grow' }),
        el('button', { type: 'button', class: 'ghost danger', onclick: () => setDevMode(false) }, 'Turn off dev mode')));

    store.subscribe('currency', renderAmounts);
    createWindow({
      id: 'dev', title: 'Dev', icon: '🛠', body, width: 420,
      defaultPos: () => ({ x: innerWidth - 436, y: Math.max(130, innerHeight - 420) }),
      onOpen: renderAmounts,
    });
  }

  function renderAmounts() {
    if (!amounts) return;
    for (const c of CURRENCIES) amounts[c.id].textContent = fmtNum(c.get(store.state));
  }

  function setDevMode(on, { announce = true } = {}) {
    writeFlag(on);
    dockBtn.hidden = !on;
    if (on) {
      if (!getWindow('dev')) buildWindow();
      // When switched on just now, show the window; on a normal page load
      // it keeps whatever open/closed state it was left in.
      if (announce) getWindow('dev').open();
    } else {
      getWindow('dev')?.close();
    }
    if (announce) toast(on ? 'Dev mode on: 🛠 Dev is in the dock' : 'Dev mode off');
  }

  // ?dev (or ?dev=1) switches it on, ?dev=0 off; otherwise use the saved flag.
  const param = new URLSearchParams(location.search).get('dev');
  if (param !== null) setDevMode(param !== '0' && param !== 'false');
  else if (readFlag()) setDevMode(true, { announce: false });

  return setDevMode;
}
