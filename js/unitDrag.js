// ============================================================================
// unitDrag.js — dragging unit cards out of the Units window and building
// windows. (Units already on the city map have their own dragging in
// cityMap.js.)
//
// Press on a card and move more than a few pixels to start a drag: a small
// "ghost" follows the pointer, and the drop zone under it lights up.
// Releasing over:
//   • a building window's slots, or a building on the city map
//       → the unit goes to work there
//   • an empty tile on the city map → the unit stands there
//   • the Units window's grid → the unit leaves its building
// A press without moving is an ordinary click (the card's onClick).
//
// Drop zones are marked in the HTML with data-drop-building="<id>" or
// data-drop-unassign, so any window can offer one.
// ============================================================================
import { el, toast } from './ui.js';
import { getSkill } from './skills.js';
import { assignUnit } from './buildings.js';
import { cityDropAt } from './cityMap.js';
import { unitIcon } from './unitArt.js';

// What a unit would be dropped on at screen point (x, y):
//   { zone, buildingId } | { zone, unassign } | { buildingId } | { tile }
//   | { refuse: reason } | null
// `zone` is the window element to highlight, when there is one.
function dropAt(x, y, unitId) {
  const hit = document.elementFromPoint(x, y);
  if (!hit) return null;
  const zone = hit.closest('[data-drop-building], [data-drop-unassign]');
  if (zone) return zone.dataset.dropBuilding ? { zone, buildingId: zone.dataset.dropBuilding } : { zone, unassign: true };
  if (hit.closest('#city-map')) {
    const t = cityDropAt(x, y, unitId);
    if (!t || t.same) return null;
    if (!t.ok) return { refuse: t.reason };
    return t.building ? { buildingId: t.building.id } : { tile: t.tile };
  }
  return null;
}

// Lets `card` be dragged as unit `unitId`. `onClick` runs for a plain press.
export function makeUnitDraggable(card, unitId, { onClick } = {}) {
  card.addEventListener('pointerdown', (e) => {
    // Buttons and inputs inside the card keep working normally.
    if (e.button !== 0 || e.target.closest('button, input, select')) return;
    const start = { x: e.clientX, y: e.clientY };
    let ghost = null;
    let hover = null;
    const setHover = (zone) => {
      if (hover === zone) return;
      hover?.classList.remove('drop-hover');
      hover = zone;
      hover?.classList.add('drop-hover');
    };

    // The listeners go on the whole page (not the card), so the drag keeps
    // working even if the card is redrawn or the pointer leaves it.
    const move = (ev) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
        const unit = getSkill(unitId);
        if (!unit) return;
        ghost = el('div', { class: 'drag-chip' }, unitIcon(unit, 28), el('span', {}, unit.name));
        document.body.append(ghost);
        card.classList.add('drag-source');
      }
      ghost.style.left = `${ev.clientX + 12}px`;
      ghost.style.top = `${ev.clientY + 12}px`;
      setHover(dropAt(ev.clientX, ev.clientY, unitId)?.zone ?? null);
    };
    const up = (ev) => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      setHover(null);
      if (!ghost) {
        if (ev.type === 'pointerup') onClick?.(ev);
        return;
      }
      ghost.remove();
      card.classList.remove('drag-source');
      if (ev.type !== 'pointerup') return;
      const target = dropAt(ev.clientX, ev.clientY, unitId);
      if (!target) return;
      if (target.refuse) toast(target.refuse);
      else if (target.buildingId) assignUnit(unitId, target.buildingId);
      else if (target.tile) assignUnit(unitId, null, target.tile);
      else if (target.unassign && getSkill(unitId)?.buildingId) assignUnit(unitId, null);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  });
}
