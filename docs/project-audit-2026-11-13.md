# Continuum project audit - 2026-11-13

## Verdict and scope

Continuum has a substantial data and analytics prototype, but the audited working tree does not build or start its API. Continuous live integration is incomplete, and a browser loader rewrites old acquisition dates to today. The current release cannot be described as a fully working real-time fire system.

This audit covers ingestion, stored data, historical coverage, analytics, geographic selection, API, exports, tests, security checks and deployment configuration. UI appearance was excluded. Functional browser behavior was checked where possible.

The baseline was run against local HEAD `b81a57d` plus existing working-tree edits. At the start, `server/api.mjs` and `src/components/LiveMap.tsx` were modified; `server/live.mjs`, `src/lib/liveClient.ts` and `tests/coder-live.test.mjs` were untracked. An existing root `audit-report.md` was preserved. During consolidation, `src/lib/data.ts` and `src/lib/archive.ts` received further edits outside this audit, including science helpers. Earlier command results do not verify these later edits. Findings and estimates describe the audited baseline; later edits need their own checks. Critical loader and startup defects remained present at the final inspection.

No application source was changed by this audit. Dependency installation and verification commands rebuilt local analytics artifacts and refreshed three JSON reports. No FIRMS window, archive or climate dataset was downloaded or promoted, and no deployment was performed.

Status vocabulary: **verified** means a command was run and its result recorded; **partial** means some cases are covered and the gap is stated; **not verified** means there is no current execution evidence; **blocked** means a host, credential or decision is needed. A verified failure is still a failure.

## 1. How the project works

The system is mainly a React/TypeScript application over locally published JSON files, with a Node API reusing the same analytics functions. It is not an AI service that generates answers at runtime. Most calculations are deterministic JavaScript.

| Layer | Main files | Actual role |
| --- | --- | --- |
| Recent fire ingestion | `scripts/fetch-live.mjs`, `scripts/build-data.mjs` | Download four NASA FIRMS rolling global CSVs; filter quality; retain point tuples and regional daily aggregates. |
| World layer | `scripts/build-countries.mjs`, `src/lib/countries.ts` | Natural Earth borders for 241 countries; point-in-polygon attribution of the same recent raw rows; country search and aggregate records. |
| Historical archive | `scripts/backfill-archive.mjs`, `scripts/promote-archive.mjs`, `src/lib/archive.ts` | Keyed, resumable FIRMS area queries, sensor/date coverage and daily aggregation; integrity checks before promotion. |
| Weather | `scripts/build-climate.mjs`, `src/lib/weather.ts` | Bundled NASA POWER/MERRA-2-derived daily driver and separate runtime POWER requests; custom stress indicators and offline fallback. |
| Record construction | `src/lib/data.ts` | Combine observed archive days, recent observations and deterministic reconstructed days; derive harmonized counts, FRP, intervals and provenance. |
| Application state | `src/lib/store.tsx` | Selected area, dates, metric and mode; construct the area's record and derive page values. |
| Analysis | `src/lib/data.ts` | Calendar, annual/month summaries, percentile status, season timing, analogs, bias diagnostics and sandbox experiments. |
| API | `server/analytics.ts`, `scripts/build-api.mjs`, `server/api.mjs` | Bundle shared analytics for Node; serve data, summaries, calendar and exports, with limits, health, readiness and metrics. |
| New runtime feed | `server/live.mjs`, `src/lib/liveClient.ts` | Attempt periodic upstream fetch/cache and browser polling; currently cannot start/build and does not update the shared analytical record. |
| Downloads | `src/lib/export.ts`, `src/lib/pdf.ts`, `src/pages/Brief.tsx` | Daily CSV, point CSV/GeoJSON and text/PDF brief. |
| Orbit context | `src/lib/satellites.ts`, `src/lib/sgp4.ts` | Local TLE loading and satellite.js SGP4 propagation; simulated orbital position is separate from measured fire detections. |
| Release controls | `scripts/bundle.mjs`, validation/test/smoke/e2e scripts, CI, Dockerfile, Render blueprint | File hashes, regressions and release configuration. Some gates are effective; others currently fail or overstate coverage. |

The intended main flow is:

`NASA CSVs / keyed archive / POWER -> data_raw -> build scripts -> public/data -> shared record builder -> browser and API -> analysis and exports`

