// ============================================================================
// windows.js — movable sub-windows floating over the city.
//
// The Time, Focus Session and Goals panels, the Units window and each
// building's interior are windows. A window has a title bar you can drag
// to move it, a minimise (–) and a close (×) button, and comes to the
// front when clicked. Buttons with data-window-toggle="id" (the dock in
// the top bar, the city toolbar) open and close them.
//
// Positions and open/minimised state are remembered per browser in
// localStorage. They're a layout preference, not game progress, so they
// aren't part of the save file. On narrow screens windows stop floating
// and stack in the page instead (see .window-layer in styles.css).
// ============================================================================
import { $, el } from './ui.js';

const KEY = 'focusIdle.windows';
const NARROW = '(max-width: 760px)';

// Saved layout: window id -> { pos: { x, y }, open, min }.
let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* storage blocked: use defaults */ }
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* storage blocked */ }
}

const windows = new Map(); // id -> handle (see createWindow)
const focusOrder = [];     // window ids, most recently focused last
let topZ = 10;             // z-index handed to the window brought to the front

// Other modules can react when windows open, close or change focus (the
// Units window uses this to know which building window is in use).
const listeners = new Set();
export const onWindowsChange = (fn) => listeners.add(fn);
function changed() {
  syncDock();
  for (const fn of listeners) fn();
}

export const isNarrow = () => matchMedia(NARROW).matches;
export const getWindow = (id) => windows.get(id);

// The most recently focused open window whose id passes `test`.
export function mostRecentWindow(test) {
  for (let i = focusOrder.length - 1; i >= 0; i--) {
    const w = windows.get(focusOrder[i]);
    if (w?.isOpen() && test(focusOrder[i])) return w;
  }
  return undefined;
}

// Keeps a window's title bar reachable: below the top bar, and with at
// least 120px of it on screen horizontally.
function clamp({ x, y }) {
  const top = (document.querySelector('.topbar')?.offsetHeight ?? 0) + 4;
  return {
    x: Math.round(Math.min(Math.max(0, x), innerWidth - 120)),
    y: Math.round(Math.max(top, Math.min(y, innerHeight - 44))),
  };
}

