# Continuum — Final Implementation Roadmap

**Phase**: 0 output, for owner approval
**Prepared**: 2026-11-14
**Frozen baseline**: HEAD `b81a57d13f9129d09df65b6474fe78dab1458d2f`, branch `coder/live-data`
**Active development agents**: Qoder (software) · Codex (science)

This roadmap is derived from the frozen state in
`docs/CONTINUUM_CURRENT_STATE_FREEZE_2026-11-14.md`. It is a plan, not authorization
to edit. No item below may start before the owner approves, and no item may edit a
file owned by the other agent without the handoff defined in
`docs/CONTINUUM_AGENT_FILE_OWNERSHIP.md`.

Two tracks are kept deliberately separate:

- **Software correctness** — the app builds, routes resolve, state propagates,
  tests fail when they should. Owned by **Qoder** (`Q-*`).
- **Scientific correctness** — a number means what its label says, intervals and
  provenance are honest, methods are documented and tested. Owned by **Codex**
  (`C-*`).
- **Shared interfaces** — one payload/contract used by both tracks (`S-*`), with a
  single named lead and a review by the other agent.

A green build is **not** evidence of scientific validity, and a scientific fix does
not by itself make the build pass. Both tracks are required for release.

---

## 1. Triage summary

| Severity | Software (Q) | Scientific (C) | Shared (S) | Total |
| --- | --- | --- | --- | --- |
| P0 — blocks build or falsifies a headline claim | 5 | 4 | 1 | 10 |
| P1 — wrong behavior on a primary path | 8 | 5 | 1 | 14 |
| P2 — misleading or unproven, contained | 2 | 2 | 1 | 5 |
| P3 — documentation / hygiene | 1 | 0 | 0 | 1 |
| **Total** | **16** | **11** | **3** | **30** |

The only true build blocker is the missing daily-cycle export set (`C-01`) plus the
live-contract errors (`Q-01`). Everything else is correctness, integrity or
evidence.

---

## 2. Software correctness register (Qoder)

### Q-01 — Live hook and caller disagree; refreshed points are discarded — **P0**

- **Files**: `src/lib/liveClient.ts` (61–114), `src/components/LiveMap.tsx` (54–59, 67–69)
- **Root cause**: `useLiveFirms` returns `void` while the caller destructures
  `{ status, data }`. The callbacks update only labels; `regionPoints` still derive
  from the `fires` prop, so a successful acquisition never reaches the map or any
  derived count.
- **Owner**: Qoder
- **Depends on**: Q-05 (types), Q-02 (route)
- **Proposed solution**: make the hook return
  `{ status, data, meta, error, refresh }`; keep provenance out of the transport
  union; have the caller consume `data` into the same region computation used for
  the initial `fires`, tagged with its provenance.
- **Acceptance test**: mocked-fetch unit test covering success → `live`, stale
  payload → `stale`, error with last-known-good → previous status, error with no
  cache → `offline`. A two-fixture test proves a changed acquisition changes the
  rendered point set and one displayed count.
- **Required evidence**: `tsc -p tsconfig.app.json` output; new test output; a
  browser capture showing the count change.
- **Regression risk**: medium — map badge, polling lifecycle, store re-render.

### Q-02 — Client calls a route the API does not serve — **P0**

- **Files**: `src/lib/liveClient.ts:72`, `server/api.mjs` (491, 718, 853–881)
- **Root cause**: client requests `/api/live-firms`; the server exposes
  `/live-firms` and `/api/v1/live-firms`, and the SPA fallback answers the unknown
  path with **200 `text/html`** (verified in the freeze probe).
- **Owner**: Qoder
- **Depends on**: none
- **Proposed solution**: adopt `/api/v1/live-firms` as the canonical client path;
  keep `/live-firms` as the documented alias; make any unrouted `/api/*` path return
  **404 JSON** so a wrong route can never masquerade as success.
- **Acceptance test**: request matrix — `/api/v1/live-firms`, `/live-firms`,
  `/api/live-firms`, `/api/unknown` — every response is JSON (503
  `not_configured` or 404), never HTML.
- **Required evidence**: curl matrix with status and content-type.
- **Regression risk**: low — prefix strip and health route must be re-checked.

### Q-03 — `process.env` evaluated in browser code — **P0**

