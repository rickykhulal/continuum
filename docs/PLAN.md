# Continuum — strategy, judging case, and verification log

**Challenge (golden source: `docs/challengestatements.txt`)**: *A Record of Fire* — harmonize NASA MODIS and VIIRS burning activity into a calendar that is honest about what the sensors each measure.

**One-line thesis**: the calendar is the entry ticket, not the product. Continuum is a **fire record doctor**: it diagnoses why the two sensors disagree, prescribes a measured correction with an interval, and lets anyone falsify the prescription.

---

## 1. The trap 95% of teams will fall into

The obvious build is: download MODIS + VIIRS, sum detections per day, draw a heatmap calendar, ship.

That build is wrong in a way a domain judge notices immediately:

- MODIS is 1 km; VIIRS is 375 m. VIIRS sees many more small fires per day.
- Adding raw counts makes a **sensor-relative** index, not an activity record. The 2012 VIIRS launch creates a step change that has nothing to do with fire.
- Merging two overpasses of the same fire counts one fire twice.

Continuum makes that failure the *subject* of the product. The headline interaction is a raw/harmonized switch with an interval band, and the Diagnosis page names the bias instead of hiding it.

---

## 2. The three moats

**Moat 1 — the estimator is measured, not chosen.**
`k_area = Σ V_day / Σ M_day` over the VIIRS era, per area — `V_day` is the Suomi-NPP + NOAA-20 + NOAA-21
platform total, and zeros are kept in the sums, because conditioning on jointly-non-zero days biases the
ratio high (measured: 3.99 vs 10.71 for the same record, caught by `tests/science.test.mjs`).
`H = V_day` on VIIRS days and `H = k_area · M_day` on MODIS-only days — MODIS is rescaled onto the VIIRS
unit, never added on top of it — with a 90% delta-method interval that carries the ratio's own variance.
On the shipped build the default area's bridge ratio is **10.63×** (90% CI 10.18–11.08 over 1,262 shared
days) and the per-area range is 10.31–24.52×, which is the honest multiplier between a 1 km sensor and a
375 m sensor once both overpasses and three spacecraft are counted. The ratio-overlap approach is
standard practice in sensor continuity work; Continuum's contribution is making it inspectable and
falsifiable in a browser.

**Moat 2 — the product audits itself.**
- Phantom-break test: raw 2012 break vs corrected break, both shown.
- Fire Twin: analog seasons backtested leave-one-out (the shipped build reports 70% over 20 seasons).
- Sensor sandbox: inject a known bias, correct it, read the recovery error (33.2% weekly MAE on the shipped build, labelled NOISE-BOUND rather than PASSED).
- Validation ledger with explicit PENDING rows: historical archive comparison and burned-area ground truth are *not* claimed.

**Moat 3 — a scientist can walk the whole chain without a terminal.**
Every source has a provenance card with its limit. Every day is tagged LIVE / PROVISIONAL / RECORD / MODEL. Every area produces a printable brief with the same numbers the screen shows.

The differentiator is not "3D globe" (any team can add one). It is that the globe is **real SGP4 geometry** over **real detections**, and clicking a satellite produces a reproducible, shareable analysis URL — the eye-candy is load-bearing.

---

## 3. Award mapping (all 10 categories, with the evidence attached)

| Category | What the judge sees | Why it is not a slogan |
| --- | --- | --- |
| **Best Use of Science** | Overlap calibration, 90% intervals, break statistic, prior-weighted bias accounting | Method page states the estimator, its assumptions, and its residual; the sandbox tests it |
| **Best Use of Data** | FIRMS MODIS C6.1 + VIIRS C2 (Suomi-NPP, NOAA-20, NOAA-21), NASA POWER, CelesTrak GP elements, Natural Earth | Five sources, each labelled with role and limit; live window is real, static parts are named |
| **Best Use of Technology** | Three.js day/night Earth, SGP4 propagation, instanced fire layer, hash-routed state, static deploy | 59-module build, 108 kB gzip main chunk, no backend, no key for the demo path |
| **Galactic Impact** | A corrected global burning record that can survive a policy or carbon-accounting citation | The point is the number being defensible, not the map being pretty |
| **Best Mission Concept** | "Record doctor" framing: diagnose → prescribe → verify → brief | The mission is a repeatable audit loop, not a one-off dashboard |
| **Most Inspirational** | Chilecito & Famatina Valley, CONAE's home region, 26 years of daily fire | Local story first, global method second |
| **Best Storytelling** | Watch → pick satellite → nadir area → Atlas → Brief, one continuous narrative | The demo path is the product path; no dead ends |
| **Global Connection** | Seven pilot regions on five continents, EN/ES, shareable AOI URLs | Same method, different places; coordinates travel in the link |
| **Best Art & Technology** | Orbital observatory, animated clock, calendar as texture | Art carries information — swaths, tracks, detections, not decoration |
| **Local Impact** | Any coordinate → radius → risk band → printable brief for a local responder | 19,400 km² AOI analysed in one click; brief is printable A4 |

