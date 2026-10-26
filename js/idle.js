// ============================================================================
// idle.js — the "idle" in idle game: every focus passively generates its own
// currency, doubled while a break bonus is active for its category.
//
// Two things happen here:
//   1. On page load, pay out what was earned while the page was closed
//      ("offline progress"), capped at OFFLINE_CAP_MS (8 hours).
//   2. Every second after that, pay out the last second's earnings.
// ============================================================================
import { store } from './state.js';
import { BREAK_BUFF_MULT, idleRate, OFFLINE_CAP_MS } from './economy.js';
import { fmtDuration, fmtNum } from './format.js';
import { toast } from './ui.js';

// Credits generation for the time span [from, to], applying a bonus only to
// the part of the span before it expired (matters for offline progress).
//
// Example: you were away 60 min and the Mental bonus ran out 20 min in.
// buffedMs = 20 min, so a Mental focus earns 60 normal minutes plus 20 extra
// minutes (the doubled part) = 80 minutes' worth of its base rate.
function generate(from, to) {
  const gains = [];
  store.update('currency', (s) => {
    for (const skill of s.skills) {
      const buffedMs = Math.max(0, Math.min(to, s.buffs[skill.category] ?? 0) - from);
      // Rates are per second and times are in ms, hence the / 1000.
      const amount = (idleRate(skill) * (to - from + (BREAK_BUFF_MULT - 1) * buffedMs)) / 1000;
      skill.currency += amount;
      gains.push([skill, amount]);
    }
    s.lastSeen = to;
  });
  return gains;
}

export function initIdle() {
  // Offline progress: how long since the game last ran (lastSeen is updated
  // every tick and saved), up to the cap. Short gaps (< 1 min) skip the toast.
  const now = Date.now();
  const away = Math.min(now - store.state.lastSeen, OFFLINE_CAP_MS);
  if (away > 60_000 && store.state.skills.length) {
    const gains = generate(now - away, now);
    const summary = gains.map(([s, amt]) => `${s.icon} +${fmtNum(amt)}`).join('  ');
    toast(`Welcome back! While you were away (${fmtDuration(away)}): ${summary}`, { ms: 7000 });
  }

  // The live tick. We measure the real time since the last tick instead of
  // assuming exactly 1000ms, because browsers slow timers down in background
  // tabs — this way you're paid correctly however late the tick fires.
  let last = Date.now();
  setInterval(() => {
    const t = Date.now();
    generate(Math.max(last, t - OFFLINE_CAP_MS), t);
    last = t;
  }, 1000);
}
