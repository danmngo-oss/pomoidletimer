// ============================================================================
// buildingWindow.js — a window showing the inside of one building: a slot
// for each worker place, the building's bonus, and Upgrade / Demolish.
//
//   • drag a unit from the Units window (or the map) into the slots to put
//     it to work, or click an empty slot to open the Units window, where
//     each card gets a "➜" button that sends units here
//   • drag a worker out (to the Units window, another building or the map),
//     or press its ✕, to take it off work
//
// One window per building: clicking the building on the map again brings
// its window to the front. Opened from cityMap.js.
// ============================================================================
import { store } from './state.js';
import { el } from './ui.js';
import { fmtNum } from './format.js';
import { STATS, statIcons } from './stats.js';
import { buildingCapacity, buildingUpgradeCost, lifeAura, matchBonus } from './economy.js';
import { BUILDING_TYPES, assignUnit, demolishBuilding, getBuilding, unitsIn, upgradeBuilding } from './buildings.js';
import { createWindow, getWindow } from './windows.js';
import { makeUnitDraggable } from './unitDrag.js';
import { unitIcon } from './unitArt.js';
import { selectSkill } from './skills.js';

const pct = (x) => `${Math.round(x * 100)}%`;
// Counts windows opened, so each new one appears a little offset.
let opened = 0;

export function openBuildingWindow(buildingId) {
  const id = `building:${buildingId}`;
  const existing = getWindow(id);
  if (existing) return existing.open();

  const info = el('p', { class: 'muted small' });
  // The slots are the drop zone for putting units to work here.
  const slots = el('div', { class: 'building-slots', dataset: { dropBuilding: buildingId } });
  const upgradeBtn = el('button', { type: 'button', class: 'primary', onclick: () => upgradeBuilding(buildingId) });
  const body = el('div', {},
    info,
    slots,
    el('div', { class: 'row' },
      el('button', {
        type: 'button', class: 'ghost danger',
        onclick: () => {
          const b = getBuilding(buildingId);
          if (b && confirm(`Demolish this ${BUILDING_TYPES[b.type].name}? There's no refund; its workers return to the city.`)) demolishBuilding(buildingId);
        },
      }, 'Demolish'),
      el('span', { class: 'grow' }),
      upgradeBtn));

  const n = opened++ % 6;
  let unsubscribe = () => {};
  const win = createWindow({
    id, title: '', body, width: 380, transient: true,
    defaultPos: () => ({ x: innerWidth / 2 - 190 + n * 28, y: 170 + n * 28 }),
    onClose: () => unsubscribe(),
  });

  function workerSlot(u) {
    const slot = el('div', {
      class: `slot filled${u.id === store.state.selectedSkillId ? ' selected' : ''}`,
      tabindex: 0,
      title: `${u.name}: click to select, drag out or press ✕ to take off work`,
    },
      unitIcon(u, 40),
      el('span', { class: 'slot-name' }, u.name),
      el('span', { class: 'muted small' }, `${statIcons(u.stats)} Lv ${u.level}`),
      el('button', {
        type: 'button', class: 'ghost icon slot-remove', title: 'Take off work', 'aria-label': `Take ${u.name} off work`,
        onclick: () => assignUnit(u.id, null),
      }, '✕'));
    makeUnitDraggable(slot, u.id, { onClick: () => selectSkill(u.id) });
    slot.addEventListener('keydown', (e) => {
      if (e.target === slot && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectSkill(u.id); }
    });
    return slot;
  }

  // Clicking an empty slot opens the Units window; since this building's
  // window is the most recently used one, its cards offer "➜" buttons here.
  const emptySlot = () => el('button', {
    type: 'button', class: 'slot empty', title: 'Open the Units window to send someone here',
    onclick: () => getWindow('units')?.open(),
  }, el('span', { class: 'slot-plus' }, '+'), el('span', { class: 'muted small' }, 'Drop a unit here'));

  function render() {
    const s = store.state;
    const b = getBuilding(buildingId);
    // Demolished: close the window.
    if (!b) return win.close();
    const type = BUILDING_TYPES[b.type];
    const workers = unitsIn(s, buildingId);
    const cap = buildingCapacity(b.level);
    const aura = workers.filter((u) => u.stats.includes('life')).reduce((sum, u) => sum + lifeAura(u), 0);
    win.setTitle(`${type.name} · Lv ${b.level} · ${workers.length}/${cap}`, type.icon);
    info.textContent = `${STATS[b.type].icon} ${STATS[b.type].label} units get +${pct(matchBonus(b.level))} ${STATS[b.type].label} here. `
      + (aura ? `LIFE workers add +${pct(aura)} to everyone else here.` : 'Add a LIFE unit to buff everyone working here.');
    slots.style.setProperty('--slot-color', STATS[b.type].color);
    slots.replaceChildren(...Array.from({ length: cap }, (_, i) => (workers[i] ? workerSlot(workers[i]) : emptySlot())));
    updateUpgrade();
  }

  // Runs every second as currencies change, so the button enables as soon
  // as you can afford the upgrade.
  function updateUpgrade() {
    const b = getBuilding(buildingId);
    if (!b) return;
    const cost = buildingUpgradeCost(b.level);
    upgradeBtn.textContent = `Upgrade · ${fmtNum(cost)} ${STATS[b.type].label}`;
    upgradeBtn.disabled = store.state.currencies[b.type] < cost;
    upgradeBtn.title = `Adds a worker slot and +5% bonus. You have ${fmtNum(store.state.currencies[b.type])} ${STATS[b.type].label}.`;
  }

  const offStructure = store.subscribe(['skills', 'city', 'selection'], render);
  const offCurrency = store.subscribe('currency', updateUpgrade);
  unsubscribe = () => { offStructure(); offCurrency(); };
  render();
}