---

## 4. Five-minute demo run-of-show

1. **Open on Orbital Watch.** Let the clock run. Say: "These are Terra, Aqua, Suomi-NPP, NOAA-20 and NOAA-21 propagating from real GP elements — the geometry is computed, not animated."
2. **Click Suomi-NPP.** The camera tweens; the panel shows the nadir point and the last swath. Click **Analyze nadir area**.
3. **Land on Atlas with a custom AOI.** Point at the LIVE FIRMS WINDOW chip, the 96th-percentile HIGH band, and the 20 VIIRS-equivalent active days.
4. **Toggle Raw → Harmonized → Compare.** Say: "Here is what the naive merge would have shown you, and here is the interval that says how much to trust the difference."
5. **Open Diagnosis.** Show the overlap ratio, the phantom break falling after correction, then run the sandbox once with an inflated bias and read the recovery error.
6. **Open Outlook, then Brief.** Finish on the printable brief: "This is what a local responder takes away."
7. **Copy the URL, paste it in a new tab.** Same AOI, same sensor, same numbers. That is the reproducibility claim, demonstrated rather than asserted.

Fallback if the venue GPU is weak: the globe degrades to software rendering; Atlas, Diagnosis and Brief carry the argument without WebGL.

---

## 5. Role-loop verification log

The build was run as a self-interrogating loop. Each role had to be satisfied before the next gate.

**Scientist — harmonization**
- Claim: `H = M + k·V` is VIIRS-equivalent. Challenge: is `V` all VIIRS? Originally **no — it was SNPP only**, on the argument that NOAA-20/21 fly the same instrument on different overpasses and two views of one fire are not two fires. That argument was reversed 2026-11-02: FIRMS counts are per-satellite detections, the live window measures the three-spacecraft total directly, and leaving two operational spacecraft out of `H` makes the harmonized unit smaller than the unit every live number is quoted in. `H` is now the VIIRS platform total (Suomi-NPP + NOAA-20 + NOAA-21) and MODIS is never stacked on top of a VIIRS day — the no-double-count invariant is asserted per day in `tests/science.test.mjs`. *Verdict: satisfied, with the platform scope now explicit and now including all three VIIRS spacecraft.*
- Claim: interval reflects uncertainty. Check: the delta-method term includes ratio variance (`varRatio`) and a residual term; live-window intervals use a wider Poisson-plus-model term. *Verdict: satisfied.*
- Claim: the 2012 break is a sensor artifact. Check: the break statistic is descriptive; attribution was a stated prior (56/17/11/16). That prior is **gone** — the Bias X-ray weights now come from the record (|ln k|, the measured FRP ratio, the rescaled share of days, and the 90% interval on k), and the residual is computed and shown rather than absorbed. *Verdict: satisfied, and the accounting is now measured rather than asserted.*

**NASA scientist — provenance**
- Live detections trace to four FIRMS CSVs (MODIS C6.1, Suomi-NPP, NOAA-20, NOAA-21 VIIRS C2); snapshot metadata records generation time, window and per-sensor first/last day. NOAA-21 reaches 2026-10-30, so 10-31 is labelled provisional rather than filled. *Verdict: satisfied.*
- The globe surface is NASA Visible Earth imagery (Blue Marble day, Black Marble 2012 night, combined clouds), credited in the Method page and README; it is a visual asset, never an analytical input. *Verdict: satisfied — no third-party texture remains.*
- The 2000→today record is a calibrated reconstruction, labelled RECORD and never LIVE. *Verdict: satisfied, provided the demo script never calls it "the archive".*

**DevOps engineer — ship**
- `tsc -b && vite build` clean; no stray emitted `vite.config.js` after setting `noEmit`; `dist/` is static; hash routing survives refresh; no runtime env var needed. *Verdict: satisfied for static hosting.*
- Risk noted: a keyless live refresh needs a rebuild, not a cron fetch. Documented; not hidden.

