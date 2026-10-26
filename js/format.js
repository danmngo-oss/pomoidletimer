const UNITS = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No'];

export function fmtNum(n, decimals = 1) {
  if (!Number.isFinite(n)) return '0';
  const abs = Math.abs(n);
  if (abs < 1000) return abs < 100 && n % 1 ? n.toFixed(decimals) : Math.floor(n).toLocaleString();
  const e = Math.min(Math.floor(Math.log10(abs) / 3), UNITS.length);
  return (n / 1000 ** e).toFixed(2) + UNITS[e - 1];
}

export const fmtRate = (n) => (n < 1 ? n.toFixed(2) : fmtNum(n, 1));

// 1500000 -> "25:00", 5400000 -> "1:30:00"
export function fmtClock(ms, { ceil = false } = {}) {
  const total = Math.max(0, ceil ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (x) => String(x).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// 3900000 -> "1h 5m"
export function fmtDuration(ms) {
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return `${Math.max(0, Math.round(ms / 1000))}s`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
