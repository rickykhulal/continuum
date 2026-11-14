# Continuum — Prioritised Implementation Roadmap (2026-11-14)

**Status**: Proposal only. **Nothing in this document has been implemented.**
Every item requires explicit project-owner approval before work begins.
**Rule**: one layer at a time; prove each item with the command named in its "Tests" row.

Priority legend: **P0** blocks compile/start/safety · **P1** blocks real data flow ·
**P2** scientific correctness · **P3** product quality · **P4** deployment/ops.

---

## Recommended sequence (dependency-ordered)

```
R-01  rotate + purge exposed key                     (no dependency)
R-02  track the three live modules                   (no dependency)
R-03  make tsc -b exit 0                             (needs R-02)
R-04  repair the live hook contract                  (needs R-03)
R-05  align client URL + response shape              (needs R-04)
R-06  remove browser process.env                     (needs R-03)
R-07  stop shifting observation time                 (needs R-03)
R-08  separate wall-clock from snapshot end          (needs R-07)
R-09  surface load failure honestly                  (needs R-07)
R-10  truthful status badges                         (needs R-05, R-09)
R-11  CSP worker-src                                 (independent)
R-12  e2e exit codes                                 (independent)
R-13  test isolation (ports)                         (independent)
R-14  keyless test variant                           (needs R-05)
R-15  feed the map from live data                    (needs R-05)
R-16  durable live cache on Render                   (needs P4 host access)
```

---

## P0 — Critical blockers

### R-01 · Rotate and purge the exposed FIRMS key

| Field | Value |
| --- | --- |
| Problem | A 32-hex `FIRMS_MAP_KEY` value is written in plaintext in 4 untracked reports (7 occurrences). |
| Files | `docs/DATA_FRESHNESS_REPORT.md`, `docs/COMPLETION_BASELINE.md`, `docs/COMPLETION_REPORT.md`, `docs/TEST_RESULTS.md`; `scripts/secret-scan.mjs` (detection gap) |
| Why | The tree is bound for a public repository; the key is live and authorises NASA quota. |
| Solution | Rotate the key at NASA FIRMS. Replace every occurrence with `<REDACTED>`. Add a hex-token rule (`[A-Fa-f0-9]{32}` near `MAP_KEY`) to the scanner. Never print the value in any doc again. |
| Dependencies | none |
| Regression risk | Low (docs + scanner only). |
| Tests | `npm run secret-scan` must stay clean **and** must fail on a deliberately planted dummy hex token. |
| Owner | Integration lead (owner action: rotate) |
| Approval | **Required** — touches credentials and shared docs. |

### R-02 · Track the three live modules

| Field | Value |
| --- | --- |
| Problem | `server/live.mjs`, `src/lib/liveClient.ts`, `tests/coder-live.test.mjs` are untracked; a clean clone cannot build or start. |
| Files | the three files; `render.yaml` (branch) confirmed |
| Why | `api.mjs:11` imports `./live.mjs` at module load; `LiveMap.tsx:3` imports `liveClient`. |
| Solution | Review, then `git add` all three in a dedicated commit; verify `git ls-files` contains them; confirm the build works from a fresh clone. |
| Dependencies | R-03 should land in the same PR so the added files compile. |
| Regression risk | Low. |
| Tests | Fresh `git clone` → `npm ci` → `npm run build` → `npm start` → `/ready` 200. |
| Owner | Claude |
| Approval | **Required** — stages previously untracked work. |

### R-03 · Make `tsc -b` exit 0

