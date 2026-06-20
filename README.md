# Nutrition Tracker

> Personal nutrition reference and meal/weight/exercise logger with transparent calorie math. Runs locally in your browser. No build step, no dependencies, no cloud.

## What this is

A self-contained personal health tracker built on a simple premise: **every number on screen should be defensible.** Most calorie apps treat BMR, TDEE, and weight-loss projections as opaque outputs. This one writes the formula and your actual values plugged in, so you can see the arithmetic that produced the answer.

Two pages:

- **Reference** (`nutrition_guide.html`) — a tabbed food browser with macros visualized as bars scaled to daily targets
- **Logger** (`nutrition_logger.html`) — meal entries, weight tracking, exercise tracking, BMR/TDEE calculator, deficit tracking with celebration milestones, multi-person support, and an Insights tab that explains every calculation

## Features

### Reference (`nutrition_guide.html`)

Five tabs of food data — Vegetables, Legumes & Nuts, Fruits, Sattu Maavu ingredients, Priority Guide. Each item shows kcal/protein/fiber as animated bars **scaled to your daily targets**, so a half-full bar means that single serving contributes half the day's goal. Search, sort by any macro, and filter by frequency (daily / weekly / occasional). "Champion" markers highlight the best picks per category.

### Logger (`nutrition_logger.html`)

Nine tabs, organized by purpose. Today/Week/Month are time views; Plan/Insights are configuration and education; Weight/Exercise are body data; Entries/Family are records.