- **Files**: `src/lib/liveClient.ts:130`
- **Root cause**: `ALLOW_MOCK_LIVE` reads Node's `process` in a Vite browser bundle.
- **Owner**: Qoder
- **Proposed solution**: use `import.meta.env` for any dev flag, or remove the mock
  lane from the client and keep mock selection server-side. Credentials stay
  server-side regardless.
- **Acceptance test**: `rg "process\.env" src/` returns nothing; type-check clean
  at this line; dev build still renders.
- **Required evidence**: grep output, tsc output.
- **Regression risk**: low — dev demo path only.

### Q-04 — Provenance union used as transport status — **P0**

- **Files**: `src/lib/liveClient.ts` (44, 85–94), `src/components/LiveMap.tsx` (52–58)
- **Root cause**: `DataSource = 'model' | 'live' | 'blend' | 'archive'` is compared
  and assigned where a transport state (`loading | live | stale | offline |
  not_configured`) is required; the server's `stale` flag is ignored.
- **Owner**: Qoder
- **Depends on**: none
- **Proposed solution**: declare two explicit types, `DataSource` (provenance) and
  `TransportStatus` (connection); the response carries both; the badge reads both
  and can show "stale · model".
- **Acceptance test**: type-level assertions plus a UI test where a stale payload of
  model data renders the stale treatment without relabelling provenance.
- **Required evidence**: tsc output; component test/screenshot.
- **Regression risk**: medium — every consumer that compared `'stale'` to
  `DataSource`.

### Q-05 — Server refresh can mix generations — **P1**

- **Files**: `server/live.mjs` (177–209, 304)
- **Root cause**: `perSatelliteCounts` is mutated (191) before the whole-window swap
  (197); `all.push(...tuples)` (192) risks an argument-count failure on a large
  global feed; thrown errors pass through `finally` (209), bypassing the stale
  branch (201–204); `getResponse` returns a stored `stale` flag without recomputing
  age.
- **Owner**: Qoder
- **Proposed solution**: build a complete staged object, swap once on success; use
  a loop/`concat` instead of spread; route every failure through one path that
  either preserves the previous generation or marks stale; compute freshness from
  acquisition/fetch times at read time.
- **Acceptance test**: fault-injection test — fetch rejects mid-refresh → counts and
  detections remain one consistent generation and `stale` reflects the new age.
- **Required evidence**: new server test output.
- **Regression risk**: medium — live lane availability.

### Q-06 — Unknown `/api/*` returns HTML 200 — **P1**

- **Files**: `server/api.mjs:881`
- **Root cause**: the static fallback does not distinguish API prefixes.
- **Owner**: Qoder
- **Proposed solution**: if the path starts with `/api/`, return 404 JSON before
  falling back to `index.html`.
- **Acceptance test**: covered by Q-02 matrix.
- **Required evidence**: curl output.
- **Regression risk**: low.

### Q-07 — CSP has no worker source — **P1**

- **Files**: `server/api.mjs` (587–588)
- **Root cause**: MapLibre GL runs a web worker; the CSP omits `worker-src`.
- **Owner**: Qoder
- **Proposed solution**: add `worker-src 'self' blob:` (narrowest that works) and
  confirm no other violation appears.
- **Acceptance test**: browser console free of CSP worker violations; map renders.
- **Required evidence**: console capture / e2e screenshot.
- **Regression risk**: low — keep the policy minimal.

### Q-08 — E2E sweep can exit 0 after failures — **P1**

- **Files**: `scripts/e2e.mjs` (no `process.exit`; only logs at 1135, 1139)
- **Root cause**: the script logs failures but never sets a failing exit code.
- **Owner**: Qoder
- **Proposed solution**: accumulate failures and set `process.exitCode = 1`.
- **Acceptance test**: an intentionally failing assertion yields non-zero.
- **Required evidence**: run output with exit code.
- **Regression risk**: none.

### Q-09 — Test suites share a fixed port — **P1**

- **Files**: `tests/api.test.mjs:11`, `tests/coder-live.test.mjs:9`
- **Root cause**: both default to port 4191.
- **Owner**: Qoder
- **Proposed solution**: distinct defaults or a dynamically allocated free port.
- **Acceptance test**: suite run twice concurrently without collision.
- **Required evidence**: concurrent run output.
- **Regression risk**: low.

