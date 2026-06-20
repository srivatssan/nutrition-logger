# Nutrition Tracker

> Personal nutrition reference and meal/weight logger with transparent calorie math. Two HTML files, runs locally, no build step, no dependencies, no cloud.

## What this is

A self-contained personal health tracker built on a simple premise: **every number on screen should be defensible.** Most calorie apps treat BMR, TDEE, and weight-loss projections as opaque outputs. This one writes the formula and your actual values plugged in, so you can see the arithmetic that produced the answer.

Two pages:

- **Reference** — a tabbed food browser with macros visualized as bars scaled to daily targets
- **Logger** — meal entries, weight tracking, BMR/TDEE calculator, deficit tracking with celebration milestones, multi-person support, and an Insights tab that explains every calculation

## Features

### Reference (`nutrition_guide.html`)

Five tabs of food data — Vegetables, Legumes & Nuts, Fruits, Sattu Maavu ingredients, Priority Guide. Each item shows kcal/protein/fiber as animated bars **scaled to your daily targets**, so a half-full bar means that single serving contributes half the day's goal. Search, sort by any macro, and filter by frequency (daily / weekly / occasional). "Champion" markers highlight the best picks per category.

### Logger (`nutrition_logger.html`)

| Tab | What it does |
|---|---|
| **01 Today** | Stat cards + meal groupings + deficit tracker + celebration banners when in deficit |
| **02 Week** | 7-day strip with per-macro mini-bars, weekly summary, SVG line chart vs targets |
| **03 Month** | Calendar heatmap colored by protein + fiber adherence; click a day to jump to it |
| **04 Plan** | BMR/TDEE calculator with 4 deficit tier options (Maintain, Mild, Moderate, Aggressive) and one-click "Apply as target" |
| **05 Insights** | Every formula explained — BMR, TDEE, the 7,700 kcal rule, deficit projection, goal timeline, macro reasoning |
| **06 Weight** | Entry form, stat cards (current / since start / 7-day / to goal), trend chart with dashed goal line |
| **07 Entries** | Chronological archive grouped by date |
| **08 Family** | Multi-person comparison cards + combined family totals + multi-line weight trend chart |

### Multi-person

Track multiple people in a single JSON file. Each has their own profile, targets, weight settings, and goal weight. Switch via dropdown — every view filters automatically. The Family tab aggregates and compares.

### Storage — three layers

1. **localStorage** — automatic, always on, persists across sessions
2. **File System Access API** (Chrome/Edge) — click "⏷ Open log file" once, pick a `nutrition_log.json`, and every change auto-writes to disk. Opens existing files in append mode (merges, never overwrites)
3. **Manual Export / Import** — universal JSON fallback for browsers without FSA support, or for backups across machines

The auto-detected migration handles v1.0 → v2.0 schema on the fly.

## Quick start

The pages use `fetch()` to load JSON, which browsers block on `file://` URLs as a security policy. Serve the folder with any local web server:

```bash
cd nutrition-tracker
python3 -m http.server 8000
```

Then open:
- Reference: `http://localhost:8000/nutrition_guide.html`
- Logger: `http://localhost:8000/nutrition_logger.html`

Equivalent alternatives: VS Code's Live Server extension, `npx serve`, Caddy, nginx — anything that serves static files over HTTP works.

## Files

```
nutrition-tracker/
├── nutrition_guide.html      # The reference / food browser
├── nutrition_data.json       # Food database — read by both pages
├── nutrition_logger.html     # The logger
├── nutrition_log.json        # User log file (you create / app writes)
└── README.md
```

The logger reads `nutrition_data.json` for meal-name autocomplete — typing "spi" suggests Spinach with macros pre-filled. The logger works fine if the reference JSON is missing; you just lose autocomplete.

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

### `nutrition_log.json` (logger — v2.0 schema)

```json
{
  "version": "2.0",
  "activePersonId": "...",
  "people": [
    {
      "id": "...",
      "name": "Sri",
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
      "personId": "...",
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
      "personId": "...",
      "timestamp": "2026-06-10T08:00:00.000Z",
      "value": 195.5,
      "notes": "morning, fasted"
    }
  ]
}
```

All weight values are stored canonically in **pounds** regardless of the user's display unit preference, so unit toggling never corrupts data.

v1.0 logs (single-user, no `people` array) auto-migrate on read: a default person is created and all entries are reassigned.

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
daily deficit       = TDEE − calories consumed
cumulative deficit  = Σ daily deficits (across all logged days)
predicted kg lost   = cumulative deficit ÷ 7,700
predicted lb lost   = cumulative deficit ÷ 3,500
```

Real-world losses deviate from this for two known reasons: short-term scale weight bounces from water and glycogen, and metabolism adapts downward as you get smaller. The Insights tab calls this out — predictions are best read as *"if your metabolism stayed exactly where it is today."*

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
- No build step, no bundler, no framework
- No runtime dependencies — only Google Fonts via CDN (Fraunces, Inter, JetBrains Mono)
- SVG for all charts (line, area, calendar heatmap, multi-line)
- File System Access API for disk persistence where available

## Customization

A few defaults you may want to change before personal use:

- **Default person name** is `'Person 01'` — generic so it works for anyone forking. The app auto-generates `Person 02`, `Person 03`, etc. when you add more people. You can rename any person inline from the person band at the top of the screen.
- **Default targets** are `{ cal: 2000, pro: 100, fib: 40 }` in the `DEFAULT_TARGETS` constant
- **Default activity level** is `moderate`
- **Color palette** for people (`PERSON_COLORS`) holds 8 colors; new people cycle through them automatically

All other settings (profile, targets, unit, goal) are editable in the UI per person.

## License

MIT.
