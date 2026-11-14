# Qoder Desktop — Frontend & Product Audit

**Agent**: Qoder Desktop (frontend / product track)
**Mode**: Read-only audit. No application source, package file, configuration, generated dataset, existing report, build artifact, branch or git state was modified by this audit.
**Branch observed**: `coder/live-data` @ `b81a57d`
**Evidence captured**: 2026-11-14 (local working tree)
**Scope**: Frontend architecture, six product sections, navigation, globe and satellite interface, UX, exports, PRD traceability, deployment architecture

---

## 0. Evidence discipline and baseline

### 0.1 Rule applied to every statement below

- **EXECUTED** — a command was run by this audit and its output is quoted.
- **SOURCE-INSPECTION** — the file was read at the stated path/line; the claim is about source text, not about observed app behaviour.
- No feature is called working because a component exists. Where the tree cannot build, runtime behaviour is stated as source-derived and labelled as such.
- Vocabulary follows `AGENTS.md`: **verified**, **partial**, **not verified**, **blocked**.

### 0.2 Commands executed for this report

| Check | Command | Output |
| --- | --- | --- |
| App typecheck | `npx tsc -p tsconfig.app.json --noEmit --incremental false` | **16 errors** (`LiveMap.tsx` 4, `data.ts` 10, `liveClient.ts` 2), exit 2 |
| Root "typecheck" | `npx tsc --noEmit` | exit 0 — **checks nothing**: `tsconfig.json` has `"files": []` and only project references |
| API module parse | `node --check server/live.mjs` | exit 0 (parses; the earlier duplicate `resetForTest` is gone) |
| Tracked state | `git status --porcelain` | 7 modified files, 12 untracked (see 0.3) |
| `liveClient.ts` in HEAD | `git cat-file -e HEAD:src/lib/liveClient.ts` | exit 128 — absent from git |
| `archive.ts` in HEAD | `git show HEAD:src/lib/archive.ts \| grep -c '^#'` | `0` (the ten JS private-field lines seen earlier are gone) |
| Bundled live snapshot | read `public/data/live_fires.json` | `generatedAt 2026-11-02T15:18:25.202Z`, window `2026-10-26 → 2026-11-02`, `fires` 71,882 |
| Build artifact age | `ls -l dist/index.html` | 2026-11-13 17:38 — **older than the current source edits** |
| Last recorded browser sweep | read `docs/e2e-report.json` | `fatal: TypeError: Cannot read properties of null (reading 'focus')`; 80 pass / 22 fail of 102 assertions |
| Textures | `ls -l public/textures` | 8K day 3,118,845 B; 8K night 1,615,537 B |

`npm run build`, `npm test`, `npm run validate`, `npm run smoke`, `npm run e2e` and the data scripts were **not** run by this audit: they write `dist/`, `docs/*.json` or the data bundle, which the read-only protocol forbids modifying. Their last recorded results live in `docs/validation.md`, `docs/e2e-report.json` and `docs/api-smoke-report.json`.

### 0.3 Tree state at capture

```
 M docs/api-smoke-report.json
 M docs/e2e-report.json
 M docs/validation-report.json
 M docs/validation.md
 M server/api.mjs
 M src/components/LiveMap.tsx
 M src/lib/data.ts
?? server/live.mjs
?? src/lib/liveClient.ts
?? tests/coder-live.test.mjs
```

The tree changed **during** the audit window: `src/lib/archive.ts` was restored and `server/live.mjs` was rewritten between the earlier snapshot and this capture. Findings below describe the tree as captured; findings recorded in `docs/validation.md` (TS1144 in `liveClient.ts`, duplicate `resetForTest`) were **not** reproducible at capture and are marked accordingly, not repeated as facts.

### 0.4 Consequence for every UI claim

The application project does not typecheck (Q-01…Q-04). `npm run build` is `tsc -b && vite build` over the same `src` include set, so **the current tree cannot produce a new production bundle**. `dist/` on disk is from 2026-11-13 17:38 and predates these edits. Any statement about rendered UI below is source inspection of a tree that does not build.

---

## 1. Executive summary

1. **The live-data path is non-functional end to end.** The client calls a URL no route matches, the hook returns nothing, the component that consumes it crashes on destructuring, the mock gate references a browser-undefined global, and the server module that would serve the data is untracked. Seven of the critical/high live-path findings are in §2.B.
2. **Every LIVE surface is driven by one static bundle.** `live_fires.json` was generated 2026-11-02 and ends its window that day; at capture the wall clock is 2026-11-14. The nav, area bar, Atlas badge and Watch dock nevertheless print LIVE, and `store.today` is defined as the bundle's `windowEnd`, so the app's "today" is 12 days behind.
3. **Failure is silent.** The bundle loader's catch fabricates a seven-day window (`emptyMeta()`), which makes the store's own error condition unreachable. A failed load renders as "LIVE, zero detections" rather than an error.
4. **The documented PRD pass state is not reproducible from source.** FR-06 (date range) has no rendered control at all, and FR-13's Compare mode renders two independently scaled calendars. Both are marked PASS in `docs/production-readiness.md`.
5. **Deployment cannot boot this tree.** `server/api.mjs:11` imports `./live.mjs`, which is untracked; a git-based Render build or Docker build from a clean clone fails at import. The CSP also omits `worker-src`, which MapLibre GL needs for its blob worker.