### Q-10 — Bundle test rewrites the manifest mid-run — **P1**

- **Files**: `tests/bundle.test.mjs` (57–76)
- **Root cause**: the test executes `scripts/bundle.mjs` against the real manifest
  and restores it in `finally`; a full run mutates shipped bytes while other tests
  read them.
- **Owner**: Qoder
- **Proposed solution**: point the rebuild at a temporary output directory, or
  assert against a copy so the real manifest is never touched.
- **Acceptance test**: `git status`/hashes unchanged after the test.
- **Required evidence**: before/after hash of `public/data/bundle.json`.
- **Regression risk**: low — keep coverage of `bundle.mjs`.

### Q-11 — Root type-check is a silent no-op — **P1**

- **Files**: `package.json`, `tsconfig.json`
- **Root cause**: solution-style config with `files: []`; `tsc --noEmit` checks
  nothing.
- **Owner**: Qoder
- **Proposed solution**: add a `typecheck` script that runs
  `tsc -p tsconfig.app.json --noEmit`, and use it in docs/CI so a green check means
  something.
- **Acceptance test**: `npm run typecheck` fails today with the 16 known errors and
  passes when they are fixed.
- **Required evidence**: command output before/after.
- **Regression risk**: none.

### Q-12 — Alignment stamps a fresh timestamp on shifted data — **P2**

- **Files**: `src/lib/data.ts` (233–287, 279)
- **Root cause**: `generatedAt: new Date().toISOString()` describes the alignment
  run, not the acquisition.
- **Owner**: Qoder (with Codex on label semantics)
- **Proposed solution**: preserve the upstream acquisition time and add a separate
  `alignedAt`; never let a derived timestamp read as an observation time.
- **Acceptance test**: aligned output `generatedAt` equals the source value.
- **Required evidence**: unit test.
- **Regression risk**: low — any consumer reading `generatedAt`.

### Q-13 — Deployment config is authored but not executed — **P2**

- **Files**: `render.yaml`, `Dockerfile`
- **Root cause**: no build/run evidence for the container path; no disk declared for
  static bundle serving.
- **Owner**: Qoder (owner approval required for config changes)
- **Proposed solution**: execute a container build and a health check, or record the
  path as **blocked**; confirm bundle delivery strategy for the chosen host.
- **Acceptance test**: container starts and serves `/api/v1/health` 200 JSON.
- **Required evidence**: build log, health response.
- **Regression risk**: low if config is unchanged until approved.

### Q-14 — Credential rotation is unconfirmed — **P2**

- **Files**: none (process)
- **Root cause**: the exposed testing key was redacted but rotation is an owner
  action.
- **Owner**: project owner; Qoder re-verifies
- **Proposed solution**: owner rotates independently; Qoder re-runs
  `npm run secret-scan` and records the result. The temporary key must never be
  reintroduced.
- **Acceptance test**: scan clean over the tree and Git objects; owner confirmation
  recorded.
- **Required evidence**: scan output, owner statement.
- **Regression risk**: none.

### Q-15 — A prior repair report states a build result that is false — **P3**

- **Files**: `docs/P0_REPAIR_REPORT.md` (do not edit in Phase 0)
- **Root cause**: the report claims `npm run build` PASS and shows a `git diff` of an
  untracked file; the frozen snapshot shows 16 errors.
- **Owner**: project owner decides whether to supersede it with a new report
- **Proposed solution**: leave the report untouched; let this roadmap and the release
  criteria be the current authority.
- **Acceptance test**: n/a.
- **Required evidence**: the freeze record §3.2 and §7.1.
- **Regression risk**: none.

### Q-16 — Two consumers can describe different areas — **P1**

- **Files**: `src/data/places.ts:76`, `server/api.mjs:223`, `src/lib/geometry.ts:198`
- **Root cause**: `customRegion` reuses an id across radii and drops `radiusKm`; the
  API cache keys on id/center/radius; polygon selection is reduced to a circle.
- **Owner**: Qoder lead, Codex reviews geometric meaning
- **Proposed solution**: include `radiusKm` (or a geometry hash) in the identity and
  cache key; mark circle-derived results as approximations.
- **Acceptance test**: two radii at one center produce distinct records and cache
  entries.