| Field | Value |
| --- | --- |
| Problem | 16 errors block `npm run build`. |
| Files | `src/components/LiveMap.tsx:54-58`, `src/lib/liveClient.ts:61-130`, `src/lib/data.ts:51-53, 1901-2050` |
| Why | Without this nothing downstream can be verified. |
| Solution | (a) Introduce a dedicated `LiveStatus` union (`loading|live|stale|offline|not_configured`) in `types.ts`; stop reusing `DataSource`. (b) Decide the daily-cycle question **before** touching `data.ts`: either implement the three functions (R-17) or delete the re-export block, the call at 1920, and the dead `generateValidationReport`. Do **not** leave a re-export of non-existent symbols. (c) Fix the two `typeof self[]` annotations by declaring an explicit `MonthlyStatus[]` / `Sensitivity[]`. (d) Type the `s` parameters. |
| Dependencies | R-02. Coordination with R-17. |
| Regression risk | Medium — `dist-server` analytics surface must not change unintentionally. |
| Tests | `npx tsc -p tsconfig.app.json --noEmit` → 0; `npm run build` → 0; `npm test` unchanged or better. |
| Owner | Claude (with Codex review of the daily-cycle decision) |
| Approval | **Required** — changes exported analytics. |

### R-04 · Repair the `useLiveFirms` contract

| Field | Value |
| --- | --- |
| Problem | The hook returns `void`; `LiveMap.tsx:54` destructures it → runtime `TypeError`. |
| Files | `src/lib/liveClient.ts:61-114`, `src/components/LiveMap.tsx:54` |
| Why | The map component cannot render at all. |
| Solution | Return `{ status, data, meta, lastUpdated, error }` and keep the callbacks for compatibility, or switch the caller to the return value only. One contract, not two. |
| Dependencies | R-03. |
| Regression risk | Low. |
| Tests | A React test that renders `LiveMap` with a mocked hook; `tsc` zero errors. |
| Owner | Claude |
| Approval | Required (source change). |

### R-05 · Fix the live URL and response shape

| Field | Value |
| --- | --- |
| Problem | Client calls `/api/live-firms` (HTML 200); server serves `/live-firms` and `/api/v1/live-firms`; the 200 body uses `fires`, the client expects `data`. |
| Files | `src/lib/liveClient.ts:37-41,72`; `server/api.mjs:491-496` |
| Why | Even with a key the client can never receive JSON. |
| Solution | Point the client at `/api/v1/live-firms` (or make both paths resolve). Wrap the provider body in the standard `envelope()` so every GET has one shape. Choose `fires` **or** `data` and use it on both sides. |
| Dependencies | R-03. |
| Regression risk | Medium — `tests/coder-live.test.mjs` asserts the current body; update deliberately, not by loosening. |
| Tests | `curl /api/v1/live-firms` returns the same JSON shape the client parses; unit test the parser. |
| Owner | Claude |
| Approval | Required. |

### R-06 · Remove `process.env` from browser code

| Field | Value |
| --- | --- |
| Problem | `ALLOW_MOCK_LIVE` reads `process.env` at module scope → `ReferenceError` in the browser. |
| Files | `src/lib/liveClient.ts:130` |
| Why | Importing the module crashes the app before React mounts. |
| Solution | Use `import.meta.env.VITE_ALLOW_MOCK_LIVE === '1'`, and only after R-14. If demo mode is retained, gate it behind an explicit build flag and keep the DEMO DATA badge. |
| Dependencies | R-03. |
| Regression risk | Low. |
| Tests | `tsc` zero; a browser smoke test that the Atlas route mounts. |
| Owner | Claude |
| Approval | Required. |

---

## P1 — Core functionality (real data flow)

### R-07 · Stop rewriting observation time

| Field | Value |
| --- | --- |
| Problem | `alignLiveToRealtime` adds `daysDiff·86400 s` to every fire and every per-day bucket, and overwrites `generatedAt`. |
| Files | `src/lib/data.ts:233-290` (call at 313), `src/lib/countries.ts:74-117` |
| Why | Historical detections are presented as current; this is the single most damaging provenance defect. |
| Solution | Delete the shift. Render the true snapshot window. If a "today" framing is required, show it as **"snapshot age: N days"** and never move a timestamp. Keep the observation time immutable from ingestion to pixel. |
| Dependencies | R-03. |
| Regression risk | **High** — many UI strings and tests assume `windowEnd ≈ today`; the calendar's default range and the `LIVE: {today}` badge will visibly change. Land with R-08 and R-10 in one PR. |
| Tests | Unit: given a bundle ending 2026-11-02 and today 2026-11-14, every `fires[i][5]` is unchanged; `meta.windowEnd` unchanged; a visible "12 days old" label. |
| Owner | Qoder (UI consequences) + Claude (data layer) |
| Approval | **Required** — user-visible change. |

