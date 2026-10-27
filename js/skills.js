// ============================================================================
// skills.js — Focus ("skill" in code) data model, CRUD, and the add/edit dialog.
// (CRUD = Create, Read, Update, Delete: the basic operations on a list.)
//
// A focus is one node on the Focus Map: something you work on (Note-taking,
// Exercise…). It has a category, the metrics you report after each session,
// an optional daily goal, a level/XP, and its own idle currency.
// ============================================================================
import { store } from './state.js';
import { $, el, toast } from './ui.js';
import { uid } from './format.js';
import { CATEGORIES, CATEGORY_IDS } from './categories.js';

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

// Default node colours, handed out in turn to new foci.
const PALETTE = ['#7c9cff', '#5fd3a4', '#ffb86b', '#ff7aa8', '#c792ea', '#62d6e8', '#f7d154'];

// Map layout space (matches the SVG viewBox in skillMap.js).
export const MAP = { w: 1000, h: 600, hub: { x: 500, y: 300 } };

// Builds a new focus object with every field filled in. This is the full
// list of what a focus stores.
export function makeSkill({ name, icon = '✦', color, category = 'mental', metrics = [], goal = null }) {
  return {
    id: uid(),
    name,
    icon,
    color: color ?? PALETTE[store.state.skills.length % PALETTE.length],
    category,             // key of CATEGORIES
    level: 1,
    xp: 0,
    currency: 0,          // this focus's own idle currency
    totalFocusMs: 0,
    sessionCount: 0,
    avgProductivity: 0,   // output points per focused hour (EMA)
    // Metrics keep their id if they already have one (a goal may point at it).
    metrics: metrics.map((m) => ({ id: m.id ?? uid(), label: m.label, unit: m.unit, perPoint: m.perPoint })),
    goal,                 // { measure: 'time' | metricId, target, start: 'HH:MM', end: 'HH:MM' } or null
    goalAdjust: null,     // today's manual goal correction, see goals.js
    goalAdjustMode: 'amount', // which adjust method the pace card shows: 'amount' | 'totals'
    pos: null,
    theme: null,          // reserved for future customization/themes
    createdAt: Date.now(),
  };
}

export const getSkill = (id) => store.state.skills.find((s) => s.id === id);

// First open slot on concentric rings around the hub.
// Tries 8 spots on an inner ring, then 12 on an outer ring, then 6 close in,
// and takes the first one that's on the map and at least 120 units from
// every existing node. The rings are stretched sideways (x * 1.5) because
// the map is wider than it is tall. If all are taken, pick a random spot.
function nextFreePosition() {
  const taken = store.state.skills.map((s) => s.pos).filter(Boolean);
  for (const [radius, slots] of [[200, 8], [270, 12], [130, 6]]) {
    for (let i = 0; i < slots; i++) {
      // Angle in radians, starting from the top (12 o'clock).
      const angle = (i / slots) * Math.PI * 2 - Math.PI / 2;
      const p = {
        x: Math.round(MAP.hub.x + Math.cos(angle) * radius * 1.5),
        y: Math.round(MAP.hub.y + Math.sin(angle) * radius),
      };
      const inBounds = p.x > 60 && p.x < MAP.w - 60 && p.y > 70 && p.y < MAP.h - 70;
      if (inBounds && taken.every((t) => Math.hypot(t.x - p.x, t.y - p.y) > 120)) return p;
    }
  }
  return { x: 80 + Math.random() * (MAP.w - 160), y: 80 + Math.random() * (MAP.h - 160) };
}

// Creates a focus, places it on the map, and selects it if nothing else is.
export function addSkill(data) {
  const skill = makeSkill(data);
  skill.pos = nextFreePosition();
  store.update(['skills', 'selection'], (s) => {
    s.skills.push(skill);
    s.selectedSkillId ??= skill.id;
  });
  return skill;
}

// Copies the fields in `patch` onto the focus with this id.
export function updateSkill(id, patch) {
  store.update('skills', (s) => Object.assign(s.skills.find((sk) => sk.id === id), patch));
}

// Removes a focus. If it was selected, select the first remaining one.
// (Its past sessions stay in the history log.)
export function deleteSkill(id) {
  store.update(['skills', 'selection', 'currency'], (s) => {
    s.skills = s.skills.filter((sk) => sk.id !== id);
    if (s.selectedSkillId === id) s.selectedSkillId = s.skills[0]?.id ?? null;
  });
}

