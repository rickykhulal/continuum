# Continuum — Scientific Validation Audit (2026-11-14)

**Scope**: The 12 scientific risks named in the audit brief, plus the calibration chain, the
archive, uncertainty, geometry, weather and claim scope.
**Mode**: Read-only. Where possible, numbers were recomputed from the shipped artifacts by importing
the project's own built analytics module (`dist-server/analytics.mjs`) and the bundles in
`public/data/`. Those runs are tagged `[EXEC]`.

---

## 0. How the science is organised

```
public/data/archive_daily.json   keyed FIRMS Area API, per-sensor day arrays + coverage ranges
        │  src/lib/archive.ts  attachArchive → archiveRatio / constellationWeights / platformEquivalent
        ▼
public/data/live_fires.json      rolling 8-day window, 71,882 points
        │  src/lib/data.ts     calibrationFor → bridge k, levelPerDay, FRP distributions
        ▼
DailyRecord[] per region         source ∈ {model, live, blend, archive}
        │
        ▼
statusFor / twinAnalogs / biasXray / runSandbox / generateValidationReport
```

---

## 1. The twelve named risks

| # | Risk | Classification | Evidence |
| --- | --- | --- | --- |
| 1 | Daily-cycle correction missing or disconnected | **CONFIRMED** | `archive.ts` (299 lines) exports none of `dailyCycleWeight`, `applyDailyCycleCorrection`, `archiveRatioWithDailyCycle`; `data.ts:51-53` re-exports them → TS2305; `data.ts:1920` calls one → TS2304; the private helper `dailyCycleFromOverlap` at `data.ts:532` has no caller. |
| 2 | Bridge ratios unvalidated | **PARTIALLY CONFIRMED** | Measured from the archive for 2/7 pilots (Chilecito 12.77/5,401 d; Pantanal 10.63/2,441 d — `[EXEC]`). The other 5 use a live-window estimate on **2–8 days** or a pooled prior (`[EXEC]`). No independent product (MCD64A1, GFWED, CONAE) is available to validate either. |
| 3 | Historical archive coverage not independently reacquired | **PARTIALLY CONFIRMED** | The archive *is* present: 9,822 requests, 4,066,557 rows to 2026-11-02 (`[ART]`). But lane coverage is uneven: California NOAA-20 covers 199 days, Greece NOAA-21 94 days, Amazon/Nepal/SE-Australia MODIS 733/323/1,093 days against a 9,498-day span. Record-level provenance is 9.4%–99.9% (`[EXEC]`). |
| 4 | Analog seasons cross calendar years incorrectly | **NOT CONFIRMED** (with one caveat) | `twinAnalogs` maps the current window onto the same month/day of each candidate year (`data.ts:1583-1585`), so candidates do not cross years. Caveat: the 27-day forward outcome is restricted to the candidate's own year (`sumInYear`, `data.ts:1598-1602`), so a window that reaches December is silently truncated. Classify the caveat **PARTIALLY CONFIRMED (truncation)**. |
| 5 | Partial-month comparisons unfair | **NOT CONFIRMED** | `statusFor` compares month-to-date with the same day-of-month cutoff in every historical year and requires ≥ min(20, cutoff−2) days (`data.ts:1373-1384`). This is the correct control. |
| 6 | Uncertainty not calibrated | **CONFIRMED** | The shipped validation report sets `ratioLo = k·0.8`, `ratioHi = k·1.2` with the comment "placeholder — actual CI from se" (`data.ts:2016-2017`). The bias-X-ray path does compute `±1.645·se` (`data.ts:1829`), so two different intervals coexist. |
| 7 | Missing precipitation treated as zero | **CONFIRMED** | `p30 += dd.p ?? 0` (`weather.ts:109`) counts an unobserved day as zero rain, which pushes the area *towards* "dry". A missing rain climatology gives `dry = 0` (`weather.ts:111`), which pushes the other way. Both are silent imputations. |
| 8 | Region geometry circles/bboxes instead of polygons | **CONFIRMED** | Detection membership is a bbox test (`data.ts:613, 2043, 2055`); pilot regions carry only `center` + `bbox` (`src/data/regions.json`); any drawn polygon is reduced to centroid + equal-area circle (`geometry.ts:198-201`, `DrawArea.tsx:116`). |
| 9 | Polygon holes mishandled | **CONFIRMED** | `polygonAreaKm2` sums `Math.abs(ringExcess)` for **every** ring (`geometry.ts:66-82`); a hole adds area instead of subtracting it. |
| 10 | Pilot coverage misrepresented | **PARTIALLY CONFIRMED** | Provenance is now computed from record rows (`provenanceMix`), and those numbers are honest (9.4%–99.9% — `[EXEC]`). But copy such as "53k live points" (`Method.tsx:11`) and "the real rolling public CSV" (`Method.tsx:115`) describes an 8-day window from 2026-11-02 and a 71,882-point bundle. |
| 11 | Static non-vegetation filtering missing | **CONFIRMED** | No land-cover, water, desert, volcanic or industrial-flare mask exists anywhere (`grep` across `src/lib` finds only a nearest-land label in `countries.ts:420`). Gas flares and volcano hotspots enter the counts. |
| 12 | Satellite products lack equivalent temporal coverage | **CONFIRMED (handled, not removed)** | MODIS 2000-11, VIIRS 2012-01, NOAA-20 2018-04, NOAA-21 2023-03. The code handles this by design with `archiveRatio` + `constellationWeights` + `platformEquivalent` (`archive.ts:199-296`). The residual is that 5/7 pilots never accumulate 365 full-constellation days, so their bridge stays a prior. |