### R-08 · Separate wall-clock time from snapshot end

| Field | Value |
| --- | --- |
| Problem | `store.today = live.meta.windowEnd`; after R-07 this would make the app look frozen. |
| Files | `src/lib/store.tsx:256`, `AreaBar.tsx:177`, `Atlas.tsx:87` |
| Why | The UI needs both facts and must not conflate them. |
| Solution | Expose `today` (wall clock) and `dataThrough` (snapshot) separately. Print both: "Today 2026-11-14 · data through 2026-11-02". |
| Dependencies | R-07. |
| Regression risk | Medium. |
| Tests | e2e asserts both strings appear and differ when stale. |
| Owner | Qoder |
| Approval | Required. |

### R-09 · Surface load failure honestly

| Field | Value |
| --- | --- |
| Problem | `emptyMeta()` always sets `windowStart`, so the guard `kept === 0 && !windowStart` never fires. |
| Files | `src/lib/data.ts:326-338`, `src/lib/store.tsx:276` |
| Why | A failed fetch renders a silent empty app. |
| Solution | Return an explicit `{ ok: false, error }` from `loadLiveBundle`, or add a boolean `failed` to meta. Render the existing retry path. |
| Dependencies | R-07. |
| Regression risk | Low. |
| Tests | Force a 500 on `live_fires.json` and assert the error state + retry button. |
| Owner | Claude |
| Approval | Required. |

### R-10 · Truthful status badges

| Field | Value |
| --- | --- |
| Problem | `LIVE` shows for `offline`, and unconditional `LIVE:`/`LIVE FIRMS WINDOW` badges print regardless of state. |
| Files | `src/components/LiveMap.tsx:413-417`, `src/components/AreaBar.tsx:177`, `src/pages/Atlas.tsx:87` |
| Why | The badge is the user's only provenance signal. |
| Solution | Map status → label: `live`→"LIVE", `stale`→"STALE · <age>", `offline`→"OFFLINE", `not_configured`→"NOT CONFIGURED", no data→"SNAPSHOT · <date>". Never show LIVE for anything but a fresh keyed response. |
| Dependencies | R-05, R-09. |
| Regression risk | Low. |
| Tests | e2e asserts the badge text per status using a stub server. |
| Owner | Qoder |
| Approval | Required. |

### R-11 · Allow MapLibre workers in the CSP

| Field | Value |
| --- | --- |
| Problem | No `worker-src`; `script-src 'self'` blocks blob workers. |
| Files | `server/api.mjs:587-588` |
| Why | The interactive map can fail to initialise under the served CSP. |
| Solution | Add `worker-src 'self' blob:;` (and confirm `child-src` fallback is unnecessary). |
| Dependencies | none. |
| Regression risk | Low; security surface grows by one scheme for workers only. |
| Tests | Load Atlas under the API-served CSP and assert no CSP violation in the console (browser-use). |
| Owner | Claude |
| Approval | Required (security header). |

### R-12 · Make `e2e` fail loudly

| Field | Value |
| --- | --- |
| Problem | `scripts/e2e.mjs` has no `process.exit`; failures and fatals exit 0. |
| Files | `scripts/e2e.mjs:1128-1146` |
| Why | The gate cannot fail, so it cannot gate. |
| Solution | Exit 1 when `failed.length > 0` or in the `catch`; keep writing the report first. |
| Dependencies | none. |
| Regression risk | Low, but CI will start reporting red. |
| Tests | Force one failing check; `echo $?` must be 1. |
| Owner | Claude |
| Approval | Required. |

