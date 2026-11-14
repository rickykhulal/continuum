# Continuum — Current State Freeze (2026-11-14)

**Phase**: 0 — read-only audit
**Role**: Full-stack technical lead
**Audit date**: 2026-11-14
**Repository**: `C:\Users\Ricky\Desktop\NASA HACKATHON`
**Status vocabulary**: verified / partial / not verified / blocked (see `AGENTS.md`)

This document freezes the repository as observed. It records what exists, what was
measured, and what was **not** touched. It is evidence for planning, not a repair
report. No application source, dataset, bundle, generated evidence or deployment
configuration was modified while producing it.

---

## 1. Freeze coordinates

| Item | Value |
| --- | --- |
| HEAD commit | `b81a57d13f9129d09df65b6474fe78dab1458d2f` |
| Branch | `coder/live-data` |
| Upstream | none configured for this branch |
| Tracked files modified | 8 |
| Untracked files | 24 |
| Working tree diffstat | 984 insertions(+), 323 deletions(−) across 8 tracked files |

The tree was re-read at the end of the audit and matched these coordinates; no
drift was observed during Phase 0.

### 1.1 Modified tracked files (working tree vs HEAD)

```
docs/api-smoke-report.json   | 252 +---------------------
docs/e2e-report.json         | 481 +++++++++++++++++++++++++++++++++++-
docs/validation-report.json  |   2 +-
docs/validation.md           |  23 +++
scripts/secret-scan.mjs      | 259 +++++++++++++++++-------
server/api.mjs               |  14 +-
src/components/LiveMap.tsx   |  55 ++++-
src/lib/data.ts              | 221 ++++++++++++++++++++
```

Two of these (`docs/api-smoke-report.json`, `docs/validation-report.json`) were
already altered by earlier verification commands and were preserved, not restored.
The other six carry working-tree state whose provenance this phase did not
establish; they were left untouched.

### 1.2 Untracked files

```
audit-report.md
docs/AGENT_FINDINGS_RECONCILIATION.md
docs/CLAUDE_RUNTIME_AUDIT.md
docs/CODEX_SCIENCE_AUDIT.md
docs/CODEX_SCIENCE_AUDIT_2026-11-14.md
docs/COMPLETION_BASELINE.md
docs/COMPLETION_REPORT.md
docs/CONTINUUM_GIT_AND_FILE_INTEGRITY_2026-11-14.md
docs/CONTINUUM_IMPLEMENTATION_ROADMAP_2026-11-14.md
docs/CONTINUUM_LIVE_DATA_AUDIT_2026-11-14.md
docs/CONTINUUM_MASTER_TECHNICAL_AUDIT_2026-11-14.md
docs/CONTINUUM_RECONCILIATION_CORRECTIONS_2026-11-14.md
docs/CONTINUUM_SCIENTIFIC_VALIDATION_AUDIT_2026-11-14.md
docs/CONTINUUM_SECURITY_AND_EVIDENCE_FOLLOWUP_2026-11-14.md
docs/CONTINUUM_SECURITY_REMEDIATION_REPORT_2026-11-14.md
docs/DATA_FRESHNESS_REPORT.md
docs/P0_REPAIR_REPORT.md
docs/QODER_PRODUCT_AUDIT.md
docs/TEST_RESULTS.md
docs/project-audit-2026-11-13.md
server/live.mjs
src/lib/liveClient.ts
tests/coder-live.test.mjs
tests/secret-scan.test.mjs
```

Consequence for the roadmap: the two files that carry the live lane
(`src/lib/liveClient.ts`, `server/live.mjs`) are **untracked**. They exist on disk
and are served/built, but they are not in Git history. Nothing in this phase added
or committed them.

---

## 2. Frozen file inventory

Size in bytes, SHA-256 prefix (16 hex chars), and mtime as observed. A `MISSING`
marker means the file was expected by the audit brief but is absent.

