// ============================================================================
// skillMap.js — the Focus Map: foci ("skills" in code) orbit a central "You"
// hub. Nodes are draggable; clicking one selects it, double-clicking edits
// it, and clicking the hub opens the break picker.
//
// The map is drawn with SVG (vector graphics built from shapes like <circle>
// and <text>). It uses its own coordinate system, the "viewBox": the map is
// always 1000 x 600 units, and the browser scales it to fit the panel. Node
// positions are saved in those units, so they look the same at any size.
//
// Drawing happens at three speeds, so frequent updates stay cheap:
//   • render()           rebuilds every node — only when foci are added,
//                        removed or edited ('skills' topic)
//   • refreshNumbers()   updates text, XP rings and glow — every second
//                        ('currency' topic, from the idle loop)
//   • refreshSelection() moves the "selected" ring ('selection' topic)
// ============================================================================
import { store } from './state.js';
import { $, svgEl } from './ui.js';
import { fmtNum, fmtRate } from './format.js';
import { BREAK_BUFF_MULT, effectiveRate, isBuffed, xpToNext } from './economy.js';
import { CATEGORIES } from './categories.js';
import { MAP, openSkillEditor, selectSkill } from './skills.js';
import { breakStatus, onBreakTick, openBreakPicker } from './breaks.js';

// Radius of a focus node, in map units.
const R = 44;