**Finding count: 44** — Critical 6, High 17, Medium 16, Low 5.

---

## 2. Findings

### A. Build and runtime integrity

#### Q-01 — Data barrel re-exports three symbols that do not exist
- **Location**: `src/lib/data.ts:51-53`, consumer `src/lib/data.ts:1920`
- **Component**: module re-export block (`dailyCycleWeight`, `applyDailyCycleCorrection`, `archiveRatioWithDailyCycle`)
- **Problem**: `src/lib/archive.ts` exports none of the three; the re-export makes the whole data module fail to typecheck, and `archiveRatioWithDailyCycle` is also called at line 1920 where it is therefore undefined.
- **Severity**: Critical
- **Evidence**: `TS2305: Module '"./archive"' has no exported member 'dailyCycleWeight'` (same for the other two) and `TS2304: Cannot find name 'archiveRatioWithDailyCycle'` at 1920.
- **Verification**: EXECUTED (tsc), SOURCE-INSPECTION for the archive export list.

#### Q-02 — Six further type errors in the same uncommitted data block
- **Location**: `src/lib/data.ts:1943,1964,2005,2006,2031,2032`
- **Component**: `monthlyStatus` / `sensitivity` helpers and the sandbox result mapper
- **Problem**: `TS2502` self-referential type annotations (1943, 1964), `TS7006` implicit-any parameters (2005-2006), `TS2339` property access on a union that does not carry `apparentDays`/`correctedDays` (2031-2032).
- **Severity**: Critical
- **Evidence**: full tsc output as in Q-01.
- **Verification**: EXECUTED.

#### Q-03 — `LiveMap` destructures a hook that returns `void`
- **Location**: `src/components/LiveMap.tsx:54`; definition `src/lib/liveClient.ts:61-114`
- **Component**: `LiveMap` ← `useLiveFirms`
- **Problem**: `useLiveFirms` has **no return statement** (the doc comment says "Returns a cleanup function" but it returns nothing). `const { status, data } = useLiveFirms(...)` therefore destructures `undefined` at runtime. TypeScript reports two errors and the page-level effect is a `TypeError` on Atlas mount.
- **Severity**: Critical
- **Evidence**: `TS2339: Property 'status' does not exist on type 'void'` and the same for `data` at `LiveMap.tsx(54,11)`/`(54,32)`; no `return` between lines 61-114.
- **Verification**: EXECUTED (TS), SOURCE-INSPECTION (runtime consequence).

#### Q-04 — Browser module reads `process.env`
- **Location**: `src/lib/liveClient.ts:130`
- **Component**: module-scope constant `ALLOW_MOCK_LIVE`
- **Problem**: `process.env.ALLOW_MOCK_LIVE === '1'` is evaluated when the chunk is imported. There is no `process` global in the browser and `vite.config.ts` defines no shim; the expression is a ReferenceError at module evaluation. Because `LiveMap` imports this module, the Atlas route chunk rejects and the Suspense fallback never resolves. The correct Vite mechanism is `import.meta.env.VITE_*`.
- **Severity**: Critical
- **Evidence**: `TS2580: Cannot find name 'process'. Do you need to install type definitions for node?`; `vite.config.ts` contains only `base`, `plugins`, `build`.
- **Verification**: EXECUTED (TS), SOURCE-INSPECTION (runtime).

#### Q-05 — The live server module and the live client module are not in git
- **Location**: `server/live.mjs`, `src/lib/liveClient.ts` (both `??` untracked); importer `server/api.mjs:11`
- **Component**: API bootstrap
- **Problem**: `server/api.mjs` statically imports `./live.mjs`. A clean clone, a Render build from `main`, or a Docker build from a fresh checkout has no such file, so the API process fails on import before binding a port. Committing the `api.mjs` change without these two files produces a service that cannot start.
- **Severity**: Critical
- **Evidence**: `git status --porcelain` lists both as `??`; `git cat-file -e HEAD:src/lib/liveClient.ts` → exit 128.
- **Verification**: EXECUTED.

#### Q-06 — No error boundary anywhere in the shell
- **Location**: `src/App.tsx:12-17` (lazy routes), `src/App.tsx:356` (Suspense)
- **Component**: application root
- **Problem**: A lazy chunk that rejects (Q-03/Q-04) leaves the boot fallback on screen indefinitely. There is no `ErrorBoundary`, no retry affordance, and no console-to-UI escalation. Suspense covers pending, not rejected.
- **Severity**: High
- **Evidence**: `grep -rn "ErrorBoundary\|componentDidCatch" src/App.tsx src/main.tsx` → no matches.
- **Verification**: SOURCE-INSPECTION.