| File | Bytes | SHA-256 (16) | mtime | Git state |
| --- | --- | --- | --- | --- |
| `src/lib/liveClient.ts` | 9,069 | `967f722964c8cc27` | 2026-11-14 11:13:37 | untracked |
| `src/components/LiveMap.tsx` | 17,072 | `a939833ba184241d` | 2026-11-13 19:39:23 | modified |
| `src/lib/data.ts` | 89,341 | `074a2213c804df85` | 2026-11-13 21:35:21 | modified |
| `src/lib/archive.ts` | 10,715 | `590dbe26e59762db` | 2026-11-14 11:13:26 | matches HEAD |
| `src/lib/store.tsx` | 19,380 | `79cf9eb4ee7edd5b` | 2026-11-12 21:30:04 | matches HEAD |
| `src/lib/geometry.ts` | 7,867 | `b4016ff3c9705cd9` | 2026-11-01 12:50:05 | matches HEAD |
| `src/lib/weather.ts` | 8,497 | `5dead847b302b34f` | 2026-10-31 12:41:01 | matches HEAD |
| `src/lib/export.ts` | 7,475 | `6bb2bb3a4b6eebdc` | 2026-11-13 17:15:18 | matches HEAD |
| `src/lib/countries.ts` | 20,006 | `d3907393c10a5f81` | 2026-11-12 10:36:16 | matches HEAD |
| `server/api.mjs` | 49,097 | `55de47f040f24d03` | 2026-11-13 19:45:18 | modified |
| `server/live.mjs` | 13,682 | `3f9ad3269919ccdd` | 2026-11-14 11:15:55 | untracked |
| `scripts/e2e.mjs` | 76,362 | `18993cab9560fe63` | 2026-11-04 09:38:34 | matches HEAD |
| `scripts/test.mjs` | 818 | `1398b1d801287137` | 2026-11-01 12:49:25 | matches HEAD |
| `scripts/secret-scan.mjs` | 8,999 | `a774cdcb5d6c4b80` | 2026-11-14 12:04:09 | modified |
| `tests/secret-scan.test.mjs` | 4,976 | `6611820eb3960c9c` | 2026-11-14 12:03:30 | untracked |
| `tests/api.test.mjs` | 14,731 | `f0dad754374ef4cd` | 2026-11-13 17:54:30 | matches HEAD |
| `tests/coder-live.test.mjs` | 7,014 | `23d7ad4e5c46d8b9` | 2026-11-13 20:56:22 | untracked |
| `tests/bundle.test.mjs` | 7,068 | `9dece036c15326f1` | 2026-11-03 16:54:27 | matches HEAD |
| `tsconfig.json` | 107 | `e8d6f7b50828db39` | 2026-10-31 12:08:45 | matches HEAD |
| `tsconfig.app.json` | 510 | `83672d2660de080f` | 2026-10-31 12:08:45 | matches HEAD |
| `package.json` | 1,911 | `4ba78f4cd632d74c` | 2026-11-13 17:15:18 | matches HEAD |
| `render.yaml` | 2,924 | `f21e0d8a74af702c` | 2026-11-03 16:36:04 | matches HEAD |
| `Dockerfile` | 2,692 | `ef382e5efeb53484` | 2026-11-01 13:19:20 | matches HEAD |

---

## 3. Build and type-check baseline — verified

### 3.1 Root `tsc --noEmit` is a no-op

`tsconfig.json` is solution-style: `"files": []` plus project references. Running
`tsc --noEmit` at the root therefore checks nothing and exits 0. **A green root
type-check is not evidence that the app type-checks.** The real gate is
`tsc -p tsconfig.app.json` (or `tsc -b`), which `npm run build` invokes.

### 3.2 The real type-check fails — verified, exit 2, exactly 16 errors