**Coder — correctness**
- Bug found in testing: satellite → nadir AOI produced a URL still pointing at the previous region, because `setView` wrote the hash from a stale closure. Fixed by deleting action-level `replaceState` calls and syncing the hash from settled state in one effect. Re-verified through a cold load: `…&lat=1.3300&lon=93.8800&rad=150&n=S-NPP+nadir` restored the exact AOI.
- Bug found: narrow-viewport overflow from the area bar's column flex-basis and input intrinsic width. Fixed in CSS; measurement showed the apparent 420 px overflow was a headless-Chrome crop, not a real layout failure.
- Bug found: the Watch time-offset slider wrote React state that the globe's animation loop overwrote every 250 ms, so dragging it did nothing. Fixed with a `seek(ms)` handle on the globe; verified that −24 h moves the clock to 30 October and reset returns to live.
- Bug found: the language toggle persisted `lang` but the navigation still rendered English because the UI never called the translator. Wired `store.t()` through navigation, tagline, alert/tour labels and Atlas metric/mode controls; verified EN→ES→EN.
- Bug found: the app fetched CelesTrak from the browser on every load and received 403s, while the Method page claimed a runtime refresh. Removed the runtime fetch, kept the real bundled elements (epoch 2026-303), added maintainer-only `npm run tle`, and corrected the provenance copy.
- Bug found: six of seven regions ranked at the 100th percentile because the reconstruction anchor was capped at 2.4× and used peak-month weights with every platform. Recalibrated the anchor against the live window's VIIRS rate for the same calendar days and added realistic year-to-year regime variance. Alerts now differentiate (two high, five normal/quiet). The 2.4× cap itself is since gone: `calibrationFor()` reports the measured level and ratio with no ceiling, and `kSource`/`levelSource` say where each came from.
- Source audit found the three Earth textures had been pulled from the three.js examples, not NASA. Replaced with official NASA Visible Earth records (Blue Marble 57730, Black Marble 79765, clouds 57747), normalised to 2048×1024 JPEG, and credited in-app; day/night alignment verified on screen.
- Bug found only behind the API origin: the server's own CSP blocked the PNG calendar export, because the export rasterizes an SVG through `new Image()` on a `blob:` URL that `img-src` did not allow. Vite preview sends no CSP headers, so a green sweep on the preview proved nothing about the deployed path. Fixed by adding `blob:` to `img-src`, with the reason recorded beside the header.
- Bug found: `DELETE`/`PUT`/`PATCH` on a known `POST /api/v1/...` route fell through to the POST handler with an empty body and answered 422, blaming the client's parameters for the client's method. Fixed to 405 `METHOD_NOT_ALLOWED`; `HEAD` on GET routes now behaves like `GET`.
- Dependency audit found the UI still fetched Google Fonts at runtime — a third-party host and the second CSP violation (`style-src 'self'`). Both faces are SIL OFL, so they are vendored into `src/fonts/` by `npm run fonts`, with Space Grotesk declared once as a variable face over `400 700` rather than four rules pointing at the same bytes. Verified: four woff2 served from the app origin, zero requests to googleapis/gstatic, and a bold/regular ink ratio of 1.52 against a static-bold reference of 1.55, so the weight axis really instantiates.
- Final sweep against the API origin (`E2E_ORIGIN=http://localhost:8787 npm run e2e`): 92/92 checks, no console errors, no failed requests, no third-party traffic, all seven texture tiers returning 200. Backend gates on the same build (bundle `continuum-2026-11-02-50570444baa4`): validate 23/23, unit + contract 59/59, secret-scan clean, smoke 44/44.
- 2026-11-03, after the world layer: the same sweep is **100/100** (`failed []`, zero console errors) at bundle `continuum-2026-11-02-954f24dbc630`, with eight new checks that a non-pilot country deep link (`#/atlas?c=kenya`, `c=antarctica`) resolves, reports a measured window, and prints its own border count rather than the bundle's stride sample or a pooled pilot density. Backend gates re-run on that build: validate 23/23, unit + contract **66/66**, secret-scan clean, smoke 44/44, perf 0 breaches. The two accuracy defects the new checks exposed — Kenya's live block mixing a modelled history under the LIVE label, and zero-detection countries inheriting a pilot average — are recorded with before/after numbers in `docs/validation.md` and decided in ADR-22.

