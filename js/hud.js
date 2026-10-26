// Top bar: currency totals.
import { store } from './state.js';
import { $, el } from './ui.js';
import { fmtNum, fmtRate } from './format.js';
import { idleRate } from './economy.js';

export function initHud() {
  const hud = $('hud');
  const focus = el('strong');
  const rate = el('strong');
  const skillCurrency = el('strong');
  hud.append(
    el('div', { class: 'hud-item', title: 'Focus — earned by logging sessions' }, el('span', { class: 'muted' }, '◆ Focus'), focus),
    el('div', { class: 'hud-item', title: 'Combined skill currency' }, el('span', { class: 'muted' }, '✦ Skill currency'), skillCurrency),
    el('div', { class: 'hud-item', title: 'Passive generation across all skills' }, el('span', { class: 'muted' }, '⚡ Idle'), rate),
  );

  function render() {
    const { skills } = store.state;
    focus.textContent = fmtNum(store.state.focus);
    skillCurrency.textContent = fmtNum(skills.reduce((sum, s) => sum + s.currency, 0));
    rate.textContent = `${fmtRate(skills.reduce((sum, s) => sum + idleRate(s), 0))}/s`;
  }

  store.subscribe(['currency', 'skills'], render);
  render();
}