```
src/components/LiveMap.tsx(54,11): TS2339: Property 'status' does not exist on type 'void'.
src/components/LiveMap.tsx(54,32): TS2339: Property 'data' does not exist on type 'void'.
src/components/LiveMap.tsx(57,18): TS2367: comparison 'DataSource' vs '"stale"' has no overlap.
src/components/LiveMap.tsx(58,21): TS2345: 'DataSource' not assignable to transport-status state.
src/lib/data.ts(51,3):   TS2305: './archive' has no exported member 'dailyCycleWeight'.
src/lib/data.ts(52,3):   TS2305: './archive' has no exported member 'applyDailyCycleCorrection'.
src/lib/data.ts(53,3):   TS2305: './archive' has no exported member 'archiveRatioWithDailyCycle'.
src/lib/data.ts(1920,50):TS2304: Cannot find name 'archiveRatioWithDailyCycle'.
src/lib/data.ts(1943,9): TS2502: 'monthlyStatus' referenced in its own type annotation.
src/lib/data.ts(1964,9): TS2502: 'sensitivity' referenced in its own type annotation.
src/lib/data.ts(2005,27):TS7006: Parameter 's' implicitly has an 'any' type.
src/lib/data.ts(2006,77):TS7006: Parameter 's' implicitly has an 'any' type.
src/lib/data.ts(2031,29):TS2339: 'apparentDays' does not exist on type 'SandboxResult | {...}'.
src/lib/data.ts(2032,30):TS2339: 'correctedDays' does not exist on type 'SandboxResult | {...}'.
src/lib/liveClient.ts(94,19):TS2345: 'DataSource' not assignable to transport-status state.
src/lib/liveClient.ts(130,32):TS2580: Cannot find name 'process'.
```

Because `npm run build` is `tsc -b && vite build`, the build stops at `tsc -b` and
Vite never runs. The API is built by a separate esbuild step (`api:build`) that does
not type-check, so "the API starts" is not evidence that the app builds.

### 3.3 Error classification

| Class | Errors | Owner |
| --- | --- | --- |
| Live hook / caller contract | LiveMap 54×2, 57, 58; liveClient 94 | Qoder |
| Browser `process.env` | liveClient 130 | Qoder |
| Missing daily-cycle exports | data.ts 51–53, 1920 | Codex (decision + impl) → Qoder (re-export wiring) |
| Dead validation-report code | data.ts 1943, 1964, 2005, 2006, 2031, 2032 | Codex |

`src/lib/archive.ts` was inspected: it exports 15 symbols (`ArchiveCell`,
`ArchiveBundle`, `ARCHIVE_START`, `dayIndex`, `indexDate`, `attachArchive`,
`archiveLoaded`, `archiveStamp`, `ArchiveCoverage`, `archiveCoverage`,
`archiveStatus`, `ArchiveDayHit`, `archiveDay`, `archiveSupplementary`,
`ConstellationWeights`, `constellationWeights`, `constellationSource`,
`platformEquivalent`, `archiveRatio`) and **none** of the three daily-cycle symbols.
The missing layer is not recoverable from the current tree.

---

## 4. Data identifiers frozen with this snapshot

| Artifact | Value |
| --- | --- |
| Bundle version | `continuum-2026-11-02-920de0617606` |
| Bundle window | 2026-10-26 → 2026-11-02 |
| Manifest counts | totalQuality 966,066 · kept 71,882 · region 50,072 · globalSampled 21,810 |
| Sensors | 4 |
| Manifest files | 20 |
| `live_fires.json` | generatedAt `2026-11-02T15:18:25.202Z`, 71,882 fires |
| Archive | `continuum-archive-1`, generated_at `2026-11-02T15:18:09.299Z`, 9,822 requests, 4,066,557 rows, 7 regions |

These identifiers are the only ones any later report may cite. A roadmap item that
changes them must say so explicitly.

---

## 5. Runtime contract probe — verified (read-only)

The API was started on an isolated port (`8899`) against the frozen bundle and then
stopped. No report file was regenerated.

| Request | Result | Interpretation |
| --- | --- | --- |
| `GET /api/v1/health` | 200 `application/json` | API healthy; `/api/v1` prefix is stripped and routed |
| `GET /live-firms` | 503 `application/json` (`not_configured`) | Route exists; no `FIRMS_MAP_KEY` in this environment |
| `GET /api/v1/live-firms` | 503 `application/json` (`not_configured`) | Prefix + live route works |
| `GET /api/live-firms` | **200 `text/html`** | **No such API route** — the SPA static fallback answered |

Startup log confirmed: bundle `continuum-2026-11-02-920de0617606`, integrity PASS,
metrics disabled, live provider not configured.

