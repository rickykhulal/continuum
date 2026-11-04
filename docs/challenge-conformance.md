# Does it match the challenge? — statement-by-statement conformance

Golden source: `docs/challengestatements.txt` (2026 NASA Space Apps Challenge, *A Record of Fire*,
Advanced/Intermediate, Earth Science + Software). Every row below quotes the statement, says what this
build does about it, names the screen or file it lives in, and labels the evidence with the vocabulary in
`AGENTS.md`. **verified** means a command was run on this tree and its output is committed.

Read this file top to bottom and you have the whole project. Nothing here is a plan.

## The two required parts

| The statement asks (verbatim) | What Continuum ships | Where to see it | Evidence |
| --- | --- | --- | --- |
| "harmonizes these records into a burning activity calendar based on active fire hotspots" | One daily series on a VIIRS-equivalent reference unit, built from MODIS + SNPP/NOAA-20/NOAA-21 detections, drawn as a calendar | Atlas · the calendar; `src/lib/data.ts` | **verified** — `npm run e2e` check *"Calendar renders every day of the record"*, `npm test` harmonization + analog-index regression cases |
| "combining the extensive historical series of MODIS with the continuity and greater detail of VIIRS to provide a consistent time series of hotspot activity" | Bridge factor `k = ΣV / ΣM` measured per area on the days both sensors publish, applied to MODIS days so the two lanes are addable | Method · *The method card* step 2; Diagnosis | **verified** — the ratio a judge can falsify is printed with its source and its overlap-day count; `npm run validate` checks the record's interval ordering and non-negative counts (23/23) |
| "so that by the end of that phase the sensor of origin no longer matters and the patterns, trends, and anomalies become the focus" | A raw ⇄ harmonized switch on every view, plus Compare mode that shows both lanes side by side; the per-sensor mix stays inspectable one click deeper in the day inspector | Atlas metric/mode controls; day inspector | **verified** — e2e checks *"Metric/mode toggles switch to Fire-days + Raw"* and *"Compare mode renders raw/harmonized split"*, *"Day inspector opens with four sensor rows"* |
| "developing a web application that takes harmonized hotspot data as input" | The SPA and the read-only API both consume one versioned bundle; the API imports the *same* analytics module the browser runs, so a number cannot differ between them | `public/data/`, `server/api.mjs` | **verified** — `npm run validate` *"dist/ serves exactly the verified bundle"*; `npm run smoke` 49/49 over HTTP |
| "a user could select a region and a specific date range" | Region: search any of 241 countries, click any point on Earth, draw a rectangle or polygon, or type a latitude/longitude. Range: two date inputs, every value inside 2000-11-01 → the last published day | Atlas, Watch area bar, `src/components/DrawArea.tsx` | **verified** — 2026-11-03 and 2026-11-04 HTTP sweeps answered all **241/241** country ids with the full 9,498-day series; e2e checks 95-110 cover search, click-on-border, open water, poles and pasted links |
| "then download analytics and visualizations of fire activity" | Daily-record CSV, per-point hotspot CSV, per-point GeoJSON with the AOI polygon, 2× PNG of the calendar, one-page PDF brief, `.txt` dispatch/advisory messages | Atlas · *Take the record with you*; Brief | **verified** — e2e checks *"CSV export downloads the daily record"*, *"Hotspot CSV downloads one row per detected point…"*, *"The hotspot CSV and the hotspot GeoJSON carry the same detections"*, *"GeoJSON export downloads live hotspots"*, *"PNG calendar export downloads"*, *"FR-27 PDF brief downloads as a valid one-page PDF"* |

## The calendar itself

