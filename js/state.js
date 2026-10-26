// ============================================================================
// state.js — the single source of truth for the whole game.
//
// All game data lives in one plain object (`state`). It is saved to the
// browser's localStorage, so progress survives closing the tab.
//
// Other modules never keep their own copy of game data. Instead they:
//   1. read it:     store.state.skills
//   2. change it:   store.update('skills', (s) => { s.skills.push(...) })
//   3. react to it: store.subscribe('skills', redrawMyPanel)
//
// The first argument to update/subscribe is a "topic" — a label for what kind
// of data changed. When you update the 'skills' topic, only functions that
// subscribed to 'skills' run again. This is a simple publish/subscribe
// ("pub/sub") pattern; it keeps modules from needing to know about each other.
//
// Note: in code a "focus" (a node on the Focus Map) is called a `skill`.
// ============================================================================

import { uid } from './format.js';

// The localStorage key the save is stored under.
const SAVE_KEY = 'focusIdle.save';
// Bump this whenever the shape of the saved data changes, and teach migrate()
// (below) how to upgrade older saves.
export const SAVE_VERSION = 2;

// Every topic a module may subscribe to.
export const TOPICS = ['skills', 'selection', 'currency', 'sessions', 'clock', 'timer', 'break', 'layout'];

// The break presets a new player starts with. `minutes: null` means an
// open-ended break that counts up instead of down. `categories` decides which
// foci get the bonus when the break ends (see categories.js / breaks.js).
const DEFAULT_BREAK_PRESETS = [
  { name: 'Take a walk', icon: '🚶', minutes: 10, categories: ['mental', 'physical'], metric: { unit: 'steps', target: 1000 } },
  { name: 'Drink water', icon: '💧', minutes: 2, categories: ['physical'], metric: { unit: 'glasses', target: 1 } },
  { name: 'Answer texts', icon: '📱', minutes: 5, categories: ['life'], metric: null },
  { name: 'Stretch', icon: '🧘', minutes: 5, categories: ['physical'], metric: null },
  { name: 'Tidy up', icon: '🧺', minutes: 10, categories: ['life'], metric: null },
  { name: 'Open break', icon: '☕', minutes: null, categories: ['mental'], metric: null },
];

// The player's own time zone (e.g. "America/Chicago"), used as the World
// Clock's starting zone. Falls back to UTC on very old browsers.
function localZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

// What a brand-new game looks like. This is also the "template" that older
// saves are filled in from, so every field a save might be missing has a
// default here. Times are stored as numbers of milliseconds ("ms"), and
// moments in time as "epoch ms" (Date.now(): ms since 1 Jan 1970).
export function createDefaultState() {
  return {
    version: SAVE_VERSION,
    momentum: 0,              // global currency, earned only from logged sessions
    skills: [],               // see makeSkill() in skills.js
    sessions: [],             // log of completed sessions, newest first
    selectedSkillId: null,
    clock: { hour12: true, timeZone: localZone(), extraZones: [] },
    timer: {
      mode: 'countdown',      // 'countdown' | 'stopwatch'
      durationMs: 25 * 60_000,
      startedAt: null,        // epoch ms while running, null while paused/stopped
      elapsedMs: 0,           // time banked before the current run
    },
    // durationMs: null = open-ended (stopwatch); metric: optional { unit, target }
    // ({ minutes, ...p } pulls `minutes` out and puts every other field in `p`.)
    breakPresets: DEFAULT_BREAK_PRESETS.map(({ minutes, ...p }) => ({
      id: uid(), ...p, durationMs: minutes ? minutes * 60_000 : null,
    })),
    activeBreak: null,        // { presetId, name, icon, durationMs, categories, metric, startedAt }
    breaks: [],               // log of finished breaks, newest first
    buffs: {},                // category -> epoch ms when its break bonus expires
    lastSeen: Date.now(),     // used for offline idle progress
  };
}