**Contract conclusion:** the browser hook calls `/api/live-firms`
(`src/lib/liveClient.ts:72`) but the server exposes `/live-firms` and
`/api/v1/live-firms` (`server/api.mjs:491`, prefix handling at 718 and 853–860).
The client's request is answered by the SPA fallback, not by the live provider. The
hook then parses HTML as JSON, throws, and can never reach the live branch for the
right reason.

---

## 6. Source-level findings frozen (not fixed)

Each item is a source inspection of the frozen snapshot. Runtime behavior beyond the
route probe above is **not verified**.

### 6.1 Live lane

- `src/lib/liveClient.ts:61–114` — `useLiveFirms` returns nothing; the component
  destructures `{ status, data }` from it (`LiveMap.tsx:54`).
- `src/lib/liveClient.ts:72` — requests `/api/live-firms` (see §5).
- `src/lib/liveClient.ts:85–94` — every success is labelled `'live'`, and
  `lastResult.current.status` is reused after a failure; the server's `stale` flag
  is never read.
- `src/lib/liveClient.ts:130` — `process.env.ALLOW_MOCK_LIVE` evaluated in browser
  code.
- `src/components/LiveMap.tsx:55–59` — callbacks update only status/time labels;
  `regionPoints` still derive from the original `fires` prop (67–69), so refreshed
  points never reach the map or analytics.
- `src/components/LiveMap.tsx:413–417` — badge branch renders for `offline` as well.
- `server/live.mjs:177–209` — `refresh` mutates shared `perSatelliteCounts` (191)
  before the whole-window swap (197); `all.push(...tuples)` (192) risks an argument
  limit on a large feed; thrown errors go through `finally` (209), bypassing the
  explicit stale branch (201–204).
- `server/live.mjs:304` — `getResponse` returns the stored `stale` flag without
  recomputing age.
- `server/api.mjs:587–588` — CSP has no `worker-src`/`child-src`; MapLibre GL uses
  a web worker.
- `server/api.mjs:881` — static fallback returns 200 HTML for unknown paths,
  including unknown `/api/*` paths.

### 6.2 Observation date and provenance parity

- `src/lib/data.ts:233–287` — `alignLiveToRealtime` shifts days by
  `daysDiff * 86400` and stamps `generatedAt: new Date().toISOString()` (279), so
  the payload carries a fresh timestamp over shifted historical data.
- `src/lib/data.ts:295–320` — `loadLiveBundle` fetches `data/live_fires.json`,
  climate and archive, then aligns.
- `src/lib/countries.ts:74–118` — `alignCountryFiresToRealtime` shifts days, window
  and per-day maps; applied at line 128.
- `server/api.mjs:52` — API reads stored JSON directly and hydrates unshifted
  country data (63–68); analytics use the startup live object (223).
- `src/lib/store.tsx:256` — `today = live?.meta.windowEnd ?? isoDate(new Date())`;
  guard at 276/300 for an empty window.

Consequence: the same selected area can carry different dates and freshness across
browser, API and store.

### 6.3 Scientific computations

- `src/lib/data.ts:1366` — `statusFor` uses month-to-date semantics.
- `src/lib/data.ts:1340` — `monthComparison` sorts history by **value** (highest-N
  selection), not by date/recency.
- `src/lib/data.ts:1563` — `twinAnalogs` builds `yStart`/`yEnd` from the same year,
  producing Dec–Jan windows; the backtest lacks the 80% gate described by the PRD.
- `src/lib/data.ts:1901` — `generateValidationReport` has no callers and carries
  the unresolved symbols in §3.2; `ratioLo: k*0.8 // placeholder` sits near 2016.
- `src/lib/data.ts:1688` — shared `analogDeparture` uses a **median**, while
  `src/pages/Brief.tsx:28` computes an arithmetic mean and the copy at lines 46 and
  173 calls it a median.
- `src/lib/weather.ts:77,114` — missing precipitation is coerced to 0; humidity
  missingness contributes a fixed 0.3 dry-air term (120); regression (125–140) uses
  harmonized records without excluding reconstruction; `offlineWeather` (219–231)
  fits a relationship against its own sinusoidal series; the load cache key (43)
  omits record identity.
