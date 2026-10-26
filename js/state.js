// Central game state: a single plain object, persisted to localStorage.
// Modules mutate it through store.update(topic, fn) so subscribers re-render.
// Note: in code a "focus" (a node on the Focus Map) is called a `skill`.

import { uid } from './format.js';

const SAVE_KEY = 'focusIdle.save';
export const SAVE_VERSION = 2;

// Every topic a module may subscribe to.
export const TOPICS = ['skills', 'selection', 'currency', 'sessions', 'clock', 'timer', 'break', 'layout'];

const DEFAULT_BREAK_PRESETS = [
  { name: 'Take a walk', icon: '🚶', minutes: 10, categories: ['mental', 'physical'], metric: { unit: 'steps', target: 1000 } },
  { name: 'Drink water', icon: '💧', minutes: 2, categories: ['physical'], metric: { unit: 'glasses', target: 1 } },
  { name: 'Answer texts', icon: '📱', minutes: 5, categories: ['life'], metric: null },
  { name: 'Stretch', icon: '🧘', minutes: 5, categories: ['physical'], metric: null },
  { name: 'Tidy up', icon: '🧺', minutes: 10, categories: ['life'], metric: null },
  { name: 'Open break', icon: '☕', minutes: null, categories: ['mental'], metric: null },
];

function localZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

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
  const s = {
    ...base,
    ...raw,
    clock: { ...base.clock, ...raw.clock },
    timer: { ...base.timer, ...raw.timer },
    version: SAVE_VERSION,
  };
  if ((raw.version ?? 1) < 2) {
    // v2: skills became "foci" with a category and optional daily goal, the
    // global currency was renamed Focus -> Momentum, and breaks gained categories.
    s.momentum = raw.focus ?? 0;
    delete s.focus;
    s.skills = s.skills.map((k) => ({ category: 'mental', goal: null, ...k }));
    s.sessions = s.sessions.map((x) => ({ momentum: x.focus ?? 0, ...x }));
    s.breakPresets = s.breakPresets.map((p) => {
      const known = DEFAULT_BREAK_PRESETS.find((d) => d.name === p.name);
      return { categories: known?.categories ?? ['mental'], metric: known?.metric ?? null, ...p };
    });
    s.breaks = s.breaks.map((b) => ({ categories: [], bonusMs: 0, ...b }));
    if (s.activeBreak) s.activeBreak = { categories: [], metric: null, ...s.activeBreak };
  }
  return s;
}

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (err) {
    console.warn('Could not load save, starting fresh.', err);
  }
  return null;
}

let state = load();
export const isFirstRun = !state;
state ??= createDefaultState();

const listeners = new Map(TOPICS.map((t) => [t, new Set()]));
let saveTimer = null;
let saving = true;

function emit(topics) {
  for (const topic of [].concat(topics)) {
    for (const fn of listeners.get(topic) ?? []) fn(state);
  }
}

function save() {
  if (!saving) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (err) { console.warn('Save failed', err); }
}

function scheduleSave() {
  saveTimer ??= setTimeout(save, 1000);
}

export const store = {
  get state() { return state; },

  subscribe(topics, fn) {
    for (const topic of [].concat(topics)) listeners.get(topic)?.add(fn);
  },

  update(topics, mutate) {
    mutate(state);
    emit(topics);
    scheduleSave();
  },

  save,

  replace(next) {
    state = migrate(next);
    emit(TOPICS);
    save();
  },

  reset() {
    saving = false;
    localStorage.removeItem(SAVE_KEY);
    location.reload();
  },
};

window.addEventListener('beforeunload', save);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