#### Q-07 — The project's obvious typecheck command is a no-op
- **Location**: `tsconfig.json`
- **Component**: build hygiene
- **Problem**: `"files": []` plus references means `tsc --noEmit` exits 0 without reading a single source file. It reports success on a tree with 16 real errors. Only `tsc -b` (the build script) or `-p tsconfig.app.json` sees them. Any contributor who "typechecks" this way gets a false green.
- **Severity**: High
- **Evidence**: `npx tsc --noEmit` → exit 0 / 0 errors; `npx tsc -p tsconfig.app.json --noEmit --incremental false` → 16 errors.
- **Verification**: EXECUTED.

### B. Live-data contract

#### Q-08 — Client and server disagree on the URL
- **Location**: client `src/lib/liveClient.ts:72`; server `server/api.mjs:489-497, 853-860, 881`
- **Component**: `useLiveFirms` ↔ `GET_ROUTES`
- **Problem**: the client fetches `/api/live-firms`. The route table keys are `/live-firms`, and the `/api/v1` branch strips only the `/api/v1` prefix; bare paths are matched at line 881. `/api/live-firms` matches neither, so it falls through to `serveStatic` (`server/api.mjs:614-618`), which returns `index.html` or a 404 JSON. The live endpoint can never be reached by this client.
- **Severity**: High
- **Evidence**: source lines above; no proxy in `vite.config.ts`.
- **Verification**: SOURCE-INSPECTION.

#### Q-09 — Response shape and envelope are inconsistent with the rest of the API
- **Location**: `server/live.mjs` `getResponse()`; `server/api.mjs:491-496` and `901-904`
- **Component**: `/live-firms` handler
- **Problem**: the handler returns `[status, body]` and `callGet` serialises `body` verbatim, so the payload has no `method_version`/`bundle_version`/`data_through` envelope that every other GET route adds via `envelope()` (`server/api.mjs:202-210`). The body duplicates data under both `fires` and `data`, and its `meta` has `windowStart`/`windowEnd`/`sensors` but no `generatedAt`, which the client's `LiveWindowMeta` declares as required. Consumers cannot tell which bundle the live window corresponds to.
- **Severity**: High
- **Evidence**: `getResponse()` body construction; `callGet` at 901-904; client interface at `liveClient.ts:29-41`.
- **Verification**: SOURCE-INSPECTION.

#### Q-10 — The map never reads the live array
- **Location**: `src/components/LiveMap.tsx:54, 67-69`
- **Component**: `LiveMap` `regionPoints` memo
- **Problem**: `regionPoints` is computed from the `fires` prop, which Atlas fills from `live?.fires` — the bundled snapshot (`src/pages/Atlas.tsx:27, 292`). `liveFires` from the hook is destructured and never used. Even with a working endpoint, no fetched detection would reach the map.
- **Severity**: High
- **Evidence**: `livePointsForRegion(region, fires)` at 68; `liveFires` has no second reference in the file.
- **Verification**: SOURCE-INSPECTION.

#### Q-11 — "LIVE" is shown for `offline` and `stale`
- **Location**: `src/components/LiveMap.tsx:413-417`
- **Component**: live status badge
- **Problem**: the badge renders whenever `liveStatus !== 'loading' && liveStatus !== 'not_configured'`, so a failed fetch (`offline`) and a cache-only fetch (`stale`) both print LIVE. This directly contradicts the product's own provenance rule that a non-fresh source must not carry the LIVE label, and it is the only status text the map shows.
- **Severity**: Critical
- **Evidence**: condition at 413; error handler sets `offline` at 61.
- **Verification**: SOURCE-INSPECTION.

#### Q-12 — Two independent staleness signals, one of them meaningless
- **Location**: `src/components/LiveMap.tsx:341-360`, `50`
- **Component**: bundled-snapshot reachability probe
- **Problem**: every 10 minutes the effect re-fetches `data/live_fires.json` and, on HTTP 200, clears `isStale` and resets `lastUpdated`. A reachable static file says nothing about data age. The "Telemetry Stale" badge can therefore disappear while `liveStatus` is still `offline`, and vice versa.
- **Severity**: High
- **Evidence**: effect body 342-357; `setIsStale(false)` on `res.ok`.
- **Verification**: SOURCE-INSPECTION.

#### Q-13 — Header and footer contradict each other in the same panel
- **Location**: `src/components/LiveMap.tsx:413-417` vs `521-525`
- **Component**: live map chrome
- **Problem**: the header says LIVE and the footer says "Showing N live detections in AOI" while the adjacent footer line says "Bundled FIRMS NRT snapshot · Data loaded at page load · Reload page for latest". One of these is false; the data source is the bundle.
- **Severity**: High
- **Evidence**: both strings present in the same component.
- **Verification**: SOURCE-INSPECTION.

