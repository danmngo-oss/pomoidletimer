// ============================================================================
// idle.js — the "idle" in idle game: every second, each unit adds its output
// to the city's INT, STR and DEX currencies (see cityRates in economy.js for
// how buildings, Life units, the Keep and break bonuses shape that output).
//
// Two things happen here:
//   1. On page load, pay out what was earned while the page was closed
//      ("offline progress"), capped at OFFLINE_CAP_MS (8 hours).
//   2. Every second after that, pay out the last second's earnings.
// ============================================================================
import { store } from './state.js';
import { OFFLINE_CAP_MS, totalRates } from './economy.js';
import { fmtDuration, fmtNum } from './format.js';
import { PRODUCING_STATS, STATS } from './stats.js';
import { toast } from './ui.js';

// Credits production for the time span [from, to] and returns the gains.
//
// Rates change when a break bonus expires, so the span is cut at every
// expiry that falls inside it and each piece is paid at the rates that were
// really in effect then. Example: away 60 min, the INT bonus ended 20 min
// in -> 20 min at the doubled INT rate, then 40 min at the normal rate.
function generate(from, to) {
  const gains = { int: 0, str: 0, dex: 0 };
  store.update('currency', (s) => {
    const cuts = Object.values(s.buffs).filter((t) => t > from && t < to);
    const points = [from, ...[...new Set(cuts)].sort((a, b) => a - b), to];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      // Measure the rates in the middle of the piece, safely away from the
      // exact moment a bonus switches off.
      const rates = totalRates(s, (a + b) / 2);
      // Rates are per second and times are in ms, hence the / 1000.
      for (const stat of PRODUCING_STATS) gains[stat] += (rates[stat] * (b - a)) / 1000;
    }
    for (const stat of PRODUCING_STATS) s.currencies[stat] += gains[stat];
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
    const summary = PRODUCING_STATS.map((stat) => `${STATS[stat].icon} +${fmtNum(gains[stat])}`).join('  ');
    toast(`Welcome back! While you were away (${fmtDuration(away)}) your city made ${summary}`, { ms: 7000 });
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
