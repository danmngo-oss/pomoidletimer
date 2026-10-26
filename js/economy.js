// ============================================================================
// economy.js — all game-balance formulas live here so they can be tuned in
// one place. Nothing in this file touches the page or the saved state
// directly: every function takes numbers/objects in and returns results,
// which makes the maths easy to read and experiment with.
//
// The game's loop in one paragraph:
//   You log a focus session -> your reported metrics become "points" ->
//   points give the focus XP (levels) and you get ◆ Momentum -> each focus
//   passively generates its own currency every second, faster at higher
//   levels and higher productivity -> breaks temporarily double that output
//   for foci in the break's categories.
// ============================================================================

export const BASE_IDLE_RATE = 0.1;               // skill currency per second at level 1
export const OFFLINE_CAP_MS = 8 * 60 * 60_000;   // max idle time credited while away
export const XP_PER_POINT = 10;
export const TIME_ONLY_POINTS_PER_MIN = 0.1;     // credit for a session logged without metrics
export const MAX_HISTORY = 200;

// Break bonuses: a finished break multiplies idle output for foci in its
// categories until the bonus timer runs out.
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

// Passive generation: grows with level, boosted by recent productivity.
// The boost uses a logarithm so it keeps growing but with diminishing
// returns: avg 9 pts/hr -> x1.5, 99 pts/hr -> x2, 999 pts/hr -> x2.5.
export function idleRate(skill) {
  const productivityBoost = 1 + Math.log10(1 + (skill.avgProductivity || 0)) * 0.5;
  return BASE_IDLE_RATE * skill.level * productivityBoost;
}

// Is there an unexpired break bonus for this category? `buffs` maps a
// category ('mental', …) to the moment (epoch ms) its bonus ends.
export const isBuffed = (buffs, category, now = Date.now()) => (buffs?.[category] ?? 0) > now;

// Idle rate including any active break bonus for the skill's category.
export function effectiveRate(skill, buffs, now = Date.now()) {
  return idleRate(skill) * (isBuffed(buffs, skill.category, now) ? BREAK_BUFF_MULT : 1);
}

// Exponential moving average so recent sessions matter most.
// Each new session counts for 30% and the previous average for 70%.
export function nextAvgProductivity(skill, productivity) {
  return skill.sessionCount <= 1 ? productivity : skill.avgProductivity * 0.7 + productivity * 0.3;
}

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
