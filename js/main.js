import { store, isFirstRun } from './state.js';
import { $, toast } from './ui.js';
import { seedStarterSkills } from './skills.js';
import { initClock } from './clock.js';
import { initTimer } from './timer.js';
import { initSkillMap } from './skillMap.js';
import { initHistory } from './history.js';
import { initHud } from './hud.js';
import { initIdle } from './idle.js';
import { initBreaks } from './breaks.js';
import { initGoalCard } from './goals.js';

function initSaveMenu() {
  $('export-btn').addEventListener('click', () => {
    store.save();
    const blob = new Blob([JSON.stringify(store.state, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `focus-idle-${new Date().toISOString().slice(0, 10)}.json`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const fileInput = $('import-file');
  $('import-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      store.replace(JSON.parse(await file.text()));
      toast('Save imported', { kind: 'success' });
    } catch {
      toast('That file is not a valid save', { kind: 'error' });
    }
  });

  $('reset-btn').addEventListener('click', () => {
    if (confirm('Erase all progress, foci and history?')) store.reset();
  });
}

if (isFirstRun) seedStarterSkills();

initClock();
initSkillMap();
initTimer();
initBreaks();
initGoalCard();
initHistory();
initHud();
initSaveMenu();
initIdle();

// Handy for debugging in the console: focusIdle.store.state
window.focusIdle = { store };