The key science operation is a MODIS-to-VIIRS bridge measured from overlapping published days, plus estimation of missing VIIRS constellation lanes. Missing historical days are filled with a calibrated deterministic reconstruction. A reconstructed count is a model result, even when its calibration inputs came from NASA.

A hotspot detection is not a unique wildfire, a burned-area estimate or proof that a fire is still burning. Multiple satellites and overpasses can observe the same event.

## 2. Commands executed and evidence

These are current audit results; older success tables in `docs/production-readiness.md` describe earlier trees.

| Command / probe | Recorded output | Status and implication |
| --- | --- | --- |
| `npm ci` | exit 0; 106 packages added, 107 audited | **verified**: locked dependencies install. |
| `npm run build` | exit 1; `src/lib/liveClient.ts(136,3): TS1144: '{' or ';' expected` | **verified** failure: current browser release cannot be produced. |
| `node --check server/live.mjs` | duplicate `resetForTest`, first reported at line 344 | **verified** failure: module has three declarations; API imports it. |
| `npm test` | exit 1; 135 tests, 108 passed, 15 failed, 9 cancelled, 3 skipped | **partial**: many existing analytics/data regressions pass; startup failures prevent API coverage. |
| `npm run validate` | exit 0; 23/23 checks, 20 manifest entries, 66,486 pilot rows | **verified** for stored bundle integrity and checked contracts; does not validate shifted browser dates or scientific accuracy. |
| `npm run smoke` | exit 1; 0/1; API did not become healthy because of duplicate declaration | **verified** failure; normal endpoint sweep was not reached. |
| `npm run secret-scan` | exit 0; clean, 166 files and 15 existing bundle assets | **verified** within scanner scope; credentials were not printed. |
| `npm audit --omit=dev --audit-level=high` | zero vulnerabilities | **verified** for audited production dependencies. |
| `npm audit --audit-level=high` | exit 1; esbuild/Vite advisories, one moderate and one high | **verified** outstanding development-tool advisories. |
| `npm run preview` followed by `npm run e2e` | 102 recorded assertions: 80 true, 22 false; fatal null `.focus()` error; command incorrectly exited 0 | **partial**: only pre-existing `dist/` was exercised because current build failed. Some selectors are obsolete; not all 22 failures demonstrate product defects. |
| NASA MODIS rolling CSV HTTP HEAD | HTTP 200, advertised length 6,452,507 bytes | **verified** upstream reachability only; not a new ingestion/publication cycle. |
| NASA POWER daily point request | HTTP 200; ten valid dates, latest valid date 2026-11-10 | **verified** endpoint response; complete runtime weather behavior is **not verified**. |

Saved machine-readable outputs: `docs/validation-report.json`, `docs/api-smoke-report.json`, `docs/e2e-report.json`. Preview was stopped; no audit server was intentionally left running. Current production deployment, container, load, rollback and alert checks are **not verified** and execution is **blocked** on a suitable host/engine where applicable.

The 108 passing unit tests and 80 browser assertions are useful evidence, but neither fraction is a percentage of project completion.

## 3. What data is actually present

The shipped bundle is `continuum-2026-11-02-920de0617606`. Its real recent acquisition window is **2026-10-26 to 2026-11-02**, eight calendar dates from the upstream products named Global_7d. A later bundle creation timestamp does not mean newer observations.

Measured from the local bundle/raw inputs during the audit:

- 966,066 quality recent rows across MODIS, VIIRS-SNPP, NOAA-20 and NOAA-21.
- 71,882 retained point geometries: **7.44%** of quality rows. Of these, 50,072 are pilot points and 21,810 are the outside sample. The outside retention is about **2.38%**.
- 241 country borders; 950,861 attributed recent rows (**98.43%**) and 15,205 unassigned. Unassigned does not prove open ocean. 181 countries have detections in this window.
- Country aggregates use the full quality inputs, while map/point exports use retained geometries. Consequently, aggregate totals and exported point counts need not match.
- Archive metadata declares 4,066,557 detections from 9,822 keyed requests. This audit inspected promoted aggregates and coverage, not independently reacquired historical NASA responses.

Each pilot's long record has 9,498 dates through November 2:

| Pilot | Observed area-days | Share of dates | Reconstructed area-days |
| --- | ---: | ---: | ---: |
| Chilecito | 9,498 | 100.0% | 0 |
| Pantanal | 9,498 | 100.0% | 0 |
| California | 5,158 | 54.3% | 4,340 |
| Greece | 3,254 | 34.3% | 6,244 |
| Amazon | 1,084 | 11.4% | 8,414 |
| Nepal | 889 | 9.4% | 8,609 |
| Southeast Australia | 1,514 | 15.9% | 7,984 |
| Total | 30,895 / 66,486 | **46.47%** | 35,591 |

Here, an observed area-day means at least one published sensor lane, including covered zero. It does **not** mean all sensors were observed, every harmonized value is unscaled, or an independent ground-truth validation was passed. Chilecito/Pantanal's 100% cannot be presented as complete four-sensor coverage.

Most non-pilot country history has roughly eight measured recent dates out of 9,498 (**0.084%**); its remaining long record is reconstructed. The project has a real global recent snapshot and some substantial real pilot archives, not a measured global 2000-to-present archive.

## 4. Prioritized defects

### P0-1: Old fire acquisitions are rewritten as current

Location: `src/lib/data.ts`, `alignLiveToRealtime()` called by `loadLiveBundle()`; `src/lib/countries.ts`, `alignCountryFiresToRealtime()` called by the browser country loader.

A read-only Node probe against `dist-server/analytics.mjs` returned:

```text
first acquisition: 2026-10-26T00:01:00Z -> 2026-11-06T00:01:00Z
added seconds: 950400 (11 days)
window: Oct 26-Nov 2 -> Nov 6-Nov 13
```

Latitude, longitude, FRP, sensor and confidence stay the same. The loader also advances sensor envelopes, regional dates and generation time. The shifted record can retain `source: live` and `live: true`. This gives a false current-data impression and affects date-specific analyses, not only badges.

The API/validator read unshifted files directly, so shared analytics do not guarantee browser/API agreement. A passing file-hash check does not catch this transformation.

Repair: preserve acquisition dates; show data-through and age; treat older observations as stale. Only new upstream observations may extend measured coverage. Reconstructed/model/sandbox outputs must never inherit LIVE.

### P0-2: The audited source cannot build or start

Location: `src/lib/liveClient.ts`, `useMockLiveFirms()`; `server/live.mjs`, `resetForTest()`.

`npm run build` reports TS1144 at the invalid `function ... ) => {` declaration. `node --check server/live.mjs` reports a duplicate exported function; `resetForTest` is declared three times. The API imports this file unconditionally, preventing all API startup.

A TypeScript diagnostic with only that delimiter corrected **in memory** exposed six more errors: `useLiveFirms` returns void but LiveMap destructures its result; provenance sources are mixed with connection statuses; browser code uses `process.env`. These were not source edits or a successful build.

Repair: resolve the complete hook contract and browser environment access, remove duplicate declarations, then run build and startup checks. Fixing the first parser error alone is insufficient.

### P1-1: Runtime observations do not reach the analytical record

Location: `src/lib/liveClient.ts`, `src/components/LiveMap.tsx`, `server/api.mjs`, `server/live.mjs`.

- Client fetches `/api/live-firms`; server exposes `/live-firms` and `/api/v1/live-firms`.
- LiveMap's callback updates status/time, while `regionPoints` still derives from the original `fires` prop. Fresh points are not placed into the shared store/calendar.
- The API's normal analytics use startup bundle data, independent of the runtime provider.
- The client ignores server `stale` and can classify cached fallback observations as live.
- Inline callbacks change identity and may repeatedly restart the effect/polling.

Repair: use one coherent data/version contract for map, calendar, country aggregation, analytics and exports. Verify one newly fetched observation appears with its true acquisition time across all of those outputs.

### P1-2: The provider has scale and consistency defects

Location: `server/live.mjs`, `refresh()`, response builders and cache lifecycle.

`all.push(...tuples)` spreads an entire feed into arguments. A matching 300,000-element probe returned `RangeError: Maximum call stack size exceeded`; real VIIRS windows are of this order. The complete live-fetch cycle is not verified because startup fails.

Counts are mutated per sensor before the all-or-nothing data swap, so partial failure can combine old points with new counts. Thrown fetch errors bypass the intended stale branch. Freshness is not recomputed by age for each response. The response duplicates the full point array as `fires` and `data`. Startup requires a key despite using public download URLs. No durable runtime cache volume is configured.