**Judge — differentiation**
- "Isn't this another calendar?" Answer: the calendar is one of six pages; the differentiator is the Diagnosis page and the raw/harmonized switch. *Verdict: satisfied.*
- "Can I check your claim in 30 seconds?" Yes: sandbox, then Compare, then copy the URL. *Verdict: satisfied.*
- "What did you not do?" Historical FIRMS archive backfill and burned-area validation are PENDING on the Method page. *Verdict: satisfied — the gap is declared, not disguised.*

---

## 6. Known limits (say these before a judge finds them)

1. The historical series is a labelled blend, not a uniform archive extract. The keyed FIRMS backfill
   (`npm run archive`, staged and promoted by `npm run archive:promote`) now replaces the reconstruction
   with real detections from 2012-01-20 onward wherever a lane has reached — at the current checkpoint
   that is the VIIRS-SNPP lane for chilecito, pantanal, california and greece. The MODIS and NOAA-20/21
   lanes are still being pulled, so 2000→2011 is reconstruction, and every day says which it is.
2. The live window is a 7-day snapshot refreshed by command, not a stream. `npm run live` re-pulls the
   four official rolling CSVs and `npm run data` rebuilds the bundle on top of them; "live" therefore
   means real FIRMS rows as of the last pull, with the pull time recorded in the manifest.
3. NOAA-21 is integrated as a separate platform series; its last complete day is 2026-10-30 and later days are provisional.
4. Weather stress is association, not ignition causality.
5. Real-handset layout has not been verified by the agent; it must be checked on physical devices before submission.

---

## 7. After the weekend — the deployment path

The hackathon build is the audit layer. The same layer is the missing piece in three real workflows:

- **Regional fire agencies**: a per-AOI brief with an honest trend and interval, refreshed as FIRMS rolls — replacing raw-count dashboards that overstate VIIRS-era activity.
- **Reinsurers and utilities**: a sensor-continuous activity index with published uncertainty, which is what a risk model actually needs.
- **Open-data programs**: a reusable calibration and validation ledger so any country's fire calendar is comparable across the 2012 platform handover.

The unit economics are small (static frontend, cached snapshots, one weather call per AOI); the value is in being the number people cite. That is why the product spends its complexity on being auditable rather than on more charts.

---

## 8. Evidence index

- `README.md` — provenance, rebuild steps, verification status
- `src/pages/Method.tsx` — method card, validation ledger, provenance cards
- `src/lib/data.ts` — harmonization, intervals, analogs, sandbox
- `scripts/build-data.mjs` — FIRMS ingestion and snapshot metadata
- `public/data/snapshot.json` — window, counts, per-sensor freshness


## 2026-11-02 — Continuum Resource Pack ingested; the dummy weather term is gone

**Scientist / Coder**
- Read `docs/rsc.pdf` in full (19 pages, 13 sections) and worked the download order in §11 against this environment.
- `npm run climate` now fetches real NASA POWER daily MERRA-2 (2000-01-01 → build date) for all seven pilot-region centres and derives a burn-weather anomaly BW from four observed quantities. `public/data/climate_daily.json`, 442 kB, 9,802 days x 7 regions, raw responses cached in `data_raw/power/`.
- `src/lib/data.ts` uses BW for both terms that were previously random: the daily weather multiplier and the persistent year regime. Coverage is 100 % of the 9,496 record days. The AR(1) path survives only as the labelled fallback when a bundle has no climate file.
- Removed the FWI Initial Spread Index and the KBDI attempt mid-flight: both carry fitted constants and my reproductions of the published forms produced out-of-range values (ISI 83–1,590 against a 0–100 scale; KBDI pinned at its 203 mm cap in every region). Shipping an index I could not validate was worse than shipping a constant-free anomaly composite, so the derived-index route was deleted rather than softened.
- `server/analytics.ts` attaches the driver for Node, the browser attaches it inside `loadLiveBundle`, and `tests/science.test.mjs` asserts it — the API-parity test is what proved the two sides had drifted (855.85 vs 830.65) before that.
- Analog goldens recaptured with the reason written into the fixture header; the old values still reproduce with the driver detached.

**Judge — differentiation**
- "Isn't this another calendar?" and "is any of it fake?" now have the same answer shape: the counts are a labelled reconstruction, and the weather that drives them is NASA reanalysis, one API key-free request per region. The Fire Twin card visibly improved under the real driver — California's nearest analog season became 2020, southeast Australia's 2020.
- Evidence: `docs/validation.md` §2026-11-02 (verified / partial / not verified / blocked, with the GOES file-size findings that close §11 step 6 of the pack).
