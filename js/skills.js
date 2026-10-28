// ============================================================================
// skills.js — unit ("skill" in code) data model, CRUD, and the add/edit dialog.
// (CRUD = Create, Read, Update, Delete: the basic operations on a list.)
//
// A unit is one slime in the city. It stands for something you work on
// (Note-taking, Exercise…): you log focus sessions for it, which level it up.
// It has stats (INT/STR/DEX, or LIFE; see stats.js) that decide what it
// produces, the metrics you report after each session, and a place in the
// city: either a tile of its own or a building it works in.
// ============================================================================
import { store } from './state.js';
import { $, el, toast } from './ui.js';
import { uid } from './format.js';
import { STATS, STAT_IDS } from './stats.js';
import { hybridShare } from './economy.js';
import { nearestFreeTile } from './grid.js';

// Ready-made metrics offered in the editor's "Add metric from preset…" list.
// perPoint = how much of the unit makes 1 point (100 chars = 1 point).
export const METRIC_PRESETS = [
  { label: 'Characters typed', unit: 'chars', perPoint: 100 },
  { label: 'Lecture time digested', unit: 'min', perPoint: 1 },
  { label: 'Pages read', unit: 'pages', perPoint: 2 },
  { label: 'Problems solved', unit: 'problems', perPoint: 0.5 },
  { label: 'Flashcards reviewed', unit: 'cards', perPoint: 10 },
  { label: 'Lines of code', unit: 'lines', perPoint: 20 },
  { label: 'Workout time', unit: 'min', perPoint: 1 },
  { label: 'Chores done', unit: 'tasks', perPoint: 1 },
];

// Default unit colours, handed out in turn to new units.
const PALETTE = ['#7c9cff', '#5fd3a4', '#ffb86b', '#ff7aa8', '#c792ea', '#62d6e8', '#f7d154'];

// Builds a new unit object with every field filled in. This is the full
// list of what a unit stores.
export function makeSkill({ name, icon = '✦', color, stats = ['int'], metrics = [] }) {
  return {
    id: uid(),
    name,
    icon,                 // shown in lists and the session log
    color: color ?? PALETTE[store.state.skills.length % PALETTE.length],
    stats,                // e.g. ['int'], ['str', 'dex'] or ['life']
    level: 1,
    xp: 0,
    totalFocusMs: 0,
    sessionCount: 0,
    avgProductivity: 0,   // output points per focused hour (EMA)
    metrics: metrics.map((m) => ({ id: m.id ?? uid(), label: m.label, unit: m.unit, perPoint: m.perPoint })),
    buildingId: null,     // the building it works in, or null
    tile: null,           // { c, r } where it stands when not in a building
    theme: null,          // reserved for future customization (slime art)
    createdAt: Date.now(),
  };
}

export const getSkill = (id) => store.state.skills.find((s) => s.id === id);

// Creates a unit, stands it on the free tile nearest the Keep, and selects it
// if nothing else is.
export function addSkill(data) {
  const skill = makeSkill(data);
  skill.tile = nearestFreeTile(store.state);
  if (!skill.tile) toast('Your city is full, so the new unit is waiting off-map. Free up a tile to see it.');
  store.update(['skills', 'selection', 'city'], (s) => {
    s.skills.push(skill);
    s.selectedSkillId ??= skill.id;
  });
  return skill;
}

// Copies the fields in `patch` onto the unit with this id.
export function updateSkill(id, patch) {
  store.update(['skills', 'city'], (s) => Object.assign(s.skills.find((sk) => sk.id === id), patch));
}

// Removes a unit. If it was selected, select the first remaining one, and
// drop it from any goal that listed it. (Its past sessions stay in the log.)
export function deleteSkill(id) {
  store.update(['skills', 'selection', 'currency', 'city', 'goals'], (s) => {
    s.skills = s.skills.filter((sk) => sk.id !== id);
    if (s.selectedSkillId === id) s.selectedSkillId = s.skills[0]?.id ?? null;
    for (const g of s.goals) if (g.units) g.units = g.units.filter((u) => u !== id);
  });
}