---

## 2. The calibration chain, recomputed

`[EXEC]` importing `dist-server/analytics.mjs`, attaching `public/data/archive_daily.json`,
`live_fires.json` and `climate_daily.json`, then calling `bridgeFor(region, live)`,
`archiveCoverage(id)` and `provenanceMix(regionRecord(region, live))`:

| Region | bridge source | k | overlap days | archived / total days | share |
| --- | --- | --- | --- | --- | --- |
| chilecito | firms-archive | 12.77 | 5,401 | 9,490 / 9,498 | 99.9% |
| pantanal | firms-archive | 10.63 | 2,441 | 9,490 / 9,498 | 99.9% |
| california | area (live) | 14.70 | 7 | 5,150 / 9,498 | 54.3% |
| greece | pilot-regions | 10.31 | 3 | 3,246 / 9,498 | 34.3% |
| amazon | area (live) | 9.95 | 8 | 1,076 / 9,498 | 11.4% |
| nepal | pilot-regions | 10.31 | 2 | 881 / 9,498 | 9.4% |
| southeast-australia | area (live) | 19.62 | 8 | 1,506 / 9,498 | 15.9% |

An independent replication of `archiveRatio()` directly from the JSON reproduced
Chilecito 12.77 / 5,401 days and Pantanal 10.63 / 2,441 days, matching the module exactly.

### 2.1 The seasonal-bias guard applies to only one path

`[SRC]` `archive.ts:260-269`:

> "A ratio measured over less than one annual cycle is seasonally biased… Requiring a full year
> keeps the archive bridge honest… `const MIN_BRIDGE_DAYS = 365;`"

`[SRC]` `data.ts:843`:

```ts
const useAreaK = !trustCountry && areaSumM >= MIN_AREA_OVERLAP_MODIS && areaSumV > 0;
```

`MIN_AREA_OVERLAP_MODIS = 30` (`data.ts:524`) is compared against **`areaSumM`, a sum of detections**,
not a number of days. A single 8-day window with 30+ MODIS hits therefore qualifies, producing
k = 14.70 (California) and k = 19.62 (SE Australia) from one seasonal week. This is the same
selection/seasonal problem the 365-day gate exists to prevent, re-entering through the live path.

**Recommendation (not implemented)**: gate the live path on overlap *days* and a season-coverage
criterion, or label `kSource` as `area-short-window` so the UI can say so.

### 2.2 Comparison with the Codex numbers

`[CLAIM]` Codex reports Chilecito `{k: 12.77, days: 5401}` and Pantanal `{k: 10.6120, days: 2053}`.
The first matches exactly; the second matches on `k` to within 0.02 but not on days (2,441 here).
The bundle Codex measured was therefore a different (earlier) archive build. Its qualitative
conclusions about the 365-day gate and constellation completion are correct.

---

## 3. Daily-cycle model

| Function | Status | Evidence |
| --- | --- | --- |
| `dailyCycleFromOverlap` | Present **only as dead private code** in `data.ts:532-589`; computes UTC-hour bins, triangular smoothing, 24-bin normalisation, linear interpolation; **no caller** | `[SRC]` + `[EXEC]` grep |
| `dailyCycleWeight` | **Absent** from `archive.ts` | `[SRC]` |
| `applyDailyCycleCorrection` | **Absent**; Codex describes it as a placeholder returning `{kCorrected: kBase, weight: 1.0}` — unverifiable now | `[CLAIM]` |
| `archiveRatioWithDailyCycle` | **Absent**; `data.ts:1920` calls it | `[SRC]` |
| UI claim | "daily-cycle model reference hour 13:30" is printed beside the ratio (`data.ts:1925-1931`) | `[SRC]` |

The 13.5 reference hour constant survives (`data.ts:525`, `VIIRS_REFERENCE_HOUR`), but nothing uses
it. The product therefore **claims** a correction that the code does not perform. This is the most
serious scientific-integrity finding after the timestamp shift.

---

## 4. Uncertainty

| Interval | How computed | Honest? |
| --- | --- | --- |
| `biasXray` ratio CI | `k ± 1.645·se` over yearly samples (`data.ts:1829`) | Reasonable, though the se construction is not independently validated |
| `generateValidationReport` ratio CI | `k × 0.8 .. k × 1.2` (`data.ts:2016-2017`) | **No** — hardcoded placeholder |
| `statusFor` percentile | empirical rank against ≤25 prior years (`data.ts:1398-1399`) | Yes, with small-sample caveats already handled by the `<5 history` branch |
| Sandbox recovery | single-seed Poisson simulation | Labelled synthetic; not a confidence interval |

