// ============================================================================
// ui.js — small helpers for building the page and giving feedback.
//
// There is no framework (React etc.) in this project. Panels are built with
// the el() helper below, which is a shorter way of calling
// document.createElement and setting properties by hand.
// ============================================================================

// Shorthand for document.getElementById: $('timer-display')
export const $ = (id) => document.getElementById(id);

// Creates an HTML element in one call. Example:
//
//   el('button', { class: 'primary', onclick: save }, 'Save')
//
// produces <button class="primary">Save</button> with a click handler.
//   • props: `class` sets the CSS class; anything starting with `on` becomes
//     an event listener (onclick -> 'click'); everything else is set as a
//     property or attribute. Props that are null/undefined/false are skipped,
//     so `{ disabled: isLocked }` works for both cases.
//   • children: text or other elements. null/false children are skipped, which
//     allows inline conditions like `isEmpty && el('p', {}, 'Nothing here')`.
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    // If the element has a JS property with this name (value, checked,
    // disabled…), set the property; otherwise fall back to an HTML attribute.
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
}

// SVG elements (used by the Focus Map) must be created in the SVG
// "namespace", otherwise the browser treats them as unknown HTML tags and
// draws nothing. This is el()'s little sibling for SVG.
const SVG_NS = 'http://www.w3.org/2000/svg';
export function svgEl(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value != null) node.setAttribute(key, value);
  }
  if (text != null) node.textContent = text;
  return node;
}

// Shows a small pop-up message in the bottom-right corner. After `ms` it gets
// the 'out' class (CSS fades it), and 400ms later it is removed entirely.
export function toast(message, { kind = 'info', ms = 4000 } = {}) {
  const node = el('div', { class: `toast ${kind}` }, message);
  $('toasts').append(node);
  setTimeout(() => node.classList.add('out'), ms);
  setTimeout(() => node.remove(), ms + 400);
}

// ---- Sound -----------------------------------------------------------------
// The chime is synthesized with the Web Audio API, so no sound file is needed.
let audioCtx = null;

// Browsers only allow audio after a user gesture; call this from a click handler.
export function primeAudio() {
  try {
    audioCtx ??= new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* audio unsupported */ }
}

// Plays three rising notes. Each note is an oscillator (a pure tone) passed
// through a gain node (a volume knob) that quickly fades in, then fades out.
export function chime() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  [660, 880, 990].forEach((freq, i) => {
    // Each note starts 0.18s after the previous one.
    const t = now + i * 0.18;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.55);
  });
}

// ---- System notifications --------------------------------------------------
// Asks for permission to show desktop notifications (only asks once).
export function requestNotifications() {
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}

// Shows a desktop notification, but only when the tab is hidden; if you're
// looking at the page, the in-page dialog/toast is enough.
export function notify(title, body) {
  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    new Notification(title, { body });
  }
}
