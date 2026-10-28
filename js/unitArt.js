// ============================================================================
// unitArt.js — how a unit looks. Until real slime art exists, each stat has
// a stand-in shape (see stats.js: INT circle, STR square, DEX triangle, LIFE
// diamond), and bigger evolutions are drawn bigger.
//
// Used by the city map (shapes drawn inside the map's SVG) and by the Units
// and building windows (small standalone <svg> icons). Swapping in real art
// later means changing this file.
// ============================================================================
import { svgEl } from './ui.js';
import { STATS } from './stats.js';
import { evolution } from './economy.js';

const diamond = (x, y, hw, hh) => `${x},${y - hh} ${x + hw},${y} ${x},${y + hh} ${x - hw},${y}`;

// One stand-in shape centred on (x, y); `size` is its rough radius.
export function drawShape(shape, x, y, size, fill, cls) {
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

// A unit's body at (x, y) inside an existing SVG group: its first stat's
// shape (outlined in that stat's colour by CSS), two eyes, and small marks
// for any extra stats. Returns the size used.
export function drawSlime(parent, unit, x, y, size, { eyes = true } = {}) {
  const main = STATS[unit.stats[0]] ?? STATS.int;
  parent.append(drawShape(main.shape, x, y, size, unit.color, 'unit-body'));
  if (eyes) {
    // Two dots for eyes make the shapes read as slimes.
    const eyeY = main.shape === 'triangle' ? y + size * 0.2 : y - size * 0.1;
    for (const dx of [-0.32, 0.32]) parent.append(svgEl('circle', { class: 'unit-eye', cx: x + dx * size, cy: eyeY, r: Math.max(1.4, size * 0.12) }));
  }
  unit.stats.slice(1).forEach((s, i) => {
    parent.append(drawShape(STATS[s].shape, x + size * 0.95 + i * size * 0.75, y - size * 0.95, size * 0.34, STATS[s].color, 'unit-mark'));
  });
  return size;
}

// A standalone icon for cards and slots, `px` pixels square.
export function unitIcon(unit, px = 40) {
  const svg = svgEl('svg', { class: 'unit-icon', viewBox: '-26 -26 52 52', width: px, height: px, 'aria-hidden': 'true' });
  svg.style.setProperty('--stat-color', (STATS[unit.stats[0]] ?? STATS.int).color);
  drawSlime(svg, unit, -2, 3, 11 + evolution(unit.level).stage * 2);
  return svg;
}