| The statement asks | What Continuum ships | Evidence |
| --- | --- | --- |
| "a calendar of burning activity showing the number of hotspots detected from the early 2000s to the present" | 2000-11-01 → 2026-11-02, **9,498 consecutive days**, rendered day-by-day with the record read at render time | **verified** — `npm run validate` row counts; e2e *"Calendar renders every day of the record"*; API sweep returns `counts.days = 9498` for every area |
| "which periods of the year see more fires" | Day-of-year heat, month totals, and a frame that switches between day / week / month / quarter / year on the same record | **verified** — e2e *"Calendar frame reads the record by day, week, month, quarter and year"*, *"Frame resolution re-reads the same record"* |
| "which years had more burning activity" | Year lens with ranked year bars and the focus year's gap against the rest | **verified** — e2e *"Calendar frame exposes span, focus year and comparison gap"* |
| "compare the burning activity of the current month against the historical median for a selected area" | Exactly that: month comparison against the median of the same month across every other year, stated as a ratio and a percentile — "1.4× the historical median", "62nd percentile" | **verified** — `src/lib/data.ts:1125` computes it, `src/components/charts.tsx:728` announces it to screen readers, Brief prints it |
| "how a current fire compares with previous ones" | Fire Twin: analog seasons chosen from the record, plus a next-4-week outlook with a per-analog spread | **verified** — e2e *"Outlook lists analog seasons and charts"*, *"Outlook uses live NASA POWER weather"* |
| "how color ramps might represent similarities and differences in the number of detected hotspots across months" | A single sequential ramp used by every heat surface, so the same colour means the same quantile everywhere | **verified** — `src/lib/format.ts:86` |
| "A downloadable CSV File of hot spots detected during a search" | `continuum_<area>_hotspots_<from>_<to>.csv`: one row per detected point — UTC time, date, latitude, longitude, instrument, FRP in MW, confidence band — with the source and the geometry-coverage limit in the header comments | **verified** — two new e2e checks read the downloaded file back and compare it, row for row, against the GeoJSON the same search produced (162 points, Pantanal live window) |

## The "you may consider" list — all of it is in

| Consideration | Status | Evidence |
| --- | --- | --- |
| Audience: early-warning and emergency responders, scientists, land managers, firefighters | **verified** — three registers on purpose: a copyable dispatch message and advisory for responders, Method/Diagnosis/Sandbox for scientists, per-area calendars and exports for land managers | e2e checks 10-12, 39-47 |
| "a map where users can draw the area of interest" | **verified** — rectangle **and** polygon, by pointer **and** by keyboard, with a data-volume estimate before analysis | e2e checks 34-36, 62-73 |
| "an option to enter latitude and longitude" | **verified** — labelled decimal-degree inputs with range validation | `src/components/AreaBar.tsx:125`, e2e checks 111-112 |
| "accessible color ramps" | **verified** — color-blind-safe cividis-like blue→yellow ramp; every chart has a sibling data table | `src/lib/format.ts:86`; e2e checks 37-38, 74-82 |
| "your tool could depict a burning calendar" | **verified** — it is the primary surface | as above |
| "historical comparisons, including anomalies against multi-year averages" | **verified** — anomaly vs the ±15-day day-of-year climatology, and vs the multi-year median, both with a 90% interval | e2e checks 26 and 17; Method step 4 |
| "number of fires detected and reported" | **verified** — three metrics (hotspots, fire-days, FRP) × two modes, all computed at render time from the selected area's record | e2e checks 14-16, 101-102 |

## What this build does *not* claim

Stated plainly because a judge who finds an overclaim discounts everything else.

- **The 2000 → today series is a reconstruction, labelled as one.** It is deterministic and calibrated to
  the live FIRMS window; where the keyed LANCE archive has been pulled, those days are marked observed
  (30,529 observed sensor-days to date, two areas 100% observed). No surface calls the reconstructed tail
  an archive download, and the CSV header says so in the file itself. **verified** as labelling, not as archive.
- **Point geometry exists only for the live window.** FIRMS publishes rolling 7-day global CSVs without a
  key; the long archive is served per-area through the keyed API. The hotspot CSV and GeoJSON therefore
  carry the live window and say so in a `# coverage,` line. **verified**.
- **A country with zero detections prints zero**, not a pilot-region average. **verified** — 63 of 241
  answered zero in the 2026-11-03 sweep and the UI shows that zero.
- **Nothing is deployed.** `render.yaml` is a ready blueprint and every command in its build/start line was
  executed locally against a fresh clone, but no Render account was driven from here and no container was
  run (no Docker engine on this machine). Host-bound gates are labelled **blocked**, not passed.

## Ten-minute judge route

1. `npm ci && npm run build && npm start` → open `http://localhost:8787`.
2. Watch: the live window, five spacecraft on real SGP4 orbits, the calibration line.
3. Atlas: type **Kenya** (no pilot region) → the whole border becomes the area and the toast states its
   measured detections. Then click mid-Pacific → open ocean, 150 km AOI. Then click inside Australia →
   country-wide again. That is the world, not a shortlist.
4. Switch harmonized ⇄ raw and Compare: the 2012 sensor step is visible and then removed.
5. Set a date range, press **Hotspot table**, open the CSV: real points, real instruments.
6. Method → Sandbox: change the resample and watch the residual move. The correction is falsifiable.
7. Run the gates yourself: `npm test` (74), `npm run validate` (23), `npm run smoke` (49), `npm run e2e` (**112/112**).
