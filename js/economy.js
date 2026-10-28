// ============================================================================
// economy.js — all game-balance formulas live here so they can be tuned in
// one place. Nothing in this file touches the page or saves anything: every
// function takes numbers/objects in and returns results, which makes the
// maths easy to read and experiment with.
//
// The game's loop in one paragraph:
//   You log a focus session for a unit -> your reported metrics become
//   "points" -> points give the unit XP (levels, and evolutions at set
//   levels) and you get ◆ Momentum -> Momentum buys buildings -> every unit
//   produces its stats' currencies (INT/STR/DEX) each second, more when it
//   works in a building of its own type, next to LIFE units, under a
//   higher-level Keep, or after a well-spent break. Currencies pay for
//   building and Keep upgrades.
// ============================================================================

export const BASE_IDLE_RATE = 0.1;               // currency per second at level 1
export const OFFLINE_CAP_MS = 8 * 60 * 60_000;   // max idle time credited while away
export const XP_PER_POINT = 10;
export const TIME_ONLY_POINTS_PER_MIN = 0.1;     // credit for a session logged without metrics
export const MAX_HISTORY = 200;

// Break bonuses: a finished break multiplies output for its stats until the
// bonus timer runs out (for LIFE, it doubles Life units' buffs instead).
export const BREAK_BUFF_MULT = 2;
export const BREAK_SWEET_SPOT_MIN = [5, 10];       // ideal break length, minutes
export const BREAK_BUFF_MAX_MS = 30 * 60_000;     // bonus length for an ideal break
export const BUFF_CAP_MS = 60 * 60_000;           // stacked bonuses can't exceed this
// Bonuses shorter than this are rounded down to "no bonus".
const MIN_BONUS_MS = 30_000;

// XP needed to go from `level` to the next one. Each level needs 40% more
// than the last: 100, 140, 196, 274…
export function xpToNext(level) {
  return Math.round(100 * 1.4 ** (level - 1));
}

// Units evolve when they reach these levels. On the map each stage is drawn
// a little bigger; real slime art can hook in here later.
export const EVOLUTIONS = [
  { level: 1, name: 'Droplet' },
  { level: 5, name: 'Slime' },
  { level: 10, name: 'Big Slime' },
  { level: 20, name: 'Grand Slime' },
];

// The evolution a level has reached: { stage: 0-3, name }.
export function evolution(level) {
  let stage = 0;
  EVOLUTIONS.forEach((e, i) => { if (level >= e.level) stage = i; });
  return { stage, name: EVOLUTIONS[stage].name };
}

// Raw output points: each metric converts "amount" into points via perPoint
// (e.g. 100 chars = 1 point, 1 lecture minute = 1 point).
// `values` maps metric id -> what the user typed, e.g. { m1: '1500' }.
// `reduce` walks the metrics and adds up a running total (`sum`).
export function metricPoints(skill, values) {
  return skill.metrics.reduce((sum, m) => {
    const v = Number(values[m.id]);
    return sum + (v > 0 ? v / (m.perPoint || 1) : 0);
  }, 0);
}

// Self-rated focus (1-5) nudges rewards by +-20%.
// (1 -> 0.8, 3 -> 1.0, 5 -> 1.2)
export const ratingMultiplier = (rating) => 1 + ((rating ?? 3) - 3) * 0.1;

// Everything a logged session earns. Used both for the live preview in the
// end-of-session dialog and for the real reward when you press "Log session".
export function scoreSession({ skill, values, focusMs, rating }) {
  const minutes = focusMs / 60_000;
  const output = metricPoints(skill, values);
  // No metrics entered: you still get a small reward based on time alone.
  const timeOnly = output === 0;
  const points = timeOnly ? minutes * TIME_ONLY_POINTS_PER_MIN : output;
  const mult = ratingMultiplier(rating);
  return {
    minutes,
    points,
    timeOnly,
    // Productivity = output points per focused hour; the core metric of the game.
    productivity: timeOnly || minutes === 0 ? 0 : output / (minutes / 60),
    xp: Math.max(1, Math.round(points * XP_PER_POINT * mult)),
    // Momentum (◆) is simply ~1 per focused minute, adjusted by your rating.
    momentum: Math.max(1, Math.round(minutes * mult)),
  };
}

// Adds XP and returns how many levels were gained.
// Leftover XP carries over, and a big session can level up more than once.
export function applyXp(skill, xp) {
  skill.xp += xp;
  let gained = 0;
  while (skill.xp >= xpToNext(skill.level)) {
    skill.xp -= xpToNext(skill.level);
    skill.level += 1;
    gained += 1;
  }
  return gained;
}

// A unit's base production per second, before stats, buildings and buffs.
// Grows with level, boosted by recent productivity. The boost uses a
// logarithm so it keeps growing but with diminishing returns:
// avg 9 pts/hr -> x1.5, 99 pts/hr -> x2, 999 pts/hr -> x2.5.
export function idleRate(skill) {
  const productivityBoost = 1 + Math.log10(1 + (skill.avgProductivity || 0)) * 0.5;
  return BASE_IDLE_RATE * skill.level * productivityBoost;
}

// Exponential moving average so recent sessions matter most.
// Each new session counts for 30% and the previous average for 70%.
export function nextAvgProductivity(skill, productivity) {
  return skill.sessionCount <= 1 ? productivity : skill.avgProductivity * 0.7 + productivity * 0.3;
}

