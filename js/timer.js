// Countdown timer + stopwatch. Time is derived from timestamps, so it stays
// accurate in background tabs and survives page reloads.
import { store } from './state.js';
import { $, el, chime, notify, primeAudio, requestNotifications, toast } from './ui.js';
import { fmtClock } from './format.js';
import { selectSkill } from './skills.js';
import { openSessionModal } from './sessionModal.js';

const elapsed = (t) => t.elapsedMs + (t.startedAt ? Date.now() - t.startedAt : 0);
const isRunning = (t) => t.startedAt != null;
const TITLE = document.title;

export function initTimer() {
  const display = $('timer-display');
  const progress = $('timer-progress');
  const minutesInput = $('timer-minutes');
  const startBtn = $('timer-start');
  const skillSelect = $('timer-skill');

  const setTimer = (patch) => store.update('timer', (s) => Object.assign(s.timer, patch));

  function start() {
    primeAudio();
    requestNotifications();
    setTimer({ startedAt: Date.now() });
  }

  function pause() {
    setTimer({ elapsedMs: elapsed(store.state.timer), startedAt: null });
  }

  function reset() {
    setTimer({ elapsedMs: 0, startedAt: null });
  }

  function finish(auto = false) {
    const t = store.state.timer;
    const focusMs = t.mode === 'countdown' ? Math.min(elapsed(t), t.durationMs) : elapsed(t);
    setTimer({ elapsedMs: focusMs, startedAt: null });
    if (focusMs < 1000) {
      toast('Start a session first — nothing to log yet.');
      return;
    }
    if (auto) {
      chime();
      notify('Focus session complete', 'Log what you accomplished to earn rewards.');
    }
    openSessionModal({ focusMs, skillId: store.state.selectedSkillId, onLogged: reset });
  }

  function setDuration(minutes) {
    const m = Math.min(600, Math.max(1, Math.round(minutes) || 25));
    setTimer({ durationMs: m * 60_000 });
  }

  // Mode / controls wiring
  for (const btn of $('timer-mode').querySelectorAll('button')) {
    btn.addEventListener('click', () => {
      const t = store.state.timer;
      if (t.mode === btn.dataset.mode) return;
      if (elapsed(t) > 0 && !confirm('Switching modes resets the current session. Continue?')) return;
      setTimer({ mode: btn.dataset.mode, elapsedMs: 0, startedAt: null });
    });
  }
  for (const btn of document.querySelectorAll('#timer-duration [data-preset]')) {
    btn.addEventListener('click', () => setDuration(Number(btn.dataset.preset)));
  }
  minutesInput.addEventListener('change', () => setDuration(Number(minutesInput.value)));
  startBtn.addEventListener('click', () => (isRunning(store.state.timer) ? pause() : start()));
  $('timer-finish').addEventListener('click', () => finish(false));
  $('timer-reset').addEventListener('click', () => {
    if (elapsed(store.state.timer) > 60_000 && !confirm('Discard this session without logging it?')) return;
    reset();
  });
  skillSelect.addEventListener('change', () => selectSkill(skillSelect.value || null));

  function renderControls() {
    const t = store.state.timer;
    const running = isRunning(t);
    const e = elapsed(t);
    for (const btn of $('timer-mode').querySelectorAll('button')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.mode === t.mode));
    }
    $('timer-duration').hidden = t.mode !== 'countdown';
    // Lock the duration once a session is underway; reset to change it.
    const locked = running || e > 0;
    for (const input of $('timer-duration').querySelectorAll('input, button')) input.disabled = locked;
    minutesInput.value = Math.round(t.durationMs / 60_000);
    startBtn.textContent = running ? 'Pause' : e > 0 ? 'Resume' : 'Start';
    $('timer-finish').disabled = e === 0;
    $('timer-panel').classList.toggle('running', running);
    tick();
  }

  function renderSkills() {
    const { skills, selectedSkillId } = store.state;
    skillSelect.replaceChildren(
      ...(skills.length ? [] : [el('option', { value: '' }, '— add a skill first —')]),
      ...skills.map((s) => el('option', { value: s.id }, `${s.icon} ${s.name}`)),
    );
    skillSelect.value = selectedSkillId ?? '';
  }

  function tick() {
    const t = store.state.timer;
    const e = elapsed(t);
    let text;
    if (t.mode === 'countdown') {
      const remaining = Math.max(0, t.durationMs - e);
      text = fmtClock(remaining, { ceil: true });
      progress.style.width = `${Math.min(100, (e / t.durationMs) * 100)}%`;
      if (isRunning(t) && remaining <= 0) finish(true);
    } else {
      text = fmtClock(e);
      progress.style.width = `${((e % 3_600_000) / 3_600_000) * 100}%`; // fills once per hour
    }
    display.textContent = text;
    document.title = isRunning(store.state.timer) ? `${text} · ${TITLE}` : TITLE;
  }

  store.subscribe('timer', renderControls);
  store.subscribe(['skills', 'selection'], renderSkills);
  renderSkills();
  renderControls();
  setInterval(tick, 250);
}
