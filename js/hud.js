// ============================================================================
// hud.js — the currency bar under the top panels ("heads-up display"):
// ◆ Momentum, each stat currency with its production per second, and a chip
// with a countdown for each active break bonus.
// It redraws every second, driven by the idle loop's 'currency' updates.
// ============================================================================
import { store } from './state.js';
import { $, el } from './ui.js';
import { fmtClock, fmtNum, fmtRate } from './format.js';
import { BREAK_BUFF_MULT, totalRates } from './economy.js';
import { PRODUCING_STATS, STATS, STAT_IDS } from './stats.js';

export function initHud() {
  const bar = $('currency-bar');
  // The number elements are built once; only their text changes.
  const momentum = el('strong');
  const amounts = {};
  const rates = {};
  const buffs = el('div', { class: 'hud-buffs' });
  bar.append(
    el('div', { class: 'currency', title: 'Momentum: earned by logging focus sessions. Buys buildings.' },
      el('span', { class: 'currency-name' }, '◆ Momentum'), momentum),
    ...PRODUCING_STATS.map((stat) => {
      amounts[stat] = el('strong');
      rates[stat] = el('span', { class: 'muted small' });
      const item = el('div', { class: 'currency', title: `${STATS[stat].label} (${STATS[stat].name}): produced by ${STATS[stat].label} units` },
        el('span', { class: 'currency-name' }, `${STATS[stat].icon} ${STATS[stat].label}`), amounts[stat], rates[stat]);
      item.style.setProperty('--stat-color', STATS[stat].color);
      return item;
    }),
    buffs,
  );

  function render() {
    const s = store.state;
    const now = Date.now();
    const perSec = totalRates(s, now);
    momentum.textContent = fmtNum(s.momentum);
    for (const stat of PRODUCING_STATS) {
      amounts[stat].textContent = fmtNum(s.currencies[stat]);
      rates[stat].textContent = `+${fmtRate(perSec[stat])}/s`;
    }
    // One chip per stat whose break bonus hasn't expired, e.g. "🧠 ×2 12:30".
    buffs.replaceChildren(...STAT_IDS
      .filter((stat) => (s.buffs[stat] ?? 0) > now)
      .map((stat) => el('span', {
        class: 'buff-chip',
        title: stat === 'life' ? 'Life units\' buffs are doubled by a break bonus' : `${STATS[stat].label} output is doubled by a break bonus`,
      }, `${STATS[stat].icon} ×${BREAK_BUFF_MULT} ${fmtClock(s.buffs[stat] - now, { ceil: true })}`)));
  }

  store.subscribe(['currency', 'skills', 'city'], render);
  render();
}
