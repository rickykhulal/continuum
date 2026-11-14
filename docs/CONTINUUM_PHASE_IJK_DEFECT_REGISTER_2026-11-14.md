# Continuum — Phase I/J/K Read-Only Defect Register

Date: 2026-11-14
Author: Qoder (sole implementation and science agent)
Status: **audit complete — no source change made**
Scope: `src/`, `server/`, `scripts/` — every timestamp rewrite, zero fallback, empty-array
fallback, catch-to-default, synthetic value, and silent failure, traced to its consumers.

## Why this document exists

The Phase I/J/K mandate requires that missing observations never become observed zeros, that
historical dates and windows survive the browser, that a failed load is reported as unavailable
rather than as an empty week, and that every downstream calculation, chart, badge and export
affected by those rules is audited. This register is the evidence base for that work.

It is read-only. Phase E is still running under PID 14540 (lock token `a8575030c561d318`); no
source file, archive file, checkpoint, lock or log was modified while this audit ran.

**Status vocabulary** (per `AGENTS.md`): verified / partial / not verified / blocked. Every row
below was read in the current working tree and the line number cited is the line that exists
today. Claims about runtime behaviour are marked either **verified by code path** (the control
flow is unambiguous) or **needs proof** (a regression test must confirm it before the fix is
called complete).

## Summary

| Severity | Count | Meaning |
| --- | --- | --- |
| Critical | 5 | Fabricates or destroys the meaning of the record; must be fixed before any data claim |
| High | 16 | Silently converts missing/failed data into a plausible number or hides a failure |
| Medium | 15 | Distorts a derived statistic, export or badge; no silent data loss |
| Low / latent | 11 | Unreachable with today's shipped bundle, or cosmetic; fix defensively |
| Legitimate zeros | 26 sites | Correct behaviour; changing these would introduce the bug the audit is fixing |

