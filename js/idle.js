// The idle loop: every skill passively generates its own currency.
import { store } from './state.js';
import { idleRate, OFFLINE_CAP_MS } from './economy.js';
import { fmtDuration, fmtNum } from './format.js';
import { toast } from './ui.js';

function generate(dtMs) {
  const gains = [];
  store.update('currency', (s) => {
    for (const skill of s.skills) {
      const amount = (idleRate(skill) * dtMs) / 1000;
      skill.currency += amount;
      gains.push([skill, amount]);
    }
    s.lastSeen = Date.now();
  });
  return gains;
}

export function initIdle() {
  const away = Math.min(Date.now() - store.state.lastSeen, OFFLINE_CAP_MS);
  if (away > 60_000 && store.state.skills.length) {
    const gains = generate(away);
    const summary = gains.map(([s, amt]) => `${s.icon} +${fmtNum(amt)}`).join('  ');
    toast(`Welcome back! While you were away (${fmtDuration(away)}): ${summary}`, { ms: 7000 });
  }

  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    generate(Math.min(now - last, OFFLINE_CAP_MS));
    last = now;
  }, 1000);
}
