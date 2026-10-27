# Focus Idle

An idle game for the browser that turns real focus sessions into game progress. You run a timer, report what you got done (characters typed, lecture minutes understood, pages read…), and your **foci** level up and keep earning currency while you're away.

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

1. **Pick a focus** on the Focus Map, or in the "Working on" dropdown. Each focus has a category: 🧠 **Mental** (mind), 💪 **Physical** (body) or 🏠 **Life balance** (chores).
2. **Start a focus session**, either as a countdown **Timer** or an open-ended **Stopwatch**.
3. When the timer runs out (or you press *Finish & log*), a dialog asks for the focus's **metrics**, a 1–5 focus rating and an optional note.
4. Metrics turn into **points**. Points earn **XP** for the focus, and focused minutes earn **◆ Momentum**.
   **Productivity** = points per focused hour, recorded in the Session Log.
5. Each focus passively generates its **own currency** every second. The rate grows with its level and its recent productivity. Up to 8h of progress is credited while you're away.

### Pace and daily goals

The **pace card** under "Working on" shows the selected focus's last session as a per-minute rate (e.g. `60 chars/min`).

Give a focus a **daily goal** in its editor: focus time (hours) or one of its metrics, plus a time window. For example, *3h of focus time from 6:00 to 14:05*. The card then compares what you've done against an even pace through that window. For example, at 10:21 with 1h 23m done it shows `1h 23m / 4h 21m ▼ 13m behind`, along with your pace vs. the pace you need and where you're on track to finish. Time goals include the session currently on the timer.

**Adjust progress** (under the goal) lets you correct today's progress by hand, for example for work done away from the timer:

- **+ Add / − Remove** an amount (minutes for time goals, the metric's unit otherwise). Progress can't go below zero.
- **Set from rate:** enter your average rate over the whole window so far (min/hr for time goals, unit/min for metrics). Today's progress becomes that rate × the time elapsed in the window.
- **Running totals** (switch with the toggle at the top): instead of working out how much you added, each row shows your last total (e.g. a document's character count) and you type the new one over it. The difference since the row's starting total counts toward today's progress, shown as "+X today". Add a row per document, with a starting total of 0 for a new document or its current count if it already has work in it. The pace line and a combined rate cover all rows together, and rows carry over to the next day starting from their last total.
  - With Running totals on and a goal that tracks a metric, **Finish & log** asks for your current totals too: each row shows its last total, you type the new ones (or add a **+ New document** row), and the change is the session's output. That part scores like any session input, and the goal won't count it a second time.

Adjustments only change the goal display. They never affect XP, Momentum, currency, productivity or the session log. They reset at midnight or when you change what the goal measures, and **Reset** clears them early.

### Breaks

Click the **You** node on the Focus Map to take a break. Pick a preset (take a walk, drink water, answer texts…): ones with minutes count down, and open-ended ones count up like a stopwatch.

- Breaks never cost anything. Foci keep generating, and a running focus session pauses and waits for you. Starting focus again ends the break.
- While on a break you can change the focus timer's length and rearrange or edit foci.
- **Manage presets** in the break picker lets you add, edit or remove presets.

**Break bonuses.** Each preset has categories (a walk is 🧠 + 💪, a hybrid). When a break ends, every focus in those categories produces **×2 idle output** for a while. How long depends on the break:

| Break length | Bonus length |
|---|---|
| 1 min | ~1 min |
| 2.5 min | ~8 min |
| **5–10 min (sweet spot)** | **30 min** |
| 15 min | ~23 min |
| 20 min | ~11 min |
| 30 min | under 1 min |

The end-of-break dialog then fine-tunes it: an optional measure (e.g. steps, target 1000) adds up to +25%, and "how refreshed do you feel?" (1–5) adds or removes up to 20%. Skipping them never lowers the bonus. Bonuses for the same category stack up to 60 minutes and show in the top bar. Boosted foci glow on the map.

## Project layout

| File | Responsibility |
|---|---|
| `index.html` | Static page structure: four panels and three `<dialog>`s (session, skill, break) |
| `css/styles.css` | All styling. Themes are CSS custom properties under `[data-theme]` |
| `js/main.js` | Entry point. Wires every module together, plus export/import/reset |
| `js/state.js` | The single state object, pub/sub by topic, localStorage save and migrations |
| `js/economy.js` | **All balance formulas** (XP curve, idle rate, scoring, break-bonus curve). Tune here |
| `js/categories.js` | The Mental / Physical / Life balance categories |
| `js/skills.js` | Focus data model, CRUD, metric presets, add/edit dialog (category, metrics, daily goal) |
| `js/skillMap.js` | SVG Focus Map: drag, select, XP rings, category badges, live currency |
| `js/timer.js` | Countdown/stopwatch built on timestamps (accurate in background tabs, survives reloads) |
| `js/breaks.js` | Breaks: presets, picker/manager dialog, banner, end-of-break bonus |
| `js/goals.js` | Pace card: last-session rate and daily-goal pace |
| `js/sessionModal.js` | End-of-session metric entry and `logSession()` |
| `js/clock.js` | World clock: 12/24h toggle, main zone, extra zone list |
| `js/idle.js` | 1s generation tick and offline progress |
| `js/history.js` | Session log table and today's summary |
| `js/hud.js` | Top-bar currency totals and active break bonuses |
| `js/ui.js`, `js/format.js` | DOM helpers, toasts, chime, notifications, number/time formatting |

### State and data flow

In code, a focus is called a `skill` (`state.skills`, `skills.js`).

Modules never touch each other's DOM. They change state through `store.update(topic, fn)` and react with `store.subscribe(topic, render)`. The topics are `skills`, `selection`, `currency`, `sessions`, `clock`, `timer`, `break` and `layout`. Saves are debounced and also flushed when the tab is hidden or closed.

If you change the save shape, bump `SAVE_VERSION` and add an upgrade step to `migrate()` in `state.js`.

In the dev console, `focusIdle.store.state` shows the live state.

## Extension points for later

- **Focus customization/themes**: each focus already has `color`, `icon`, `pos` and a reserved `theme` field. Node rendering is all in `skillMap.js → render()`.
- **App themes**: add a `[data-theme="..."]` block in `styles.css` (a `paper` light theme is already there) and toggle `document.documentElement.dataset.theme`.
- **Spending currency**: each focus's `currency` and global `momentum` add up but nothing spends them yet. Upgrades and a shop would hook into `economy.idleRate()`.
- **More metric types**: presets are in `skills.js → METRIC_PRESETS`.