### R-13 · Isolate API tests

| Field | Value |
| --- | --- |
| Problem | `api.test.mjs` and `coder-live.test.mjs` both use port 4191; default-concurrency runs collide (11 vs 5 vs 4 failures). |
| Files | `tests/api.test.mjs:11`, `tests/coder-live.test.mjs:9`, `scripts/test.mjs` |
| Why | `npm test` is non-deterministic and therefore not a gate. |
| Solution | Assign distinct ports per file (or `PORT=0` with port discovery). Optionally set `--test-concurrency=1` for API files only. |
| Dependencies | none. |
| Regression risk | Low. |
| Tests | Run the full glob 3× and require identical tallies. |
| Owner | Claude |
| Approval | Required. |

### R-14 · Keyless test variant for the live provider

| Field | Value |
| --- | --- |
| Problem | 4 tests assert a keyed 200 and can never pass without a key. |
| Files | `tests/coder-live.test.mjs:105-148` |
| Why | The suite must be green in a keyless CI. |
| Solution | Skip keyed cases when the key is absent **and** add provider tests that use `inject()` (the existing seam) to feed synthetic CSV fixtures — never synthetic fires into a served endpoint. |
| Dependencies | R-05. |
| Regression risk | Low. |
| Tests | `npm test` green with no key; provider parsing covered by fixtures. |
| Owner | Claude |
| Approval | Required. |

### R-15 · Feed the map from live data when available

| Field | Value |
| --- | --- |
| Problem | `LiveMap` draws `fires={live?.fires}` (bundle) regardless of the hook. |
| Files | `src/pages/Atlas.tsx:27,292`, `src/components/LiveMap.tsx:30-69` |
| Why | Even a correct client would not reach a map point. |
| Solution | Choose source explicitly: `status === 'live' || 'stale'` → hook data; otherwise bundle. Show which source is drawn in the footer. |
| Dependencies | R-05, R-10. |
| Regression risk | Medium — two data shapes must be normalised. |
| Tests | With an injected live payload, N map points equal the payload count; footer names the source. |
| Owner | Qoder |
| Approval | Required. |

---

## P2 — Scientific correctness

### R-16 · Re-implement the daily-cycle layer

| Field | Value |
| --- | --- |
| Problem | `dailyCycleWeight`, `applyDailyCycleCorrection`, `archiveRatioWithDailyCycle` are lost; the UI still claims them. |
| Files | `src/lib/archive.ts` (new functions), `src/lib/data.ts:51-53, 1920, 2016`, `tests/science.test.mjs` |
| Why | The product advertises a correction it does not perform. |
| Solution | Re-derive from the surviving contracts: 24 UTC-hour bins from overlap acquisitions, triangular smoothing, normalise to unit integral, evaluate at 13.5 h (already `VIIRS_REFERENCE_HOUR`), and express k as `kBase / weight(13.5) / weight(actual)`. If the science is not agreed, **remove the claim** and delete the dead code (this is a legitimate alternative). |
| Dependencies | R-03 (which must not "fix" this by deletion unless the owner chooses that path). |
| Regression risk | **High** — changes every harmonised number if the correction is non-unity. |
| Tests | New `tests/daily-cycle.test.mjs`: uniform fallback under <6 bins; unit integral; monotone response to a known diurnal fixture; k changes by the expected factor. Recapture goldens deliberately. |
| Owner | Codex (science) + Claude (implementation) |
| Approval | **Required** — scientific method change. |

### R-17 · Gate short-window bridge ratios

| Field | Value |
| --- | --- |
| Problem | `useAreaK` accepts a k from 2–8 days because it counts detections, not days. |
| Files | `src/lib/data.ts:524, 843, 848` |
| Why | Seasonal bias re-enters through the live path despite the 365-day archive guard. |
| Solution | Require a minimum number of **both-lane days** (e.g. ≥ 60) plus a season-coverage check; otherwise fall back to country-window/pilot prior and label the source `area-short-window`. |
| Dependencies | none. |
| Regression risk | Medium — several regions will change k and therefore every count. |
| Tests | Unit: a 7-day window must not yield `kSource:'area'`; a synthetic 120-day both-lane window may. |
| Owner | Codex |
| Approval | **Required** — changes displayed numbers. |