Four defect chains matter more than any single line. They are described in
[§5](#5-the-four-critical-chains) because the fix order is determined by them.

---

## 1. Timestamp and window rewriting

### IJ-01 — Critical — `src/lib/data.ts:228-282` `alignLiveToRealtime`

- **Class:** fabricated data (historical observation time rewritten).
- **Root cause:** the function assumes the bundled FIRMS snapshot must be dragged forward to
  wall-clock today. It adds `daysDiff * 86400` to every fire epoch (`f[5]`, line 268), rewrites
  every `regionDays` date key and `firstT`/`lastT` (249-260), rewrites `sensorMeta.first/last`
  (240-247), rewrites `windowStart`/`windowEnd` (271-279), and stamps `generatedAt: now` (274).
- **Impact:** every "live" point in the globe, LiveMap, GeoJSON export, calendar live window and
  Watch panel claims an observation date that is not the observation date. The snapshot is
  labelled as if it were captured today. This is the mandated defect in the Phase I scope.
- **Fix:** make the function an identity transform (keep it as the single call site so the
  deletion is auditable), or delete it and its call at `src/lib/data.ts:308`. The bundle already
  carries `windowStart`, `windowEnd`, `generatedAt` and per-fire epochs; nothing needs aligning.
  Snapshot age must be derived from those fields, not from a rewrite.
- **Regression test:** T-01 — load a bundle with a fixed window in 2026-10; assert every
  `fires[i][5]`, every `regionDays` key, `windowStart`, `windowEnd` and `generatedAt` are byte-equal
  to the bundle input.

### IJ-02 — Critical — `src/lib/countries.ts:74-118` `alignCountryFiresToRealtime`

- **Class:** fabricated data (country observation dates and window rewritten).
- **Root cause:** same assumption as IJ-01, applied to the world layer — shifts `days` (85),
  every `perDay` / `perDaySensors` / `perDayFrp` key (88-99) and each country's
  `windowStart`/`windowEnd` (100-107), then replaces the file window (110-117).
- **Impact:** country fire dates no longer match the FIRMS window that measured them; a country
  ranked by "yesterday" is actually ranked by a day up to two weeks earlier. Applied unconditionally
  inside `loadWorldLayer` (line 128), so every browser session is affected.
- **Fix:** identity; call `hydrateWorldLayer(f)` with the file as shipped.
- **Regression test:** T-02 — country `days`, `perDay` keys and `window` equal the input file.

### IJ-03 — High — `src/lib/data.ts:274` `generatedAt: new Date().toISOString()`

- **Class:** provenance conflation (generated-at vs fetched-at vs observed-at).
- **Root cause:** the align step overwrites the bundle's real generation time with "now".
- **Impact:** the UI cannot show snapshot age (mandate item 2) because the snapshot claims to be
  brand new. `DATA_FRESHNESS_REPORT.md` reasoning is invalidated at this line.
- **Fix:** preserved automatically once IJ-01 is an identity transform. Keep three distinct fields
  in the type: `generatedAt` (bundle build), `fetchedAt` (browser fetch, may be added by the
  loader), `windowEnd` (last observation).
- **Regression test:** T-01 + T-10.

### IJ-47 — Low — `src/lib/weather.ts:108` `base = n ? base / n : d.t`

- **Class:** fabricated neutral anomaly when the ±7-day temperature window has no neighbours.
- **Impact:** `tAnom` becomes exactly 0, which reads as "no anomaly" rather than "no baseline".
  Only reachable at the very start of a POWER series; POWER series start in 2016 so the window is
  usually populated.
- **Fix:** allow `tAnom` to be `null` and let `heat` fall back to 0 only under an explicit
  `baseline: 'insufficient'` flag. Deferred to Phase K with IJ-13/IJ-15.

---

## 2. Failure masking and fabricated empty metadata

### IJ-04 — Critical — `src/lib/data.ts:321-336` `emptyMeta()`

- **Class:** fabricated data + failed load made indistinguishable from a valid empty week.
- **Root cause:** `emptyMeta` (reached only from the catch at line 310) invents
  `generatedAt: now`, `windowStart: addDays(today, -6)`, `windowEnd: today`, and counts of 0.
- **Impact:** this one object defeats **every** downstream truth check:
  1. `src/lib/store.tsx:276` and `:300` detect failure as
     `b.meta.counts.kept === 0 && !b.meta.windowStart` — `windowStart` is always truthy, so the
     "Live data unavailable" error is **never** shown.
  2. `src/lib/store.tsx:256` sets `today = live.meta.windowEnd`, now a fabricated wall-clock date,
     which drives the whole record, the outlook cutoff and the freshness readout.
  3. `src/lib/data.ts:975-989` builds a calibration from a 7-day window with zero observations;
     `calibrationFor` returns `null` at `:842` (`if (!k) return null`), so `level = 0` and the
     entire 26-year reconstruction is generated as zeros (see IJ-18).
- **Fix:** `emptyMeta` must not exist. `loadLiveBundle` must return a discriminated result
  (`{ ok: true, bundle } | { ok: false, error }`) and the store must render an explicit
  UNAVAILABLE state. `windowStart`, `windowEnd` and `generatedAt` are `null` when unavailable.
- **Regression test:** T-03 — simulate a rejected fetch and a 404; assert the store exposes
  `unavailable`, the range is not rewritten, and no record values are produced.

### IJ-05 — Critical — `src/lib/store.tsx:276, 300` failure detector

- **Class:** silent failure (consumer defect that only works because the producer fabricates).
- **Root cause:** detection depends on `!b.meta.windowStart`; IJ-04 makes that impossible.
- **Impact:** the retry button exists but is unreachable; no error banner is ever rendered for a
  failed live load.
- **Fix:** with IJ-04's result union, set `loadError` from the error branch, keep the retry path,
  and remove the `windowStart` heuristic.
- **Regression test:** T-03.

### IJ-18 — Critical — `src/lib/data.ts:988-989` + `:842` calibration-null path

- **Class:** missing-as-zero at the root of the record.
- **Root cause:** `const level = cal?.levelPerDay ?? 0; const k = cal?.k ?? 1;`. When calibration
  is `null` — failed live load (IJ-04), or a genuinely quiet window where every pilot has zero
  detections (`pool.k = 0` at `:778`, so `calibrationFor` returns `null` at `:842`) — `lambda`
  at `:1007` is 0 for every day of 2000-2026 and `pre[]` is all zeros.
- **Impact:** verified by code path: a failed live fetch renders a full 26-year chart of zeros
  labelled `reconstructed`, not an error. This is the single most misleading state the app can
  reach, and it is the default state whenever the data bundle is missing or the network fails.
- **Fix:** `buildRecord` must not produce a record when calibration is unavailable. Return
  `{ status: 'unavailable', reason }` (or throw a typed error the store renders). A quiet but
  *measured* window (all four sensors published, zero detections) must be distinguishable from an
  unmeasured one — that is the same `sensorMeta`/`observed` distinction already used at
  `sensorCount` (`:1215`).
- **Regression test:** T-03 + T-06 — calibration unavailable ⇒ unavailable state; a measured
  zero window ⇒ record of zeros labelled observed, not model.

### IJ-06 — High — `src/lib/data.ts:293-310` live bundle fetch

- **Class:** silent failure.
- **Root cause:** `fetch(...).then((r) => r.json())` at 294-296 has no `r.ok` check, and the
  climate/archive fetches at 298-303 collapse failure to `null`; the whole `Promise.all` failure
  is caught at 310 and converted to `emptyMeta`.
- **Impact:** an HTML 404 body becomes a JSON parse error and is reported as an empty week;
  a corrupt `climate_daily.json` silently disables the weather driver with no signal.
- **Fix:** check `res.ok`, throw typed `DataUnavailable` errors, and let the store distinguish
  "live missing" from "climate missing" from "archive missing". Climate/archive absence is
  legitimate degradation (the reconstruction is designed to run without them) but must be
  reported, not swallowed.
- **Regression test:** T-03, plus a case that asserts a missing `climate_daily.json` yields the
  same record as the shipped bundle with a `climate: 'unavailable'` flag.

### IJ-07 — High — `src/lib/countries.ts:121-135` `loadWorldLayer`

- **Class:** silent failure (mandate item 4).
- **Root cause:** `.catch(() => { topoPromise = null; })` resolves the promise. Every caller
  (`.then(...)` at `src/lib/store.tsx:397`, `src/components/AreaBar.tsx:37`,
  `src/components/WorldSearch.tsx:19`) therefore sees success and installs an empty world layer.
- **Impact:** country regions disappear from search and the map without any notice; clicks fall
  back to pooled pilot density (`src/lib/data.ts:881`) while the UI still presents a country
  record.
- **Fix:** return a result object; store exposes `worldLayer: 'ready' | 'unavailable'`; show a
  banner and disable country-region selection when unavailable.
- **Regression test:** T-04 — simulate 404 for `countries.json` and `country_fires.json`; assert
  the state is `unavailable` and no country region can be selected.

### IJ-08 — High — `src/lib/store.tsx:256` `today = live?.meta.windowEnd ?? isoDate(new Date())`

- **Class:** stale-data misclassification.
- **Root cause:** the app has one `today` that serves as both "last observation" and "wall clock".
  With a healthy bundle it is the window end (correct for anomaly windows); with a failed bundle
  it silently becomes the wall clock.
- **Impact:** when the snapshot is days old, every "current" statistic (month-to-date, outlook
  cutoff, freshness) is computed against the wrong boundary; when the load fails, against a
  boundary that has no data at all.
- **Fix:** two explicit values — `clockToday` (wall clock) and `recordEnd` (last observation,
  nullable). Anomaly windows use `recordEnd`; "age of snapshot" uses `clockToday - recordEnd`.
  Dependent on IJ-04.
- **Regression test:** T-10 — status LABEL matrix: HISTORICAL (recordEnd < clock, > threshold),
  LIVE STALE (server flags stale), LIVE (fresh), UNAVAILABLE (no recordEnd).

### IJ-09 — Medium — `src/pages/Watch.tsx:55` freshness

- **Class:** consumer of IJ-04/IJ-08.
- **Root cause:** `daysBetween(store.today, today)`. Truthful only while `store.today` is the real
  window end; after a failed load both sides are the same fabricated date, so the age is 0.
- **Fix:** compute from `clockToday - recordEnd` and render "snapshot age: N days" next to the
  status badge (mandate item 2).
- **Regression test:** T-10.

### IJ-10 — Medium — `src/lib/liveClient.ts:350-353` `windowEndMeta`

- **Class:** fabricated date.
- **Root cause:** returns today's date when `meta` is missing.
- **Impact:** callers label an absent window as current.
- **Fix:** return `null`; update the two call sites to render "window unavailable".
- **Regression test:** T-03.

### IJ-32 — Low — `src/lib/liveClient.ts:257-285` mock live data

- **Class:** gated synthetic data — **legitimate if the gate holds**.
- **Status:** `ALLOW_MOCK_LIVE` requires `VITE_ALLOW_MOCK_LIVE === '1'`; data is labelled
  `model`; LiveMap renders the DEMO badge. The mock window (2026-10-20..27) and `Date.now()`
  timestamps are static by design.
- **Residual risk:** nothing asserts the flag is absent from a production build.
- **Fix (defensive):** add a build-time assertion in the Phase M suite that greps `dist/` for the
  mock array coordinates (e.g. `-10.5,-78.0`) and fails if present.
- **Regression test:** T-11 (build check).

---

## 3. Missing-as-zero in the science layer

### IJ-11 — High — `src/lib/weather.ts:77` `rainByDate.set(date, p ?? 0)`

- **Class:** missing-as-zero (mandate item 5).
- **Impact:** a POWER gap becomes a 0 mm day. It then feeds the 30-day rainfall total (IJ-12), the
  dry-anomaly (IJ-13), the drought stress (121) and the log fit that calibrates expected burning
  (126-135).
- **Fix:** keep `null` in `rainByDate`; when summing, count `n` valid days and mark the 30-day
  total incomplete if `n < 30`.
- **Regression test:** T-05 — a POWER response with missing `PRECTOTCORR` days yields
  `precip: null`, `dry30: null` (or `complete: false`), and is not drawn as a 0 mm bar.

### IJ-12 — High — `src/lib/weather.ts:114` `p30 += dd.p ?? 0`

- **Class:** missing-as-zero, same chain as IJ-11.
- **Fix:** accumulate only non-null and require 30 valid days for a complete total.
- **Regression test:** T-05.

### IJ-13 — Medium — `src/lib/weather.ts:118` `rainClim > 0 ? ... : 0`

- **Class:** insufficient climatology reported as "not dry" (mandate item 6).
- **Impact:** when fewer than 10 usable years exist (`rainClimatology` returns 0 at IJ-15), `dry`
  is 0 and the composite stress is biased low — silently labelling a data gap as favourable fire
  weather.
- **Fix:** `rainClimatology` returns `{ value: number | null, years: number }`; when
  `years < 5`, `dry = null`, `stress = null`, and the UI shows "insufficient climatology".
- **Regression test:** T-06.

### IJ-14 — Medium — `src/lib/weather.ts:120` `dryAir = d.r != null ? ... : 0.3`

- **Class:** synthetic value presented as measurement.
- **Impact:** a missing RH day contributes a fixed 0.3 dryness (≈ 76% RH equivalent) to the
  stress score.
- **Fix:** `dryAir = null` when `r == null`; renormalise the composite over available terms, or
  return `stress = null` when fewer than two terms are observed. Record the term weights used.
- **Regression test:** T-06 (assert the stress is null or explicitly marked partial, and that the
  weights renormalise).

### IJ-15 — High — `src/lib/weather.ts:178` `return n ? sum / n : 0`

- **Class:** insufficient climatology as zero (mandate item 6).
- **Impact:** with no qualifying year, the 30-day rain climatology is 0 mm, which makes any rain
  look infinite relative to normal, and drives IJ-13 to 0.
- **Fix:** return `null` and a sample count.
- **Regression test:** T-06.

### IJ-16 — High — `src/lib/weather.ts:238` `fetchedAt: new Date().toISOString()`

- **Class:** false provenance timestamp.
- **Impact:** `src/pages/Outlook.tsx:37` prints "fetched <now> UTC" for a series that was never
  fetched. The page does label the source "offline estimate" (badge at 194/324), so the source
  label is honest; the fetch time is not.
- **Fix:** `fetchedAt: null`; the note renders "synthetic — not fetched".
- **Regression test:** T-07.

### IJ-17 — High — `src/lib/weather.ts:219-245` `offlineWeather`

- **Class:** synthetic values with observed-shaped naming (mandate item 7).
- **Root cause:** `tAnom`, `dry` and `stress` are sine waves (225-227); `t2m/precip/rh` are
  correctly `null`. `source: 'offline estimate'` is shown at page level.
- **Impact:** per-day stress values (0-100) are rendered as "fire-weather stress" with band labels
  (`src/pages/Outlook.tsx:37, 225, 254`) and drive the Outlook recommendation text
  (`:241-243`). A reader cannot tell that the number is a synthetic wave, and the recommendation
  ("Stage readiness" / "Watch closely") is presented as if weather-informed.
- **Fix:** add `modeled: true` to each offline day and to the context; render the badge on every
  value and suppress weather-driven recommendation text when `modeled` (use MODELED or
  UNAVAILABLE explicitly). Do not emit `fit`/`expected` as if fitted to weather.
- **Regression test:** T-07 — offline context ⇒ every day `modeled: true`, no observed label, no
  weather-driven recommendation string.

### IJ-19 — Low — `src/lib/data.ts:1397` `freshness = ... : 99`

- **Class:** sentinel as measurement.
- **Impact:** "99 days old" for an empty record; it happens to be obviously wrong, but a sentinel
  invites formatting bugs.
- **Fix:** `null` + explicit "no record" state.

### IJ-20 — Medium — `src/lib/data.ts:1398, 1418`

- **Class:** insufficient-data-as-zero.
- **Root cause:** `ratio = baseline ? current / baseline : 0`, `anomalyPct ... : 0` while the
  sentence correctly says "Not enough history…" (`:1402`).
- **Impact:** the structured fields are `0`; the Brief and compare views read the fields, not the
  sentence, and can print `0.00×` / `0%` as if measured.
- **Fix:** `null` for `baselineMedian`, `ratioToMedian`, `anomalyPct`, `percentile` when
  `history.length < 5`; update consumers to render "insufficient history".
- **Regression test:** T-06 + a UI assertion that the Brief shows "insufficient history" rather
  than `0.00×`.

### IJ-21 — High — `src/lib/data.ts:1621, 1666`

- **Class:** fabricated neutral value entering a headline statistic.
- **Root cause:** `anomaly: base ? ((a.next - base) / base) * 100 : 0` (1621) and
  `next4WeeksAnomalyPct: outcomes[i]?.anomaly ?? 0` (1666), while
  `analogDepartureSummary` (`:1687-1697`) is explicitly written to exclude non-finite values and
  documents "missing values are not zeros".
- **Impact:** an analogue with an unavailable climatological base contributes an exact 0% to the
  median departure — the headline "next four weeks" number — biasing it toward zero.
- **Fix:** emit `NaN` in both places (or `null` and filter), so the existing summary excludes them
  and reports `excludedCount`.
- **Regression test:** T-12 — one analogue with an empty base ⇒ median over the remaining
  analogues, `excludedCount: 1`; all empty ⇒ `median: null`.

### IJ-22 — Medium — `src/lib/data.ts:1671` `backtestHitRate: trials ? ... : 0`

- **Class:** insufficient-data-as-zero.
- **Impact:** "0% hit rate" over 0 trials is a claim the method cannot support.
- **Fix:** `null` when `trials === 0`; the UI renders "no backtest".
- **Regression test:** T-12.

### IJ-23 — Medium — `src/lib/data.ts:1176-1180`

- **Class:** missing-as-zero, partially mitigated.
- **Root cause:** `r.modis = seen.modis ? d.m : 0` — a day a sensor did not publish stores 0 in
  the record. `r.observed = seen` (1181) records availability and `sensorCount` (`:1215`) renders
  "—", so the on-screen per-sensor display is honest.
- **Residual impact:** `dailyValue`, the calendar cells and both CSV exports read the numeric
  fields and print 0 for an unpublished sensor. The API CSV (`server/api.mjs:388-390`) has no
  availability column at all.
- **Fix:** keep the numeric field (many sums depend on it) but add the availability map to every
  export row and make chart series gap rather than plot 0 for `observed[sensor] === false`.
- **Regression test:** T-09 — an archive window missing one lane still sums correctly and the
  exports disclose the missing lane; a genuine measured zero day still prints 0.

### IJ-24 — Low — `src/components/charts.tsx:839, 1081`

- **Class:** chart fallback that plots 0 for an absent analogue week/table cell.
- **Impact:** a missing year is drawn at the axis floor instead of as a gap.
- **Fix:** emit `null` and let the path builder skip the segment.

### IJ-25 — Low — `src/lib/data.ts:207-219` `weatherCoverage`

- **Class:** honest-but-ambiguous return (`{days: 0, share: 0}` when no climate bundle).
- **Impact:** `share: 0` can be read as "0% observed" rather than "no data". The UI must show
  "climate unavailable".
- **Fix:** `share: null` when `days === 0`; verify the consumer at the Phase K step.

---

## 4. UI count fallbacks, API behaviour and ingestion provenance

### IJ-26 — High — `src/App.tsx:217`, `src/components/Overlays.tsx:313`, `src/pages/Method.tsx:280`

- **Class:** failed load rendered as a measured zero.
- **Root cause:** `nf(store.live?.meta.counts.kept ?? 0)` prints "Live detections worldwide: 0"
  with no qualifier, and `emptyMeta` supplies `counts.kept = 0`.
- **Impact:** with IJ-04 fixed these become "unavailable"; until then they are the visible face of
  the failure.
- **Fix:** render the live status badge and "unavailable" when the bundle is unavailable; never
  print 0 without an observed provenance.
- **Regression test:** T-03 + T-09.

### IJ-27 — Medium — `src/pages/Watch.tsx:59-68` `regionLive`

- **Class:** missing-as-zero in the UI.
- **Root cause:** `if (!live) return 0`, then a calibration fallback; a failed bundle reaches `0`
  through both branches.
- **Fix:** return `null` and render "—"/"unavailable" with the reason.

### IJ-28 — High — `src/pages/Outlook.tsx:16, 32, 57, 59, 62`

- **Class:** missing precipitation drawn as zero (mandate item 5).
- **Root cause:** `d.precip ?? 0` in the axis maximum, the bar heights and the tooltips.
- **Impact:** a POWER gap renders as a 0 mm bar — visually "no rain" instead of "no measurement",
  which is the exact inference the mandate forbids.
- **Fix:** skip bars for `precip == null`; tooltip "no measurement"; keep the axis independent of
  nulls.
- **Regression test:** T-05 (+ a DOM assertion that no 0 mm bar exists for a null day).

### IJ-29 — High — `src/pages/Outlook.tsx:228`

- **Class:** fabricated observations in text.
- **Root cause:** `nf(lastWeather?.t2m ?? 0, 1)` and `nf(lastWeather?.precip ?? 0, 1)` inside the
  band line; with offline weather (`t2m/precip = null`) it prints "0.0 °C · 0.0 mm".
- **Fix:** omit the term when null; never substitute 0.
- **Regression test:** T-07.

### IJ-30 — Medium — `src/pages/Outlook.tsx:241, 243`

- **Class:** synthetic stress driving a recommendation.
- **Root cause:** `(lastWeather?.stress ?? 0) >= 50` in the recommendation branch; offline stress
  is synthetic (IJ-17).
- **Fix:** gate the recommendation on `!modeled` weather; otherwise use the record-only branch.
- **Regression test:** T-07.

### IJ-31 — Low — `src/pages/Watch.tsx:228`

- **Class:** cosmetic fallback (`cover?.distanceKm ?? 0` prints "outside (0 km)").
- **Fix:** "position unavailable" when there is no satellite state.

### IJ-33 — High — `server/api.mjs:886` unknown `/api/*` falls through to the SPA

- **Class:** API contract defect (mandated).
- **Status:** `/api/v1/` already returns a JSON 404 (`:853-860`); the generic dispatcher at `:886`
  ends with `return serveStatic(req, res, pathname)`, so `/api/anything` returns `index.html`
  with a 200.
- **Impact:** any client mistyping a route gets HTML and a 200 instead of a typed error; the
  error-shape contract only holds under `/api/v1/`.
- **Fix:** before the static fallback, if `pathname === '/api' || pathname.startsWith('/api/')`,
  return the standard JSON 404 envelope with `request_id` and `allow`/supported-route hint.
- **Regression test:** T-08 — `/api/`, `/api/v1/`, `/api/nope`, `/api/v1/nope` all return
  `application/json` 404 with `error.code === 'NOT_FOUND'`; `/` and `/area/xyz` still serve the
  SPA (front-end routing preserved).

### IJ-34 — High — `server/api.mjs:44-50` `readJson`

- **Class:** silent failure (corrupt file indistinguishable from absent file).
- **Impact:** a truncated `archive_daily.json` or `snapshot.json` degrades the API to the
  reconstruction with no signal; `manifestCheck` is a separate path and does not cover every
  loader.
- **Fix:** return `{ ok, value, error }`; distinguish ENOENT (absent, legitimate) from a parse
  error (corrupt, must fail loudly or be reported in `/health` and the response meta).
- **Regression test:** T-11 — truncate a copy of `archive_daily.json`; the API reports the
  corruption in `/health` and does not silently serve the reconstruction as if the archive were
  absent.

### IJ-35 — Low (latent) — `server/api.mjs:457-474` `worldLayerIndex`

- **Class:** latent missing-as-zero (`detections: w ? w.total : 0`).
- **Status:** **cannot occur with the shipped bundle.** `scripts/build-countries.mjs:439`
  initialises a `byCountry` entry for every table index and `:543-566` emits a row for every
  gazetteer country, so all 241 ids are present. Verified against `public/data/country_fires.json`:
  241 rows, 0 missing ids, 60 zero-total rows (all legitimate measured zeros).
- **Fix (defensive):** return `null` and let the caller render "not measured"; do not change the
  legitimate zeros.

### IJ-36 — Low — `server/api.mjs:268` `mean_per_day ... : 0`

- **Class:** empty-range zero. A range with no days has no mean.
- **Fix:** `null`.

### IJ-37 — Medium — `server/api.mjs:404-409` GeoJSON export over `liveFires`

- **Class:** silent failure.
- **Root cause:** `liveFires` is `[]` when `live_fires.json` is absent or unparseable (`:72`), and
  the export happily returns `count: 0`.
- **Fix:** distinguish "live layer absent" from "no fires in range": include
  `meta.live: 'unavailable'` and a warning field, or 503 for a live-only export.

### IJ-38 — Medium — `server/api.mjs:384-399` CSV export

- **Class:** missing-as-zero in an export.
- **Root cause:** per-sensor columns print `r.modis` etc. even when the lane was unpublished
  (IJ-23); there is no availability column (`source` and `live` are present).
- **Fix:** add `observed_modis,observed_viirs,observed_noaa20,observed_noaa21` (or a single
  `instruments_published` string, matching `src/lib/export.ts:42`).
- **Regression test:** T-09.

### IJ-39 — Low — `server/api.mjs:614-620` `serveStatic`

- **Class:** SPA fallback also catches missing assets (any path, including `/assets/x.js`, gets
  `index.html` with 200).
- **Impact:** a stale `index.html` referencing a removed chunk receives HTML where JS was
  expected; the browser reports a MIME error rather than a clean 404.
- **Fix:** serve the SPA fallback only for extensionless navigational paths; 404 for a path with
  a known asset extension.
- **Regression test:** T-08 extension case (`/assets/missing.js` ⇒ 404, `/calendar` ⇒ 200 HTML).

### IJ-40 — Low (latent) — `src/lib/countries.ts:203-208`

- **Class:** latent missing-as-zero, documented as an intentional measured zero.
- **Status:** same analysis as IJ-35. The comment's inference ("scanned for the whole window and
  produced nothing") is true only because the shipped window table is built from the same
  gazetteer and is all-or-nothing (`scripts/build-countries.mjs:39-42` fails the build on a
  missing CSV). It is **not** safe for a future partial table.
- **Fix (defensive):** require an explicit `scanned: true` marker in the window row (or return
  `null`); correct the comment to state the invariant it depends on.

### IJ-41 — High — `scripts/build-data.mjs:92-99` + `:161-166`

- **Class:** provenance fabrication.
- **Root cause:** a failed CSV download logs `[skip]` and continues (`:97-98`), but the written
  snapshot always lists all four sources (`:161-166`) and the build exits 0.
- **Impact:** the bundle asserts acquisition that did not happen; `sensorMeta` silently omits the
  failed sensor while `sources` claims it. Any downstream provenance report that reads `sources`
  is wrong. (Contrast: `build-countries.mjs:39-42` fails fast, which is the correct model.)
- **Fix:** fail the build when any of the four required CSVs is unavailable, or record per-source
  `{ status: 'ok' | 'failed', rows, from, to }` and omit failed sources from `sources`.
- **Regression test:** T-11 — a missing CSV ⇒ non-zero exit (or a bundle whose `sources` excludes
  it and whose manifest records the failure).

### IJ-42 — Medium — `scripts/build-data.mjs:114, 127`

- **Class:** missing-as-zero measurement.
- **Root cause:** `Number.isFinite(frp) ? ... : 0` stores 0 MW for a blank FRP; the region-day
  accumulator adds the same 0.
- **Impact:** zero FRP is a physical claim ("detection with no radiative power").
- **Fix:** drop the row (FRP is required for a quality detection) or carry `null` and exclude it
  from FRP sums, keeping the count.
- **Regression test:** T-11 — a blank FRP row is either rejected or contributes null FRP and the
  FRP mean is computed over known values only.

### IJ-43 — Medium — `server/live.mjs:168`

- **Class:** same as IJ-42, live path.
- **Fix:** identical rule, shared with the bundle builder so the two cannot drift.

### IJ-44 — Medium — `server/live.mjs:183-193` + `:319-324`

- **Class:** provenance inconsistency on a partial refresh.
- **Root cause:** `perSatelliteCounts[src.key]` is overwritten per successful source before `ok`
  is decided; when a later source fails, `fires` keeps the last-good window (`:201-204`) but the
  counts and `activeSensors` (`:292-299`) describe the partial attempt.
- **Impact:** the live meta can advertise a sensor whose served data is from the previous fetch.
- **Fix:** build counts from the accepted `fires` array, or commit `perSatelliteCounts` only when
  `ok`; expose `attemptedAt`, `stale` and per-source status separately.
- **Regression test:** T-10 — a partial refresh keeps the old counts and reports `stale: true`
  with the failing source named.

### IJ-45 — Low — `scripts/build-countries.mjs:558` `frpMax`

- **Class:** missing-as-zero in the bundle (`frpMax: 0` for zero detections; `frpMean` is
  correctly `null` — verified: 60 of 241 rows).
- **Fix:** `frpMax: null` when `total === 0`; keep `total: 0` (a real measurement).

### IJ-46 — Medium-low — `src/lib/export.ts:35-43`

- **Class:** model counts in detection-named columns.
- **Status:** partially labelled — the header block (`:28-33`) states how many rows are observed
  vs reconstructed, and each row carries `source`, `provisional`, and `instruments_published`
  (`:42`). A reader who skips the header still sees "modis_detections".
- **Fix:** consider renaming to `modis_hotspots` (the value is a VIIRS-equivalent hotspot count,
  not raw detections) or prefix model rows. Do not remove `source`.
- **Regression test:** existing export tests plus a row-level assertion that `source` and
  `instruments_published` are present and correct for a reconstructed day.

---

## 5. The four critical chains

1. **Failure masking.** `loadLiveBundle` catch → `emptyMeta` (IJ-04) → store detector can never
   fire (IJ-05) → "Live detections 0" (IJ-26), range end rewritten (`store.tsx:279`), status
   fresh (IJ-09). Fix order: IJ-06 → IJ-04 → IJ-05 → IJ-08/09 → IJ-26.
2. **All-zero record.** Failed or empty live window → `calibrationFor` returns `null` (`:842`) →
   `level = 0` (IJ-18) → 26 years of zeros labelled `reconstructed`. This is proven by control
   flow; the Phase I test T-03 must assert it at runtime before the fix is accepted.
3. **Date rewriting.** `alignLiveToRealtime` (IJ-01) and `alignCountryFiresToRealtime` (IJ-02)
   rewrite both the browser's live layer and the world layer, and re-stamp `generatedAt`
   (IJ-03), which makes snapshot age unrepresentable.
4. **Provenance.** Build-time skip-and-continue (IJ-41) and FRP `: 0` (IJ-42/43) mean the bundle
   can overstate what NASA delivered; the API's corrupt-as-absent loader (IJ-34) hides a broken
   archive. Fix before Phase H regenerates anything.

## 6. Legitimate zeros — preserved, with the reason

| Site | Why 0 is correct |
| --- | --- |
| `src/lib/data.ts:731-736, 818-819, 871, 1013-1019` | A sensor present in the window but with no detection contributes 0 detections; shares are 0 for an era that had no such spacecraft |
| `src/lib/data.ts:808` | `exact.sensors.MODIS` absent means the country window measured 0 MODIS detections across the full window |
| `src/lib/data.ts:1175, 1180` | Zero fires on a *complete* pull is a measured zero; zero FRP follows from no detections |
| `src/lib/data.ts:1330, 1381-1385, 2167` | Year bins / day bins / occurrence counters |
| `src/lib/archive.ts:211-213` | Sum over existing archive cells; a missing sensor cell within a covered day is a measured zero |
| `src/components/charts.tsx:121, 155, 357-370, 430, 1159` | Aggregation accumulators and axis maxima |
| `src/lib/countries.ts:494` | Sort tie-break |
| `server/api.mjs:643, 729-732` | Rate-limit and metrics counters |
| `scripts/lib/archive-persistence.mjs:97` | Checkpoint row-count validation |
| `scripts/validate.mjs:68` | Uses `-1`, not 0, as the "missing" sentinel — the correct pattern |
| `scripts/build-countries.mjs:487-491` | Per-sensor / per-day tallies |
| `scripts/e2e.mjs`, `scripts/perf-probe.mjs`, `scripts/rehearse-restore.mjs`, `scripts/smoke.mjs` | Test tooling defaults |
| `server/live.mjs:214-221, 223-238, 304-310` | Best-effort cache write; corrupt cache ignored then `fetchedAt = 0` ⇒ `stale = true` (honest); offline/non-configured 503 |
| `server/live.mjs:229` | `Number(x) || 0` for a missing timestamp then stale-by-default |
| `public/data/country_fires.json` (60 rows) | Every border was scanned for the whole window; zero detections is the measurement |

## 7. Regression tests to add (mandate mapping)

| ID | Test | Covers |
| --- | --- | --- |
| T-01 | Historical fire epochs, `regionDays` keys, `windowStart/End`, `generatedAt` survive a load unchanged | IJ-01, IJ-03 |
| T-02 | Country `days`, `perDay*` keys, and window survive a load unchanged | IJ-02 |
| T-03 | Rejected fetch / 404 / empty bundle ⇒ explicit unavailable state; no fabricated window; no record values | IJ-04, IJ-05, IJ-06, IJ-10, IJ-18, IJ-26 |
| T-04 | Missing `countries.json` or `country_fires.json` ⇒ `worldLayer: 'unavailable'`, country selection disabled | IJ-07 |
| T-05 | Missing precipitation stays `null` end-to-end; no 0 mm bar, no 0 mm tooltip, incomplete 30-day total flagged | IJ-11, IJ-12, IJ-28 |
| T-06 | Insufficient climatology / history ⇒ insufficient-data state, never 0 share, 0 ratio or 0% anomaly | IJ-13, IJ-15, IJ-18 (measured-zero variant), IJ-20, IJ-25 |
| T-07 | Offline weather is `modeled`, `fetchedAt: null`, no observed-shaped text, no weather-driven recommendation | IJ-14, IJ-16, IJ-17, IJ-29, IJ-30 |
| T-08 | `/api/`, `/api/v1/`, `/api/nope`, `/api/v1/nope` ⇒ JSON 404; `/` and client routes ⇒ SPA; missing asset ⇒ 404 | IJ-33, IJ-39 |
| T-09 | **Valid observed zeros still work:** a country with 0 detections ranks as measured 0; a complete-pull day with 0 detections is an observed zero; exports disclose missing lanes | IJ-23, IJ-26, IJ-38, IJ-35, IJ-40 |
| T-10 | Status matrix HISTORICAL / LIVE STALE / LIVE / UNAVAILABLE with snapshot age; partial refresh keeps old counts | IJ-08, IJ-09, IJ-44 |
| T-11 | A failed CSV never appears in `sources`; corrupt API JSON is reported, not treated as absent; blank FRP is not 0 MW; production bundle contains no mock live data | IJ-32, IJ-34, IJ-41, IJ-42, IJ-43 |
| T-12 | Missing analogue base is excluded from the median (`excludedCount`); 0 trials ⇒ `hitRate: null` | IJ-21, IJ-22 |

## 8. Execution order (when authorised)

Phase I/J (browser truth): IJ-06 → IJ-04 → IJ-05 → IJ-08/09 → IJ-01 → IJ-02 → IJ-03 →
IJ-26/27 → IJ-33 → IJ-34 → IJ-10 → T-01/02/03/04/08/10 first, then the rest.

Phase K (science): IJ-11 → IJ-12 → IJ-13/15 → IJ-14/17 → IJ-16 → IJ-20/21/22 → IJ-28/29/30 →
IJ-23/38 → IJ-25 → IJ-18 last (it depends on the unavailable-state plumbing from Phase I).
T-05/06/07/09/12 accompany.

Phase H/regeneration guards: IJ-41 → IJ-42/43 → IJ-44 → IJ-45 before any bundle rebuild.

Latent/defensive: IJ-35, IJ-40, IJ-36, IJ-37, IJ-39, IJ-24, IJ-31, IJ-32, IJ-46 — fix with
tests, never by deleting the legitimate zeros listed in §6.

## 9. Evidence

- Files read end-to-end during this audit: `src/lib/data.ts` (record, calibration, live overlay,
  anomaly, twin), `src/lib/countries.ts`, `src/lib/weather.ts`, `src/lib/liveClient.ts`,
  `src/lib/store.tsx`, `src/lib/export.ts`, `src/pages/Watch.tsx`, `src/pages/Outlook.tsx`,
  `server/api.mjs`, `server/live.mjs`, `scripts/build-data.mjs`, `scripts/build-countries.mjs`,
  `scripts/lib/archive-plan.mjs`, `scripts/lib/archive-promotion.mjs`.
- Bundle completeness check (read-only): `country_fires.json` — 241 rows, 8 days, window
  2026-10-26..2026-11-02, 60 zero-total rows, 0 gazetteer ids missing.
- Phase E state at audit time (read-only): batch 30, requests 24,252, rows 16,066,036, cursor
  advances 24,251 / 27,146 planned (89.34%), remaining 2,895, failed windows 85 across 10 lanes,
  lane row-sum parity exact, lock held by PID 14540 token `a8575030c561d318`.
- No source, archive, checkpoint, lock or log file was written by this audit.