// ---- The city ------------------------------------------------------------

// Hybrids: each extra stat adds 10% to a unit's total output, split evenly.
// 1 stat -> 1x, 2 stats -> 0.55x each (1.1x total), 3 -> 0.4x each (1.2x).
export const HYBRID_BONUS = 0.1;
export const hybridShare = (n) => (n > 0 ? (1 + HYBRID_BONUS * (n - 1)) / n : 0);

// Buildings. A unit working in a building of its own stat gets this bonus on
// that stat's share: +25% at level 1, +5% per level after.
export const matchBonus = (level) => 0.25 + 0.05 * (level - 1);
// Worker slots: 3 at level 1, one more per level.
export const buildingCapacity = (level) => 2 + level;
// Buying a building costs ◆ Momentum, 60% more for each one you already own
// (20, 32, 51, 82…).
export const buildCost = (owned) => Math.round(20 * 1.6 ** owned);
// Upgrading a building costs its own stat's currency, doubling each level
// (50, 100, 200…).
export const buildingUpgradeCost = (level) => Math.round(50 * 2 ** (level - 1));

// Each Life unit adds this to every other unit in its building's output:
// +10% at level 1, +1% per level after.
export const lifeAura = (unit) => 0.1 + 0.01 * (unit.level - 1);

// The Keep: +10% to all output per level above 1. Upgrading costs this much
// of EACH of INT, STR and DEX (100, 200, 400…).
export const KEEP_BONUS_PER_LEVEL = 0.1;
export const keepMultiplier = (level) => 1 + KEEP_BONUS_PER_LEVEL * (level - 1);
export const keepUpgradeCost = (level) => Math.round(100 * 2 ** (level - 1));

// Is there an unexpired break bonus for this stat? `buffs` maps a stat
// ('int', …, 'life') to the moment (epoch ms) its bonus ends.
export const isBuffed = (buffs, stat, now = Date.now()) => (buffs?.[stat] ?? 0) > now;

// Every unit's output per second at moment `now`, as a Map of
// unit id -> { int, str, dex }. Life units map to zeros.
//
// For one stat of one unit:
//   idleRate × hybridShare × Keep multiplier × (1 + Life buffs in its building)
//     × (1 + matchBonus if the building is that stat's type)
//     × 2 if that stat has a break bonus running
export function cityRates(state, now = Date.now()) {
  const keep = keepMultiplier(state.city.keepLevel);
  const lifeBreak = isBuffed(state.buffs, 'life', now) ? BREAK_BUFF_MULT : 1;
  // Total Life buff in each building.
  const aura = new Map();
  for (const u of state.skills) {
    if (u.stats.includes('life') && u.buildingId) {
      aura.set(u.buildingId, (aura.get(u.buildingId) ?? 0) + lifeAura(u) * lifeBreak);
    }
  }
  const out = new Map();
  for (const u of state.skills) {
    const rates = { int: 0, str: 0, dex: 0 };
    const stats = u.stats.filter((s) => s !== 'life');
    if (stats.length) {
      const building = u.buildingId ? state.buildings.find((b) => b.id === u.buildingId) : null;
      const base = idleRate(u) * hybridShare(stats.length) * keep * (1 + (building ? aura.get(building.id) ?? 0 : 0));
      for (const s of stats) {
        const match = building && building.type === s ? 1 + matchBonus(building.level) : 1;
        rates[s] = base * match * (isBuffed(state.buffs, s, now) ? BREAK_BUFF_MULT : 1);
      }
    }
    out.set(u.id, rates);
  }
  return out;
}

// The whole city's output per second: { int, str, dex }.
export function totalRates(state, now = Date.now()) {
  const total = { int: 0, str: 0, dex: 0 };
  for (const r of cityRates(state, now).values()) {
    total.int += r.int;
    total.str += r.str;
    total.dex += r.dex;
  }
  return total;
}

// ---- Breaks --------------------------------------------------------------

// 0..1 score for break length. Short breaks ramp up quadratically (1 min = 4%,
// 2.5 min = 25%), the sweet spot scores 100%, and long breaks fall off
// (15 min = 78%, 20 min = 37%, 30 min = ~2%).
export function breakLengthQuality(durationMs) {
  const [lo, hi] = BREAK_SWEET_SPOT_MIN;
  const m = durationMs / 60_000;
  if (m < lo) return (m / lo) ** 2;
  if (m <= hi) return 1;
  // A bell-curve style drop-off: gentle just past 10 min, steep later.
  return Math.exp(-(((m - hi) / hi) ** 2));
}

// Length of the bonus a break earns. The optional preset metric (e.g. steps)
// adds up to +25% for hitting its target, and the 1-5 "how refreshed" rating
// nudges it +-20%. Skipping either never reduces the bonus.
// Example: a 7-minute walk (quality 1) with 1000/1000 steps and rating 5
// earns 30 min x 1.25 x 1.2 = 45 minutes of x2 output.
export function breakBonus({ durationMs, metricValue, metricTarget, rating }) {
  const quality = breakLengthQuality(durationMs);
  const metric = metricTarget > 0 && metricValue > 0 ? 1 + 0.25 * Math.min(1, metricValue / metricTarget) : 1;
  const ms = BREAK_BUFF_MAX_MS * quality * metric * ratingMultiplier(rating);
  return { quality, ms: ms < MIN_BONUS_MS ? 0 : Math.round(ms) };
}
