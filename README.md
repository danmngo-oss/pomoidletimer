# Focus Idle

An idle city-builder for the browser that turns real focus sessions into game progress. You run a timer and report what you got done (characters typed, lecture minutes understood, pages read…). Your **units**, little slimes, level up, work in your city's buildings, and keep producing currency while you're away.

No build step and no dependencies: plain HTML, CSS and ES modules.

**Play it online:** https://danmngo-oss.github.io/pomoidletimer/

## Run it

ES modules won't load from `file://`, so serve the folder:

```bash
cd focus-idle
python3 -m http.server 8000      # or: npx serve
# open http://localhost:8000
```

## How it plays

1. **Pick a unit** on the city map (or in the "Working on" dropdown). Each unit stands for something you work on, like Note-taking or Exercise.
2. **Start a focus session**, either as a countdown **Timer** or an open-ended **Stopwatch**.
3. When it ends (or you press *Finish & log*), report the unit's **metrics**, rate your focus from 1 to 5, and add an optional note.
4. Metrics turn into **points**. Points give the unit **XP**, and focused minutes earn **◆ Momentum**. **Productivity** = points per focused hour, recorded in the Session Log.
5. Every unit produces its stats' **currencies** each second, even while the page is closed (up to 8h).

### Units and stats

| Stat | Stand-in shape | Produces |
|---|---|---|
| 🧠 **INT** (mind) | circle | INT |
| 💪 **STR** (power) | square | STR |
| 🎯 **DEX** (precision) | triangle | DEX |
| 🌿 **LIFE** (life balance) | diamond | nothing; buffs its building instead |

- **Hybrids:** a unit can mix INT, STR and DEX. Its output is split between them, and each extra stat adds 10% in total. For example, a level-10 STR unit makes 1× its rate in STR, while a level-10 STR/DEX unit makes 0.55× STR + 0.55× DEX (1.1× in total). With three stats it's 0.4× each (1.2×).
- **LIFE units** produce nothing. Each one adds **+10%** (+1% per level) to every other unit working in the same building.
- **Evolution:** units evolve at levels 5, 10 and 20 (Droplet → Slime → Big Slime → Grand Slime) and are drawn bigger. The shapes stand in until slime art arrives.

### The city

