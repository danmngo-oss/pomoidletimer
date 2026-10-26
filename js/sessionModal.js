// Shown when a focus session ends: the user reports their self-measured output.
import { store } from './state.js';
import { $, el, toast } from './ui.js';
import { fmtDuration, fmtNum, uid } from './format.js';
import { applyXp, MAX_HISTORY, nextAvgProductivity, scoreSession } from './economy.js';
import { getSkill, openSkillEditor } from './skills.js';

export function logSession({ skill, values, focusMs, rating, note }) {
  const result = scoreSession({ skill, values, focusMs, rating });
  let levelsGained = 0;
  store.update(['skills', 'currency', 'sessions'], (s) => {
    const sk = s.skills.find((x) => x.id === skill.id);
    levelsGained = applyXp(sk, result.xp);
    sk.totalFocusMs += focusMs;
    sk.sessionCount += 1;
    if (!result.timeOnly) sk.avgProductivity = nextAvgProductivity(sk, result.productivity);
    s.momentum += result.momentum;
    s.sessions.unshift({
      id: uid(),
      at: Date.now(),
      skillId: sk.id,
      skillName: sk.name,
      icon: sk.icon,
      color: sk.color,
      focusMs,
      rating,
      note,
      metrics: sk.metrics
        .map((m) => ({ metricId: m.id, label: m.label, unit: m.unit, value: Number(values[m.id]) || 0 }))
        .filter((m) => m.value > 0),
      ...result,
    });
    s.sessions.length = Math.min(s.sessions.length, MAX_HISTORY);
  });
  return { result, levelsGained };
}

export function openSessionModal({ focusMs, skillId, onLogged }) {
  const dlg = $('session-dialog');
  let skill = getSkill(skillId) ?? store.state.skills[0] ?? null;
  const values = {};
  let rating = 3;
  let note = '';

  const fields = el('div', { class: 'metric-inputs' });
  const preview = el('div', { class: 'reward-preview' });
  const submitBtn = el('button', { type: 'submit', class: 'primary' }, 'Log session');
  const skillSelect = el('select', { onchange: (e) => { skill = getSkill(e.target.value); renderFields(); } });

  function renderSkillOptions() {
    skillSelect.replaceChildren(...store.state.skills.map((s) => el('option', { value: s.id }, `${s.icon} ${s.name}`)));
    if (skill) skillSelect.value = skill.id;
  }

  function renderFields() {
    submitBtn.disabled = !skill;
    if (!skill) {
      fields.replaceChildren(
        el('p', { class: 'muted' }, 'You need a focus to log this session to.'),
        el('button', {
          type: 'button',
          onclick: () => openSkillEditor(null, (id) => { skill = getSkill(id); renderSkillOptions(); renderFields(); }),
        }, '+ Add a Focus'));
      preview.replaceChildren();
      return;
    }
    fields.replaceChildren(
      ...skill.metrics.map((m) => el('label', { class: 'field' }, m.label || 'Unnamed metric',
        el('div', { class: 'input-unit' },
          el('input', {
            type: 'number', min: '0', step: 'any', inputMode: 'decimal', placeholder: '0',
            value: values[m.id] ?? '',
            oninput: (e) => { values[m.id] = e.target.value; updatePreview(); },
          }),
          el('span', { class: 'unit' }, m.unit)),
        el('small', { class: 'muted' }, `${m.perPoint} ${m.unit} = 1 point`))),
      ...(skill.metrics.length ? [] : [el('p', { class: 'muted' },
        'This focus has no metrics yet, so you\'ll get time-based credit. Edit it on the Focus Map to add some.')]),
    );
    updatePreview();
  }

  function updatePreview() {
    const r = scoreSession({ skill, values, focusMs, rating });
    preview.replaceChildren(
      el('div', {}, el('strong', {}, r.timeOnly ? '—' : `${fmtNum(r.productivity)} pts/hr`), el('span', { class: 'muted' }, 'productivity')),
      el('div', {}, el('strong', {}, `+${fmtNum(r.xp)}`), el('span', { class: 'muted' }, 'XP')),
      el('div', {}, el('strong', {}, `+${fmtNum(r.momentum)} ◆`), el('span', { class: 'muted' }, 'Momentum')),
    );
  }

  const ratingGroup = el('div', { class: 'rating', role: 'radiogroup', 'aria-label': 'Focus rating' },
    ...[1, 2, 3, 4, 5].map((n) => el('label', {},
      el('input', { type: 'radio', name: 'rating', value: n, checked: n === rating, onchange: () => { rating = n; updatePreview(); } }),
      el('span', {}, n))));

  const form = el('form', {
    class: 'dialog-body',
    onsubmit: (e) => {
      e.preventDefault();
      if (!skill) return;
      const { result, levelsGained } = logSession({ skill, values, focusMs, rating, note: note.trim() });
      dlg.close();
      toast(`${skill.icon} ${skill.name}: +${fmtNum(result.xp)} XP, +${fmtNum(result.momentum)} ◆`, { kind: 'success' });
      if (levelsGained) toast(`${skill.name} reached level ${getSkill(skill.id).level}! Idle output increased.`, { kind: 'level' });
      onLogged?.();
    },
  },
    el('h3', {}, 'Session complete'),
    el('p', { class: 'muted' }, `You focused for ${fmtDuration(focusMs)}. What did you get done?`),
    el('label', { class: 'field' }, 'Focus', skillSelect),
    fields,
    el('div', { class: 'field' }, 'How focused were you? (1–5)', ratingGroup),
    el('label', { class: 'field' }, 'Notes (optional)',
      el('textarea', { rows: 2, placeholder: 'e.g. Finished chapter 3 notes', oninput: (e) => { note = e.target.value; } })),
    preview,
    el('div', { class: 'row dialog-actions' },
      el('button', {
        type: 'button', class: 'ghost danger',
        onclick: () => { if (confirm('Discard this session?')) { dlg.close(); onLogged?.(); } },
      }, 'Discard'),
      el('span', { class: 'grow' }),
      el('button', { type: 'button', class: 'ghost', onclick: () => dlg.close() }, 'Later'),
      submitBtn),
  );

  renderSkillOptions();
  renderFields();
  dlg.replaceChildren(form);
  dlg.showModal();
}