// Upgrade older saves here when the shape changes (bump SAVE_VERSION).
function migrate(raw) {
  const base = createDefaultState();
  // `...` (spread) copies fields. Defaults go first, then the save's own
  // values overwrite them, so any field the save lacks keeps its default.
  // Nested objects (clock, timer) are merged the same way, one level down.
  const s = {
    ...base,
    ...raw,
    clock: { ...base.clock, ...raw.clock },
    timer: { ...base.timer, ...raw.timer },
    version: SAVE_VERSION,
  };
  // `??` means "use the right side if the left is null/undefined".
  if ((raw.version ?? 1) < 2) {
    // v2: skills became "foci" with a category and optional daily goal, the
    // global currency was renamed Focus -> Momentum, and breaks gained categories.
    s.momentum = raw.focus ?? 0;
    delete s.focus;
    s.skills = s.skills.map((k) => ({ category: 'mental', goal: null, ...k }));
    s.sessions = s.sessions.map((x) => ({ momentum: x.focus ?? 0, ...x }));
    // Presets that match a default by name get that default's categories;
    // anything custom becomes Mental. (`?.` returns undefined instead of
    // crashing when `known` wasn't found.)
    s.breakPresets = s.breakPresets.map((p) => {
      const known = DEFAULT_BREAK_PRESETS.find((d) => d.name === p.name);
      return { categories: known?.categories ?? ['mental'], metric: known?.metric ?? null, ...p };
    });
    s.breaks = s.breaks.map((b) => ({ categories: [], bonusMs: 0, ...b }));
    if (s.activeBreak) s.activeBreak = { categories: [], metric: null, ...s.activeBreak };
  }
  return s;
}

// Reads the save from localStorage. Returns null when there is none (a new
// player) or it can't be read, in which case the game starts fresh.
function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (err) {
    console.warn('Could not load save, starting fresh.', err);
  }
  return null;
}

// Load once, when this module is first imported.
let state = load();
export const isFirstRun = !state;
// `??=` assigns only if `state` is still null.
state ??= createDefaultState();

// topic -> the set of functions to call when that topic changes.
const listeners = new Map(TOPICS.map((t) => [t, new Set()]));
let saveTimer = null;
// Turned off during a reset so the page doesn't re-save on its way out.
let saving = true;

// Calls every subscriber of the given topic(s). `[].concat(x)` turns either a
// single topic or an array of topics into an array.
function emit(topics) {
  for (const topic of [].concat(topics)) {
    for (const fn of listeners.get(topic) ?? []) fn(state);
  }
}

// Writes the state to localStorage right now.
function save() {
  if (!saving) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (err) { console.warn('Save failed', err); }
}

// The idle loop changes state every second, so instead of saving on every
// change we save at most once per second ("debouncing"): the first change
// starts a 1s timer and later changes in that second just ride along.
function scheduleSave() {
  saveTimer ??= setTimeout(save, 1000);
}

// The public API every other module uses.
export const store = {
  // A "getter": store.state always returns the current object, even after
  // replace() swaps in a new one.
  get state() { return state; },

  // Run `fn` whenever any of the given topics is updated.
  subscribe(topics, fn) {
    for (const topic of [].concat(topics)) listeners.get(topic)?.add(fn);
  },

  // Change the state, then notify subscribers and schedule a save.
  // `mutate` receives the state and edits it in place.
  update(topics, mutate) {
    mutate(state);
    emit(topics);
    scheduleSave();
  },

  save,

  // Swap in a whole new state (used by Import), then redraw everything.
  replace(next) {
    state = migrate(next);
    emit(TOPICS);
    save();
  },

  // Wipe the save and reload the page, which starts a new game.
  reset() {
    saving = false;
    localStorage.removeItem(SAVE_KEY);
    location.reload();
  },
};

// Save immediately when the tab is closed or hidden (switched away from, or a
// phone screen locks), so the 1-second debounce never loses progress.
window.addEventListener('beforeunload', save);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
