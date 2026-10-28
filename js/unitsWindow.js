// ============================================================================
// unitsWindow.js — the Units window: every unit as a card in a simple grid,
// with a search box and tabs (All, INT, STR, DEX, LIFE, Idle, Working).
//
//   • click a card to select that unit (the timer logs to it); click it
//     twice quickly to edit it
//   • drag a card into a building window or onto the city map to move it
//   • while a building window is open, each card gets a "➜ Forge"-style
//     button that sends the unit to the most recently used building window
//   • drop a working unit back onto the grid to take it off work
// ============================================================================
import { store } from './state.js';
import { el } from './ui.js';
import { STATS, statIcons, statLabels } from './stats.js';
import { evolution } from './economy.js';
import { openSkillEditor, selectSkill } from './skills.js';
import { BUILDING_TYPES, assignUnit, getBuilding } from './buildings.js';
import { createWindow, mostRecentWindow, onWindowsChange } from './windows.js';
import { makeUnitDraggable } from './unitDrag.js';
import { unitIcon } from './unitArt.js';

const TABS = [
  { id: 'all', label: 'All', test: () => true },
  ...['int', 'str', 'dex', 'life'].map((s) => ({ id: s, label: `${STATS[s].icon} ${STATS[s].label}`, test: (u) => u.stats.includes(s) })),
  { id: 'idle', label: 'Idle', test: (u) => !u.buildingId },
  { id: 'working', label: 'Working', test: (u) => !!u.buildingId },
];

// The building the "➜" buttons send units to: the one whose window was used
// most recently, or null when no building window is open.
function targetBuilding() {
  const w = mostRecentWindow((id) => id.startsWith('building:'));
  return w ? getBuilding(w.id.slice('building:'.length)) ?? null : null;
}

export function initUnitsWindow() {
  let tab = 'all';
  let query = '';
  let lastTargetId = null;
  let lastClick = { id: null, at: 0 };

  const search = el('input', {
    type: 'search', placeholder: 'Search by name, stat or metric…', 'aria-label': 'Search units',
    oninput: (e) => { query = e.target.value.trim().toLowerCase(); renderGrid(); },
  });
  const tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Filter units' });
  const hint = el('div', { class: 'send-hint small' });
  // The grid is also the drop zone for taking a unit off work.
  const grid = el('div', { class: 'unit-grid', dataset: { dropUnassign: '1' } });
  const body = el('div', {},
    el('div', { class: 'row' }, search, el('button', { type: 'button', class: 'chip', onclick: () => openSkillEditor(null, selectSkill) }, '+ New unit')),
    tabs,
    hint,
    grid,
    el('p', { class: 'muted small' }, 'Drag a unit into a building window or onto the map. Drop a working unit here to take it off work.'));

  // Free-text search over the name, stats and metric names.
  const matches = (u) => !query || [u.name, statLabels(u.stats), ...u.metrics.map((m) => m.label)].join(' ').toLowerCase().includes(query);

  // Click selects; a second click on the same card within 400ms edits.
  function clickCard(id) {
    const now = Date.now();
    if (lastClick.id === id && now - lastClick.at < 400) {
      lastClick = { id: null, at: 0 };
      openSkillEditor(id);
      return;
    }
    lastClick = { id, at: now };
    selectSkill(id);
  }

  function card(u, target) {
    const b = u.buildingId ? getBuilding(u.buildingId) : null;
    const c = el('div', {
      class: `unit-card${u.id === store.state.selectedSkillId ? ' selected' : ''}`,
      tabindex: 0,
      role: 'button',
      title: `${u.name}: click to select, click twice to edit, drag to move`,
    },
      unitIcon(u, 44),
      el('strong', { class: 'unit-card-name' }, u.name),
      el('span', { class: 'muted small' }, `Lv ${u.level} · ${evolution(u.level).name}`),
      el('span', { class: 'small' }, `${statIcons(u.stats)} ${statLabels(u.stats)}`),
      el('span', { class: 'muted small' }, b ? `${BUILDING_TYPES[b.type].icon} ${BUILDING_TYPES[b.type].name}` : 'Idle in the city'),
      // Only when a building window is open and the unit isn't there already.
      target && u.buildingId !== target.id && el('button', {
        type: 'button', class: 'chip send-btn', title: `Send ${u.name} to the ${BUILDING_TYPES[target.type].name}`,
        onclick: () => assignUnit(u.id, target.id),
      }, `➜ ${BUILDING_TYPES[target.type].name}`));
    makeUnitDraggable(c, u.id, { onClick: () => clickCard(u.id) });
    c.addEventListener('keydown', (e) => {
      if (e.target !== c) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectSkill(u.id); }
      if (e.key === 'e') openSkillEditor(u.id);
    });
    return c;
  }

  function renderTabs() {
    const units = store.state.skills;
    tabs.replaceChildren(...TABS.map((t) => el('button', {
      type: 'button',
      role: 'tab',
      'aria-selected': String(t.id === tab),
      onclick: () => { tab = t.id; render(); },
    }, `${t.label} ${units.filter(t.test).length}`)));
  }

  function renderGrid() {
    const target = targetBuilding();
    lastTargetId = target?.id ?? null;
    hint.hidden = !target;
    if (target) hint.textContent = `➜ buttons send units to the ${BUILDING_TYPES[target.type].name} (Lv ${target.level}) window.`;
    const t = TABS.find((x) => x.id === tab);
    const units = store.state.skills.filter((u) => t.test(u) && matches(u));
    grid.replaceChildren(...(units.length
      ? units.map((u) => card(u, target))
      : [el('p', { class: 'muted small grid-empty' }, store.state.skills.length ? 'No units match.' : 'No units yet. Add one with + New unit.')]));
  }

  function render() {
    renderTabs();
    renderGrid();
  }

  // Created last: if the window was left open, it draws straight away, which
  // needs everything above to exist.
  createWindow({
    id: 'units', title: 'Units', icon: '🧪', body, width: 440, startOpen: false,
    defaultPos: () => ({ x: 16, y: Math.max(130, innerHeight - 560) }),
    onOpen: () => render(),
  });
  store.subscribe(['skills', 'city', 'selection'], render);
  // Redraw only when the target building changes, not on every focus change.
  onWindowsChange(() => { if ((targetBuilding()?.id ?? null) !== lastTargetId) renderGrid(); });
  render();
}