#### Q-14 — The fetched timestamp is never displayed
- **Location**: `src/components/LiveMap.tsx:49, 56, 348`
- **Component**: `lastUpdated` state
- **Problem**: `lastUpdated` is written from the hook callback and the reachability probe but never rendered, so the required "updated N min ago" affordance does not exist.
- **Severity**: Medium
- **Evidence**: three references, all writes; no JSX use.
- **Verification**: SOURCE-INSPECTION.

#### Q-15 — Synthetic detections remain in the shipped module behind a broken gate
- **Location**: `src/lib/liveClient.ts:130-171`
- **Component**: `useMockLiveFirms`
- **Problem**: nine hardcoded `Date.now()` fires are constructed as `LiveFire` tuples. The only gate is the `process.env` expression that throws in the browser (Q-04). No component calls the hook, so the "DEMO DATA" badge at `LiveMap.tsx:412` is dead code. If the gate were repaired naively, invented detections would be renderable with no active caller path to the badge.
- **Severity**: High
- **Evidence**: mock array 142-152; `grep -rn "useMockLiveFirms" src` → definition only.
- **Verification**: SOURCE-INSPECTION.

#### Q-16 — The 7-day slider does not mean what its label says, and does not affect counts
- **Location**: `src/components/LiveMap.tsx:91-95, 362-368, 507-518`
- **Component**: day-offset filter
- **Problem**: the filter keeps points **older** than `minTime + span*dayOffset/7` — a cumulative prefix of the window — while the label reads "Day N of 7", which reads as a single day. At `7` no filtering happens at all. Separately, the sensor chip counts are computed from `regionPoints`, not `filteredPoints`, so they ignore both the slider and the sensor selection.
- **Severity**: Medium
- **Evidence**: cutoff computation 92-94; `counts` memo 362-368; label 508.
- **Verification**: SOURCE-INSPECTION.

#### Q-17 — Partial upstream failure can desynchronise counts from fires
- **Location**: `server/live.mjs` `refresh()` (`perSatelliteCounts[src.key] = tuples.length` then `if (ok && all.length > 0)`)
- **Component**: refresh cycle
- **Problem**: each successful source updates `perSatelliteCounts` immediately, but on any partial failure the previous `fires` array is kept and only `stale=true` is set. The response can therefore report per-satellite counts from the new partial fetch alongside detections from the previous window.
- **Severity**: Medium
- **Evidence**: loop mutates counts before `ok` is evaluated; the `else if (fires.length > 0)` branch keeps `fires`.
- **Verification**: SOURCE-INSPECTION.

#### Q-18 — Live I/O starts as a side effect of importing the API
- **Location**: `server/api.mjs:21`
- **Component**: module bootstrap
- **Problem**: `startLive()` runs during module evaluation, before the server listens. With a key present, any process that imports `api.mjs` — tests, scripts, tooling — begins upstream fetches and a timer. `stopLive` exists but is only exported for manual use.
- **Severity**: Medium
- **Evidence**: call at line 21; `start()` begins `refresh()` and `setInterval` in `server/live.mjs`.
- **Verification**: SOURCE-INSPECTION.

#### Q-19 — Runtime cache is outside the integrity model
- **Location**: `server/live.mjs:46, 216-217`
- **Component**: disk cache
- **Problem**: `data_raw/live_fires_cache.json` is written at runtime but is not part of `bundle_manifest.json` and is not covered by `npm run validate`. On an ephemeral host it is lost at restart, and nothing verifies its contents.
- **Severity**: Low
- **Evidence**: cache path and `writeFileSync`; manifest lists only `public/data` artefacts.
- **Verification**: SOURCE-INSPECTION.

### C. LIVE provenance across the product

#### Q-20 — "LIVE" in the navigation is a bundle-loaded boolean
- **Location**: `src/App.tsx:98-99`; `src/lib/store.tsx:256`
- **Component**: `TopNav` badge; `today` selector
- **Problem**: `store.live` is set when the static bundle parses. The nav badge maps that boolean directly to the string `LIVE`, and `today` is defined as `live?.meta.windowEnd` — so the app's "today" is the snapshot end, not the wall clock. A successfully parsed 12-day-old file is indistinguishable from a fresh fetch.
- **Severity**: High
- **Evidence**: `store.live ? 'LIVE' : 'SYNC'`; `today = live?.meta.windowEnd ?? isoDate(new Date())`.
- **Verification**: SOURCE-INSPECTION.

#### Q-21 — Area bar prints an unconditional LIVE badge with a "real-time" tooltip
- **Location**: `src/components/AreaBar.tsx:177`
- **Component**: `AreaBar`
- **Problem**: `<Badge tone="live" pulse>LIVE: {store.today}</Badge>` with `title="Real-time FIRMS observations active through …"` is rendered regardless of fetch status, freshness or provenance. `store.today` is the snapshot end (Q-20).
- **Severity**: High
- **Evidence**: line 177 verbatim.
- **Verification**: SOURCE-INSPECTION.

