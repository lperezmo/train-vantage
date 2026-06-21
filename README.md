# Train Vantage

Pendleton, Oregon freight-train information: grade crossings, the UP La Grande
Subdivision through downtown, wayside defect detectors, historical blocked-crossing
patterns, and a history-based estimate of whether a train is blocking downtown right now.

[![Live on Vercel](https://img.shields.io/badge/Live-train--vantage.vercel.app-000000?logo=vercel&logoColor=white)](https://train-vantage.vercel.app)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![MapLibre GL](https://img.shields.io/badge/MapLibre_GL-4-396CB2?logo=maplibre&logoColor=white)](https://maplibre.org)

The Union Pacific La Grande Subdivision runs right through the middle of Pendleton.
A single long train can block several downtown street crossings at once and split the
town in two. There is no public real-time freight-train feed, so this app focuses on
what is knowable without one: a detailed map, six years of blocked-crossing history
from the FRA, and a live-alert architecture that is ready to plug in once a local
radio receiver is on the ground.

## How it works

Train Vantage has three layers.

### Layer 1: the map

The map tab shows an OpenStreetMap basemap (proxied through `/api/tiles`) with these
overlays, all toggle-able from the sidebar:

- **35 FRA NTAD grade crossings** on the UP La Grande Sub in the Pendleton area
  (17 downtown at-grade crossings highlighted in orange).
- **The UP La Grande Subdivision rail line** geometry from OpenStreetMap.
- **24 wayside defect detectors** sourced from the public defectdetector.net directory.
  Five of these are marked as "key detectors" used for the ETA model (see Layer 3).
- **Mileposts** (MP 211-217 in the Pendleton area, from FRA NTAD), off by default.

Click any crossing or detector marker for a popup with ID, milepost, type, and
detector functions.

### Layer 2: historical blocked-crossing patterns

The headline of the app. The History tab and the top-of-sidebar gauge are both driven
by 317 self-reported blocked-crossing reports from the
[FRA Blocked Crossing Incident Reporter](https://www.fra.dot.gov/blockedcrossings/api/incidents)
for Umatilla County, OR, covering 2020-07-24 through 2026-06-17 (approximately 2,155
observation days).

**Important framing:** these are unverified public reports. They describe historical
patterns, not live train position. The app says so clearly in the UI.

Charts rendered from the history:

| Chart | What it shows |
|---|---|
| Most-reported crossings | Top crossings by report count, labeled Downtown / Private / Other |
| Reports by hour of day | 24-bar SVG histogram; peak hour highlighted |
| Reports by day of week | Which days have the most reports |
| Reports by month | Seasonal pattern across all years |
| How long blockages lasted | Duration bucket distribution (0-15 min through 8+ hr) |
| Reported reasons | Top 5 reasons given by reporters |
| When reports cluster (day x hour) | 7x24 likelihood heatmap (Mon-Sun by 0-23 hr) |

The "Chance a train is blocking downtown right now" gauge at the top of the sidebar
blends the hourly frequency from the history with a day-of-week factor. It refreshes
every five minutes when the page is left open. It is a historical-frequency estimate,
not a live observation.

A note on the data: the single most-reported crossing in the dataset is 809043H, a
private road crossing east of downtown near Cayuse (211 of 317 reports). The most-
reported public crossing west of downtown is 809097N (NW McKennon Rd / Bartsch Rd,
81 reports). The five core downtown at-grade crossings around SE 1st-4th St do not
appear in the blocked-crossing dataset, possibly because reports for those crossings
are filed under different city values. The charts label crossing categories honestly.

**Data refresh:** to regenerate the baked JSON from the live FRA endpoint, run the
fetch scripts from the repo root:

```sh
uv run scripts/fetch_blocked.py
uv run scripts/fetch_geo.py
```

Both scripts are idempotent and print a summary on completion.

### Layer 3: live-alert architecture (ready, off by default)

The Live and ETA tab shows the ETA model and the live-detection architecture. By
default the tab shows a discreet banner ("no live radio detector is wired in yet") and
the heads-up table. No live feed runs unless you configure one.

**ETA model.** When a wayside detector fires, the model computes:

```
eta_min = dist_to_downtown_mi / speed_mph * 60
```

Direction is geometry: detectors with milepost less than 215.5 (west of downtown) catch
eastbound trains approaching from the Columbia Plateau; detectors with milepost greater
than 215.5 (east of downtown) catch westbound trains coming down the Blue Mountain grade.

The heads-up table brackets each key detector against 25 mph and 40 mph to show a range
of expected heads-up time. The instantaneous speed at the detector is the only speed
ever available, and trains accelerate and brake significantly on the grade, so the
farther detectors carry wider error bars.

The five key detectors and their heads-up ranges to downtown (MP 215.5):

| ID | Location | MP | Direction | Dist (mi) | Heads-up range |
|---|---|---|---|---|---|
| 10701 | Mission | 221.9 | westbound | 6.4 | ~10-15 min |
| 10702 | Rieth | 211.1 | eastbound | 4.4 | ~7-11 min |
| 10703 | Rieth | 207.1 | eastbound | 8.4 | ~13-20 min |
| 10704 | Echo | 194.9 | eastbound | 20.6 | ~31-49 min |
| 10700 | Bonifer | 240.7 | westbound | 25.2 | ~38-60 min |

**When a live detection store is configured**, the `/api/live` serverless function
reads the ten most recent rows from a Supabase `detections` table and returns them to
the front end. The live banner turns green, a recent-detection list appears, and a
green dot is placed on the map at the detector's position.

**Supabase `detections` table schema:**

```sql
CREATE TABLE detections (
  id               bigserial PRIMARY KEY,
  detected_at      timestamptz NOT NULL DEFAULT now(),
  detector_id      text        NOT NULL,
  milepost         numeric,
  speed_mph        numeric,
  axles            integer,
  direction        text,         -- 'eastbound' | 'westbound'
  defect           boolean,
  eta_downtown_min numeric,
  raw_text         text
);
```

**Environment variables** (set as Vercel Project Environment Variables; not committed):

```
SUPABASE_URL=     # e.g. https://xxxxxxxx.supabase.co
SUPABASE_KEY=     # Supabase anon or service key (used by /api/live reader)
INGEST_TOKEN=     # Shared secret; watchtower must send this to POST /api/ingest
```

With these unset (the default deployed state), the app returns `{ configured: false }`
from `/api/live` and the front end shows the subtle "not wired in yet" banner. Nothing
breaks.

## The watchtower: making live alerts work

The watchtower is a small local pipeline that listens to wayside detector radio
broadcasts and posts each detection to the app. You need an
[RTL-SDR dongle](https://www.rtl-sdr.com/buy-rtl-sdr-dvb-t-dongles/) (RTL2832U +
R820T2 chipset, general-purpose, roughly $15-$25). Do not use a 1090 MHz ADS-B-only
stick; those cannot tune 160 MHz.

The detectors broadcast their automated voice reports on **160.410 MHz, narrowband FM**.
A typical call, once transcribed, reads:

```
U P detector milepost two two one point nine track one total axles 412
speed 35 miles per hour no defects
```

### One-time hardware setup

1. Install the dongle and its drivers.
   - Linux: `sudo apt install rtl-sdr sox`
   - Windows: download rtl-sdr binaries (rtl_fm.exe), install the WinUSB driver via
     Zadig, and add the binaries to PATH. Install sox separately.
2. Verify the dongle: `rtl_test` should list it without errors.

### Running each pipeline step

All scripts are in the `watchtower/` directory. Run them from there with `uv run`.
Each script uses PEP 723 inline dependency metadata, so `uv run` installs any Python
dependencies automatically into an isolated environment on first use.

**Step 1: capture** (`capture.py`). Tunes rtl_fm to 160.410 MHz NFM, squelched,
and saves a wav clip per transmission. The underlying command is:

```sh
rtl_fm -f 160.410M -M fm -s 16k -l 50 -g 40 | \
  sox -t raw -r 16k -e signed -b 16 -c 1 - clip.wav silence 1 0.1 1% 1 2.0 1%
```

To test without hardware, use `--mock` with any local wav clip:

```sh
uv run watchtower/capture.py --mock sample.wav --out clip.wav
```

Live capture (needs the dongle):

```sh
uv run watchtower/capture.py --out captures/
```

**Step 2: transcribe** (`transcribe.py`). Runs faster-whisper (tiny.en model, CPU,
int8) on the captured wav. The model downloads once on first run and is cached locally.

```sh
uv run watchtower/transcribe.py clip.wav
# Optional: use a larger model for better accuracy on noisy audio
uv run watchtower/transcribe.py clip.wav --model small.en
```

Alternatively, if you prefer to avoid the Python dependency, build
[whisper.cpp](https://github.com/ggerganov/whisper.cpp) and run:

```sh
./main -m models/ggml-tiny.en.bin -f clip.wav -otxt
cat clip.wav.txt
```

**Step 3: parse** (`parse.py`). Converts the transcribed text into a structured
detection (milepost, track, axles, speed, defect flag). Uses stdlib only; no
dependencies to fetch.

```sh
uv run watchtower/parse.py
# (self-test mode: runs a set of sample calls through the parser and prints PASS/FAIL)
```

**Step 4: ETA** (`eta.py`). Computes direction and minutes to downtown from milepost
and speed. Mirrors the JavaScript model exactly.

```sh
uv run watchtower/eta.py
# (demo mode: prints ETA for four sample detector positions)
```

**Step 5: push** (`push.py`). POSTs the assembled detection payload to the app's
`/api/ingest` endpoint (recommended) or directly to Supabase. Reads JSON from stdin.

```sh
echo '{"detector_id":"10701","milepost":221.9,"speed_mph":35}' | \
  INGEST_URL=https://train-vantage.vercel.app/api/ingest \
  INGEST_TOKEN=your-secret \
  uv run watchtower/push.py
```

Without env vars, push.py prints what it would send and exits 0 (safe, inert).

**End-to-end in one command** (`run.py`). Glues all steps together. Use `--mock` to
test with a wav clip (skips the radio, runs transcribe through push), or `--text` to
skip capture and transcribe and feed raw text directly into the parser:

```sh
# Test with a local wav clip (no hardware needed):
uv run watchtower/run.py --mock sample.wav --detector-id 10701

# Test the parser directly with raw text:
uv run watchtower/run.py --text "U P detector milepost two two one point nine track one total axles 412 speed 35 miles per hour no defects" --detector-id 10701
```

For continuous live operation, run capture.py in a loop and hand each clip to run.py:

```sh
# Illustrative loop (adapt to your OS and desired restart behavior):
while true; do
  uv run watchtower/capture.py --out clip.wav
  uv run watchtower/run.py --mock clip.wav --detector-id 10701
done
```

### Environment variables for the watchtower push step

Set these before running push.py or run.py to route detections to the store:

```sh
# Recommended: through the app ingest endpoint
export INGEST_URL="https://train-vantage.vercel.app/api/ingest"
export INGEST_TOKEN="your-shared-secret"   # must match INGEST_TOKEN in Vercel env

# Alternative: write directly to Supabase (bypasses the app)
export SUPABASE_URL="https://xxxxxxxx.supabase.co"
export SUPABASE_KEY="your-supabase-key"
```

## Volunteer mode (/volunteer.html)

There is an opt-in volunteer page at `/volunteer.html` (live at
`https://train-vantage.vercel.app/volunteer.html`) that runs Whisper entirely in your
browser via [transformers.js](https://xenova.github.io/transformers.js/) (Xenova/whisper-tiny.en).

Point a scanner speaker at your device's microphone, tune to 160.410 MHz, click Start,
then Stop after a detector call. The page transcribes the audio in your browser, parses
the detector call (the same grammar as parse.py), and lets you submit the detection to
`/api/ingest`.

Honest caveats:
- It downloads roughly 30 MB on first use (the model is cached by the browser after that).
- Accuracy on noisy scanner audio is hit or miss.
- Submissions only reach the detection store when the app has Supabase and an ingest
  token configured. Without those, the parse still shows up on the page but is not saved.
- The local watchtower pipeline is the more reliable and supported path.

Nothing on the volunteer page is required to use Train Vantage. The main app works
fully without it.

## Run locally

```sh
npm install
npm run dev
```

Open the localhost URL printed by Vite. The `/api/tiles`, `/api/live`, and `/api/ingest`
proxies run as Vite dev middleware locally and as Vercel serverless functions in
production, so behavior is identical in both environments. See `vite.config.js` for the
middleware wiring.

```sh
npm run build    # produces static output in dist/
```

Copy `.env.example` to `.env` and fill in values to test the live layer locally.

## Deploy

This repo is connected to Vercel. Pushing to the default branch auto-deploys. To set
it up fresh: import the repo into Vercel with the Vite framework preset. `vercel.json`
pins the build and all three serverless functions. Set the Supabase and ingest env vars
as Vercel Project Environment Variables when you are ready to wire in live alerts.

## Caveats and safety

- **Historical data is not live.** The probability gauge and all charts come from past
  FRA blocked-crossing reports. They describe what has happened historically, not what
  a train is doing right now.
- **Reports are self-reported and unverified.** Anyone can file a blocked-crossing
  report with the FRA. The dataset is useful for patterns but individual reports have
  not been validated.
- **ETA ranges widen significantly at distance.** The detector gives only the
  instantaneous speed at that point. Trains accelerate and brake heavily on the Blue
  Mountain grade, so ETAs from the Bonifer or Echo detectors (25+ miles from downtown)
  carry wide error bars. The heads-up table shows a range, not a precise time.
- **No live freight-train position feed exists publicly.** Railroads do not publish
  real-time train locations. The live-alert layer depends entirely on radio reception of
  the wayside detectors, which requires a physical receiver on the ground.

## Attribution

- Basemap and rail line: [OpenStreetMap](https://www.openstreetmap.org) contributors.
- Grade crossings and mileposts: FRA National Transportation Atlas Database (NTAD),
  via the NTAD ArcGIS FeatureServer.
- Wayside defect detector positions and frequencies: [defectdetector.net](https://www.defectdetector.net).
- Blocked-crossing history: FRA Blocked Crossing Incident Reporter
  (https://www.fra.dot.gov/blockedcrossings/api/incidents).