export function selectSkill(id) {
  store.update('selection', (s) => { s.selectedSkillId = id; });
}

// The example foci a new player starts with (one or more per category).
export function seedStarterSkills() {
  addSkill({ name: 'Note-taking', icon: '✎', category: 'mental', metrics: [METRIC_PRESETS[0]] });
  addSkill({ name: 'Lectures', icon: '🎓', category: 'mental', metrics: [METRIC_PRESETS[1]] });
  addSkill({ name: 'Exercise', icon: '🏃', category: 'physical', metrics: [METRIC_PRESETS[6]] });
  addSkill({ name: 'Chores', icon: '🧺', category: 'life', metrics: [METRIC_PRESETS[7]] });
}

// ---- Add / edit dialog ----------------------------------------------------
// Opens the editor for an existing focus (skillId) or a new one (null).
// `onSaved(id)` is called after saving, e.g. so the caller can select it.
//
// Like the break preset manager, the dialog edits a `draft` copy; nothing is
// saved until the form is submitted, so Cancel simply closes it.

export function openSkillEditor(skillId = null, onSaved) {
  const dlg = $('skill-dialog');
  const existing = skillId ? getSkill(skillId) : null;
  // structuredClone makes a deep copy, so editing the draft's metrics array
  // can't accidentally change the real focus before Save is pressed.
  const draft = existing
    ? structuredClone({
      name: existing.name, icon: existing.icon, color: existing.color,
      category: existing.category ?? 'mental', metrics: existing.metrics, goal: existing.goal,
    })
    : { name: '', icon: '✦', color: PALETTE[store.state.skills.length % PALETTE.length], category: 'mental', metrics: [], goal: null };
  // The goal form always has values to show; measure '' means "no goal".
  const goal = draft.goal ?? { measure: '', target: 3, start: '09:00', end: '17:00' };

  // -- Daily goal section --
  // The "measure" dropdown lists Focus time plus each named metric, so it is
  // rebuilt whenever the metrics change.
  const goalMeasure = el('select', { 'aria-label': 'Goal measure', onchange: (e) => { goal.measure = e.target.value; renderGoal(); } });
  const goalFields = el('div', { class: 'goal-fields' });
  function renderGoal() {
    const named = draft.metrics.filter((m) => m.label.trim());
    goalMeasure.replaceChildren(
      el('option', { value: '' }, 'No daily goal'),
      el('option', { value: 'time' }, 'Focus time'),
      ...named.map((m) => el('option', { value: m.id }, `${m.label} (${m.unit || 'units'})`)),
    );
    // If the goal's metric was deleted, fall back to "no goal".
    if (goal.measure && goal.measure !== 'time' && !named.some((m) => m.id === goal.measure)) goal.measure = '';
    goalMeasure.value = goal.measure;
    goalFields.hidden = !goal.measure;
    if (!goal.measure) return goalFields.replaceChildren();
    // Time goals are entered in hours; metric goals in the metric's unit.
    const unit = goal.measure === 'time' ? 'hours' : named.find((m) => m.id === goal.measure).unit || 'units';
    goalFields.replaceChildren(
      el('label', { class: 'field' }, 'Target',
        el('div', { class: 'input-unit' },
          el('input', { type: 'number', min: '0.01', step: 'any', required: true, value: goal.target, oninput: (e) => { goal.target = parseFloat(e.target.value); } }),
          el('span', { class: 'unit' }, unit))),
      el('label', { class: 'field' }, 'From', el('input', { type: 'time', required: true, value: goal.start, oninput: (e) => { goal.start = e.target.value; } })),
      el('label', { class: 'field' }, 'Until', el('input', { type: 'time', required: true, value: goal.end, oninput: (e) => { goal.end = e.target.value; } })),
    );
  }

  // -- Metrics section: one row per metric (name, unit, amount per point) --
  const metricRows = el('div', { class: 'metric-rows' });
  function renderMetrics() {
    renderGoal();
    if (!draft.metrics.length) {
      metricRows.replaceChildren(el('p', { class: 'muted' }, 'No metrics yet. Sessions will earn time-based credit only.'));
      return;
    }
    metricRows.replaceChildren(
      el('div', { class: 'metric-row metric-head muted' }, el('span', {}, 'Metric'), el('span', {}, 'Unit'), el('span', {}, 'Amount = 1 pt'), el('span')),
      ...draft.metrics.map((m, i) => el('div', { class: 'metric-row' },
        el('input', { value: m.label, placeholder: 'e.g. Characters typed', required: true, 'aria-label': 'Metric name', oninput: (e) => { m.label = e.target.value; renderGoal(); } }),
        el('input', { value: m.unit, placeholder: 'chars', 'aria-label': 'Unit', oninput: (e) => { m.unit = e.target.value; renderGoal(); } }),
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

  // Mental / Physical / Life balance, as radio buttons styled like tabs.
  const categoryPicker = el('div', { class: 'segmented category-picker', role: 'radiogroup', 'aria-label': 'Category' },
    ...CATEGORY_IDS.map((c) => el('label', { title: CATEGORIES[c].hint },
      el('input', { type: 'radio', name: 'focus-category', value: c, checked: draft.category === c, onchange: () => { draft.category = c; } }),
      el('span', {}, `${CATEGORIES[c].icon} ${CATEGORIES[c].label}`))));

  const form = el('form', {
    class: 'dialog-body',
    onsubmit: (e) => {
      e.preventDefault();
      const name = draft.name.trim();
      if (!name) return;
      // "HH:MM" strings compare correctly as text ("06:00" < "14:05").
      if (goal.measure && goal.end <= goal.start) {
        toast('The goal\'s "Until" time must be after its "From" time.', { kind: 'error' });
        return;
      }
      const data = {
        ...draft,
        name,
        icon: draft.icon.trim() || '✦',
        goal: goal.measure ? { measure: goal.measure, target: goal.target, start: goal.start, end: goal.end } : null,
      };
      let id = skillId;
      if (existing) updateSkill(skillId, data);
      else id = addSkill(data).id;
      dlg.close();
      toast(existing ? `Updated ${name}` : `Added ${name} to your Focus Map`);
      onSaved?.(id);
    },
  },
    el('h3', {}, existing ? 'Edit focus' : 'New focus'),
    el('div', { class: 'row' },
      el('label', { class: 'field grow' }, 'Name',
        el('input', { value: draft.name, required: true, maxLength: 40, placeholder: 'e.g. Spanish', autofocus: true, oninput: (e) => { draft.name = e.target.value; } })),
      el('label', { class: 'field icon-field' }, 'Icon',
        el('input', { value: draft.icon, maxLength: 4, oninput: (e) => { draft.icon = e.target.value; } })),
      el('label', { class: 'field color-field' }, 'Color',
        el('input', { type: 'color', value: draft.color, oninput: (e) => { draft.color = e.target.value; } }))),
    el('div', { class: 'field' }, 'Category', categoryPicker),
    el('h4', {}, 'Productivity metrics'),
    el('p', { class: 'muted small' }, 'What will you report after each session? Each metric converts into points.'),
    metricRows,
    el('div', { class: 'row' },
      presetSelect,
      el('button', { type: 'button', class: 'ghost', onclick: () => { draft.metrics.push({ id: uid(), label: '', unit: '', perPoint: 1 }); renderMetrics(); } }, '+ Custom metric')),
    el('h4', {}, 'Daily goal'),
    el('p', { class: 'muted small' }, 'e.g. 3 hours of focus time between 6:00 and 14:05. The Focus Session panel then shows whether you\'re ahead of or behind that pace.'),
    goalMeasure,
    goalFields,
    el('div', { class: 'row dialog-actions' },
      // The Delete button only exists when editing an existing focus.
      existing && el('button', {
        type: 'button', class: 'ghost danger',
        onclick: () => {
          if (!confirm(`Delete ${existing.name}? Its level and currency will be lost.`)) return;
          deleteSkill(skillId);
          dlg.close();
        },
      }, 'Delete'),
      el('span', { class: 'grow' }),
      el('button', { type: 'button', class: 'ghost', onclick: () => dlg.close() }, 'Cancel'),
      el('button', { type: 'submit', class: 'primary' }, existing ? 'Save' : 'Add focus')),
  );

  renderMetrics();
  dlg.replaceChildren(form);
  dlg.showModal();
}
