import { store } from './state.js';
import { $, el } from './ui.js';

const FALLBACK_ZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Africa/Cairo',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland',
];

function zoneList() {
  let zones = [];
  try { zones = Intl.supportedValuesOf('timeZone'); } catch { /* older browser */ }
  if (!zones.length) zones = FALLBACK_ZONES;
  return zones.includes('UTC') ? zones : ['UTC', ...zones];
}

function isValidZone(zone) {
  try { new Intl.DateTimeFormat(undefined, { timeZone: zone }); return true; } catch { return false; }
}

const prettyZone = (zone) => zone.replace(/_/g, ' ').replace(/\//g, ' / ');

const formatters = new Map();
function formatter(zone, hour12, kind) {
  const key = `${zone}|${hour12}|${kind}`;
  if (!formatters.has(key)) {
    const hourCycle = hour12 ? 'h12' : 'h23';
    const options = {
      time: { hour: hour12 ? 'numeric' : '2-digit', minute: '2-digit', second: '2-digit', hourCycle },
      short: { weekday: 'short', hour: hour12 ? 'numeric' : '2-digit', minute: '2-digit', hourCycle },
      date: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' },
      offset: { timeZoneName: 'shortOffset' },
    }[kind];
    formatters.set(key, new Intl.DateTimeFormat(undefined, { timeZone: zone, ...options }));
  }
  return formatters.get(key);
}

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

  if (!isValidZone(store.state.clock.timeZone)) {
    store.update('clock', (s) => { s.clock.timeZone = 'UTC'; });
  }

  const options = () => zones.map((z) => el('option', { value: z }, prettyZone(z)));
  zoneSelect.append(...options());
  addSelect.append(el('option', { value: '' }, 'Add a clock…'), ...options());

  zoneSelect.addEventListener('change', () => store.update('clock', (s) => { s.clock.timeZone = zoneSelect.value; }));
  formatBtn.addEventListener('click', () => store.update('clock', (s) => { s.clock.hour12 = !s.clock.hour12; }));
  $('clock-add').addEventListener('click', () => {
    const zone = addSelect.value;
    if (!zone) return;
    store.update('clock', (s) => { if (!s.clock.extraZones.includes(zone)) s.clock.extraZones.push(zone); });
    addSelect.value = '';
  });

  function render() {
    const { clock } = store.state;
    zoneSelect.value = clock.timeZone;
    formatBtn.textContent = clock.hour12 ? '12h' : '24h';
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