### R-18 · Compute a real bridge CI

| Field | Value |
| --- | --- |
| Problem | `ratioLo/Hi` are `k·0.8` / `k·1.2`. |
| Files | `src/lib/data.ts:2016-2017` |
| Why | A placeholder presented as an interval is a false precision claim. |
| Solution | Reuse the `biasXray` standard-error construction (`data.ts:1829`) or a year-clustered bootstrap; if neither is available, print "interval not estimated" rather than ±20%. |
| Dependencies | R-16 (the function is currently dead; fix before wiring). |
| Regression risk | Low while dead; medium if surfaced. |
| Tests | Interval narrows as days grow; contains k; excludes zero. |
| Owner | Codex |
| Approval | Required. |

### R-19 · Replace bbox membership with polygons

| Field | Value |
| --- | --- |
| Problem | Fire counting uses bounding boxes; drawn areas become circles. |
| Files | `src/lib/data.ts:613, 2043, 2055`; `src/data/regions.json`; `src/lib/geometry.ts:198-201` |
| Why | Counts include fires outside the named area and lose shape. |
| Solution | Add true polygons for the seven pilots (Natural Earth or hand-digitised), use `pointInRing` for membership, and keep the circle only as a display fallback. |
| Dependencies | None technically; needs owner-provided geometry. |
| Regression risk | **High** — every regional number moves. |
| Tests | Geometry tests for known in/out points; count deltas recorded and explained. |
| Owner | Integration lead (data) + Claude (code) |
| Approval | **Required**. |

### R-20 · Subtract holes in area

| Field | Value |
| --- | --- |
| Problem | `polygonAreaKm2` adds hole rings. |
| Files | `src/lib/geometry.ts:66-82` |
| Why | Area is overstated for any polygon with holes. |
| Solution | Use signed area with a consistent winding order; subtract inner rings. |
| Dependencies | none. |
| Regression risk | Low for the seven pilots (no holes); correct for drawn areas. |
| Tests | A square with a square hole equals outer − inner. |
| Owner | Claude |
| Approval | Required. |

### R-21 · Make missing weather explicit

| Field | Value |
| --- | --- |
| Problem | `p30 += dd.p ?? 0` treats unobserved rain as zero; missing climatology yields `dry = 0`. |
| Files | `src/lib/weather.ts:109-111` |
| Why | Silent imputation biases the stress index. |
| Solution | Track `p30Days` observed; require ≥ N days before computing a 30-day total; otherwise mark stress as unavailable for that date and let the caller label it. |
| Dependencies | none. |
| Regression risk | Medium — stress changes where coverage is thin. |
| Tests | A date with 40% missing rain must not produce a stress value; a full-coverage date is unchanged. |
| Owner | Codex |
| Approval | Required. |

### R-22 · Add a non-vegetation mask

| Field | Value |
| --- | --- |
| Problem | No land-cover filtering; flares, volcanoes and industrial heat enter the counts. |
| Files | ingestion (`scripts/build-data.mjs`), `src/lib/data.ts` |
| Why | "Fire detections" is currently "thermal anomalies". |
| Solution | Apply a static MODIS/VIIRS land-cover or known-flare mask at ingestion, or at minimum publish the excluded-class counts. |
| Dependencies | A land-cover product (asset, not a credential). |
| Regression risk | **High** — counts drop, possibly materially. |
| Tests | Known flare coordinates are excluded; a known wildfire is retained. |
| Owner | Codex |
| Approval | **Required** — changes headline numbers. |

### R-23 · Fix analog year-end truncation

