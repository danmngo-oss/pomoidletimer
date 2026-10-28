// ============================================================================
// cityMap.js — the isometric city: a slab of tiles with the Keep in the
// middle, buildings (cubes for now) and units (stand-in shapes for now:
// INT circle, STR square, DEX triangle, LIFE diamond).
//
//   • click a unit to select it (the timer logs to the selected unit);
//     click it twice quickly to edit it
//   • drag a unit onto a building to put it to work there, or onto an empty
//     tile to stand it there
//   • click a building to manage it; drag it to an empty tile to move it
//   • click the Keep to take a break
//
// How the isometric drawing works: tile (c, r) is drawn as a diamond whose
// top corner is at x = (c − r) × TW/2, y = (c + r) × TH/2. Moving one column
// goes down-right, one row goes down-left. Things further back (smaller
// c + r) are drawn first, so nearer things correctly cover them ("painter's
// algorithm"). pointToTile() reverses the formula for dragging.
//
// Redraw speeds: render() rebuilds everything on 'skills'/'city' changes;
// refreshSelection() and refreshLive() only toggle classes, so selecting and
// the per-second tick never rebuild the map (or interrupt a drag).
// ============================================================================
import { store } from './state.js';
import { $, svgEl, toast } from './ui.js';
import { STATS, statLabels } from './stats.js';
import { buildingCapacity, evolution, isBuffed } from './economy.js';
import { CENTER, GRID, inGrid, isKeepTile, tileContents } from './grid.js';
import { getSkill, openSkillEditor, selectSkill } from './skills.js';
import {
  BUILDING_TYPES, assignUnit, moveBuilding, openBuildMenu, openBuildingDialog, openKeepDialog, unitsIn,
} from './buildings.js';
import { breakStatus, onBreakTick, openBreakPicker } from './breaks.js';

// Tile size (width, height) and slab thickness, in SVG units.
const TW = 96;
const TH = 48;
const SLAB = 28;
const HALF_W = (GRID * TW) / 2;
const KEEP_COLOR = '#9b8cff';

const tileTop = ({ c, r }) => ({ x: ((c - r) * TW) / 2, y: ((c + r) * TH) / 2 });
const tileCenter = (t) => { const p = tileTop(t); return { x: p.x, y: p.y + TH / 2 }; };
// The inverse of tileTop: which tile a map point falls in.
function pointToTile(p) {
  const u = p.x / (TW / 2);
  const v = p.y / (TH / 2);
  return { c: Math.floor((u + v) / 2), r: Math.floor((v - u) / 2) };
}
const diamond = (x, y, hw, hh) => `${x},${y - hh} ${x + hw},${y} ${x},${y + hh} ${x - hw},${y}`;
const pts = (list) => list.map((p) => p.join(',')).join(' ');

// Lightens (amount > 0) or darkens (amount < 0) a "#rrggbb" colour, for the
// three faces of a cube.
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255]
    .map((v) => Math.round(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount));
  return `rgb(${ch.join(',')})`;
}

// Draws a cube standing on `tile` (left, right and top faces) into `parent`.
// Returns the centre of its top face and that face's half-width/height.
function drawCube(parent, tile, height, color, inset = 0.72) {
  const { x, y } = tileCenter(tile);
  const hw = (TW / 2) * inset;
  const hh = (TH / 2) * inset;
  const L = [x - hw, y];
  const B = [x, y + hh];
  const R = [x + hw, y];
  const T = [x, y - hh];
  const up = ([px, py]) => [px, py - height];
  parent.append(
    svgEl('polygon', { class: 'face', points: pts([L, B, up(B), up(L)]), fill: shade(color, -0.25) }),
    svgEl('polygon', { class: 'face', points: pts([B, R, up(R), up(B)]), fill: shade(color, -0.45) }),
    svgEl('polygon', { class: 'face top', points: pts([up(T), up(R), up(B), up(L)]), fill: shade(color, 0.12) }),
  );
  return { x, y: y - height, hw, hh };
}

