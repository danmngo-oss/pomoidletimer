// ============================================================================
// buildings.js — the city's buildings and the Keep: buying, upgrading,
// moving and assigning units, plus the Build menu and Keep dialogs. (Each
// building's own window, showing its interior, is in buildingWindow.js.)
//
// A building is { id, type, level, tile }. Its type is a stat ('int', 'str'
// or 'dex'): units with that stat get a bonus working there, but any unit
// can work in any building. Buildings are bought with ◆ Momentum and
// upgraded with their own stat's currency (more worker slots, bigger bonus).
//
// The Keep is the central building (state.city.keepLevel). Upgrading it,
// with INT + STR + DEX, raises the whole city's output. Clicking it on the
// map takes a break (breaks.js); its upgrade dialog lives here.
//
// All the numbers come from economy.js.
// ============================================================================
import { store } from './state.js';
import { $, el, toast } from './ui.js';
import { fmtNum, uid } from './format.js';
import { STATS, PRODUCING_STATS } from './stats.js';
import {
  buildCost, buildingCapacity, buildingUpgradeCost, keepMultiplier, keepUpgradeCost, matchBonus,
} from './economy.js';
import { nearestFreeTile } from './grid.js';

// Names and icons for the three building types (keyed by stat).
export const BUILDING_TYPES = {
  int: { name: 'Library', icon: '📚' },
  str: { name: 'Forge', icon: '⚒️' },
  dex: { name: 'Workshop', icon: '🛠️' },
};

export const getBuilding = (id) => store.state.buildings.find((b) => b.id === id);
export const unitsIn = (state, buildingId) => state.skills.filter((u) => u.buildingId === buildingId);
const pct = (x) => `${Math.round(x * 100)}%`;

// ---- Actions ---------------------------------------------------------------

// Buys a building of `type` and places it on the free tile nearest the Keep.
export function buyBuilding(type) {
  const s = store.state;
  const cost = buildCost(s.buildings.length);
  if (s.momentum < cost) return toast(`You need ${cost} ◆ Momentum (you have ${fmtNum(s.momentum)}).`);
  const tile = nearestFreeTile(s);
  if (!tile) return toast('Your city is full. Move a unit into a building to free a tile.');
  store.update(['city', 'currency'], (st) => {
    st.momentum -= cost;
    st.buildings.push({ id: uid(), type, level: 1, tile });
  });
  toast(`Built a ${BUILDING_TYPES[type].name}! Drag units onto it to put them to work.`, { kind: 'success' });
}

export function upgradeBuilding(id) {
  const b = getBuilding(id);
  const cost = buildingUpgradeCost(b.level);
  if (store.state.currencies[b.type] < cost) return toast(`You need ${fmtNum(cost)} ${STATS[b.type].label}.`);
  store.update(['city', 'currency'], (s) => {
    s.currencies[b.type] -= cost;
    s.buildings.find((x) => x.id === id).level += 1;
  });
  toast(`${BUILDING_TYPES[b.type].name} upgraded to level ${b.level}!`, { kind: 'level' });
}

// Removes a building (no refund). Its workers go back to standing on tiles.
export function demolishBuilding(id) {
  store.update(['city', 'skills', 'currency'], (s) => {
    s.buildings = s.buildings.filter((b) => b.id !== id);
    for (const u of s.skills) {
      if (u.buildingId === id) {
        u.buildingId = null;
        u.tile = nearestFreeTile(s);
      }
    }
  });
}

export function moveBuilding(id, tile) {
  store.update('city', (s) => { s.buildings.find((b) => b.id === id).tile = tile; });
}

export function upgradeKeep() {
  const s = store.state;
  const cost = keepUpgradeCost(s.city.keepLevel);
  if (PRODUCING_STATS.some((k) => s.currencies[k] < cost)) {
    return toast(`You need ${fmtNum(cost)} each of INT, STR and DEX.`);
  }
  store.update(['city', 'currency'], (st) => {
    for (const k of PRODUCING_STATS) st.currencies[k] -= cost;
    st.city.keepLevel += 1;
  });
  toast(`The Keep reached level ${store.state.city.keepLevel}! All output +${pct(keepMultiplier(store.state.city.keepLevel) - 1)}.`, { kind: 'level' });
}