export function initSkillMap() {
  const svg = $('skill-map');
  svg.setAttribute('viewBox', `0 0 ${MAP.w} ${MAP.h}`);

  // Layers, drawn in this order: lines first so they sit underneath nodes.
  const edges = svgEl('g', { class: 'edges' });
  const nodes = svgEl('g', { class: 'nodes' });
  // The hub doubles as the break button.
  // Normally it shows "You" and your ◆ Momentum; during a break it shows
  // the break's icon and countdown instead (see refreshHub).
  const hubFocus = svgEl('text', { class: 'hub-sub', y: 22, 'text-anchor': 'middle' });
  const hubLabel = svgEl('text', { class: 'hub-label', y: -2, 'text-anchor': 'middle' }, 'You');
  // A <g> is an SVG group; `translate` moves everything inside it, so the
  // hub's circles and text can be drawn around (0, 0).
  const hub = svgEl('g', {
    class: 'hub', role: 'button', tabindex: 0, 'aria-label': 'Take a break',
    transform: `translate(${MAP.hub.x} ${MAP.hub.y})`,
  });
  hub.append(
    svgEl('title', {}, 'Take a break'),
    svgEl('circle', { class: 'hub-pulse', r: 36 }),
    svgEl('circle', { class: 'hub-body', r: 36 }),
    hubLabel,
    hubFocus,
  );
  hub.addEventListener('click', openBreakPicker);
  // Keyboard users can Tab to the hub and press Enter/Space.
  hub.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBreakPicker(); }
  });
  const emptyHint = svgEl('text', { class: 'map-empty', x: MAP.hub.x, y: MAP.hub.y + 90, 'text-anchor': 'middle' }, 'Add your first focus to start generating currency');
  svg.append(edges, hub, nodes, emptyHint);

  // Handles to each node's changeable parts, so the per-second refresh can
  // update text without rebuilding (and without breaking a drag in progress).
  const refs = new Map(); // skill id -> { g, line, stats, currency, ring }

  // Converts a mouse/touch position (screen pixels) into map units, using
  // the inverse of the SVG's current screen transform. Needed for dragging
  // because the map is scaled to the panel's size.
  function toSvgPoint(evt) {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  // Moves a node (and the end of its line to the hub) to skill.pos.
  function place(skill) {
    const ref = refs.get(skill.id);
    ref.g.setAttribute('transform', `translate(${skill.pos.x} ${skill.pos.y})`);
    ref.line.setAttribute('x2', skill.pos.x);
    ref.line.setAttribute('y2', skill.pos.y);
  }

  // Drag-to-move. Pointer events cover mouse, pen and touch in one API.
  // A press that moves less than 4 units counts as a click (select) instead.
  function enableDrag(g, skill) {
    g.addEventListener('pointerdown', (e) => {
      // Left button only (or a touch/pen press, which also report 0).
      if (e.button !== 0) return;
      const start = toSvgPoint(e);
      const origin = { ...skill.pos };
      let moved = false;
      // "Capture" keeps sending move events to this node even if the pointer
      // races outside it, so fast drags don't drop the node.
      g.setPointerCapture(e.pointerId);

      const onMove = (ev) => {
        const p = toSvgPoint(ev);
        const dx = p.x - start.x;
        const dy = p.y - start.y;
        if (!moved && Math.hypot(dx, dy) < 4) return;
        moved = true;
        g.classList.add('dragging');
        // Clamp so nodes (and their labels) stay inside the map.
        skill.pos = {
          x: Math.round(Math.min(MAP.w - R, Math.max(R, origin.x + dx))),
          y: Math.round(Math.min(MAP.h - R - 40, Math.max(R + 24, origin.y + dy))),
        };
        place(skill);
      };
      const onUp = () => {
        g.removeEventListener('pointermove', onMove);
        g.classList.remove('dragging');
        if (moved) store.update('layout', () => {}); // persist position only
        else selectSkill(skill.id);
      };
      g.addEventListener('pointermove', onMove);
      g.addEventListener('pointerup', onUp, { once: true });
      g.addEventListener('pointercancel', onUp, { once: true });
    });
  }

  // Builds every node from scratch.
  function render() {
    const { skills } = store.state;
    edges.replaceChildren();
    nodes.replaceChildren();
    refs.clear();
    emptyHint.style.display = skills.length ? 'none' : '';

    for (const skill of skills) {
      // The dashed line from the hub to this node.
      const line = svgEl('line', { x1: MAP.hub.x, y1: MAP.hub.y, stroke: skill.color });
      edges.append(line);

      // One node = a group containing several circles and labels, all drawn
      // around (0, 0) and moved into place by place().
      const g = svgEl('g', { class: 'node', tabindex: 0, role: 'button', 'aria-label': `${skill.name}, level ${skill.level}` });
      // The CSS uses this variable to colour the node's rings.
      g.style.setProperty('--node-color', skill.color);
      // The XP ring: pathLength=100 lets us treat the stroke as 0–100%, and
      // stroke-dasharray "40 100" then draws 40% of it (see refreshNumbers).
      // rotate(-90) makes it start at 12 o'clock instead of 3 o'clock.
      const ring = svgEl('circle', { class: 'xp-ring', r: R + 7, pathLength: 100, transform: 'rotate(-90)' });
      const currency = svgEl('text', { class: 'node-currency', y: -R - 16, 'text-anchor': 'middle' });
      const stats = svgEl('text', { class: 'node-stats', y: R + 40, 'text-anchor': 'middle' });
      // Small category badge (🧠/💪/🏠) at the node's bottom-right.
      const category = CATEGORIES[skill.category] ?? CATEGORIES.mental;
      const badge = svgEl('g', { class: 'cat-badge', transform: `translate(${R * 0.74} ${R * 0.74})` });
      badge.append(
        svgEl('title', {}, category.label),
        svgEl('circle', { r: 13 }),
        svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, category.icon),
      );
      // Later items draw on top of earlier ones.
      g.append(
        svgEl('circle', { class: 'select-ring', r: R + 14 }),
        svgEl('circle', { class: 'xp-track', r: R + 7 }),
        ring,
        svgEl('circle', { class: 'node-body', r: R }),
        svgEl('text', { class: 'node-icon', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, skill.icon),
        svgEl('text', { class: 'node-name', y: R + 22, 'text-anchor': 'middle' }, skill.name),
        stats,
        currency,
        badge,
      );
      g.addEventListener('dblclick', () => openSkillEditor(skill.id));
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectSkill(skill.id); }
        if (e.key === 'e') openSkillEditor(skill.id);
      });
      enableDrag(g, skill);
      nodes.append(g);
      refs.set(skill.id, { g, line, stats, currency, ring });
      place(skill);
    }
    refreshNumbers();
    refreshSelection();
  }

  // Hub text: "You / ◆ 12" normally, or the break icon and timer on a break.
  // `st` is the break status (null when not on a break); it's passed in by
  // the break tick, or looked up here when called with no argument.
  function refreshHub(st = breakStatus()) {
    hub.classList.toggle('on-break', !!st);
    hubLabel.textContent = st ? st.icon : 'You';
    hubFocus.textContent = st ? st.text : `◆ ${fmtNum(store.state.momentum)}`;
  }

  // Per-second update of each node's numbers, XP ring and bonus glow.
  function refreshNumbers() {
    refreshHub();
    const { buffs } = store.state;
    for (const skill of store.state.skills) {
      const ref = refs.get(skill.id);
      if (!ref) continue;
      const buffed = isBuffed(buffs, skill.category);
      ref.g.classList.toggle('buffed', buffed);
      ref.currency.textContent = fmtNum(skill.currency);
      ref.stats.textContent = `Lv ${skill.level} · +${fmtRate(effectiveRate(skill, buffs))}/s${buffed ? ` ×${BREAK_BUFF_MULT}` : ''}`;
      const pct = Math.min(100, (skill.xp / xpToNext(skill.level)) * 100);
      ref.ring.setAttribute('stroke-dasharray', `${pct} 100`);
    }
  }

  function refreshSelection() {
    for (const [id, { g }] of refs) g.classList.toggle('selected', id === store.state.selectedSkillId);
    $('map-edit').disabled = !store.state.selectedSkillId;
  }

  store.subscribe('skills', render);
  store.subscribe('currency', refreshNumbers);
  store.subscribe('selection', refreshSelection);
  store.subscribe('break', () => refreshHub());
  // breaks.js calls this 4x per second during a break, so the hub countdown
  // is smooth.
  onBreakTick(refreshHub);

  // After adding a focus, select it (openSkillEditor passes its new id).
  $('map-add').addEventListener('click', () => openSkillEditor(null, selectSkill));
  $('map-edit').addEventListener('click', () => {
    if (store.state.selectedSkillId) openSkillEditor(store.state.selectedSkillId);
  });

  render();
}