// One stand-in unit shape centred on (x, y), `size` = rough radius.
function drawShape(shape, x, y, size, fill, cls) {
  if (shape === 'square') {
    const s = size * 0.88;
    return svgEl('rect', { class: cls, x: x - s, y: y - s, width: s * 2, height: s * 2, rx: size * 0.3, fill });
  }
  if (shape === 'triangle') {
    return svgEl('polygon', { class: cls, points: `${x},${y - size * 1.1} ${x + size},${y + size * 0.75} ${x - size},${y + size * 0.75}`, fill });
  }
  if (shape === 'diamond') return svgEl('polygon', { class: cls, points: diamond(x, y, size * 0.95, size * 1.15), fill });
  return svgEl('circle', { class: cls, cx: x, cy: y, r: size, fill });
}

// A unit: shadow, selection ring, body shape (its first stat's shape, outlined
// in that stat's colour), small marks for any extra stats, and — when not
// `mini` — eyes plus name/level labels. Bigger evolutions are drawn bigger.
function drawUnit(unit, x, y, mini = false) {
  const { stage, name: evoName } = evolution(unit.level);
  const size = mini ? 7 : 12 + stage * 3;
  const main = STATS[unit.stats[0]] ?? STATS.int;
  const g = svgEl('g', {
    class: `unit${mini ? ' mini' : ''}`,
    'data-unit': unit.id,
    tabindex: mini ? null : 0,
    role: 'button',
    'aria-label': `${unit.name}, ${statLabels(unit.stats)}, level ${unit.level}`,
  });
  g.style.setProperty('--stat-color', main.color);
  g.append(
    svgEl('title', {}, `${unit.name} · ${statLabels(unit.stats)} · Lv ${unit.level} ${evoName}`),
    svgEl('ellipse', { class: 'unit-shadow', cx: x, cy: y + size * 0.95, rx: size * 0.95, ry: size * 0.35 }),
    svgEl('ellipse', { class: 'unit-select', cx: x, cy: y + size * 0.95, rx: size * 1.5, ry: size * 0.6 }),
    drawShape(main.shape, x, y, size, unit.color, 'unit-body'),
  );
  unit.stats.slice(1).forEach((s, i) => {
    g.append(drawShape(STATS[s].shape, x + size * 0.95 + i * size * 0.75, y - size * 0.95, size * 0.34, STATS[s].color, 'unit-mark'));
  });
  if (!mini) {
    // Two dots for eyes make the shapes read as slimes.
    const eyeY = main.shape === 'triangle' ? y + size * 0.2 : y - size * 0.1;
    for (const dx of [-0.32, 0.32]) g.append(svgEl('circle', { class: 'unit-eye', cx: x + dx * size, cy: eyeY, r: Math.max(1.6, size * 0.12) }));
    g.append(
      svgEl('text', { class: 'unit-name', x, y: y + size * 1.95 + 6, 'text-anchor': 'middle' }, unit.name),
      svgEl('text', { class: 'unit-level', x, y: y + size * 1.95 + 18, 'text-anchor': 'middle' }, `Lv ${unit.level}`),
    );
  }
  return g;
}

