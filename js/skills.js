// Skill data model, CRUD, and the add/edit dialog.
import { store } from './state.js';
import { $, el, toast } from './ui.js';
import { uid } from './format.js';

export const METRIC_PRESETS = [
  { label: 'Characters typed', unit: 'chars', perPoint: 100 },
  { label: 'Lecture time digested', unit: 'min', perPoint: 1 },
  { label: 'Pages read', unit: 'pages', perPoint: 2 },
  { label: 'Problems solved', unit: 'problems', perPoint: 0.5 },
  { label: 'Flashcards reviewed', unit: 'cards', perPoint: 10 },
  { label: 'Lines of code', unit: 'lines', perPoint: 20 },
];

const PALETTE = ['#7c9cff', '#5fd3a4', '#ffb86b', '#ff7aa8', '#c792ea', '#62d6e8', '#f7d154'];

// Map layout space (matches the SVG viewBox in skillMap.js).
export const MAP = { w: 1000, h: 600, hub: { x: 500, y: 300 } };

export function makeSkill({ name, icon = '✦', color, metrics = [] }) {
  return {
    id: uid(),
    name,
    icon,
    color: color ?? PALETTE[store.state.skills.length % PALETTE.length],
    level: 1,
    xp: 0,
    currency: 0,          // this skill's own idle currency
    totalFocusMs: 0,
    sessionCount: 0,
    avgProductivity: 0,   // output points per focused hour (EMA)
    metrics: metrics.map((m) => ({ id: uid(), label: m.label, unit: m.unit, perPoint: m.perPoint })),
    pos: null,
    theme: null,          // reserved for future customization/themes
    createdAt: Date.now(),
  };
}

export const getSkill = (id) => store.state.skills.find((s) => s.id === id);

// First open slot on concentric rings around the hub.
function nextFreePosition() {
  const taken = store.state.skills.map((s) => s.pos).filter(Boolean);
  for (const [radius, slots] of [[200, 8], [270, 12], [130, 6]]) {
    for (let i = 0; i < slots; i++) {
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

export function addSkill(data) {
  const skill = makeSkill(data);
  skill.pos = nextFreePosition();
  store.update(['skills', 'selection'], (s) => {
    s.skills.push(skill);
    s.selectedSkillId ??= skill.id;
  });
  return skill;
}

export function updateSkill(id, patch) {
  store.update('skills', (s) => Object.assign(s.skills.find((sk) => sk.id === id), patch));
}

export function deleteSkill(id) {
  store.update(['skills', 'selection', 'currency'], (s) => {
    s.skills = s.skills.filter((sk) => sk.id !== id);
    if (s.selectedSkillId === id) s.selectedSkillId = s.skills[0]?.id ?? null;
  });
}

export function selectSkill(id) {
  store.update('selection', (s) => { s.selectedSkillId = id; });
}

export function seedStarterSkills() {
  addSkill({ name: 'Note-taking', icon: '✎', metrics: [METRIC_PRESETS[0]] });
  addSkill({ name: 'Lectures', icon: '🎓', metrics: [METRIC_PRESETS[1]] });
}

// ---- Add / edit dialog ----------------------------------------------------

export function openSkillEditor(skillId = null, onSaved) {
  const dlg = $('skill-dialog');
  const existing = skillId ? getSkill(skillId) : null;
  const draft = existing
    ? structuredClone({ name: existing.name, icon: existing.icon, color: existing.color, metrics: existing.metrics })
    : { name: '', icon: '✦', color: PALETTE[store.state.skills.length % PALETTE.length], metrics: [] };

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
      const data = { ...draft, name, icon: draft.icon.trim() || '✦' };
      let id = skillId;
      if (existing) updateSkill(skillId, data);
      else id = addSkill(data).id;
      dlg.close();
      toast(existing ? `Updated ${name}` : `Added ${name} to your map`);
      onSaved?.(id);
    },
  },
    el('h3', {}, existing ? 'Edit skill' : 'New skill'),
    el('div', { class: 'row' },
      el('label', { class: 'field grow' }, 'Name',
        el('input', { value: draft.name, required: true, maxLength: 40, placeholder: 'e.g. Spanish', autofocus: true, oninput: (e) => { draft.name = e.target.value; } })),
      el('label', { class: 'field icon-field' }, 'Icon',
        el('input', { value: draft.icon, maxLength: 4, oninput: (e) => { draft.icon = e.target.value; } })),
      el('label', { class: 'field color-field' }, 'Color',
        el('input', { type: 'color', value: draft.color, oninput: (e) => { draft.color = e.target.value; } }))),
    el('h4', {}, 'Productivity metrics'),
    el('p', { class: 'muted small' }, 'What will you report after each session? Each metric converts into points.'),
    metricRows,
    el('div', { class: 'row' },
      presetSelect,
      el('button', { type: 'button', class: 'ghost', onclick: () => { draft.metrics.push({ id: uid(), label: '', unit: '', perPoint: 1 }); renderMetrics(); } }, '+ Custom metric')),
    el('div', { class: 'row dialog-actions' },
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
      el('button', { type: 'submit', class: 'primary' }, existing ? 'Save' : 'Add skill')),
  );

  renderMetrics();
  dlg.replaceChildren(form);
  dlg.showModal();
}