Repair: append safely, stage metadata and points together, swap atomically, preserve last-good data with truthful age/source, and test large feeds, missing sensors, upstream errors, restarts and cache persistence. Keep upstream credentials server-side.

### P1-3: Selected geometry, cached records and downloads disagree

Locations: `src/lib/geometry.ts`, `src/data/places.ts`, `src/lib/data.ts`, `src/lib/export.ts`, `server/api.mjs`.

Drawn polygons are reduced to equal-area circles, while point filtering uses bounding boxes. Country aggregates use exact polygons but point CSV/GeoJSON uses bounding boxes and a sampled point set. A country download can include neighboring-country detections and omit many genuine points.

The API record cache key uses `region.radiusKm`, which custom Region objects do not store. Their IDs also omit radius. A probe at the same centre with radii 20 and 140 km produced areas 1,257 and 61,575 km2 but identical cache keys. This can reuse the wrong area's record.

Geometry probes also found an accepted self-intersecting polygon, holes added instead of subtracted (49,447.34 + 12,362.31 = 61,809.65 km2), and an 800 km direct-radius area of 2,010,619 km2 that bypasses the configured 250,000 km2 API limit.

Repair: retain the actual selected geometry, clip consistently, subtract holes, reject self-intersection and enforce limits on every entry route. Include geometry identity and bundle version in cache keys. Distinguish sampled point exports from complete observations.

### P1-4: Comparisons and analogs contain mathematical errors

Location: `src/lib/data.ts`, `monthComparison()` and `twinAnalogs()`.

The history array is sorted by magnitude before `slice(-5/-10/-20)`, so recent-year averages actually select the highest totals. A chronological fixture with 2020-25 totals `[100,80,60,40,20,10]` returns mean5 **60**; the latest-five result should be **42**.

`monthComparison` compares the current partial month with full historical months. Use the same elapsed-day window, or make the different coverage explicit.

Analog candidate start/end dates receive the same year. A December-January window becomes reversed. The Chilecito probe produced zero analogs on January 15 and February 1 but still 20 reported backtest trials; June/November returned three analogs.

Repair: preserve chronological order for rolling means, align elapsed windows, handle year crossings in candidates and backtests, and add boundary fixtures with independently calculated expectations.

### P1-5: Test success can mask failure

Locations: `scripts/e2e.mjs`, `tests/coder-live.test.mjs`, readiness/conformance documents.

The e2e catch/failure paths write reports without setting a failing process exit status. The audit reproduced exit 0 despite 22 false assertions and a fatal exception. The script must fail CI on assertions and fatal errors, and must test the newly built artifact. Update obsolete selectors against intended behavior; do not weaken assertions to obtain a green report.

The new keyed tests use standalone `test.skip()` rather than conditionally skipping their enclosing suites, and shared rate-limit state leaks between cases. Existing analytic/data tests cover many regressions, but mostly check implementation consistency rather than independent scientific validity.

Older blanket success tables and coverage numbers need reconciliation with the current working tree and dated evidence. A document describing an earlier successful run does not certify this release.

### P2-1: Weather missingness affects advice

Location: `src/lib/weather.ts`.

Missing precipitation is inserted as zero, which can manufacture dryness. Offline handling creates sinusoidal synthetic stress: it is labelled offline but can still influence derived posture. The weather cache key contains coordinates and today but not the fire-record identity, although fitted relationships depend on that record.

Repair: preserve missing values, separate unavailable weather from measured zero, keep simulated weather out of operational advice, and invalidate record-dependent results correctly. The POWER HTTP response is verified; end-to-end weather behavior in a current release is not verified.

### P2-2: Export and brief semantics are inconsistent

Locations: `src/lib/export.ts`, `src/lib/pdf.ts`, `src/pages/Brief.tsx`, `server/api.mjs`.

- Browser CSV column `harmonized_viirs_equiv` receives `dailyValue(..., mode)`, so raw mode writes raw totals under that name while intervals remain harmonized.
- API CSV lacks observed/constellation availability flags needed to distinguish missing lanes, measured zeros and estimated completion.
- Brief uses mean analog departure but calls it median; another shared helper computes a median, so outputs can diverge.
- API method-card text says NOAA-20/21 never enter H, contrary to the record implementation.
- PDF text uses two operands for `Tm`, which requires six. A pypdf probe accepted the sample file but extracted lines run together. This is a standards/placement defect, not proof that every viewer refuses to open it. The brief also lacks the fuller map/calendar/weather composition in the PRD.

