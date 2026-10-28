// ============================================================================
// stats.js — the kinds of unit (slime) living in the city.
//
// INT, STR and DEX are the three producing stats. A unit with a stat
// produces that stat's currency, and a building of the same type boosts it.
// A unit can have several stats (a hybrid); economy.js decides how its output
// is split between them.
//
// LIFE is special: a Life unit produces nothing itself, but buffs every
// other unit working in the same building. A unit is either Life or a mix
// of INT/STR/DEX, never both.
//
// Until real slime art exists, each stat has a stand-in shape on the map.
// To add a stat, add an entry here. The keys ('int', …) are what gets saved,
// so don't rename existing keys without a migration in state.js.
// ============================================================================
export const STATS = {
  int: { label: 'INT', name: 'Mind', icon: '🧠', shape: 'circle', color: '#7c9cff', hint: 'Mind work: studying, writing, planning' },
  str: { label: 'STR', name: 'Power', icon: '💪', shape: 'square', color: '#ff8a7a', hint: 'Power work: exercise, heavy physical tasks' },
  dex: { label: 'DEX', name: 'Precision', icon: '🎯', shape: 'triangle', color: '#f7d154', hint: 'Precision work: typing, crafts, detail work' },
  life: { label: 'LIFE', name: 'Life balance', icon: '🌿', shape: 'diamond', color: '#5fd3a4', hint: 'Chores and life admin. Buffs the units in its building instead of producing' },
};

// Every stat key, in display order, and just the three that produce currency.
export const STAT_IDS = Object.keys(STATS);
export const PRODUCING_STATS = ['int', 'str', 'dex'];

// ['int', 'str'] -> '🧠💪' and 'INT/STR'.
export const statIcons = (ids = []) => ids.map((id) => STATS[id]?.icon ?? '').join('');
export const statLabels = (ids = []) => ids.map((id) => STATS[id]?.label ?? id).join('/');

export const isLifeUnit = (unit) => unit.stats.includes('life');
