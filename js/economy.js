// All game-balance formulas live here so they can be tuned in one place.

export const BASE_IDLE_RATE = 0.1;               // skill currency per second at level 1
export const OFFLINE_CAP_MS = 8 * 60 * 60_000;   // max idle time credited while away
export const XP_PER_POINT = 10;
export const TIME_ONLY_POINTS_PER_MIN = 0.1;     // credit for a session logged without metrics
export const MAX_HISTORY = 200;

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
    focus: Math.max(1, Math.round(minutes * mult)),
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

// Exponential moving average so recent sessions matter most.
export function nextAvgProductivity(skill, productivity) {
  return skill.sessionCount <= 1 ? productivity : skill.avgProductivity * 0.7 + productivity * 0.3;
}