Repair: make export column meanings independent of display mode, include coverage/provenance, share all brief statistics, reconcile the method card and render-check a standards-compliant PDF.

### P2-3: Deployment configuration has current gaps

Locations: `server/api.mjs`, `Dockerfile`, `render.yaml`, CI and monitoring examples.

MapLibre fetches NASA GIBS tiles and uses workers. The API CSP permits GIBS images but not GIBS connections, and lacks the blob-worker allowance. Source mismatch is verified; current API-hosted browser behavior is not verified because startup fails.

The Docker runtime omits root `public/tle` and `public/textures` paths used by readiness. No durable provider cache volume is declared. Render builds without the full gates and checks liveness rather than bundle readiness. Current container deployment, load, restoration/rollback and routed alerts have not been executed in this audit. Monitoring examples are not live monitoring.

Repair: fix runtime assets/cache and CSP, gate deployment on current-source checks, then execute deployment/readiness and failure drills on the target host. Respect the offline TLE refresh requirement; do not introduce browser CelesTrak dependence.

## 5. Scientific completeness

The central challenge is a consistent MODIS/VIIRS burning calendar. The project implements a simplified aggregate overlap-ratio estimator and constellation completion with provenance. That is a useful starting point, but the scientifically defensible claim is **partial**, not a validated sensor-independent fire record.

Remaining evidence includes matched spatial/time detection pairs, calibration across seasons/biomes/intensities, held-out sensor agreement, independent uncertainty coverage, robust handling of missing observations, and sensitivity to calibration/sampling choices. A chosen 90% interval is not proof that 90% of independent outcomes fall inside it.

The broader local PRD also proposes fitted detection probability, GOES-derived daily-cycle correction and sensor FRP mapping. These are not established in the shipped pipeline. At inspection, the later `dailyCycleFromOverlap` helper had no observed call site or upstream hourly/GOES integration. It and further archive/analytics additions arrived after the baseline; their behavior is **not verified** by these results. Merely adding a function with that name does not supply validation.

The sandbox applies known simulated distortions and divides by the same known probability; this demonstrates internal mathematics, not recovery of unknown real-world sensor bias. The bias waterfall uses heuristic allocations rather than independently identified causal components. The static non-vegetation-source filtering advertised in `.env.example` is not implemented. No shipped scientific validation notebook was found.

GOES/GFWED and the full production PRD are broader project ambitions, not all mandatory NASA challenge objectives. For a hackathon, a narrower validated MODIS/VIIRS calendar can be a credible target. State limits plainly: hotspots include agricultural burns and thermal anomalies; posture/analogs are not validated ignition, spread or dispatch forecasts.

## 6. Completion estimates

These are engineering judgment ranges, not measurements, NASA scores or acceptance-test pass rates. UI appearance contributes nothing to these estimates.

| Scope | Estimated completion | Main reason |
| --- | ---: | --- |
| Non-visual functional prototype | **50-60%**, midpoint about 55% | Substantial data, record builder, analysis and exports exist; core startup, freshness, selection and correctness defects remain. |
| Continuous live integration | **20-30%** | Recent-data scripts and a provider draft exist; no verified fetch-to-map/calendar/API/export cycle or complete scheduled publication. |
| Broader scientific PRD | **25-35%** | Aggregate estimators exist; independent calibration, detection/FRP modelling and validation remain. |
| Production operations | **15-25%** | Manifests, limits and deployment/runbook artifacts exist; current release fails startup and host-bound evidence is missing. |

An explicit prototype rubric is: data foundations 25% weight at 80% complete; prototype estimators 25% at 55%; analytics/API/selection/exports 25% at 60%; live integration 15% at 25%; operations 10% at 20%. Weighted result: **54.5%**. This scores implemented prototype capability, while the separate science estimate judges the broader validation/model scope. Different scope choices change the estimate.

Measured historical coverage is independently **46.47% observed pilot area-days**, not 46.47% project completion. The current release is unusable pending startup/provenance fixes regardless of an overall percentage.

## 7. Recommended repair order