// Creates a window, or turns an existing element (`root`) into one.
//   id          unique name; also the key its layout is remembered under
//   title, icon shown in the title bar (setTitle changes them later)
//   root        an element already in #windows whose children become the body
//   body        or: a ready-made body element (given class window-body)
//   width       in px
//   defaultPos  () => { x, y }, used until the player moves it
//   startOpen   whether it starts open (until the player opens/closes it)
//   transient   not remembered, and closing it removes it for good
//               (building windows)
//   onOpen, onClose   callbacks
export function createWindow({
  id, title, icon = '', root = null, body = null, width = 340, defaultPos, startOpen = true, transient = false, onOpen, onClose,
}) {
  const memory = transient ? {} : (saved[id] ??= {});
  const win = root ?? el('section', {});
  win.classList.add('window');
  win.dataset.window = id;
  win.style.width = `${width}px`;
  win.setAttribute('role', 'dialog');
  win.setAttribute('aria-modal', 'false');

  let content = body;
  if (!content) {
    content = el('div', {});
    content.append(...win.childNodes);
  }
  content.classList.add('window-body');

  const titleEl = el('span', { class: 'window-title' });
  const minBtn = el('button', { type: 'button', class: 'window-btn', title: 'Minimise', 'aria-label': 'Minimise' }, '–');
  const closeBtn = el('button', { type: 'button', class: 'window-btn', title: 'Close', 'aria-label': 'Close' }, '×');
  const bar = el('div', { class: 'window-bar' }, titleEl, el('span', { class: 'grow' }), minBtn, closeBtn);
  win.replaceChildren(bar, content);
  if (!win.parentElement) $('windows').append(win);

  // Moves the window to its remembered (or default) spot, kept on screen.
  function place() {
    const pos = clamp(memory.pos ?? defaultPos?.() ?? { x: 40, y: 120 });
    win.style.left = `${pos.x}px`;
    win.style.top = `${pos.y}px`;
  }

  function setMinimized(min) {
    win.classList.toggle('minimized', min);
    minBtn.textContent = min ? '▢' : '–';
    minBtn.title = min ? 'Restore' : 'Minimise';
    minBtn.setAttribute('aria-label', minBtn.title);
    memory.min = min;
    persist();
  }

  const handle = {
    id,
    el: win,
    body: content,
    isOpen: () => !win.hidden,
    setTitle(text, ic = icon) {
      titleEl.textContent = `${ic} ${text}`.trim();
      win.setAttribute('aria-label', text);
    },
    // Brings the window to the front and records it as most recently used.
    focus() {
      win.style.zIndex = ++topZ;
      const i = focusOrder.indexOf(id);
      if (i >= 0) focusOrder.splice(i, 1);
      focusOrder.push(id);
      changed();
    },
    // `scroll`: in the stacked phone layout, jump to the window (not wanted
    // for the windows opened automatically when the page loads).
    open(scroll = true) {
      if (!win.hidden) return handle.focus();
      win.hidden = false;
      place();
      memory.open = true;
      persist();
      onOpen?.();
      handle.focus();
      if (scroll && isNarrow()) win.scrollIntoView({ block: 'start', behavior: 'smooth' });
    },
    close() {
      win.hidden = true;
      memory.open = false;
      persist();
      onClose?.();
      if (transient) handle.destroy();
      else changed();
    },
    toggle() {
      if (handle.isOpen()) handle.close();
      else handle.open();
    },
    // After the browser window is resized, pull the window back on screen.
    keepOnScreen() {
      if (!win.hidden) {
        const pos = clamp({ x: win.offsetLeft, y: win.offsetTop });
        win.style.left = `${pos.x}px`;
        win.style.top = `${pos.y}px`;
      }
    },
    destroy() {
      win.remove();
      windows.delete(id);
      const i = focusOrder.indexOf(id);
      if (i >= 0) focusOrder.splice(i, 1);
      changed();
    },
  };

  minBtn.addEventListener('click', () => setMinimized(!win.classList.contains('minimized')));
  closeBtn.addEventListener('click', () => handle.close());

  // Any press inside the window brings it to the front. `true` = run during
  // the capture phase, i.e. before the press reaches whatever was clicked.
  win.addEventListener('pointerdown', () => { if (focusOrder.at(-1) !== id) handle.focus(); }, true);

  // Dragging the title bar moves the window (not on the buttons, and not in
  // the stacked phone layout). The window layer covers the viewport, so
  // offsetLeft/offsetTop are screen positions.
  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button') || isNarrow()) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, left: win.offsetLeft, top: win.offsetTop };
    bar.setPointerCapture(e.pointerId);
    win.classList.add('moving');
    const move = (ev) => {
      const pos = clamp({ x: start.left + ev.clientX - start.x, y: start.top + ev.clientY - start.y });
      win.style.left = `${pos.x}px`;
      win.style.top = `${pos.y}px`;
    };
    const up = () => {
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
      win.classList.remove('moving');
      memory.pos = { x: win.offsetLeft, y: win.offsetTop };
      persist();
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  });

  handle.setTitle(title, icon);
  windows.set(id, handle);
  setMinimized(memory.min ?? false);
  win.hidden = true;
  if (memory.open ?? startOpen) handle.open(false);
  else changed();
  return handle;
}

// Marks each dock/toolbar toggle button as pressed while its window is open.
function syncDock() {
  for (const btn of document.querySelectorAll('[data-window-toggle]')) {
    btn.setAttribute('aria-pressed', String(!!windows.get(btn.dataset.windowToggle)?.isOpen()));
  }
}

// The three windows that start out as sections in index.html, plus the
// dock buttons. Default spots follow the original sketch: Time on the left,
// Focus Session in the middle, Goals on the right.
export function initWindows() {
  createWindow({ id: 'clock', title: 'Time', icon: '🕒', root: $('clock-panel'), width: 280, defaultPos: () => ({ x: 16, y: 130 }) });
  createWindow({ id: 'timer', title: 'Focus Session', icon: '⏱', root: $('timer-panel'), width: 360, defaultPos: () => ({ x: innerWidth / 2 - 180, y: 130 }) });
  createWindow({ id: 'goals', title: 'Goals', icon: '🎯', root: $('goals-panel'), width: 380, defaultPos: () => ({ x: innerWidth - 396, y: 130 }) });

  // One listener for every toggle button, including ones added later.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-window-toggle]');
    if (btn) windows.get(btn.dataset.windowToggle)?.toggle();
  });
  addEventListener('resize', () => { for (const w of windows.values()) w.keepOnScreen(); });
  syncDock();
}
