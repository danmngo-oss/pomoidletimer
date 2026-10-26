// ============================================================================
// clock.js — the World Clock panel: a big clock for one chosen time zone, a
// 12h/24h toggle, and a list of extra clocks for other zones.
//
// All the time-zone maths is done by the browser's built-in Intl API
// (Intl.DateTimeFormat), which knows every zone and its daylight-saving
// rules. We only tell it which zone and which format we want.
// ============================================================================
import { store } from './state.js';
import { $, el } from './ui.js';

// Used only if the browser can't list its time zones (very old browsers).
const FALLBACK_ZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Africa/Cairo',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland',
];

// Every zone the browser knows (~400 names like "Europe/Paris"), UTC first.
function zoneList() {
  let zones = [];
  try { zones = Intl.supportedValuesOf('timeZone'); } catch { /* older browser */ }
  if (!zones.length) zones = FALLBACK_ZONES;
  return zones.includes('UTC') ? zones : ['UTC', ...zones];
}

// Intl throws an error for unknown zone names, which we use as the check.
function isValidZone(zone) {
  try { new Intl.DateTimeFormat(undefined, { timeZone: zone }); return true; } catch { return false; }
}

// "America/New_York" -> "America / New York" for the dropdowns.
const prettyZone = (zone) => zone.replace(/_/g, ' ').replace(/\//g, ' / ');

// Creating a formatter is relatively slow and we format several times per
// second, so each one is built once and kept in this cache, keyed by
// zone + 12/24h + which kind of text we want.
const formatters = new Map();
function formatter(zone, hour12, kind) {
  const key = `${zone}|${hour12}|${kind}`;
  if (!formatters.has(key)) {
    // h12 = 1–12 with AM/PM, h23 = 00–23.
    const hourCycle = hour12 ? 'h12' : 'h23';
    // The four kinds of text we display, picked by `kind`:
    //   time   -> "1:10:33 PM"         (big clock)
    //   short  -> "Mon 09:29"          (extra clocks list)
    //   date   -> "Monday, October 26, 2026"
    //   offset -> "GMT+9"
    const options = {
      time: { hour: hour12 ? 'numeric' : '2-digit', minute: '2-digit', second: '2-digit', hourCycle },
      short: { weekday: 'short', hour: hour12 ? 'numeric' : '2-digit', minute: '2-digit', hourCycle },
      date: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' },
      offset: { timeZoneName: 'shortOffset' },
    }[kind];
    // `undefined` as the locale means "use the visitor's own language settings".
    formatters.set(key, new Intl.DateTimeFormat(undefined, { timeZone: zone, ...options }));
  }
  return formatters.get(key);
}

// Just the "GMT+9" part. formatToParts splits a formatted date into labelled
// pieces, and we keep only the piece labelled timeZoneName.
function offsetLabel(zone, date) {
  try {
    return formatter(zone, false, 'offset').formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

export function initClock() {
  const zones = zoneList();
  const zoneSelect = $('clock-zone');
  const addSelect = $('clock-add-zone');
  const list = $('clock-list');
  const formatBtn = $('clock-format');

  // A save from another browser might name a zone this browser doesn't know.
  if (!isValidZone(store.state.clock.timeZone)) {
    store.update('clock', (s) => { s.clock.timeZone = 'UTC'; });
  }

  // Fill both dropdowns with every zone (done once; the list never changes).
  const options = () => zones.map((z) => el('option', { value: z }, prettyZone(z)));
  zoneSelect.append(...options());
  addSelect.append(el('option', { value: '' }, 'Add a clock…'), ...options());

  // Controls only change the state; the 'clock' subscription below redraws.
  zoneSelect.addEventListener('change', () => store.update('clock', (s) => { s.clock.timeZone = zoneSelect.value; }));
  formatBtn.addEventListener('click', () => store.update('clock', (s) => { s.clock.hour12 = !s.clock.hour12; }));
  $('clock-add').addEventListener('click', () => {
    const zone = addSelect.value;
    if (!zone) return;
    store.update('clock', (s) => { if (!s.clock.extraZones.includes(zone)) s.clock.extraZones.push(zone); });
    addSelect.value = '';
  });

  // Rebuilds the panel's structure (runs when clock settings change). The
  // times themselves are filled in by tick().
  function render() {
    const { clock } = store.state;
    zoneSelect.value = clock.timeZone;
    formatBtn.textContent = clock.hour12 ? '12h' : '24h';
    // One <li> per extra zone; the zone name is stored on the element
    // (data-zone) so tick() knows which zone each row shows.
    list.replaceChildren(...clock.extraZones.map((zone) =>
      el('li', { dataset: { zone } },
        el('div', {},
          el('div', { class: 'zone-name' }, prettyZone(zone)),
          el('div', { class: 'muted zone-offset' })),
        el('div', { class: 'zone-time' }),
        el('button', {
          class: 'ghost icon', type: 'button', title: 'Remove', 'aria-label': `Remove ${zone}`,
          onclick: () => store.update('clock', (s) => { s.clock.extraZones = s.clock.extraZones.filter((z) => z !== zone); }),
        }, '✕'))));
    tick();
  }

  // Updates just the text of every clock. Runs once per second.
  function tick() {
    const now = new Date();
    const { hour12, timeZone } = store.state.clock;
    $('clock-time').textContent = formatter(timeZone, hour12, 'time').format(now);
    $('clock-date').textContent = `${formatter(timeZone, hour12, 'date').format(now)} · ${offsetLabel(timeZone, now)}`;
    for (const li of list.children) {
      const zone = li.dataset.zone;
      li.querySelector('.zone-time').textContent = formatter(zone, hour12, 'short').format(now);
      li.querySelector('.zone-offset').textContent = offsetLabel(zone, now);
    }
  }

  store.subscribe('clock', render);
  render();
  // Align ticks to the start of each second so the display never lags.
  setTimeout(() => { tick(); setInterval(tick, 1000); }, 1000 - (Date.now() % 1000));
}