// Puts a unit to work in a building, or (buildingId null) takes it out and
// stands it on `tile`, or the nearest free tile. Returns true on success.
export function assignUnit(unitId, buildingId, tile = null) {
  const s = store.state;
  const unit = s.skills.find((u) => u.id === unitId);
  if (buildingId) {
    if (unit.buildingId === buildingId) return true;
    const b = getBuilding(buildingId);
    const cap = buildingCapacity(b.level);
    if (unitsIn(s, buildingId).length >= cap) {
      toast(`The ${BUILDING_TYPES[b.type].name} is full (${cap} workers). Upgrade it for more room.`);
      return false;
    }
    store.update(['city', 'skills'], (st) => {
      const u = st.skills.find((x) => x.id === unitId);
      u.buildingId = buildingId;
      u.tile = null;
    });
    return true;
  }
  const t = tile ?? nearestFreeTile(s);
  if (!t) {
    toast('There\'s no free tile to put this unit on.');
    return false;
  }
  store.update(['city', 'skills'], (st) => {
    const u = st.skills.find((x) => x.id === unitId);
    u.buildingId = null;
    u.tile = t;
  });
  return true;
}

// ---- Dialogs -----------------------------------------------------------------
// Both share <dialog id="building-dialog">. The Keep dialog redraws itself
// after an upgrade (show()), so numbers and buttons stay current.

const dialog = () => $('building-dialog');
function showDialog(body) {
  const dlg = dialog();
  dlg.replaceChildren(body);
  if (!dlg.open) dlg.showModal();
}
const closeBtn = () => el('button', { type: 'button', class: 'ghost', onclick: () => dialog().close() }, 'Close');

// The build menu: one card per building type, priced in Momentum.
export function openBuildMenu() {
  const s = store.state;
  const cost = buildCost(s.buildings.length);
  const canAfford = s.momentum >= cost;
  showDialog(el('div', { class: 'dialog-body' },
    el('h3', {}, 'Build'),
    el('p', { class: 'muted small' },
      `Buildings cost ◆ Momentum, which you earn by logging focus sessions. Units of the building's stat get +${pct(matchBonus(1))} working there; any unit can work in any building. Your next building costs ${cost} ◆ (you have ${fmtNum(s.momentum)}).`),
    el('div', { class: 'build-grid' }, PRODUCING_STATS.map((type) => el('button', {
      type: 'button',
      class: 'build-card',
      disabled: !canAfford,
      onclick: () => { buyBuilding(type); dialog().close(); },
    },
      el('span', { class: 'build-icon' }, BUILDING_TYPES[type].icon),
      el('strong', {}, BUILDING_TYPES[type].name),
      el('span', { class: 'muted small' }, `${STATS[type].icon} ${STATS[type].label} building`),
      el('span', { class: 'muted small' }, `${buildingCapacity(1)} workers`),
      el('span', { class: 'build-cost' }, `${cost} ◆`)))),
    el('div', { class: 'row dialog-actions' }, el('span', { class: 'grow' }, ''), closeBtn())));
}

// The Keep: city-wide bonus and its upgrade.
export function openKeepDialog() {
  const show = () => {
    const s = store.state;
    const level = s.city.keepLevel;
    const cost = keepUpgradeCost(level);
    const affordable = PRODUCING_STATS.every((k) => s.currencies[k] >= cost);
    showDialog(el('div', { class: 'dialog-body' },
      el('h3', {}, `🏰 The Keep · Lv ${level}`),
      el('p', { class: 'muted small' },
        `Home of your monarch slime. The Keep boosts everything your city produces. Click it on the map whenever you want to take a break.`),
      el('p', {}, `City-wide output: `, el('strong', {}, `+${pct(keepMultiplier(level) - 1)}`),
        el('span', { class: 'muted' }, ` → +${pct(keepMultiplier(level + 1) - 1)} at level ${level + 1}`)),
      el('div', { class: 'row dialog-actions' },
        el('span', { class: 'grow' }),
        el('button', {
          type: 'button', class: 'primary', disabled: !affordable,
          onclick: () => { upgradeKeep(); show(); },
        }, `Upgrade · ${fmtNum(cost)} each of INT/STR/DEX`),
        closeBtn())));
  };
  show();
}