| Field | Value |
| --- | --- |
| Problem | The 27-day forward outcome is restricted to the candidate's own year (`sumInYear`), truncating December windows. |
| Files | `src/lib/data.ts:1598-1602` |
| Why | Outlook under-reports for late-year windows. |
| Solution | Span across the year boundary using the full record index. |
| Dependencies | none. |
| Regression risk | Low. |
| Tests | A 20 Dec anchor returns 27 days, not 11. |
| Owner | Codex |
| Approval | Required. |

---

## P3 — Product quality

| ID | Problem | Files | Solution | Tests | Owner |
| --- | --- | --- | --- | --- | --- |
| R-24 | FR-06: no date input; `setRange` unused | `src/lib/store.tsx:418`, Atlas/Watch headers | Add a date-range control bound to `setRange`, honouring the URL hash | e2e sets a range and asserts the record window changes | Qoder |
| R-25 | FR-13: comparison calendars use independent scales | `src/components/charts.tsx:93-101`, `Atlas.tsx:180-198` | Add an optional `scaleMax` prop; pass the harmonised max to the raw panel | Unit: both panels use the same `max` | Qoder |
| R-26 | No error boundary | `src/App.tsx` | Add a route-level boundary with a retry that calls `resetLiveBundle()` | Force a render throw; app shows a recoverable state | Qoder |
| R-27 | Method copy overclaims | `src/pages/Method.tsx:11,115` | Replace "53k live points"/"real rolling public CSV"/"zero backend" with the true snapshot date and count | Copy review + e2e string assertion | Qoder |
| R-28 | PDF hard-coded creation date | `src/lib/pdf.ts:76` | Use the real build/export time | PDF metadata inspection | Qoder |
| R-29 | Stale/incorrect completion docs | `docs/COMPLETION_*.md`, `docs/DATA_FRESHNESS_REPORT.md`, `docs/TEST_RESULTS.md` | Mark superseded; correct the false freshness and test-count claims, or delete with owner approval | none (docs) | Integration lead |

All P3 items require owner approval before merge.

---

## P4 — Deployment and operations

| ID | Problem | Files | Solution | Tests | Owner |
| --- | --- | --- | --- | --- | --- |
| R-30 | Live cache lost on deploy | `render.yaml`, `server/live.mjs:46` | Add a Render disk mounted at `data_raw`, or persist to object storage | Deploy twice; last-good survives | Integration lead |
| R-31 | Dockerfile never executed | `Dockerfile` | Run `docker build .` on a host with an engine; fix whatever fails | Container `/api/v1/ready` 200 | Integration lead |
| R-32 | `secret-scan` blind spot | `scripts/secret-scan.mjs:21-41` | Add hex-token and `*_MAP_KEY` patterns; test with a planted dummy | Scanner fails on the dummy, passes on the tree | Claude |
| R-33 | "API starts" used as build proof | docs, CI | Make `npm run build` the gate; `api:build` alone is not a proof | CI runs `tsc -b` before `api:build` | Integration lead |
| R-34 | No observability on live refresh | `server/live.mjs` | Log per-source ok/latency/count; expose counters on `/metrics` when a token is set | `/metrics` shows refresh age and per-source status | Claude |
| R-35 | No accessibility gate | `scripts/e2e.mjs` | Add an automated axe pass on the six routes | Zero critical violations | Qoder |

---

## Ownership summary

| Owner | Items |
| --- | --- |
| **Claude** | R-02, R-03, R-04, R-05, R-06, R-09, R-11, R-12, R-13, R-14, R-20, R-32, R-34 |
| **Codex** | R-16, R-17, R-18, R-21, R-22, R-23 |
| **Qoder** | R-07 (UI half), R-08, R-10, R-15, R-24, R-25, R-26, R-27, R-28, R-35 |
| **Integration lead** | R-01, R-19, R-29, R-30, R-31, R-33 |

## Approval gates

Every item above requires explicit owner approval. Items marked **Required** in bold additionally
change credentials, exported analytics, displayed numbers, or scientific method, and should not
proceed on an agent's judgement alone.

**No roadmap item has been started. This document is a proposal.**
