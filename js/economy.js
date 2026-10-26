// All game-balance formulas live here so they can be tuned in one place.

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
const MIN_BONUS_MS = 30_000;

export function xpToNext(level) {
  return Math.round(100 * 1.4 ** (level - 1));
}

// Raw output points: each metric converts "amount" into points via perPoint
// (e.g. 100 chars = 1 point, 1 lecture minute = 1 point).
export function metricPoints(skill, values) {
  return skill.metrics.reduce((sum, m) => {
    const v = Number(values[m.id]);
    return sum + (v > 0 ? v / (m.perPoint || 1) : 0);
  }, 0);
}

// Self-rated focus (1-5) nudges rewards by +-20%.
export const ratingMultiplier = (rating) => 1 + ((rating ?? 3) - 3) * 0.1;

export function scoreSession({ skill, values, focusMs, rating }) {
  const minutes = focusMs / 60_000;
  const output = metricPoints(skill, values);
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
    momentum: Math.max(1, Math.round(minutes * mult)),
  };
}

// Adds XP and returns how many levels were gained.
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
export function idleRate(skill) {
  const productivityBoost = 1 + Math.log10(1 + (skill.avgProductivity || 0)) * 0.5;
  return BASE_IDLE_RATE * skill.level * productivityBoost;
}

export const isBuffed = (buffs, category, now = Date.now()) => (buffs?.[category] ?? 0) > now;

// Idle rate including any active break bonus for the skill's category.
export function effectiveRate(skill, buffs, now = Date.now()) {
  return idleRate(skill) * (isBuffed(buffs, skill.category, now) ? BREAK_BUFF_MULT : 1);
}

// Exponential moving average so recent sessions matter most.
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
  return Math.exp(-(((m - hi) / hi) ** 2));
}

// Length of the bonus a break earns. The optional preset metric (e.g. steps)
// adds up to +25% for hitting its target, and the 1-5 "how refreshed" rating
// nudges it +-20%. Skipping either never reduces the bonus.
export function breakBonus({ durationMs, metricValue, metricTarget, rating }) {
  const quality = breakLengthQuality(durationMs);
  const metric = metricTarget > 0 && metricValue > 0 ? 1 + 0.25 * Math.min(1, metricValue / metricTarget) : 1;
  const ms = BREAK_BUFF_MAX_MS * quality * metric * ratingMultiplier(rating);
  return { quality, ms: ms < MIN_BONUS_MS ? 0 : Math.round(ms) };
}