- **Buildings** (cubes, for now) are bought with ◆ Momentum: 📚 **Library** (INT), ⚒️ **Forge** (STR) and 🛠️ **Workshop** (DEX). Each costs more than the last (20, 32, 51…).
- **Drag a unit onto a building** to put it to work, or onto an empty tile to stand it there. Any unit can work in any building. A building of the unit's own stat adds **+25%** to that stat's share (+5% per building level).
- **Unassigned units** still produce at full rate.
- **Click a building** to see its workers, assign or remove units, **upgrade** it (paid in its own stat's currency; adds a worker slot and a bigger bonus) or demolish it. Drag a building to move it.
- **The Keep** in the middle is home to your crowned monarch slime. **Click it to take a break.** Upgrade it with **🏰 Keep** (INT + STR + DEX) for **+10% city-wide output per level**.

### Breaks

Click the Keep and pick a preset (take a walk, drink water, answer texts…). Presets with minutes count down; open-ended ones count up like a stopwatch.

- Breaks never cost anything. The city keeps producing, and a running focus session pauses and waits for you. Starting focus again ends the break.
- Each preset has stats. When the break ends, those stats' output is **×2** for a while (a walk is INT + STR, a hybrid). A **LIFE** break doubles Life units' buffs instead.
- **Manage presets** in the break picker lets you add, edit or remove presets.

How long the bonus lasts depends on the break:

| Break length | Bonus length |
|---|---|
| 1 min | ~1 min |
| 2.5 min | ~8 min |
| **5–10 min (sweet spot)** | **30 min** |
| 15 min | ~23 min |
| 20 min | ~11 min |
| 30 min | under 1 min |

The end-of-break dialog then fine-tunes it: an optional measure (e.g. steps, target 1000) adds up to +25%, and "how refreshed do you feel?" (1–5) adds or removes up to 20%. Skipping them never lowers the bonus. Bonuses for the same stat stack up to 60 minutes and show in the currency bar. Boosted units glow on the map.

### Goals

The **Goals** panel holds as many goals as you like. Add one with **+ Add goal**:

- **Period:** **hourly** (each clock hour), **daily** (a time window, e.g. 6:00–14:05) or **weekly** (Monday–Sunday).
- **Measure:** focus time, or a metric unit such as `chars`. A metric goal adds up every counted unit's metrics with that unit.
- **Units:** all of them, or a chosen few.

Each goal shows progress against an even pace through its window. For example, at 10:21 with 1h 23m done on a 3h daily goal it shows `1h 23m / 4h 21m ▼ 13m behind`, plus your pace, the pace you need, and where you're on track to finish. Time goals include the session currently on the timer.

The **pace card** in the timer panel shows the selected unit's **last session rate** (e.g. `60 chars/min`), its **overall pace** and the **pace still needed** for the first goal that counts it.

Each goal's **± | Running total** switch picks how you correct its progress by hand (under **✎ Adjust progress**):

- **±:** add or remove an amount (minutes for time goals, the metric's unit otherwise), or set progress from your average rate over the period so far. Progress can't go below zero.
- **Running total:** each row shows your last total (e.g. a document's character count) and you type the new one over it. The difference counts. Add a row per document, with a starting total of 0 for a new document or its current count if it already has text. Rows carry over to the next period starting from their last total.
  - With Running total on, **Finish & log** asks for your current totals too (with a **+ New document** button). The change is the session's output and scores like any session input, and the goal won't count it twice.

Adjustments only change the goal display. They never affect XP, Momentum, currency, productivity or the session log. The ± amount resets each period, and **Reset** clears adjustments early.

## Project layout

| File | Responsibility |
|---|---|
| `index.html` | Page structure: Time, Focus Session and Goals panels, currency bar, city, session log, and five `<dialog>`s |
| `css/styles.css` | All styling. Themes are CSS custom properties under `[data-theme]` |
| `js/main.js` | Entry point. Wires every module together, plus export/import/reset |
| `js/state.js` | The single state object, pub/sub by topic, localStorage save and migrations (v1 → v2 → v3) |
| `js/economy.js` | **All balance formulas**: XP, evolutions, hybrid split, building/Keep/Life bonuses and costs, city production, break-bonus curve. Tune here |
| `js/stats.js` | The INT / STR / DEX / LIFE stats, their shapes and colours |
| `js/grid.js` | The city's tile grid: what's on a tile, the nearest free tile |
| `js/cityMap.js` | The isometric city: drawing, selecting, dragging units and buildings |
| `js/buildings.js` | Buying, upgrading, moving and staffing buildings; the Keep; their dialogs |
| `js/skills.js` | Unit data model, CRUD, metric presets, add/edit dialog |
| `js/timer.js` | Countdown/stopwatch built on timestamps (accurate in background tabs, survives reloads) |
| `js/breaks.js` | Breaks: presets, picker/manager dialog, banner, end-of-break bonus |
| `js/goals.js` | Goals panel, goal editor, adjustments and running totals, and the timer's pace card |
| `js/sessionModal.js` | End-of-session metric entry and `logSession()` |
| `js/clock.js` | Time panel: 12/24h toggle, main zone, extra zone list |
| `js/idle.js` | 1s production tick and offline progress |
| `js/history.js` | Session log table and today's summary |
| `js/hud.js` | Currency bar: Momentum, INT/STR/DEX with rates, active break bonuses |
| `js/ui.js`, `js/format.js` | DOM helpers, toasts, chime, notifications, number/time formatting |

### State and data flow

In code, a unit is called a `skill` (`state.skills`, `skills.js`).

Modules never touch each other's DOM. They change state through `store.update(topic, fn)` and react with `store.subscribe(topic, render)`. The topics are `skills`, `selection`, `currency`, `sessions`, `clock`, `timer`, `break`, `city` and `goals`. Saves are debounced and also flushed when the tab is hidden or closed.

If you change the save shape, bump `SAVE_VERSION` and add an upgrade step to `migrate()` in `state.js`.

In the dev console, `focusIdle.store.state` shows the live state.

## Extension points for later

- **Slime art:** units are drawn by `drawUnit()` in `cityMap.js`, with the stand-in shape picked from `stats.js` and the size from `evolution()` in `economy.js`. Each unit has a reserved `theme` field.
- **Building art and types:** `drawCube()` and `drawBuilding()` in `cityMap.js`; types are listed in `BUILDING_TYPES` in `buildings.js`.
- **Map customization:** buildings and units already sit on tiles you can rearrange. The grid size is `GRID` in `grid.js`.
- **App themes:** add a `[data-theme="..."]` block in `styles.css` (a `paper` light theme is already there) and toggle `document.documentElement.dataset.theme`.
- **More metric types:** presets are in `skills.js → METRIC_PRESETS`.