Because `generateValidationReport` has **no caller**, the placeholder CI is currently dead code —
but it is exported-ready and would ship if wired up.

---

## 5. Geometry and geography

| Item | Behaviour | Consequence |
| --- | --- | --- |
| Pilot region | `center` + `bbox` only (`regions.json`) | A bbox over-includes fires outside the named area; Chilecito's box crosses terrain types, Pantanal's crosses biomes |
| Custom AOI | polygon → `geometryToCircle` (`geometry.ts:198-201`) | Shape is lost; a long thin firefront becomes a large disc |
| Area | spherical excess per ring, absolute value summed (`geometry.ts:66-82`) | Holes add instead of subtract |
| Centroid | unit-vector mean with closing-vertex dedup (`geometry.ts:88-110`) | Correct |
| Point-in-ring | used for country labelling | Correct for label; **not** used for fire counting |

Country-level counting is separate and does use real Natural Earth polygons
(`countries.ts`, `scripts/build-countries.mjs`), so the 241-country layer is materially better than
the seven pilot boxes. The pilot record — which drives every KPI — is box-based.

---

## 6. Weather

`[SRC]` `weather.ts`:

* Real NASA POWER MERRA-2 daily fields (`T2M`, `PRECTOTCORR`, `RH2M`), 9,802 days per region
  (`[ART]` `climate_daily.json`, 442,572 bytes).
* `stress = clamp01(0.46·heat + 0.38·dry + 0.16·dryAir) × 100` (`weather.ts:113-121`) — a bespoke
  index, not a published fire-danger index. It is disclosed as such on the Method page.
* Two silent imputations (`?? 0`, `?? 0.3`) described in risk 7.
* MERRA-2 publishes with a lag; recent weeks carry a persistence anomaly, which the Method copy
  does disclose.

---

## 7. Test invariants that actually pass

`[EXEC]` `node --test tests/science.test.mjs tests/geometry.test.mjs tests/archive-coverage.test.mjs`
→ **52/52 pass**. These tests run against `dist-server/analytics.mjs`, not the edited `data.ts`, so
they validate the **last successfully built** analytics, not the 221 new lines. They do pin:

* per-day harmonisation identity,
* archive coverage arithmetic,
* spherical geometry,
* analog index construction.

They do **not** test: the daily-cycle correction, the validation-report CI, bbox-vs-polygon
membership, precipitation imputation, or hole subtraction.

---

## 8. What the project may and may not claim

### Supported

* A 26-year deterministic **reconstruction** of daily fire activity for seven pilot regions,
  calibrated to real FIRMS overlap and real MERRA-2 weather.
* A **measured** MODIS→VIIRS bridge for the two fully archived pilots (12.77 and 10.63), with a
  365-day guard and constellation completion.
* A real, integrity-checked keyed archive (4.07 M rows) and a 241-country live-window layer.
* An honestly labelled provenance split per record row.
* A satellite/orbital visualisation driven by real TLEs and SGP4.

### Not supported

* "A validated, sensor-independent fire record."
* "Daily-cycle corrected bridge ratios."
* "Calibrated uncertainty intervals."
* "Live" anything, while timestamps are shifted and the client is disconnected.
* "Fires" — these are **detections**. A detection is not a fire; absence of detection is not
  absence of fire. The UI already says this in `statusFor` copy; it must hold everywhere.

### Blocked on credentials or hosts

| Claim | Blocker |
| --- | --- |
| Refresh the archive past 2026-11-02 | `FIRMS_MAP_KEY` |
| Validate against burned area (MCD64A1) | Earthdata Login |
| Validate against CONAE / GFWED | registration / network |

---

## 9. Findings summary

| ID | Finding | Class |
| --- | --- | --- |
| S-01 | Daily-cycle layer lost; UI still claims it | CONFIRMED |
| S-02 | Live-window k admitted on 2–8 days | CONFIRMED |
| S-03 | Validation CI is ±20% placeholder | CONFIRMED |
| S-04 | Bbox membership + equal-area circles | CONFIRMED |
| S-05 | Holes added in area | CONFIRMED |
| S-06 | Missing precipitation as zero | CONFIRMED |
| S-07 | No non-vegetation filtering | CONFIRMED |
| S-08 | Partial-month comparison handled correctly | NOT CONFIRMED (risk does not hold) |
| S-09 | Analog candidates do not cross years; forward outcome truncates at year end | NOT CONFIRMED / PARTIALLY CONFIRMED |
| S-10 | Provenance shares 9.4%–99.9% | VERIFIED from shipped bundle |
| S-11 | Science tests 52/52 pass on built analytics | VERIFIED |
| S-12 | Science tests do not cover the new/changed code | CONFIRMED |
