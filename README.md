# Focus Idle

An idle game for the browser that turns real focus sessions into game progress. You run a timer, report what you got done (characters typed, lecture minutes understood, pages read…), and your **skills** level up and keep earning currency while you're away.

No build step and no dependencies: plain HTML, CSS and ES modules.

## Run it

ES modules won't load from `file://`, so serve the folder:

```bash
cd focus-idle
python3 -m http.server 8000      # or: npx serve
# open http://localhost:8000
```

## How it plays

1. **Pick a skill** on the Skill Map, or in the "Working on" dropdown.
2. **Start a focus session**, either as a countdown **Timer** or an open-ended **Stopwatch**.
3. When the timer runs out (or you press *Finish & log*), a dialog asks for the skill's **metrics**, a 1–5 focus rating and an optional note.
4. Metrics turn into **points**. Points earn **XP** for the skill, and focused minutes earn **◆ Focus**.
   **Productivity** = points per focused hour, recorded in the Session Log.
5. Each skill passively generates its **own currency** every second. The rate grows with its level and its recent productivity. Up to 8h of progress is credited while you're away.

### Breaks

Click the **You** node on the Skill Map to take a break. Pick a preset (take a walk, drink water, answer texts…): ones with minutes count down, and open-ended ones count up like a stopwatch.

- Breaks never cost anything. Skills keep generating, and the break is only logged in today's summary.
- A focus session that's running pauses and waits for you. Starting focus again ends the break.
- While on a break you can change the focus timer's length and rearrange or edit skills.
- **Manage presets** in the break picker lets you add, edit or remove presets.

## Project layout

| File | Responsibility |
|---|---|
| `index.html` | Static page structure: four panels and two `<dialog>`s |
| `css/styles.css` | All styling. Themes are CSS custom properties under `[data-theme]` |
| `js/main.js` | Entry point. Wires every module together, plus export/import/reset |
| `js/state.js` | The single state object, pub/sub by topic, localStorage save and migrations |
| `js/economy.js` | **All balance formulas** (XP curve, idle rate, scoring). Tune here |
| `js/skills.js` | Skill data model, CRUD, metric presets, add/edit dialog |
| `js/skillMap.js` | SVG skill map: drag, select, XP rings, live currency |
| `js/timer.js` | Countdown/stopwatch built on timestamps (accurate in background tabs, survives reloads) |
| `js/breaks.js` | Breaks: presets, picker/manager dialog, banner, start/end logic |
| `js/sessionModal.js` | End-of-session metric entry and `logSession()` |
| `js/clock.js` | World clock: 12/24h toggle, main zone, extra zone list |
| `js/idle.js` | 1s generation tick and offline progress |
| `js/history.js` | Session log table and today's summary |
| `js/hud.js` | Top-bar currency totals |
| `js/ui.js`, `js/format.js` | DOM helpers, toasts, chime, notifications, number/time formatting |

### State and data flow

Modules never touch each other's DOM. They change state through `store.update(topic, fn)` and react with `store.subscribe(topic, render)`. The topics are `skills`, `selection`, `currency`, `sessions`, `clock`, `timer`, `break` and `layout`. Saves are debounced and also flushed when the tab is hidden or closed.

If you change the save shape, bump `SAVE_VERSION` and add an upgrade step to `migrate()` in `state.js`.

In the dev console, `focusIdle.store.state` shows the live state.

## Extension points for later

- **Skill customization/themes**: each skill already has `color`, `icon`, `pos` and a reserved `theme` field. Node rendering is all in `skillMap.js → render()`.
- **App themes**: add a `[data-theme="..."]` block in `styles.css` (a `paper` light theme is already there) and toggle `document.documentElement.dataset.theme`.
- **Spending currency**: skill `currency` and global `focus` add up but nothing spends them yet. Upgrades and a shop would hook into `economy.idleRate()`.
- **More metric types**: presets are in `skills.js → METRIC_PRESETS`.
