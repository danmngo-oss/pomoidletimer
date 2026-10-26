// ============================================================================
// sessionModal.js — the "Session complete" dialog, shown when a focus session
// ends: the user reports their self-measured output (characters typed,
// lecture minutes…), rates their focus, and claims the rewards.
//
// It has two parts:
//   • logSession()       — does the bookkeeping: XP, Momentum, stats, history
//   • openSessionModal() — builds the dialog and calls logSession() on submit
// ============================================================================
import { store } from './state.js';
import { $, el, toast } from './ui.js';
import { fmtDuration, fmtNum, uid } from './format.js';
import { applyXp, MAX_HISTORY, nextAvgProductivity, scoreSession } from './economy.js';
import { getSkill, openSkillEditor } from './skills.js';

// Records a finished session and pays out its rewards.
// `values` maps metric id -> the amount the user entered.
// Returns the rewards and how many levels the focus gained (for the toasts).
export function logSession({ skill, values, focusMs, rating, note }) {
  const result = scoreSession({ skill, values, focusMs, rating });
  let levelsGained = 0;
  // One update covering three topics, so the map, HUD and session log all
  // redraw once afterwards.
  store.update(['skills', 'currency', 'sessions'], (s) => {
    // Look the focus up in the live state rather than using `skill` directly,
    // so we edit the object that actually gets saved.
    const sk = s.skills.find((x) => x.id === skill.id);
    levelsGained = applyXp(sk, result.xp);
    sk.totalFocusMs += focusMs;
    sk.sessionCount += 1;
    if (!result.timeOnly) sk.avgProductivity = nextAvgProductivity(sk, result.productivity);
    s.momentum += result.momentum;
    // The history entry copies the focus's name/icon/colour, so the log still
    // reads correctly if the focus is later renamed or deleted.
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
      // Keep only metrics the user actually filled in. metricId lets daily
      // goals (goals.js) find a metric even if it's renamed later.
      metrics: sk.metrics
        .map((m) => ({ metricId: m.id, label: m.label, unit: m.unit, value: Number(values[m.id]) || 0 }))
        .filter((m) => m.value > 0),
      // Adds points, xp, momentum, productivity… from scoreSession.
      ...result,
    });
    // Trim the oldest entries so the save doesn't grow forever.
    s.sessions.length = Math.min(s.sessions.length, MAX_HISTORY);
  });
  return { result, levelsGained };
}

// Opens the dialog. `onLogged` runs after the session is logged or
// discarded (the timer uses it to reset itself). Closing with "Later" or Esc
// skips it, so the time stays on the timer.
export function openSessionModal({ focusMs, skillId, onLogged }) {
  const dlg = $('session-dialog');
  // Default to the selected focus, else the first one, else none.
  let skill = getSkill(skillId) ?? store.state.skills[0] ?? null;
  // The form's current inputs. These variables are shared by the event
  // handlers below (a "closure"), which is how the dialog remembers what's
  // been typed without storing it in the game state.
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

  // One number input per metric of the chosen focus. Rebuilt when the focus
  // dropdown changes, since each focus has different metrics.
  function renderFields() {
    submitBtn.disabled = !skill;
    if (!skill) {
      // No foci exist yet: offer to create one right here, then continue.
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

  // The three reward boxes at the bottom, recalculated on every keystroke
  // using the same formula the real reward uses.
  function updatePreview() {
    const r = scoreSession({ skill, values, focusMs, rating });
    preview.replaceChildren(
      el('div', {}, el('strong', {}, r.timeOnly ? '—' : `${fmtNum(r.productivity)} pts/hr`), el('span', { class: 'muted' }, 'productivity')),
      el('div', {}, el('strong', {}, `+${fmtNum(r.xp)}`), el('span', { class: 'muted' }, 'XP')),
      el('div', {}, el('strong', {}, `+${fmtNum(r.momentum)} ◆`), el('span', { class: 'muted' }, 'Momentum')),
    );
  }

  // Five radio buttons styled as a row of boxes (see .rating in styles.css).
  const ratingGroup = el('div', { class: 'rating', role: 'radiogroup', 'aria-label': 'Focus rating' },
    ...[1, 2, 3, 4, 5].map((n) => el('label', {},
      el('input', { type: 'radio', name: 'rating', value: n, checked: n === rating, onchange: () => { rating = n; updatePreview(); } }),
      el('span', {}, n))));

  const form = el('form', {
    class: 'dialog-body',
    onsubmit: (e) => {
      // Stop the browser's default form submit (which would reload the page).
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
  // The <dialog> element lives in index.html; we fill it and show it as a
  // modal (blocks the page behind it until closed).
  dlg.replaceChildren(form);
  dlg.showModal();
}