#### Q-22 — Atlas prints a static LIVE FIRMS WINDOW badge
- **Location**: `src/pages/Atlas.tsx:87`
- **Component**: Atlas page header
- **Problem**: `<Badge tone="live" pulse>LIVE FIRMS WINDOW</Badge>` is constant, not derived from `liveStatus`, file age or the live endpoint.
- **Severity**: High
- **Evidence**: line 87.
- **Verification**: SOURCE-INSPECTION.

#### Q-23 — The bundled snapshot is 12 days old
- **Location**: `public/data/live_fires.json`
- **Component**: data bundle
- **Problem**: `meta.generatedAt` is `2026-11-02T15:18:25.202Z` and `windowEnd` is `2026-11-02`. At capture the date is 2026-11-14. The app labels this window LIVE on Watch, Atlas and the area bar. There is no age-based downgrade anywhere.
- **Severity**: High
- **Evidence**: file read (`generatedAt`, `windowStart`, `windowEnd`, 71,882 fires); `dist/index.html` mtime 2026-11-13 17:38.
- **Verification**: EXECUTED (file read), SOURCE-INSPECTION (labelling).

#### Q-24 — Watch presents the static snapshot as global real detections
- **Location**: `src/pages/Watch.tsx:131, 400`
- **Component**: Watch hero and dock
- **Problem**: the hero prints "{kept} real detections worldwide" from `live.meta.counts.kept` (71,882) and the dock prints "LIVE FIRMS WINDOW". Both read the bundled file loaded at page load; neither states its acquisition date.
- **Severity**: High
- **Evidence**: lines 131 and 400; `counts.kept` value from the bundle.
- **Verification**: SOURCE-INSPECTION, EXECUTED (bundle value).

#### Q-25 — Settings reports "live detections worldwide" without a date
- **Location**: `src/components/Overlays.tsx:313`
- **Component**: Settings drawer statistics
- **Problem**: the row is labelled "Live detections worldwide" and filled from `store.live?.meta.counts.kept`. No snapshot date or provenance is shown in the same view.
- **Severity**: Medium
- **Evidence**: line 313.
- **Verification**: SOURCE-INSPECTION.

#### Q-26 — Atlas's "live" KPI is summed from the reconstructed record, not detections
- **Location**: `src/pages/Atlas.tsx:29-31, 120-121`
- **Component**: Atlas KPI tile
- **Problem**: `liveCount` sums `records` (harmonized daily series with live-day injection) across the window, then labels the result "VIIRS-eq · N active days". A reader cannot tell which of those days are measured detections and which are reconstructed, although the same page labels the same window LIVE.
- **Severity**: Medium
- **Evidence**: `recordsInRange(records, windowStart, today)` then `reduce(... r.harmonized)`.
- **Verification**: SOURCE-INSPECTION.

#### Q-27 — A bundle failure is converted into a plausible fake window
- **Location**: `src/lib/data.ts:315, 326-338`
- **Component**: `loadLiveBundle` catch / `emptyMeta()`
- **Problem**: on any failure the loader returns `{meta: emptyMeta(), fires: []}`. `emptyMeta()` sets `windowStart = today-6d`, `windowEnd = today` and `counts.kept: 0`. The UI therefore receives a syntactically valid seven-day window ending today with zero detections.
- **Severity**: High
- **Evidence**: `.catch(() => ({ meta: emptyMeta(), fires: [] }) as LiveBundle)`; `windowStart: addDays(isoDate(now), -6)`.
- **Verification**: SOURCE-INSPECTION.

#### Q-28 — The store's own error state is unreachable
- **Location**: `src/lib/store.tsx:276`
- **Component**: bundle load effect
- **Problem**: the error is set only when `b.meta.counts.kept === 0 && !b.meta.windowStart`. `emptyMeta()` always supplies `windowStart`, so the condition is never true on the failure path created in Q-27. The app silently shows LIVE + zero instead of the retryable error the comment describes.
- **Severity**: High
- **Evidence**: condition at 276; `emptyMeta` at `data.ts:333`.
- **Verification**: SOURCE-INSPECTION.

### D. Failure states and status copy

#### Q-29 — Live fetch errors reach the console only
- **Location**: `src/components/LiveMap.tsx:60-63`
- **Component**: `useLiveFirms` error callback
- **Problem**: the callback sets `liveStatus` to `offline` and calls `console.error`; no message, toast or inline notice is rendered, and the badge (Q-11) says LIVE.
- **Severity**: Medium
- **Evidence**: lines 60-63.
- **Verification**: SOURCE-INSPECTION.

#### Q-30 — "Live data not configured" is documented but not implemented
- **Location**: `src/lib/liveClient.ts:55` (comment); UI search `src/**`
- **Component**: status copy
- **Problem**: the module comment promises the UI shows "live data not configured" for `not_configured`. The only UI handling of that status is badge suppression at `LiveMap.tsx:413`. No string of that kind exists in `src/`.
- **Severity**: Medium
- **Evidence**: `grep -rn "not configured" src` → comments only.
- **Verification**: EXECUTED (grep), SOURCE-INSPECTION.

