// SVG map of skills orbiting a central "You" hub. Nodes are draggable.
import { store } from './state.js';
import { $, svgEl } from './ui.js';
import { fmtNum, fmtRate } from './format.js';
import { idleRate, xpToNext } from './economy.js';
import { MAP, openSkillEditor, selectSkill } from './skills.js';

const R = 44;

export function initSkillMap() {
  const svg = $('skill-map');
  svg.setAttribute('viewBox', `0 0 ${MAP.w} ${MAP.h}`);

  const edges = svgEl('g', { class: 'edges' });
  const nodes = svgEl('g', { class: 'nodes' });
  const hubFocus = svgEl('text', { class: 'hub-sub', y: 22, 'text-anchor': 'middle' });
  const hub = svgEl('g', { class: 'hub', transform: `translate(${MAP.hub.x} ${MAP.hub.y})` });
  hub.append(
    svgEl('circle', { r: 36 }),
    svgEl('text', { class: 'hub-label', y: -2, 'text-anchor': 'middle' }, 'You'),
    hubFocus,
  );
  const emptyHint = svgEl('text', { class: 'map-empty', x: MAP.hub.x, y: MAP.hub.y + 90, 'text-anchor': 'middle' }, 'Add your first skill to start generating currency');
  svg.append(edges, hub, nodes, emptyHint);

  const refs = new Map(); // skill id -> { g, line, stats, currency, ring }

  function toSvgPoint(evt) {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  function place(skill) {
    const ref = refs.get(skill.id);
    ref.g.setAttribute('transform', `translate(${skill.pos.x} ${skill.pos.y})`);
    ref.line.setAttribute('x2', skill.pos.x);
    ref.line.setAttribute('y2', skill.pos.y);
  }

  function enableDrag(g, skill) {
    g.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const start = toSvgPoint(e);
      const origin = { ...skill.pos };
      let moved = false;
      g.setPointerCapture(e.pointerId);

      const onMove = (ev) => {
        const p = toSvgPoint(ev);
        const dx = p.x - start.x;
        const dy = p.y - start.y;
        if (!moved && Math.hypot(dx, dy) < 4) return;
        moved = true;
        g.classList.add('dragging');
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

  function render() {
    const { skills } = store.state;
    edges.replaceChildren();
    nodes.replaceChildren();
    refs.clear();
    emptyHint.style.display = skills.length ? 'none' : '';

    for (const skill of skills) {
      const line = svgEl('line', { x1: MAP.hub.x, y1: MAP.hub.y, stroke: skill.color });
      edges.append(line);

      const g = svgEl('g', { class: 'node', tabindex: 0, role: 'button', 'aria-label': `${skill.name}, level ${skill.level}` });
      g.style.setProperty('--node-color', skill.color);
      const ring = svgEl('circle', { class: 'xp-ring', r: R + 7, pathLength: 100, transform: 'rotate(-90)' });
      const currency = svgEl('text', { class: 'node-currency', y: -R - 16, 'text-anchor': 'middle' });
      const stats = svgEl('text', { class: 'node-stats', y: R + 40, 'text-anchor': 'middle' });
      g.append(
        svgEl('circle', { class: 'select-ring', r: R + 14 }),
        svgEl('circle', { class: 'xp-track', r: R + 7 }),
        ring,
        svgEl('circle', { class: 'node-body', r: R }),
        svgEl('text', { class: 'node-icon', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, skill.icon),
        svgEl('text', { class: 'node-name', y: R + 22, 'text-anchor': 'middle' }, skill.name),
        stats,
        currency,
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

  function refreshNumbers() {
    hubFocus.textContent = `◆ ${fmtNum(store.state.focus)}`;
    for (const skill of store.state.skills) {
      const ref = refs.get(skill.id);
      if (!ref) continue;
      ref.currency.textContent = fmtNum(skill.currency);
      ref.stats.textContent = `Lv ${skill.level} · +${fmtRate(idleRate(skill))}/s`;
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

  $('map-add').addEventListener('click', () => openSkillEditor(null, selectSkill));
  $('map-edit').addEventListener('click', () => {
    if (store.state.selectedSkillId) openSkillEditor(store.state.selectedSkillId);
  });

  render();
}
