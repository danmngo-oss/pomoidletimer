// ============================================================================
// format.js — turns raw numbers into readable text, plus a unique-ID helper.
// These functions have no side effects; they just return strings.
// ============================================================================

// Suffixes for big numbers: thousand, million, billion, trillion, …
const UNITS = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No'];

// Idle-game style numbers: 950 -> "950", 3.25 -> "3.3", 12500 -> "12.50K".
export function fmtNum(n, decimals = 1) {
  if (!Number.isFinite(n)) return '0';
  const abs = Math.abs(n);
  // Under 1000: show one decimal only for small fractional numbers.
  if (abs < 1000) return abs < 100 && n % 1 ? n.toFixed(decimals) : Math.floor(n).toLocaleString();
  // `e` = how many groups of three digits: 1 for thousands, 2 for millions…
  const e = Math.min(Math.floor(Math.log10(abs) / 3), UNITS.length);
  return (n / 1000 ** e).toFixed(2) + UNITS[e - 1];
}

// Per-second rates are often below 1, so show two decimals there (0.15/s).
export const fmtRate = (n) => (n < 1 ? n.toFixed(2) : fmtNum(n, 1));

// Stopwatch-style display.
// 1500000 -> "25:00", 5400000 -> "1:30:00"
// `ceil` rounds up partial seconds, so a countdown shows 25:00 at the start
// and reaches 00:00 exactly when it finishes.
export function fmtClock(ms, { ceil = false } = {}) {
  const total = Math.max(0, ceil ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (x) => String(x).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// Human-friendly length of time.
// 3900000 -> "1h 5m", 10800000 -> "3h", 40000 -> "40s"
export function fmtDuration(ms) {
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return `${Math.max(0, Math.round(ms / 1000))}s`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// A random unique ID for foci, sessions, presets… Uses the browser's built-in
// randomUUID when available, otherwise builds one from the time + randomness.
export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