- **Required evidence**: unit test.
- **Regression risk**: medium — cache hit rate.

---

## 3. Scientific correctness register (Codex)

### C-01 — Daily-cycle layer is referenced but absent — **P0**

- **Files**: `src/lib/archive.ts`, `src/lib/data.ts` (51–53, 1920)
- **Root cause**: `data.ts` re-exports `dailyCycleWeight`,
  `applyDailyCycleCorrection`, `archiveRatioWithDailyCycle`, but `archive.ts`
  exports none of them. The layer is not recoverable from the tree.
- **Owner**: Codex
- **Depends on**: none (but blocks the build and Q-11)
- **Proposed solution**: an explicit scientific decision — either implement the three
  functions with a documented method and fixtures, or retire the feature and delete
  the re-exports plus the dead references. No silent removal of a PRD feature.
- **Acceptance test**: `tsc` clean for those lines; if implemented, synthetic-fixture
  unit tests demonstrate the correction and the ratio; if retired, a written record
  states the PRD impact.
- **Required evidence**: method note, test output, decision record.
- **Regression risk**: high if implemented — displayed values change.

### C-02 — Validation report is dead and contains a placeholder interval — **P0**

- **Files**: `src/lib/data.ts` (1901–2035; 1943, 1964, 2005, 2006, 2016, 2031–2032)
- **Root cause**: `generateValidationReport` has no callers and does not compile;
  `ratioLo: k*0.8` is a placeholder labelled as an interval.
- **Owner**: Codex
- **Depends on**: C-01 (if the report includes daily-cycle columns)
- **Proposed solution**: define the output schema, then either wire and implement it
  with real confidence intervals or delete it. A placeholder must never ship as a
  CI.
- **Acceptance test**: either a schema-valid generated JSON from a real run, or the
  function is gone and no PRD gate depends on it.
- **Required evidence**: sample output + schema test, or removal record.
- **Regression risk**: high — the validation gate depends on it.

### C-03 — Analog windows are built on the wrong years — **P0**

- **Files**: `src/lib/data.ts:1563` (`twinAnalogs`)
- **Root cause**: `yStart` and `yEnd` are both built from the same year, so a
  Dec→Jan span becomes a same-year window; the described 80% backtest gate is not
  enforced.
- **Owner**: Codex
- **Proposed solution**: construct endpoints across the correct calendar years and
  either enforce the gate or remove the claim.
- **Acceptance test**: fixture with a known crossing case yields the intended dates;
  gate test passes/fails as specified.
- **Required evidence**: test output.
- **Regression risk**: medium — analog counts and departures change.

### C-04 — Month comparison selects the largest, not the most recent — **P0**

- **Files**: `src/lib/data.ts:1340`
- **Root cause**: history is sorted by value before selection.
- **Owner**: Codex
- **Proposed solution**: select by date/recency, then compute the comparison.
- **Acceptance test**: fixture where the largest month is not the most recent;
  selection must return the recent one.
- **Required evidence**: test output.
- **Regression risk**: medium — displayed comparisons change.

### C-05 — Sandbox output can inherit an observed label — **P1**

- **Files**: `src/lib/data.ts` (`runSandbox`), any UI that renders its result
- **Root cause**: simulated results are not consistently tagged as simulated.
- **Owner**: Codex
- **Proposed solution**: carry an explicit provenance field through the sandbox and
  render it; never label simulated output live/observed.
- **Acceptance test**: test asserts provenance on sandbox output; UI test shows the
  simulated treatment.
- **Required evidence**: test output, screenshot.
- **Regression risk**: low.

### C-06 — Weather imputes missingness and fits its own simulation — **P1**

- **Files**: `src/lib/weather.ts` (43, 77, 114, 120, 125–140, 219–231)
- **Root cause**: missing precipitation → 0; missing humidity → fixed 0.3 dry-air
  term; regression includes reconstruction; `offlineWeather` fits a relationship
  against a sinusoidal series it generated; cache key omits record identity.
- **Owner**: Codex
- **Proposed solution**: preserve missingness and flag proxies; exclude
  reconstruction from fits or label the fit as hybrid; mark the offline fit as
  simulated; key the cache by record identity.
- **Acceptance test**: missing-rain and missing-humidity fixtures keep nulls and set
  proxy flags; cache invalidates when records change.