### E. Navigation, sections, interaction

#### Q-31 — Six routed views, one overlay, and documentation drift
- **Location**: `src/App.tsx:12-17, 51-58`; `src/components/Overlays.tsx:111, 247`
- **Component**: navigation
- **Problem**: the six routes are Watch, Atlas, Diagnosis, Outlook, Brief, Method. Alert Center and Settings are modal drawers opened from the header, not sections. Earlier product documentation describes a six-section map in which "Alert center" is the sixth section; the current information architecture has six routes plus two overlays. Any PRD traceability that counts sections must state which definition it uses.
- **Severity**: Medium
- **Evidence**: lazy imports and `NAV` array; `role="dialog"` drawers.
- **Verification**: SOURCE-INSPECTION.

#### Q-32 — Modal drawers have no Escape handling and no focus management
- **Location**: `src/components/Overlays.tsx:111` (Alert Center), `247` (Settings); contrast `353-358`
- **Component**: drawers
- **Problem**: both drawers declare `role="dialog" aria-modal="true"` but neither closes on Escape, traps focus, or restores focus to the invoking button. Only the judge tour binds Escape. Keyboard users have no in-dialog dismissal path.
- **Severity**: Medium
- **Evidence**: the only `Escape` listener is inside the tour effect at 353-358.
- **Verification**: SOURCE-INSPECTION.

#### Q-33 — The "PDF" export tile navigates instead of exporting
- **Location**: `src/pages/Atlas.tsx:358-361`
- **Component**: export grid
- **Problem**: the tile labelled PDF calls `store.setView('brief')`. Users expecting a download get a page change; the download only happens after a second button on Brief.
- **Severity**: Low
- **Evidence**: line 358 `onClick={() => store.setView('brief')}`.
- **Verification**: SOURCE-INSPECTION.

#### Q-34 — Every generated PDF carries the same creation date
- **Location**: `src/lib/pdf.ts:76`
- **Component**: `buildPdf`
- **Problem**: `/CreationDate (D:20261101000000Z)` is hardcoded, so a brief generated today claims to have been created on 2026-11-01. The document is also text-only (Helvetica text stream; no charts), which is acceptable for FR-27 but means the PDF and the on-screen composition differ.
- **Severity**: Low
- **Evidence**: line 76; object 6 is the only Info dictionary.
- **Verification**: SOURCE-INSPECTION.

#### Q-35 — Compare mode does not share a colour scale
- **Location**: `src/pages/Atlas.tsx:169-198`; `src/components/charts.tsx:72-101`
- **Component**: paired `CalendarHeatmap` in split mode
- **Problem**: `CalendarHeatmapBase` computes its own `max` from its own `records` (line 93-101) and accepts no domain/scale prop. The raw and harmonised calendars therefore normalise independently, so the same colour means different values in the two panels — the opposite of a like-for-like split.
- **Severity**: Medium
- **Evidence**: prop list 73-84 has no scale parameter; internal `max` computed at 93-101.
- **Verification**: SOURCE-INSPECTION.

#### Q-36 — 8K textures are selected by capability, not viewing size
- **Location**: `src/components/Globe.tsx:287-289`
- **Component**: globe texture selection
- **Problem**: the only gate is `maxTextureSize >= 8192`. A capable small-screen device downloads 3,118,845 B (day) + 1,615,537 B (night) for a globe a few hundred pixels wide. There is no DPR, viewport, connection or save-data check, and both 8K files ship in `public/` regardless.
- **Severity**: Medium
- **Evidence**: ternary on `maxTex`; file sizes from `ls -l`.
- **Verification**: EXECUTED (sizes), SOURCE-INSPECTION (gate).

#### Q-37 — CSP has no `worker-src`, which MapLibre GL needs
- **Location**: `server/api.mjs:587-588`
- **Component**: `securityHeaders`
- **Problem**: the policy sets `default-src 'self'` and `script-src 'self'` with no `worker-src`. MapLibre GL creates its worker from a blob URL, which is blocked unless `worker-src blob:` (or a `child-src` fallback) is allowed. On the Node-hosted deployment — the only path that sends these headers — the interactive map can fail to initialise. (`img-src` does include the GIBS host, so tiles are not the problem.)
- **Severity**: Medium
- **Evidence**: full policy string at 588; no `worker-src` token.
- **Verification**: SOURCE-INSPECTION (dependency behaviour noted as such).

#### Q-38 — Method copy overstates the current architecture
- **Location**: `src/pages/Method.tsx:11, 115`
- **Component**: judge-facing proof cards
- **Problem**: the page states "53k live points" and "zero backend required", while the bundle holds 71,882 kept detections and the repository now ships a read-only API that the live client is meant to call. The copy is stale relative to both facts.
- **Severity**: Low
- **Evidence**: lines 11 and 115; bundle `counts.kept` value.
- **Verification**: SOURCE-INSPECTION, EXECUTED (bundle value).

### F. PRD traceability

