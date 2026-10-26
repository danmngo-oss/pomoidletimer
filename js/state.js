// Central game state: a single plain object, persisted to localStorage.
// Modules mutate it through store.update(topic, fn) so subscribers re-render.

const SAVE_KEY = 'focusIdle.save';
export const SAVE_VERSION = 1;

// Every topic a module may subscribe to.
export const TOPICS = ['skills', 'selection', 'currency', 'sessions', 'clock', 'timer', 'layout'];

function localZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

export function createDefaultState() {
  return {
    version: SAVE_VERSION,
    focus: 0,                 // global currency, earned only from logged sessions
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
    lastSeen: Date.now(),     // used for offline idle progress
  };
}

// Upgrade older saves here when the shape changes (bump SAVE_VERSION).
function migrate(raw) {
  const base = createDefaultState();
  return {
    ...base,
    ...raw,
    clock: { ...base.clock, ...raw.clock },
    timer: { ...base.timer, ...raw.timer },
    version: SAVE_VERSION,
  };
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