- **Required evidence**: test output.
- **Regression risk**: medium — displayed weather stress changes.

### C-07 — Calibration and constellation thresholds lack stability evidence — **P1**

- **Files**: `src/lib/archive.ts` (`calibrationFor`, `constellationWeights`),
  tests
- **Root cause**: thresholds (`MIN_BRIDGE_DAYS=365`, `MIN_AREA_OVERLAP_MODIS=30`,
  30-day constellation gate) are implemented but not exercised against fixtures.
- **Owner**: Codex
- **Proposed solution**: encode each threshold as a boundary test and document the
  empirical basis; do not move a threshold without evidence.
- **Acceptance test**: boundary tests at just-below/at/just-above each threshold.
- **Required evidence**: test output, method note.
- **Regression risk**: low if thresholds are unchanged.

### C-08 — Brief calls a mean a median — **P1**

- **Files**: `src/pages/Brief.tsx` (28, 46, 173), `src/lib/data.ts:1688`
- **Root cause**: the brief computes an arithmetic mean while the copy (and the
  shared `analogDeparture`) use a median.
- **Owner**: Codex
- **Proposed solution**: pick one statistic, use the shared function, and fix the
  wording; the exported brief must match.
- **Acceptance test**: brief value equals the shared statistic for a fixture.
- **Required evidence**: test output.
- **Regression risk**: low.

### C-09 — Polygon holes are added, not subtracted — **P2**

- **Files**: `src/lib/geometry.ts` (67–78, 162–190)
- **Root cause**: `polygonAreaKm2` sums `Math.abs` per ring, so holes increase area;
  self-intersections are not detected.
- **Owner**: Codex
- **Proposed solution**: apply ring orientation (subtract holes), add a topology
  guard, and document the winding rule.
- **Acceptance test**: a polygon with a known hole returns outer−inner.
- **Required evidence**: test output.
- **Regression risk**: low — only polygons with holes change.

### C-10 — Exported values and intervals can have different meanings — **P2**

- **Files**: `src/lib/export.ts` (35–51), `server/api.mjs:285`
- **Root cause**: `harmonized_viirs_equiv` is filled with the selected mode's
  `dailyValue`; API calendar emits selected metric values beside harmonized hotspot
  bounds; sampled point sets are not labelled partial.
- **Owner**: Codex lead, Qoder implements the schema
- **Proposed solution**: make interval fields metric-specific or explicitly
  unavailable; make each column's label match its value; state sampling in the
  export.
- **Acceptance test**: CSV header/value consistency test; API schema test.
- **Required evidence**: sample CSV + schema test.
- **Regression risk**: medium — downstream consumers.

### C-11 — `observeArea` uses a bounding box as if it were the polygon — **P2**

- **Files**: `src/lib/data.ts:613`
- **Root cause**: membership is tested against the bbox, so points outside the
  polygon but inside the box are counted.
- **Owner**: Codex
- **Proposed solution**: use polygon membership for polygon selections, or label the
  count as an approximation consistently across UI, export and API.
- **Acceptance test**: fixture with a point in the bbox but outside the polygon.
- **Required evidence**: test output.
- **Regression risk**: medium — counts for polygon selections change.

---

## 4. Shared interfaces (single lead, cross-review)

### S-01 — One observation payload for browser, API and store — **P0**

- **Files**: `src/lib/data.ts` (233–320), `src/lib/countries.ts` (74–128),
  `server/api.mjs` (52, 63–68, 223), `src/lib/store.tsx` (256, 276, 300)
- **Root cause**: the browser aligns to real time, the API hydrates unshifted
  country data, and the store reads the startup live object; the same region can
  carry different dates and freshness.
- **Lead**: Qoder (plumbing) · **Review**: Codex (date/provenance semantics)
- **Proposed solution**: one alignment function with an explicit acquisition time;
  the API computes from the same aligned payload; the store consumes it; provenance
  and observation window are separate fields.
- **Acceptance test**: the same region returns identical date, window and provenance
  from browser, API and store.
- **Required evidence**: cross-surface fixture output.
- **Regression risk**: high — touches every consumer; do after Q-01/Q-04.

### S-02 — Geometry identity must be complete in caches — **P1**

- Covered operationally by Q-16; Codex confirms what geometric identity must
  include. Do not split into two implementations.