- `src/lib/archive.ts` — constellation weights gated on 30 days, bridge ratio with
  `MIN_BRIDGE_DAYS=365`, calibration `MIN_AREA_OVERLAP_MODIS=30`; `provenanceMix`
  exists. These rules are implemented but their empirical stability is not
  demonstrated in this snapshot.

### 6.4 Geometry and exports

- `src/lib/geometry.ts:67–78` — `polygonAreaKm2` adds the absolute area of every
  ring, so holes are **added** rather than subtracted.
- `src/lib/geometry.ts:162–190` — `inspectGeometry` does not detect
  self-intersections.
- `src/lib/geometry.ts:198` — `geometryToCircle` replaces a polygon with a
  centroid/equal-area circle without marking the result as an approximation.
- `src/lib/data.ts:613` — `observeArea` filters by bounding box, not polygon
  membership.
- `src/data/places.ts:76` — `customRegion` derives the same id for different radii
  and does not retain `radiusKm`.
- `server/api.mjs:223` — the analytics cache keys on id, center and
  `region.radiusKm`, so different radii at one center can collide.
- `src/lib/export.ts:35–40` — `exportCSV` labels a column
  `harmonized_viirs_equiv` but fills it from `dailyValue` in the selected mode, so
  raw mode can populate a harmonized-labelled column with raw values.
- `src/lib/export.ts:51` — `hotspotsInWindow` uses bbox membership over a sampled
  point set; the export does not state that the set is partial.
- `server/api.mjs:285` — calendar output emits selected metric/mode values beside
  `r.lo`/`r.hi`, which are harmonized hotspot bounds.

### 6.5 Test and evidence integrity

- `scripts/e2e.mjs` — no `process.exit` anywhere (only `console.log` at 1135 and
  1139); a failing sweep can still exit 0.
- `tests/api.test.mjs:11` and `tests/coder-live.test.mjs:9` — both default
  `PORT = 4191`, so concurrent runs collide.
- `tests/bundle.test.mjs:57–76` — runs `scripts/bundle.mjs` and restores the
  manifest in `finally`; a full test run rewrites the manifest mid-run.
- `scripts/test.mjs` — discovers all `tests/*.test.mjs` (11 files) and runs one
  `node --test`; it does not isolate ports or generated files.

---

## 7. Evidence report inventory (as frozen)

All nine reports named by the audit brief exist:

| Report | State |
| --- | --- |
| `docs/CODEX_SCIENCE_AUDIT_2026-11-14.md` | present, 539 lines |
| `docs/CODEX_SCIENCE_AUDIT.md` | present, 420 lines |
| `docs/CONTINUUM_MASTER_TECHNICAL_AUDIT_2026-11-14.md` | present |
| `docs/CONTINUUM_LIVE_DATA_AUDIT_2026-11-14.md` | present |
| `docs/CONTINUUM_SCIENTIFIC_VALIDATION_AUDIT_2026-11-14.md` | present |
| `docs/CONTINUUM_GIT_AND_FILE_INTEGRITY_2026-11-14.md` | present |
| `docs/CONTINUUM_RECONCILIATION_CORRECTIONS_2026-11-14.md` | present |
| `docs/P0_REPAIR_REPORT.md` | present, 6,603 B |
| `docs/CONTINUUM_SECURITY_REMEDIATION_REPORT_2026-11-14.md` | present |

No report was regenerated, restored, or overwritten in this phase.

### 7.1 Known stale claim

`docs/P0_REPAIR_REPORT.md` states `npm run build` → PASS and presents a `git diff`
of `src/lib/liveClient.ts`. Both are contradicted by the frozen snapshot: the
type-check fails with 16 errors (§3.2), and `src/lib/liveClient.ts` is untracked,
so it cannot appear in `git diff`. This document is left as-is and the discrepancy
is carried into the roadmap.

---

## 8. Explicitly outside this snapshot

- No live FIRMS credential is present in the environment; live behavior beyond the
  503 path is **not verified**.
- No deployment was executed; `render.yaml` and `Dockerfile` are inspected, not run.
- Browser rendering, MapLibre worker behavior, and TLE propagation were not
  exercised.
- No unit/contract/E2E suite was run in Phase 0, because several of them write to
  generated evidence (`tests/bundle.test.mjs`) or require a live key.