#### Q-39 — FR-06 (date range) has no rendered control
- **Location**: `src/lib/store.tsx:64, 258, 418, 453`; consumers `src/pages/Atlas.tsx:53, 263`, `src/pages/Brief.tsx:109`
- **Component**: range state
- **Problem**: `setRange` is exposed but never called by any component. The only writers are the URL-hash restore (453) and automatic `windowEnd` updates. There are no date inputs anywhere in `src/` (`type="date"` → 0 matches). Exports and rank bars therefore always use the full record unless a hand-built hash supplies `from`/`to`. `docs/production-readiness.md` marks FR-06 PASS with "Atlas range controls", and `docs/challenge-conformance.md` describes "two date inputs".
- **Severity**: High
- **Evidence**: `grep -rn "setRange(" src/pages src/components` → 0; `grep -rn 'type="date"' src` → 0; range consumers listed above.
- **Verification**: EXECUTED (grep), SOURCE-INSPECTION.

#### Q-40 — FR-13's "axis lock" is not present in the compare view
- **Location**: `src/pages/Atlas.tsx:186-198`
- **Component**: split calendar
- **Problem**: split mode mounts a second `CalendarHeatmap` with `mode="raw"`; as in Q-35 it derives its own scale. `docs/production-readiness.md` marks FR-13 PASS ("Raw vs harmonized toggle + split with axis lock").
- **Severity**: Medium
- **Evidence**: second component instance; Q-35 scale evidence.
- **Verification**: SOURCE-INSPECTION.

#### Q-41 — Recorded browser evidence describes an older tree and is red
- **Location**: `docs/e2e-report.json`
- **Component**: verification record
- **Problem**: the file records `fatal: TypeError: Cannot read properties of null (reading 'focus')` and 80 pass / 22 fail of 102 assertions, against `dist/` dated 2026-11-13 17:38. It cannot certify the current source, which does not build. `docs/validation.md` likewise records `npm test` 108 pass / 15 fail of 135 on a tree whose two cited compile errors are no longer present.
- **Severity**: Low
- **Evidence**: report JSON as read; `dist/index.html` mtime; `docs/validation.md` entry.
- **Verification**: EXECUTED (file read) — this audit did **not** run e2e or tests.

### G. Deployment architecture

#### Q-42 — A git-based deploy of this change set cannot boot
- **Location**: `render.yaml` (`branch: main`, `startCommand: npm start`, `healthCheckPath: /api/v1/health`); `server/api.mjs:11`
- **Component**: Render blueprint / API entry
- **Problem**: `npm start` runs `server/api.mjs`, which imports `./live.mjs`; that file is untracked. A build from `main` either lacks the import (current main) or, once `api.mjs` is committed, lacks the module and crashes before `/api/v1/health` can answer. The blueprint's health check would fail and the service would be marked unhealthy.
- **Severity**: High
- **Evidence**: blueprint fields; `git status`; import line.
- **Verification**: EXECUTED (git), SOURCE-INSPECTION.

#### Q-43 — Nothing refreshes the live window after deploy
- **Location**: `render.yaml` (free plan, no cron, no disk)
- **Component**: deployment topology
- **Problem**: the bundled window is fixed at build time and the blueprint schedules no refresh job. Even with a working provider, the free instance sleeps and has ephemeral storage, so the disk cache (Q-19) is lost and the served "live" window would be whatever the build shipped. There is no cron/scheduled `npm run live` in the repo's deploy configuration.
- **Severity**: Medium
- **Evidence**: blueprint has no `cron`/`disk`; `package.json` has no scheduled entrypoint.
- **Verification**: SOURCE-INSPECTION.

#### Q-44 — The Docker path inherits the same missing-module failure
- **Location**: `Dockerfile` (`COPY server ./server`, `npm run build`)
- **Component**: container build
- **Problem**: `npm run build` is `tsc -b && vite build`, which fails on Q-01…Q-04, and the runtime stage copies `server/` only as it exists in the build context. From a git checkout, `live.mjs` and `liveClient.ts` are absent, so the image either fails to build or fails at import. The file is also explicitly authored-not-executed (ADR-10), so this path has no execution evidence.
- **Severity**: Medium
- **Evidence**: Dockerfile COPY/run lines; git state; ADR-10 note in the file header.
- **Verification**: SOURCE-INSPECTION.

---

## 3. Six product sections as they exist now

Structure verified from `src/App.tsx:12-17` and `NAV` at `51-58`; per-page behaviour beyond the findings above was not re-verified this pass.