### S-03 — Live analytics must use the refreshed acquisition — **P1**

- **Files**: `src/lib/store.tsx`, `src/lib/data.ts`, `src/components/LiveMap.tsx`
- **Lead**: Qoder · **Review**: Codex (provenance labels)
- **Depends on**: Q-01, Q-02, Q-04
- **Acceptance test**: after a simulated acquisition change, both the map and a
  displayed analytical count change, and the provenance label matches the payload.

---

## 5. Dependency-ordered batches

Each batch ends with its own evidence capture. A batch does not open until the
previous batch's gate passes.

| Batch | Contents | Gate |
| --- | --- | --- |
| **B0 — owner** | Rotate the temporary FIRMS key; approve scope and the four Phase 0 docs | Owner statement; `npm run secret-scan` clean |
| **B1 — build unblock** | C-01 (implement or retire daily-cycle), C-02 (validation report), Q-03, Q-04 (types), Q-01 | `tsc -p tsconfig.app.json` exits 0; `npm run build` completes |
| **B2 — live contract** | Q-02, Q-06, Q-07, Q-01 follow-through | Route matrix all JSON; worker CSP clean |
| **B3 — parity** | S-01, S-02/Q-16, Q-12 | Same region identical across browser/API/store |
| **B4 — live integration** | Q-05, S-03, Q-04 UI badge | Fault-injection test; changed acquisition changes points and a count |
| **B5 — science** | C-03, C-04, C-05, C-06, C-07, C-08 | Each issue's fixture test passes |
| **B6 — export/geometry** | C-09, C-10, C-11 | CSV/API schema tests; hole-area test |
| **B7 — test integrity** | Q-08, Q-09, Q-10, Q-11 | E2E exits non-zero on failure; suite isolated; root typecheck meaningful |
| **B8 — release** | Q-13, Q-14, Q-15, full gate run | `docs/CONTINUUM_RELEASE_ACCEPTANCE_CRITERIA.md` all gates |

Critical path: **C-01 → B1 → B2 → S-01 → B4**. C-01 and S-01 are the two items
most likely to overrun; they should start first.

### 5.1 Parallelism rules

- Codex may run C-03, C-04, C-05, C-06, C-07, C-08, C-09 in parallel with Qoder's
  B1/B2 **only** on files each owns exclusively (see the ownership doc).
- `src/lib/data.ts` is shared: only one agent writes it at a time, with a handoff
  note naming the line ranges and symbols.
- No agent edits a file the other is currently holding. The ownership doc is the
  authority.

---

## 6. Handoff protocol for shared files

Shared files are: `src/lib/data.ts`, `src/lib/geometry.ts`, `src/lib/weather.ts`,
`src/lib/export.ts`, `server/api.mjs`, `src/lib/store.tsx`,
`src/components/LiveMap.tsx`, `scripts/e2e.mjs`, `tests/*`.

A handoff note must contain, in the issue thread or a new doc:

1. Issue ID and the exact line ranges touched.
2. Symbols added/removed/renamed.
3. The command that proves the change and its output.
4. What the receiving agent must re-run before editing (usually `tsc
   -p tsconfig.app.json` and the focused test).
5. Whether generated evidence moved, and if so, why (never loosen a tolerance).

Only after the note is acknowledged may the other agent edit the file. This is the
operational form of the rule "never edit a file currently owned by Codex".

---

## 7. Explicitly out of scope

- Restoring `archive.ts` or any file from an older snapshot.
- Broad rewrites to silence TypeScript errors (e.g. `any`, `@ts-ignore`, deleting
  features to make errors disappear).
- Regenerating bundles, datasets, validation or smoke reports to make a gate pass.
- Changing metric definitions silently; any semantic change needs a written
  decision and a visible label change.
- Committing, pushing, deploying, or altering Git history.
- Fabricating observations, historical series, validation results or benchmarks.
- Touching Codex-owned files while Codex is working on them.

---

## 8. Evidence discipline

Every closed issue must attach, in the issue itself:

- the exact command run and its exit code,
- the relevant output (redacted of credentials),
- the before/after file hash when a shipped artifact is involved,
- the acceptance test name and result.

Vocabulary is fixed by `AGENTS.md`: **verified / partial / not verified / blocked**.
An issue is not closed because the code "looks right".