export function selectSkill(id) {
  store.update('selection', (s) => { s.selectedSkillId = id; });
}

// The example units a new player starts with: one of each kind, including a
// hybrid (typing notes is both mind and precision work).
export function seedStarterSkills() {
  addSkill({ name: 'Note-taking', icon: '✎', stats: ['int', 'dex'], metrics: [METRIC_PRESETS[0]] });
  addSkill({ name: 'Lectures', icon: '🎓', stats: ['int'], metrics: [METRIC_PRESETS[1]] });
  addSkill({ name: 'Exercise', icon: '🏃', stats: ['str'], metrics: [METRIC_PRESETS[6]] });
  addSkill({ name: 'Chores', icon: '🧺', stats: ['life'], metrics: [METRIC_PRESETS[7]] });
}

// ---- Add / edit dialog ----------------------------------------------------
// Opens the editor for an existing unit (skillId) or a new one (null).
// `onSaved(id)` is called after saving, e.g. so the caller can select it.
//
// Like the break preset manager, the dialog edits a `draft` copy; nothing is
// saved until the form is submitted, so Cancel simply closes it.

export function openSkillEditor(skillId = null, onSaved) {
  const dlg = $('skill-dialog');
  const existing = skillId ? getSkill(skillId) : null;
  // structuredClone makes a deep copy, so editing the draft's metrics array
  // can't accidentally change the real unit before Save is pressed.
  const draft = existing
    ? structuredClone({ name: existing.name, icon: existing.icon, color: existing.color, stats: existing.stats, metrics: existing.metrics })
    : { name: '', icon: '✦', color: PALETTE[store.state.skills.length % PALETTE.length], stats: ['int'], metrics: [] };

  // -- Stats: any mix of INT/STR/DEX, or LIFE on its own --
  const statPicker = el('div', { class: 'row stat-picker', role: 'group', 'aria-label': 'Stats' });
  const statNote = el('p', { class: 'muted small' });
  function renderStats() {
    statPicker.replaceChildren(...STAT_IDS.map((id) => el('label', { class: 'cat-toggle', title: STATS[id].hint },
      el('input', {
        type: 'checkbox',
        checked: draft.stats.includes(id),
        onchange: (e) => {
          if (id === 'life') draft.stats = e.target.checked ? ['life'] : [];
          else draft.stats = e.target.checked ? [...draft.stats.filter((s) => s !== 'life'), id] : draft.stats.filter((s) => s !== id);
          renderStats();
        },
      }),
      el('span', {}, `${STATS[id].icon} ${STATS[id].label} · ${STATS[id].name}`))));
    const n = draft.stats.length;
    statNote.textContent = draft.stats.includes('life')
      ? 'LIFE units don\'t produce currency. Each one buffs every other unit working in the same building.'
      : n > 1
        ? `Hybrid: each stat gets ${hybridShare(n).toFixed(2)}× of this unit's rate (${(hybridShare(n) * n).toFixed(1)}× in total).`
        : n === 1 ? `Produces ${STATS[draft.stats[0]].label}, with a bonus when working in a ${STATS[draft.stats[0]].label} building.` : 'Pick at least one stat.';
  }

  // -- Metrics: one row per metric (name, unit, amount per point) --
  const metricRows = el('div', { class: 'metric-rows' });
  function renderMetrics() {
    if (!draft.metrics.length) {
      metricRows.replaceChildren(el('p', { class: 'muted' }, 'No metrics yet. Sessions will earn time-based credit only.'));
      return;
    }
    metricRows.replaceChildren(
      el('div', { class: 'metric-row metric-head muted' }, el('span', {}, 'Metric'), el('span', {}, 'Unit'), el('span', {}, 'Amount = 1 pt'), el('span')),
      ...draft.metrics.map((m, i) => el('div', { class: 'metric-row' },
        el('input', { value: m.label, placeholder: 'e.g. Characters typed', required: true, 'aria-label': 'Metric name', oninput: (e) => { m.label = e.target.value; } }),
        el('input', { value: m.unit, placeholder: 'chars', 'aria-label': 'Unit', oninput: (e) => { m.unit = e.target.value; } }),
        el('input', { type: 'number', min: '0.01', step: 'any', value: m.perPoint, required: true, 'aria-label': 'Amount per point', oninput: (e) => { m.perPoint = parseFloat(e.target.value) || 1; } }),
        el('button', { type: 'button', class: 'ghost icon', title: 'Remove metric', onclick: () => { draft.metrics.splice(i, 1); renderMetrics(); } }, '✕'))),
    );
  }

  // Picking a preset adds a copy of it as a new metric, then resets the
  // dropdown back to its "Add metric from preset…" label.
  const presetSelect = el('select', { 'aria-label': 'Add a metric preset' },
    el('option', { value: '' }, 'Add metric from preset…'),
    ...METRIC_PRESETS.map((p, i) => el('option', { value: i }, `${p.label} (${p.perPoint} ${p.unit} = 1 pt)`)));
  presetSelect.addEventListener('change', () => {
    const preset = METRIC_PRESETS[presetSelect.value];
    if (preset) draft.metrics.push({ id: uid(), ...preset });
    presetSelect.value = '';
    renderMetrics();
  });

  const form = el('form', {
    class: 'dialog-body',
    onsubmit: (e) => {
      e.preventDefault();
      const name = draft.name.trim();
      if (!name) return;
      if (!draft.stats.length) {
        toast('Pick at least one stat for this unit.', { kind: 'error' });
        return;
      }
      const data = { ...draft, name, icon: draft.icon.trim() || '✦' };
      let id = skillId;
      if (existing) updateSkill(skillId, data);
      else id = addSkill(data).id;
      dlg.close();
      toast(existing ? `Updated ${name}` : `${name} joined your city`);
      onSaved?.(id);
    },
  },
    el('h3', {}, existing ? 'Edit unit' : 'New unit'),
    el('div', { class: 'row' },
      el('label', { class: 'field grow' }, 'Name',
        el('input', { value: draft.name, required: true, maxLength: 40, placeholder: 'e.g. Spanish', autofocus: true, oninput: (e) => { draft.name = e.target.value; } })),
      el('label', { class: 'field icon-field' }, 'Icon',
        el('input', { value: draft.icon, maxLength: 4, oninput: (e) => { draft.icon = e.target.value; } })),
      el('label', { class: 'field color-field' }, 'Color',
        el('input', { type: 'color', value: draft.color, oninput: (e) => { draft.color = e.target.value; } }))),
    el('div', { class: 'field' }, 'Stats', statPicker, statNote),
    el('h4', {}, 'Productivity metrics'),
    el('p', { class: 'muted small' }, 'What will you report after each session? Each metric converts into points. Hourly, daily and weekly targets live in the Goals panel.'),
    metricRows,
    el('div', { class: 'row' },
      presetSelect,
      el('button', { type: 'button', class: 'ghost', onclick: () => { draft.metrics.push({ id: uid(), label: '', unit: '', perPoint: 1 }); renderMetrics(); } }, '+ Custom metric')),
    el('div', { class: 'row dialog-actions' },
      // The Delete button only exists when editing an existing unit.
      existing && el('button', {
        type: 'button', class: 'ghost danger',
        onclick: () => {
          if (!confirm(`Delete ${existing.name}? Its level will be lost.`)) return;
          deleteSkill(skillId);
          dlg.close();
        },
      }, 'Delete'),
      el('span', { class: 'grow' }),
      el('button', { type: 'button', class: 'ghost', onclick: () => dlg.close() }, 'Cancel'),
      el('button', { type: 'submit', class: 'primary' }, existing ? 'Save' : 'Add unit')),
  );

  renderStats();
  renderMetrics();
  dlg.replaceChildren(form);
  dlg.showModal();
}