| View | Route id | Entry file | Data actually rendered |
| --- | --- | --- | --- |
| Orbital Watch | `watch` | `src/pages/Watch.tsx` | `store.live` bundle → `Globe`, hero count, hour bins |
| Atlas | `atlas` | `src/pages/Atlas.tsx` | `records` + bundled `live.fires` via `LiveMap` |
| Diagnosis | `diagnosis` | `src/pages/Diagnosis.tsx` | `bridgeFor(region, store.live)` + record-derived analytics |
| Outlook | `outlook` | `src/pages/Outlook.tsx` | analog record + NASA POWER fetch (`Outlook.tsx:143-154`) |
| Brief | `brief` | `src/pages/Brief.tsx` | record + `live` window; `.txt` and PDF downloads |
| Method | `method` | `src/pages/Method.tsx` | record provenance, bridge, sandbox copy |
| Alert Center (overlay) | — | `src/components/Overlays.tsx:111` | ranked regions from `store.alerts` |
| Settings (overlay) | — | `src/components/Overlays.tsx:247` | local settings + bundle stats |

**Navigation**: six top-level buttons plus brand, alert, settings and hamburger; hash-based view/region/metric/range/frame serialization at `src/lib/store.tsx:463-469`; skip link at `src/App.tsx:296` focuses `#main` without a hash reset.

---

## 4. PRD traceability — verified discrepancies only

| Requirement | Documentation claim | Source at capture | Verdict |
| --- | --- | --- | --- |
| FR-06 date range | PASS, "Atlas range controls" (`production-readiness.md:75`) | no date input; `setRange` has no UI caller | **contradicted** (Q-39) |
| FR-13 compare axis lock | PASS, "split with axis lock" (`production-readiness.md:82`) | two independently scaled calendars | **contradicted** (Q-35, Q-40) |
| FR-27 one-page PDF | PASS, real download asserted | `buildPdf` works but hardcodes creation date 2026-11-01 | **partial** (Q-34) |
| FR-32 keyboard | PASS for tested paths | skip link present; drawers lack Escape/focus trap | **partial** (Q-32) |
| FR-33 table alternatives | PASS, `TableAlt` in `ui.tsx` | `TableAlt` exists at `src/components/ui.tsx:205`; not re-run this pass | **not re-verified** |
| FR-37 degrade to cache/notice | PASS via e2e network audit | live path degrades to a silent fake window (Q-27/Q-28) | **contradicted for the live path** |
| FR-18 provisional marking | PASS | snapshot `windowEnd` 2026-11-02, `provisional_from` consequently 2026-11-03; UI prints LIVE instead of provisional on the live surfaces | **partial** |

No PRD rows are added here from memory of earlier drafts; rows omitted are those this audit did not re-check.

---

## 5. Deployment architecture — observed shape

- One Node process: `server/api.mjs` serves `dist/` at `/` and the API under `/api/v1` on `$PORT`; zero runtime npm dependencies.
- Static assets include the 71,882-point live snapshot (2.7 MB `live_fires.json`) and both 8K textures (4.7 MB) in `public/`.
- Render blueprint: free plan, `branch: main`, `npm start`, health check `/api/v1/health`, `DATA_BUNDLE_PATH=public/data`, no disk, no cron.
- Docker: multi-stage, `node:22-bookworm-slim`, non-root, health check `/api/v1/ready`; explicitly authored-not-executed.
- Security headers: CSP at `server/api.mjs:588`; missing `worker-src` (Q-37).
- **Blocked**: no deploy was performed or observed; deployed-state claims are **not verified**.

---

## 6. Findings that need another agent's investigation

1. **Science / data (Codex track)**: the `dailyCycle*` implementation added to `src/lib/data.ts` (Q-01/Q-02) — does the intended estimator exist elsewhere, and is the UTC-midnight conversion meaningful for hour-of-day weighting?
2. **Runtime / API (Claude track)**: correct `/live-firms` URL contract, envelope shape, and the import-time `startLive()` side effect (Q-08, Q-09, Q-18); whether `server/live.mjs` passes its own mocked-fetch tests at capture.
3. **Runtime (Claude track)**: the partial-refresh count/fires desynchronisation (Q-17) and the runtime cache location/integrity (Q-19).
4. **Science (Codex track)**: whether the Atlas "live" KPI (Q-26) is documented as measured detections or harmonised equivalents in the PRD.
5. **Whoever owns the docs**: `production-readiness.md` FR-06/FR-13/FR-37 rows no longer match source (Q-39/Q-40/Q-28); this audit did not edit them.

---

## 7. Unresolved questions

1. Which tree is authoritative for release: `main` @ `b81a57d`, or `coder/live-data` with these uncommitted edits? The documented PASS rows describe neither exactly.
2. Is a browser-visible "live" claim allowed for a build-time snapshot at all, or must the label be "snapshot through <date>" everywhere outside an active fetch?
3. Should `store.today` remain `windowEnd` (snapshot-relative) or be decoupled from the bundle so "month-to-date" means wall-clock month-to-date?
4. Is the live provider intended to run on the free Render instance (and therefore sleep), or only as a build-time ingest?
5. Does the PRD define six sections including an Alert Center section, or is Alert Center an overlay by design?

---

## 8. Non-implementation statement

No application source, package file, configuration, generated dataset, existing report, build artifact, branch or git state was modified. The only file written is this report. No finding above was acted on, no other agent's report was read into this one as evidence, and no cross-agent finding was resolved. This audit stops here pending integration approval.
