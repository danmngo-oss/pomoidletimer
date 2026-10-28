// ============================================================================
// grid.js — the city's tile grid. Pure helpers: no drawing, no saving.
//
// The city is GRID x GRID square tiles (drawn as diamonds by cityMap.js).
// A tile is { c, r }: column and row, both 0-based. The Keep (central
// building) sits on the middle tile, and the three tiles behind it are its
// grounds: the Keep is tall enough to hide anything standing there, so they
// stay empty. Every other tile holds at most one thing: a building, or a
// unit that isn't working inside a building.
// ============================================================================
export const GRID = 9;
export const CENTER = { c: 4, r: 4 };

// The Keep's tile plus the three tiles behind it (straight up, up-left and up-right on screen).
export const KEEP_TILES = [CENTER, { c: CENTER.c - 1, r: CENTER.r - 1 }, { c: CENTER.c - 1, r: CENTER.r }, { c: CENTER.c, r: CENTER.r - 1 }];

export const sameTile = (a, b) => !!a && !!b && a.c === b.c && a.r === b.r;
export const isKeepTile = (t) => KEEP_TILES.some((k) => sameTile(k, t));
export const inGrid = (t) => t.c >= 0 && t.r >= 0 && t.c < GRID && t.r < GRID;

// What stands on a tile:
//   { kind: 'keep' } | { kind: 'building', building } | { kind: 'unit', unit } | null
export function tileContents(state, tile) {
  if (isKeepTile(tile)) return { kind: 'keep' };
  const building = state.buildings.find((b) => sameTile(b.tile, tile));
  if (building) return { kind: 'building', building };
  const unit = state.skills.find((u) => !u.buildingId && sameTile(u.tile, tile));
  if (unit) return { kind: 'unit', unit };
  return null;
}

// The free tile closest to the Keep, searching ring by ring outwards, or
// null when every tile is taken.
export function nearestFreeTile(state) {
  for (let ring = 1; ring < GRID; ring++) {
    for (let dc = -ring; dc <= ring; dc++) {
      for (let dr = -ring; dr <= ring; dr++) {
        // Only the squares on this ring's edge; inner ones were tried already.
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue;
        const t = { c: CENTER.c + dc, r: CENTER.r + dr };
        if (inGrid(t) && !tileContents(state, t)) return t;
      }
    }
  }
  return null;
}
