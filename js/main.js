// ============================================================================
// main.js — the entry point. index.html loads only this file; everything else
// is pulled in through the `import` lines below (these are ES modules, which
// is why the game must be served over http:// rather than opened as a file).
//
// How the code fits together:
//   • state.js holds ONE big object with the whole game (units, buildings,
//     currencies, goals, sessions, timer, breaks…) and saves it to the
//     browser's localStorage.
//   • Every other module owns one part of the screen. It reads from the
//     state, changes it through store.update(...), and re-draws itself when
//     the state it cares about changes (store.subscribe(...)).
//   • economy.js holds the game-balance maths; stats.js and grid.js describe
//     unit types and the city's tiles; format.js and ui.js are small helpers
//     shared by everyone.
//
// Naming note: the player sees "units" (slimes in the city), but in the code
// a unit is called a `skill` — that was its original name.
// ============================================================================
import { store, isFirstRun } from './state.js';
import { $, toast } from './ui.js';
import { seedStarterSkills } from './skills.js';
import { initClock } from './clock.js';
import { initTimer } from './timer.js';
import { initCityMap } from './cityMap.js';
import { initHistory } from './history.js';
import { initHud } from './hud.js';
import { initIdle } from './idle.js';
import { initBreaks } from './breaks.js';
import { initGoals, initPaceCard } from './goals.js';

// Wires up the Export / Import / Reset buttons in the top bar.
function initSaveMenu() {
  // Export: turn the state into a JSON text file and "click" an invisible
  // download link for it. createObjectURL gives the in-memory file a URL.
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

  // Import: the visible button opens a hidden <input type="file">. When a
  // file is picked we parse it and swap it in as the whole game state.
  const fileInput = $('import-file');
  $('import-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    // Clearing the input lets you import the same file twice in a row.
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
    if (confirm('Erase all progress: your city, units, goals and history?')) store.reset();
  });
}

// ---- Startup ---------------------------------------------------------------
// A brand-new player (nothing in localStorage) gets a few example units.
if (isFirstRun) seedStarterSkills();

// Each init function finds its part of index.html, draws it, and subscribes
// to the state it needs. initIdle goes last because it may immediately pay
// out "while you were away" earnings, which the other panels should show.
initClock();
initCityMap();
initTimer();
initBreaks();
initPaceCard();
initGoals();
initHistory();
initHud();
initSaveMenu();
initIdle();

// Handy for debugging in the console: focusIdle.store.state
window.focusIdle = { store };
