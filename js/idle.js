// The idle loop: every focus passively generates its own currency, doubled
// while a break bonus is active for its category.
import { store } from './state.js';
import { BREAK_BUFF_MULT, idleRate, OFFLINE_CAP_MS } from './economy.js';
import { fmtDuration, fmtNum } from './format.js';
import { toast } from './ui.js';

// Credits generation for the time span [from, to], applying a bonus only to
// the part of the span before it expired (matters for offline progress).
function generate(from, to) {
  const gains = [];
  store.update('currency', (s) => {
    for (const skill of s.skills) {
      const buffedMs = Math.max(0, Math.min(to, s.buffs[skill.category] ?? 0) - from);
      const amount = (idleRate(skill) * (to - from + (BREAK_BUFF_MULT - 1) * buffedMs)) / 1000;
      skill.currency += amount;
      gains.push([skill, amount]);
    }
    s.lastSeen = to;
  });
  return gains;
}

export function initIdle() {
  const now = Date.now();
  const away = Math.min(now - store.state.lastSeen, OFFLINE_CAP_MS);
  if (away > 60_000 && store.state.skills.length) {
    const gains = generate(now - away, now);
    const summary = gains.map(([s, amt]) => `${s.icon} +${fmtNum(amt)}`).join('  ');
    toast(`Welcome back! While you were away (${fmtDuration(away)}): ${summary}`, { ms: 7000 });
  }

  let last = Date.now();
  setInterval(() => {
    const t = Date.now();
    generate(Math.max(last, t - OFFLINE_CAP_MS), t);
    last = t;
  }, 1000);
}