| Tab | What it shows |
|---|---|
| **01 Today** | Today's intake against targets (three rings for calories/protein/fiber), meal-by-meal breakdown grouped into Breakfast/Lunch/Snacks/Dinner, three deficit cards (TDEE today / today's deficit / cumulative), and a celebration banner when you cross into deficit or hit a 1 kg milestone |
| **02 Week** | 7-day strip across the top with per-day macro bars, weekly totals card, and an SVG line chart of daily intake vs targets across the week |
| **03 Month** | Calendar heatmap colored by combined protein + fiber adherence — green for met-goals days, amber for partial, faint for missing. Click any day to jump to it in the Today view |
| **04 Plan** | Profile form (gender, age, height, activity level), BMR and TDEE calculator with the result, and four deficit tier cards (Maintain / Mild / Moderate / Aggressive) each with one-click **Apply as target** that overwrites your daily calorie target |
| **05 Insights** | Education tab. Eight cards explaining every formula in the app — BMR (with Mifflin–St Jeor history), TDEE (with multiplier table), the 7,700 kcal rule, today's deficit math, weekly projection (250/500/750/1000 kcal/day tiers with your actual deficit highlighted), cumulative deficit and predicted loss, time-to-goal projection (when goal weight is set), and why protein/fiber get their own targets. Each card shows the abstract formula, then the same formula with your numbers plugged in |
| **06 Weight** | Weight settings (unit toggle: lbs/kg, goal weight), entry form, four stat cards (current / since start / 7-day change / to goal), and a trend chart with a dashed goal line. Period selector: 7 / 30 / 90 / all days |
| **07 Exercise** | Exercise settings, entry form (activity name with autocomplete from 26 common activities, duration in minutes, calories burned with optional `⌁ estimate` button that uses MET × weight × duration), four stat cards (today / 7-day / 30-day totals + sessions count), bar chart of daily calories burned, and grouped session history. **Exercise calories add to your daily deficit** — TDEE assumes baseline activity from your activity multiplier; logged sessions are additional burn on top of that |
| **08 Entries** | Chronological archive of every meal logged for the active person, grouped by date. Useful for searching back, exporting, or auditing |
| **09 Family** | Multi-person comparison cards (each person's calories/protein/fiber against their own targets), combined family-wide totals, multi-line weight trend chart showing everyone's progress on one chart |

### Multi-person

Track multiple people in a single JSON file. Each has their own profile, targets, weight settings, goal weight, and exercise log. Switch via dropdown — every view filters automatically. The Family tab aggregates and compares.

When you add a new person, they're appended to the `people` array in the same JSON. Each meal/weight/exercise has a `personId` linking it to one person, which is how views filter. One JSON file = one "household."

### Storage — three layers

1. **localStorage** — automatic, always on, persists across sessions in your browser
2. **File System Access API** (Chrome/Edge only) — click "⏷ Open log file" once, pick a `nutrition_log.json`, and every change auto-writes to disk. Reads existing files in append mode (merges, never overwrites). Survives browser data clearing
3. **Manual Export / Import** — universal JSON fallback for browsers without FSA support, or for backups across machines

### Schema

The app uses a strict schema version (`6.0`). It does not auto-migrate from older versions. If you have an older log file, edit the `version` field by hand before importing — see [Troubleshooting](#troubleshooting) below.

## Hosting the app

The pages use `fetch()` to load JSON, which browsers block on `file://` URLs as a security policy. You need to serve the folder from any local HTTP server. Four options below, easiest first.

### Option A — Use the start script (recommended)

The repo includes start scripts that check for Python, find the right command (`python3`, `python`, or `py -3`), launch the server on port 8080, and auto-open the logger in your default browser.

- **Windows:** double-click `start.bat`
- **macOS / Linux:** open a terminal in this folder and run:
  ```bash
  chmod +x start.sh   # one-time, makes the script executable
  ./start.sh
  ```

The browser opens automatically once the server is up. To stop, press `Ctrl + C` in the script's window (Windows) or terminal (macOS/Linux).

**If the script says Python is missing,** install it from <https://www.python.org/downloads/>. On Windows, be sure to check **"Add Python to PATH"** on the installer's first screen — this is the single most common installation mistake. After installing, double-click `start.bat` again.

### Option B — Run Python manually (good if you already use the terminal)

Skips the start script and runs Python's built-in server directly.

1. **Open a terminal** in the folder containing the files
   - macOS: open Terminal, type `cd ` (with a space), then drag the folder into Terminal, press Enter
   - Windows: Shift + right-click the folder → "Open PowerShell window here" or "Open in Terminal"
   - Linux: right-click the folder → "Open in Terminal"
2. **Start the server** by running:
   ```bash
   python3 -m http.server 8080
   ```
   On Windows you may need `python` or `py -3` instead of `python3`. You should see a line like *"Serving HTTP on :: port 8080"*
3. **Open the app** in your browser:
   - Logger: <http://localhost:8080/nutrition_logger.html>
   - Reference: <http://localhost:8080/nutrition_guide.html>
4. **To stop**, return to the terminal and press `Ctrl + C`

Leave the terminal window open while you're using the app. Closing it stops the server.

### Option C — VS Code Live Server extension (good if you already use VS Code)

1. Install [Visual Studio Code](https://code.visualstudio.com/) if you don't have it
2. Inside VS Code, click the **Extensions** icon (squares on the left sidebar), search for *"Live Server"* by Ritwick Dey, and click **Install**
3. Open the folder in VS Code: **File → Open Folder…** and pick your nutrition-tracker folder
4. Right-click `nutrition_logger.html` in the file list → **Open with Live Server**
5. Your default browser opens the page automatically. To stop the server, click **Port: 5500** at the bottom-right of VS Code

This is the most popular option for people who don't want to use the terminal.

### Option D — Node.js `npx serve` (good if you have Node)

If you have [Node.js](https://nodejs.org/) installed (common for developers):

1. Open a terminal in the project folder (see Option B for how)
2. Run:
   ```bash
   npx serve
   ```
3. Pick the URL it prints — usually <http://localhost:3000> — and open it in your browser
4. Stop with `Ctrl + C`

`npx serve` will download itself the first time you run it (no manual install needed beyond Node itself).

## First run

On first visit, **no setup is needed.** The app automatically creates an empty profile named "Person 01" in your browser's local storage and you can start logging immediately.

If you want your data to persist outside the browser (recommended for long-term tracking), after a few entries:

1. Click **↓ Export JSON** in the top-right — downloads `nutrition_log.json` to your Downloads folder
2. Move it somewhere stable (your project folder, Dropbox, iCloud, etc.)
3. Click **⏷ Open log file** and pick the file you just moved. From that point on, every change auto-writes to that file (Chrome and Edge only)

## Files

```
nutrition-tracker/
├── nutrition_guide.html      # The food reference page
├── nutrition_logger.html     # The logger page (HTML structure only)
├── nutrition_logger.css      # All logger styling
├── nutrition_logger.js       # All logger logic
├── nutrition_data.json       # Food database (read by both pages)
├── nutrition_log.json        # Your data (optional, auto-created)
├── start.sh                  # Start script for macOS / Linux
├── start.bat                 # Start script for Windows
└── README.md
```

The logger reads `nutrition_data.json` for meal-name autocomplete — typing "spi" suggests Spinach with macros pre-filled. The logger works fine if the reference JSON is missing; you just lose autocomplete.

`nutrition_log.json` is **not** required to start. The app creates an empty log in browser storage on first load.

## Data model

### `nutrition_data.json` (food reference)

```json
{
  "meta": { "title": "...", "version": "1.0" },
  "scales": { "cal": 300, "pro": 100, "fib": 40 },
  "sections": {
    "veg": {
      "title": "...",
      "items": [
        {
          "name": "Spinach",
          "serving": "1 cup cooked",
          "cal": 41, "pro": 5.3, "fib": 4.3,
          "freq": "daily",
          "champion": true
        }
      ]
    }
  }
}
```

### `nutrition_log.json` (logger — schema v6.0)

```json
{
  "version": "6.0",
  "createdAt": "2026-06-10T10:29:09.727Z",
  "updatedAt": "2026-06-18T20:12:12.178Z",
  "activePersonId": "abc-123",
  "people": [
    {
      "id": "abc-123",
      "name": "Person 01",
      "color": "#E8A03E",
      "profile": {
        "gender": "male",
        "age": 39,
        "heightCm": 178,
        "activityLevel": "moderate"
      },
      "targets": { "cal": 2189, "pro": 120, "fib": 40 },
      "weightSettings": { "unit": "lbs", "goal": 175 }
    }
  ],
  "entries": [
    {
      "id": "...",
      "personId": "abc-123",
      "timestamp": "2026-06-10T12:20:00.000Z",
      "meal": "breakfast",
      "food": "Greek yogurt with berries",
      "cal": 220, "pro": 18, "fib": 4,
      "notes": ""
    }
  ],
  "weights": [
    {
      "id": "...",
      "personId": "abc-123",
      "timestamp": "2026-06-10T08:00:00.000Z",
      "value": 195.5,
      "notes": "morning, fasted"
    }
  ],
  "exercises": [
    {
      "id": "...",
      "personId": "abc-123",
      "timestamp": "2026-06-10T17:30:00.000Z",
      "activity": "Walking (brisk)",
      "durationMin": 30,
      "kcal": 175,
      "notes": "outdoor, 30°C"
    }
  ]
}
```

All weight values are stored canonically in **pounds** regardless of the user's display unit preference, so unit toggling never corrupts data. The schema validator requires `version`, `activePersonId`, and all four arrays (`people`, `entries`, `weights`, `exercises`) to be present.

## The math

### BMR — Mifflin–St Jeor (1990)

The most accurate predictive BMR equation in routine use, recommended by the Academy of Nutrition and Dietetics. Replaced the older Harris–Benedict formula (1919).

```
Male:   BMR = (10 × kg) + (6.25 × cm) − (5 × age) + 5
Female: BMR = (10 × kg) + (6.25 × cm) − (5 × age) − 161
```

### TDEE

```
TDEE = BMR × activity multiplier

  Sedentary    × 1.2     desk job, little exercise
  Light        × 1.375   1–3 workouts/week
  Moderate     × 1.55    3–5 workouts/week
  Active       × 1.725   6–7 workouts/week
  Very active  × 1.9     twice-daily or physical job
```

### Deficit and projected weight loss

The 7,700 kcal-per-kg figure is the textbook energy density of body fat. The pound equivalent is roughly 3,500 kcal.

```
daily deficit       = (TDEE − calories consumed) + exercise burn
cumulative deficit  = Σ daily deficits (across all logged days)
predicted kg lost   = cumulative deficit ÷ 7,700
predicted lb lost   = cumulative deficit ÷ 3,500
```

**Why exercise adds:** TDEE already includes some activity through the multiplier you picked (sedentary, light, moderate, etc.). Logged exercise sessions are *additional* burn on top of that baseline, so they push the deficit higher.

If you're logging exercise consistently, don't also inflate your activity multiplier — you'd be double-counting. The Insights tab calls this out.

Real-world losses deviate from this for two known reasons: short-term scale weight bounces from water and glycogen, and metabolism adapts downward as you get smaller. The Insights tab calls this out — predictions are best read as *"if your metabolism stayed exactly where it is today."*

### Exercise calorie estimation (MET-based)

The `⌁ estimate` button in the Exercise tab uses the standard MET (Metabolic Equivalent of Task) formula:

```
kcal = MET × weight_kg × (duration_min / 60)
```

MET values come from the Compendium of Physical Activities (Ainsworth et al.). 26 common activities are bundled. Example: brisk walking is 5.0 METs, so 30 minutes for a 90 kg person yields approximately 225 kcal.

### Goal projection (when goal weight is set)

```
days to goal = (current − goal) × 3,500 ÷ daily deficit
```

## Privacy

All data is yours, stored locally:

- Browser localStorage (always)
- Optional JSON file on your disk via the File System Access API
- No analytics, no cloud, no account

The log file is portable JSON — take it with you, version-control it, edit it by hand if you want. Nothing leaves your machine.

## Browser compatibility

| Browser | Core features | File auto-save |
|---|---|---|
| Chrome 86+ | ✓ | ✓ |
| Edge 86+ | ✓ | ✓ |
| Firefox | ✓ | Export/Import only |
| Safari | ✓ | Export/Import only |

## Tech stack

- Pure HTML, CSS, and vanilla JavaScript
- Externalized into three files (`.html` / `.css` / `.js`) for separation of concerns
- No build step, no bundler, no framework
- No runtime dependencies — only Google Fonts via CDN (Fraunces, Inter, JetBrains Mono)
- SVG for all charts (line, area, calendar heatmap, multi-line, bar)
- File System Access API for disk persistence where available

## Customization

A few defaults you may want to change before personal use:

- **Default person name** is `'Person 01'` — generic so it works for anyone forking. The app auto-generates `Person 02`, `Person 03`, etc. when you add more people. You can rename any person inline from the person band at the top of the screen
- **Default targets** are `{ cal: 2000, pro: 100, fib: 40 }` in the `DEFAULT_TARGETS` constant
- **Default activity level** is `moderate`
- **Color palette** for people (`PERSON_COLORS`) holds 8 colors; new people cycle through them automatically
- **Activity MET values** for exercise estimation are in the `ACTIVITIES` array — edit, add, or remove freely

All other settings (profile, targets, unit, goal) are editable in the UI per person.

## Troubleshooting

### "Unsupported schema version" on startup

Your saved log is from an older schema. Open `nutrition_log.json` in a text editor and change the version string:

```json
{
  "version": "6.0",   ← was "2.1" or older
  ...
}
```

Save the file and click **↑ Import JSON** in the app to load it. The structure between v2.1 and v6.0 is identical — only the version label changed.

If your file is older than v2.1 (no `people` array), you'll need to manually wrap your top-level `targets` and `weightSettings` into a person object inside a `people` array, and add a `personId` to each entry. The schema documentation above shows the expected v6.0 shape.

### Autocomplete shows "no foods indexed"

The logger couldn't reach `nutrition_data.json`. Confirm the file is in the same folder as the logger HTML, and that you're accessing the page via HTTP (`http://localhost:...`), not by double-clicking the HTML file.

### "File auto-save" button is missing

You're on a browser without File System Access API support (Firefox, Safari). Use **↓ Export JSON** for backups and **↑ Import JSON** to restore — same result, slightly more manual.

## License

MIT.