1. Restore complete TypeScript build and API startup. Resolve the hook contract, not just the first syntax error.
2. Remove temporal shifting. Establish truthful acquisition, generation, data-through, age and provenance fields everywhere.
3. Connect one atomic/versioned refresh path across raw data, country layer, record builder, browser, API and downloads. Test upstream outage, partial sensors, large feeds and restart persistence.
4. Make area selection and point exports use the same actual geometry. Repair cache identity, hole handling, self-intersection and size limits.
5. Fix recent-year averages, elapsed-month comparisons, year-crossing analogs and export/brief semantics with independently calculated fixtures.
6. Establish scientific validation on the strongest existing pilot archives, starting with Chilecito/Pantanal while checking individual sensor coverage. Expand real archive coverage before claiming global historical observations.
7. Correct CI failure signaling and documentation, then execute deployment/readiness/rollback/monitoring checks on the chosen host.

A focused hackathon scope can prioritize two defensible pilot records, a transparent MODIS/VIIRS calibration, honest freshness/missing-data labels, calendar comparisons and accurate CSV downloads before expanding forecasting or global synthetic history.

After fixes, the baseline gates are `npm ci`, `npm run build`, `npm test` and e2e against a running preview/current artifact. When intentionally refreshing data, follow the working agreement's exact chain:

```text
npm run live -> npm run countries -> npm run data -> npm run api:build
-> npm run bundle -> npm run build -> npm test -> npm run validate
-> npm run smoke -> npm run secret-scan -> API on :8787 -> npm run e2e
```

Do not run bundle after build. Recapture legitimate analog goldens with `node scripts/capture-analogs.mjs --write` and record the reason; do not loosen tolerances or bypass failures. Use an appropriate science/geometry regression for each substantive repair. Host-bound gates remain blocked until executed on a target.

## 8. Audit limitations and interpretation

This is extensive source and local execution evidence, not proof that every possible input works. The failed build prevents a current-source browser verification. The preview sweep used older dist files, aborted early and has a broken exit status. The current API could not start. Historical source responses were not independently reacquired, paid/keyed backfills were not run and no keys were exposed. Later concurrent edits need their own verification. Earlier perf/restore/remote-CI reports remain historical evidence rather than current audit results.

The data foundations and many numerical routines are valuable work. The next milestone is a buildable, truthful and scientifically checkable data flow; visual polish can follow.

## Appendix: Read-only reproductions

The following Node probe was run against the generated analytics module during the audit and returned the timestamp, mean, cache, hole-area and spread results quoted above. Run it from the repository root using `node --input-type=module` with this code as the input. It neither starts the API nor writes datasets.

```javascript
import fs from 'node:fs';
import * as A from './dist-server/analytics.mjs';
const b = JSON.parse(fs.readFileSync('public/data/live_fires.json', 'utf8'));
const s = A.alignLiveToRealtime(b, '2026-11-13');
const rows = [100,80,60,40,20,10].map((value,i) => ({
  date: (2020+i)+'-01-01', year: 2020+i, month: 1,
  raw: value, harmonized: value
}));
const m = A.monthComparison(rows,1,'hotspots','harmonized','2026-11-13');
const small = A.customRegion(28,84,20), big = A.customRegion(28,84,140);
const key = r => r.id+':'+r.center+':'+(r.radiusKm ?? '');
const outer = A.rectRing(0,0,2,2), inner = A.rectRing(0.5,0.5,1.5,1.5);
let spread;
try { const sink=[]; sink.push(...Array(300000).fill(1)); spread='accepted'; }
catch(e) { spread=e.name+': '+e.message; }
console.log({
  before: new Date(b.fires[0][5]*1000).toISOString(),
  after: new Date(s.fires[0][5]*1000).toISOString(),
  offsetSeconds: s.fires[0][5]-b.fires[0][5],
  mean5: m.mean5, expectedMean5: 42,
  smallArea: small.areaKm2, bigArea: big.areaKm2, sameKey: key(small)===key(big),
  outer: A.polygonAreaKm2([outer]), inner: A.polygonAreaKm2([inner]),
  combined: A.polygonAreaKm2([outer,inner]), spread
});
```

The spread threshold is engine-dependent; the recorded Node runtime threw on this input. This probe verifies the unsafe pattern's scale sensitivity, not a successful full provider fetch. Rebuild `dist-server/analytics.mjs` after intentional analytics edits before rechecking those edited functions.