export function initCityMap() {
  const svg = $('city-map');
  svg.setAttribute('viewBox', `${-HALF_W - 20} -150 ${GRID * TW + 40} ${GRID * TH + SLAB + 190}`);

  // -- The slab and its tiles: drawn once, they never change --
  const H = GRID * TH;
  const board = svgEl('g', { class: 'board' });
  board.append(
    svgEl('polygon', { class: 'slab-left', points: `${-HALF_W},${H / 2} 0,${H} 0,${H + SLAB} ${-HALF_W},${H / 2 + SLAB}` }),
    svgEl('polygon', { class: 'slab-right', points: `0,${H} ${HALF_W},${H / 2} ${HALF_W},${H / 2 + SLAB} 0,${H + SLAB}` }),
  );
  for (let c = 0; c < GRID; c++) {
    for (let r = 0; r < GRID; r++) {
      const { x, y } = tileCenter({ c, r });
      // The Keep's grounds are paved; everything else is grass.
      const cls = isKeepTile({ c, r }) ? 'tile keep-ground' : `tile${(c + r) % 2 ? ' alt' : ''}`;
      board.append(svgEl('polygon', { class: cls, points: diamond(x, y, TW / 2, TH / 2) }));
    }
  }
  const objects = svgEl('g', { class: 'objects' });
  // Drag feedback (highlighted tile and the "ghost" under the pointer).
  const overlay = svgEl('g', { class: 'overlay' });
  svg.append(board, objects, overlay);

  // The Keep's changing parts, kept for refreshKeep().
  let keepGroup = null;
  let keepLabel = null;

  function drawKeep(parent) {
    const level = store.state.city.keepLevel;
    keepGroup = svgEl('g', { class: 'keep', 'data-keep': '1', tabindex: 0, role: 'button', 'aria-label': 'The Keep: take a break' });
    keepGroup.append(svgEl('title', {}, 'The Keep: click to take a break'));
    const { x: cx, y: cy } = tileCenter(CENTER);
    keepGroup.append(svgEl('ellipse', { class: 'keep-pulse', cx, cy, rx: TW * 0.45, ry: TH * 0.45 }));
    const top = drawCube(keepGroup, CENTER, 56 + level * 6, KEEP_COLOR, 0.86);
    // The monarch slime on the roof: a blob with eyes and a crown.
    const { x, y } = top;
    keepGroup.append(
      svgEl('ellipse', { class: 'monarch', cx: x, cy: y - 10, rx: 19, ry: 14 }),
      svgEl('circle', { class: 'unit-eye', cx: x - 6, cy: y - 12, r: 2.2 }),
      svgEl('circle', { class: 'unit-eye', cx: x + 6, cy: y - 12, r: 2.2 }),
      svgEl('polygon', { class: 'crown', points: `${x - 11},${y - 22} ${x - 11},${y - 34} ${x - 5},${y - 28} ${x},${y - 38} ${x + 5},${y - 28} ${x + 11},${y - 34} ${x + 11},${y - 22}` }),
    );
    keepLabel = svgEl('text', { class: 'map-label keep-label', x, y: y - 46, 'text-anchor': 'middle' });
    keepGroup.append(keepLabel);
    parent.append(keepGroup);
    refreshKeep();
  }

  function drawBuilding(parent, b) {
    const type = BUILDING_TYPES[b.type];
    const workers = unitsIn(store.state, b.id);
    const g = svgEl('g', { class: 'building', 'data-building': b.id, tabindex: 0, role: 'button', 'aria-label': `${type.name}, level ${b.level}` });
    g.append(svgEl('title', {}, `${type.name} (${STATS[b.type].label}) · Lv ${b.level} · ${workers.length}/${buildingCapacity(b.level)} workers`));
    const top = drawCube(g, b.tile, Math.min(70, 30 + b.level * 5), STATS[b.type].color);
    // Workers stand on the roof, spread around its centre.
    workers.forEach((u, i) => {
      const angle = (i / workers.length) * Math.PI * 2 - Math.PI / 2;
      const spread = workers.length > 1 ? 0.5 : 0;
      g.append(drawUnit(u, top.x + Math.cos(angle) * top.hw * spread, top.y - 6 + Math.sin(angle) * top.hh * spread, true));
    });
    g.append(svgEl('text', { class: 'map-label', x: top.x, y: top.y - top.hh - 16, 'text-anchor': 'middle' },
      `${type.icon} Lv ${b.level} · ${workers.length}/${buildingCapacity(b.level)}`));
    parent.append(g);
  }

  // Rebuilds every object, nearest last.
  function render() {
    const s = store.state;
    const items = [
      { tile: CENTER, draw: drawKeep },
      ...s.buildings.map((b) => ({ tile: b.tile, draw: (p) => drawBuilding(p, b) })),
      ...s.skills.filter((u) => !u.buildingId && u.tile).map((u) => ({
        tile: u.tile,
        draw: (p) => {
          const { x, y } = tileCenter(u.tile);
          p.append(drawUnit(u, x, y - 8));
        },
      })),
    ].sort((a, b) => (a.tile.c + a.tile.r) - (b.tile.c + b.tile.r) || a.tile.c - b.tile.c);
    objects.replaceChildren();
    for (const item of items) item.draw(objects);
    refreshSelection();
    refreshLive();
  }

  function refreshSelection() {
    for (const g of objects.querySelectorAll('[data-unit]')) g.classList.toggle('selected', g.dataset.unit === store.state.selectedSkillId);
    $('map-edit').disabled = !store.state.selectedSkillId;
  }

  // Per-second: units glow while a break bonus boosts one of their stats.
  function refreshLive() {
    const { buffs } = store.state;
    for (const g of objects.querySelectorAll('[data-unit]')) {
      const unit = getSkill(g.dataset.unit);
      g.classList.toggle('buffed', !!unit && unit.stats.some((st) => isBuffed(buffs, st)));
    }
  }

  // The Keep's label: its level normally, the break timer during a break.
  function refreshKeep(st = breakStatus()) {
    if (!keepGroup) return;
    keepGroup.classList.toggle('on-break', !!st);
    keepLabel.textContent = st ? `${st.icon} ${st.text}` : `🏰 Keep Lv ${store.state.city.keepLevel}`;
  }

  // ---- Pointer handling: click, double-click and drag ------------------------

  // Screen pixels -> map units (the map is scaled to fit its panel).
  function toSvgPoint(evt) {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  // Where a dragged thing would land, and whether that's allowed:
  // units -> a building or an empty tile; buildings -> an empty tile.
  function dropTarget(kind, id, tile) {
    if (!inGrid(tile)) return { ok: false };
    const contents = tileContents(store.state, tile);
    if (kind === 'unit') {
      if (!contents) return { ok: true, tile };
      if (contents.kind === 'building') return { ok: true, building: contents.building };
      if (contents.kind === 'unit' && contents.unit.id === id) return { ok: true, same: true };
      return { ok: false, reason: contents.kind === 'keep' ? 'The Keep is home to your monarch. Drop units on a building or an empty tile.' : 'That tile is taken.' };
    }
    if (!contents) return { ok: true, tile };
    if (contents.kind === 'building' && contents.building.id === id) return { ok: true, same: true };
    return { ok: false, reason: 'Buildings need an empty tile.' };
  }

  // Which tile a drag is over. Buildings, the Keep and units are drawn
  // standing up, so their roofs and heads overlap the tiles behind them:
  // ask the browser what's actually under the pointer first, and only use
  // the tile maths (pointToTile) when the pointer is over bare ground.
  function tileUnderPointer(ev, p) {
    const hit = document.elementFromPoint(ev.clientX, ev.clientY);
    const buildingEl = hit?.closest?.('#city-map [data-building]');
    if (buildingEl) return store.state.buildings.find((b) => b.id === buildingEl.dataset.building)?.tile ?? pointToTile(p);
    if (hit?.closest?.('#city-map [data-keep]')) return CENTER;
    const unitEl = hit?.closest?.('#city-map [data-unit]');
    const unitTile = unitEl && getSkill(unitEl.dataset.unit)?.tile;
    return unitTile ?? pointToTile(p);
  }

  function showDragFeedback(kind, id, ev, p) {
    const tile = tileUnderPointer(ev, p);
    const target = dropTarget(kind, id, tile);
    overlay.replaceChildren();
    if (inGrid(tile)) {
      const { x, y } = tileCenter(tile);
      overlay.append(svgEl('polygon', { class: target.ok ? 'drop-ok' : 'drop-bad', points: diamond(x, y, TW / 2, TH / 2) }));
    }
    if (kind === 'unit') {
      const u = getSkill(id);
      overlay.append(drawShape(STATS[u.stats[0]].shape, p.x, p.y, 12, u.color, 'drag-ghost'));
    }
  }

  function drop(kind, id, ev, p) {
    const target = dropTarget(kind, id, tileUnderPointer(ev, p));
    if (!target.ok) {
      if (target.reason) toast(target.reason);
      return;
    }
    if (target.same) return;
    if (kind === 'unit') assignUnit(id, target.building?.id ?? null, target.tile ?? null);
    else moveBuilding(id, target.tile);
  }

  let lastClick = { id: null, at: 0 };
  function click(kind, id) {
    if (kind === 'keep') return openBreakPicker();
    if (kind === 'building') return openBuildingDialog(id);
    // Two clicks on the same unit within 400ms = edit it.
    const now = Date.now();
    if (lastClick.id === id && now - lastClick.at < 400) {
      lastClick = { id: null, at: 0 };
      return openSkillEditor(id);
    }
    lastClick = { id, at: now };
    selectSkill(id);
  }

  // One listener on the whole map ("event delegation"): find which unit,
  // building or Keep was pressed from the data-* attribute on its group.
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const unitEl = e.target.closest('[data-unit]');
    const buildingEl = !unitEl && e.target.closest('[data-building]');
    const keepEl = !unitEl && !buildingEl && e.target.closest('[data-keep]');
    if (!unitEl && !buildingEl && !keepEl) return;
    const kind = unitEl ? 'unit' : buildingEl ? 'building' : 'keep';
    const id = unitEl?.dataset.unit ?? buildingEl?.dataset.building ?? null;
    // The element that moves (null for the Keep, which can't be dragged).
    const sourceEl = unitEl || buildingEl || null;
    const start = toSvgPoint(e);
    let dragging = false;
    // Capture on the <svg> (which is never redrawn) so the drag keeps
    // receiving events even if the pointer races ahead.
    svg.setPointerCapture(e.pointerId);

    const onMove = (ev) => {
      const p = toSvgPoint(ev);
      if (kind === 'keep') return;
      if (!dragging && Math.hypot(p.x - start.x, p.y - start.y) < 6) return;
      if (!dragging) {
        dragging = true;
        sourceEl.classList.add('drag-source');
      }
      showDragFeedback(kind, id, ev, p);
    };
    const onUp = (ev) => {
      svg.removeEventListener('pointermove', onMove);
      svg.removeEventListener('pointerup', onUp);
      svg.removeEventListener('pointercancel', onUp);
      overlay.replaceChildren();
      sourceEl?.classList.remove('drag-source');
      if (!dragging) return click(kind, id);
      if (ev.type === 'pointerup') drop(kind, id, ev, toSvgPoint(ev));
    };
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onUp);
  });

  // Keyboard: Tab to a unit/building/the Keep, Enter or Space to activate,
  // "e" on a unit to edit it.
  svg.addEventListener('keydown', (e) => {
    const unitEl = e.target.closest('[data-unit]');
    if (unitEl && e.key === 'e') return openSkillEditor(unitEl.dataset.unit);
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (unitEl) selectSkill(unitEl.dataset.unit);
    else if (e.target.closest('[data-building]')) openBuildingDialog(e.target.closest('[data-building]').dataset.building);
    else if (e.target.closest('[data-keep]')) openBreakPicker();
  });

  store.subscribe(['skills', 'city'], render);
  store.subscribe('selection', refreshSelection);
  store.subscribe('currency', refreshLive);
  store.subscribe('break', () => refreshKeep());
  // breaks.js calls this 4x per second during a break, for a smooth countdown.
  onBreakTick(refreshKeep);

  // Toolbar above the map.
  $('map-add').addEventListener('click', () => openSkillEditor(null, selectSkill));
  $('map-edit').addEventListener('click', () => {
    if (store.state.selectedSkillId) openSkillEditor(store.state.selectedSkillId);
  });
  $('map-build').addEventListener('click', openBuildMenu);
  $('map-keep').addEventListener('click', openKeepDialog);

  render();
}
