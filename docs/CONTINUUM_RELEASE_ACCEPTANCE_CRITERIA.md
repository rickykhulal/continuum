# Continuum — Release Acceptance Criteria

**Phase**: 0 output, for owner approval
**Prepared**: 2026-11-14
**Frozen baseline**: HEAD `b81a57d13f9129d09df65b6474fe78dab1458d2f`

These are the gates a release must pass. They are written so that a green result is
evidence, not reassurance. Every gate names a command, a pass condition, the
artifact it protects, and its **current** status on the frozen tree.

Status uses the fixed vocabulary: **verified** (command run, output recorded) ·
**partial** (some cases covered, gap named) · **not verified** (no evidence) ·
**blocked** (needs a key, a host, or an owner decision).

No gate may be softened to make a release pass. Fix the code or record the failure.

---

## 1. Non-gates — things that do not count as acceptance

These can be true while the product is not acceptable:

- `npm run build` succeeding. A build proves syntax and types, not that a fire
  count, an interval or a provenance label is correct.
- The API process starting. It is bundled by esbuild (`api:build`), which does not
  type-check.
- `tsc --noEmit` at the repository root exiting 0. The root config is solution-style
  with `files: []`; it checks nothing.
- A test suite exiting 0 when the runner never sets a failing exit code (see G5).
- A data bundle with a valid manifest hash. Integrity proves the bytes are the ones
  recorded, not that the recording is scientifically right.
- A browser page rendering. Rendering is not correctness.

---

## 2. Software acceptance gates

### G0 — Freeze and authorization — **verified**

- **Command**: `git rev-parse HEAD`, `git status --porcelain`.
- **Pass**: HEAD matches the freeze record and the four Phase 0 documents exist;
  owner has approved the roadmap.
- **Artifact**: the snapshot itself.
- **Current**: HEAD `b81a57d13f9129d09df65b6474fe78dab1458d2f`, 8 modified +
  24 untracked, unchanged during the audit.
- **Evidence**: `docs/CONTINUUM_CURRENT_STATE_FREEZE_2026-11-14.md` §1–2.

### G1 — Type-check and build — **not verified (fails: 16 errors)**

- **Commands**: `npx tsc -p tsconfig.app.json --noEmit`; `npm run build`.
- **Pass**: 0 diagnostics; `tsc -b` exits 0; Vite build completes; `dist/` exists.
- **Artifact**: the shipped SPA.
- **Current**: exit 2 with exactly 16 errors (LiveMap 4, data.ts 10, liveClient 2).
  `npm run build` stops at `tsc -b`, so Vite never runs.
- **Blocks**: every other software gate.
- **Evidence**: full diagnostic list in the freeze record §3.2.

### G2 — Unit and contract tests — **partial**

- **Command**: `npm test` (one `node --test` over `tests/*.test.mjs`).
- **Pass**: all tests pass; no shared fixed port; the run leaves `public/data` and
  `dist/data` byte-identical to their pre-run state.
- **Artifact**: behavior contracts for data, API, world layer, live lane, security.
- **Current**: suite exists (11 files), but two files default to port 4191
  (`tests/api.test.mjs:11`, `tests/coder-live.test.mjs:9`) and
  `tests/bundle.test.mjs:57–76` rewrites the real manifest mid-run. A full run was
  deliberately not executed in Phase 0 for that reason. `tests/secret-scan.test.mjs`
  passes 2/2 on its own.
- **Gap**: isolation (Q-09, Q-10) and the live contract (Q-01, Q-02).
- **Evidence**: per-file output captured when the gates are run at release.

### G3 — Data integrity and bundle parity — **partial**

- **Commands**: `npm run validate`; rebuild the bundle and compare
  `public/data` vs `dist/data`; re-run `bundle.mjs` and compare `bundle_version`.
- **Pass**: every validation check passes; served version equals the on-disk
  version; a rebuild on unchanged inputs does not move the version; manifest row
  counts match the world layer.
- **Artifact**: `continuum-2026-11-02-920de0617606` and its 20 files.
- **Current**: 23/23 reported earlier on this bundle; **not re-run in Phase 0**, and
  `docs/validation-report.json` is modified in the working tree. Treat as
  **partial** until re-run and re-recorded at release.
- **Evidence**: validate output, manifest before/after hash, served-version log.

### G4 — API contract — **partial**

- **Commands**: start the API on an isolated port; request the route matrix.
- **Pass**: every response is JSON; health 200; unknown `/api/*` 404 JSON;
  `/live-firms` and `/api/v1/live-firms` return 503 `not_configured` without a key;
  the client's chosen path is one the server serves.
- **Artifact**: the read-only API.
- **Current**: verified that `/api/v1/health` is 200 JSON, `/live-firms` and
  `/api/v1/live-firms` are 503 JSON, and **`/api/live-firms` is 200 HTML** — the SPA
  fallback masks a missing route the client calls.
- **Gap**: Q-02, Q-06.
- **Evidence**: freeze record §5.

### G5 — E2E sweep behaves — **not verified**

- **Commands**: `npm run preview` then `npm run e2e`; run once with a deliberately
  failing check.
- **Pass**: the sweep passes on the real app; a failing check produces a **non-zero
  exit code**; the report records every check.
- **Artifact**: user paths (six sections, globe/map, mobile viewport).
- **Current**: `scripts/e2e.mjs` has no `process.exit` (only logs at 1135, 1139),
  so a failing sweep can exit 0. Not run against the frozen build.
- **Gap**: Q-08, plus Q-07 for the MapLibre worker CSP.
- **Evidence**: run output + exit code + `docs/e2e-report.json` (regenerate only at
  release).

### G6 — Live refresh end to end — **blocked**

- **Requires**: a server-side `FIRMS_MAP_KEY` in the runtime environment (never in
  the repo, bundle or logs).
- **Commands**: start the API with the key; call the canonical live route; wait for
  a refresh (or invoke the refresh test hook); compare the mapped point set and one
  analytical count across two acquisitions.
- **Pass**: a changed acquisition changes the rendered points and the count; the
  server's `stale` flag is recomputed from age; provenance and transport status are
  reported separately; a failed refresh leaves one consistent generation.
- **Current**: blocked on the temporary key; the contract mismatch (Q-02) and the
  discarded points (Q-01) are verified defects independent of the key.
- **Gap**: Q-01, Q-02, Q-04, Q-05, S-03.
- **Evidence**: two acquisition diffs, fault-injection test output, route matrix.

---

## 3. Scientific acceptance gates

### G7 — No fabricated or mislabelled science — **not verified**

- **Commands**: run the Codex fixture tests; inspect the rendered labels and the
  export headers.
- **Pass**:
  - the 2000→today series is labelled a reconstruction calibrated to the live
    window, never a raw archive re-download;
  - no model, sandbox or synthetic series carries the LIVE label;
  - every displayed statistic names the statistic it actually computes (mean vs
    median);
  - every interval is either metric-specific or explicitly unavailable — no
    `k*0.8` placeholder ships;
  - missing weather inputs are not silently reported as dry conditions;
  - sampled point sets are not described as complete.
- **Artifact**: every number and label in the UI, API and export.
- **Current**: multiple verified source-level defects (C-02, C-03, C-04, C-05,
  C-06, C-08, C-10, C-11).
- **Evidence**: fixture test output, method notes, label screenshots.

### G8 — Observation parity across surfaces — **not verified**

- **Commands**: select one region; read its date, window and provenance from the
  browser, the API and the store.
- **Pass**: all three report the same acquisition date, window and provenance for
  the same region; the payload's timestamp describes acquisition, not the alignment
  run.
- **Artifact**: cross-surface consistency.
- **Current**: browser aligns to real time, API hydrates unshifted country data,
  store reads the startup live object (S-01, Q-12).
- **Evidence**: three-surface fixture output.

### G9 — Validation report is real — **not verified**

- **Commands**: generate the validation report; validate it against its schema.
- **Pass**: the report is generated by a reachable code path, matches the schema,
  uses computed confidence intervals, and its claims match the shipped bundle
  version and window.
- **Artifact**: the PRD validation gate.
- **Current**: `generateValidationReport` is dead code that does not compile and
  contains a placeholder CI (C-02).
- **Evidence**: generated sample + schema test, or a written decision that the
  report is retired and which PRD gate covers the gap.

### G10 — Geometry and export integrity — **not verified**

- **Commands**: hole-area fixture; polygon-vs-bbox membership fixture; CSV
  header/value consistency test; calendar API schema test.
- **Pass**: holes subtract; membership matches the declared geometry or is labelled
  an approximation; each CSV column's value matches its header; each API interval
  matches its metric; two radii at one center never share a record or cache entry.
- **Artifact**: selected-area counts, exports and API analytics.
- **Current**: holes are added (C-09), bbox stands in for polygon (C-11), the
  harmonized column can carry raw values (C-10), radius is absent from identity
  (Q-16).
- **Evidence**: fixture outputs, sample CSV, schema output.

---

## 4. Security and deployment gates

### G11 — Secrets and CSP — **partial**

- **Commands**: `npm run secret-scan`; scan tracked + untracked + Git objects;
  load the app and read the console for CSP violations.
- **Pass**: the scan exits 0 over the whole tree and history; no credential appears
  in any doc, bundle or log; map tiles/worker load under the CSP.
- **Artifact**: repository and served app.
- **Current**: scanner repaired and tested (2/2); scan clean over 208 files,
  121 MB, 0 unscanned; 0 remaining 32-hex tokens in the worktree and Git objects.
  **Rotation of the exposed temporary key is not confirmed** — an unrotated key
  means G11 is **partial**, not verified.
- **Gap**: Q-07 (worker CSP), Q-14 (rotation confirmation).
- **Evidence**: scan output, owner rotation statement, console capture.

### G12 — Deployment — **blocked**

- **Commands**: build the container (or deploy to the chosen host) and request
  `/api/v1/health` and one data route.
- **Pass**: the service starts, serves the built SPA and the frozen bundle, returns
  health 200 JSON, and has no runtime dependency on CelesTrak. No secret is baked
  into the image.
- **Artifact**: the deployed service.
- **Current**: `render.yaml` and `Dockerfile` are authored but never executed;
  bundle delivery/disk strategy is not demonstrated.
- **Gap**: Q-13.
- **Evidence**: build log, health response, served bundle version.

---

## 5. Gate status at freeze

| Gate | Status | Blocks release? |
| --- | --- | --- |
| G0 Freeze/authorization | verified | — |
| G1 Type-check/build | not verified (fails) | **yes** |
| G2 Tests | partial | **yes** |
| G3 Data integrity | partial | **yes** |
| G4 API contract | partial | **yes** |
| G5 E2E | not verified | **yes** |
| G6 Live refresh | blocked | **yes** (or owner waiver) |
| G7 No fabricated science | not verified | **yes** |
| G8 Observation parity | not verified | **yes** |
| G9 Validation report | not verified | **yes** |
| G10 Geometry/exports | not verified | **yes** |
| G11 Secrets/CSP | partial | **yes** until rotation confirmed |
| G12 Deployment | blocked | **yes** for a hosted release |

---

## 6. Waivers

- Only the **project owner** may waive a gate.
- Only **P2/P3** items are waivable. A P0 or P1 defect may not be waived into a
  release.
- A waiver is recorded in this document as: gate, item, reason, residual risk,
  date, owner signature. No verbal waiver.
- Waiving G6 or G12 requires an explicit statement that the release ships without a
  verified live lane or without verified deployment.

---

## 7. Release evidence package

A release candidate is accepted only when all of the following are attached:

1. `git rev-parse HEAD` and a clean `git status` (no uncommitted surprises).
2. G1 diagnostic output (0 errors) and `npm run build` log.
3. G2 `npm test` output with per-file results.
4. G3 `npm run validate` output and the served-vs-disk bundle version.
5. G4 route matrix with status and content-type.
6. G5 e2e output **and exit code**, plus the regenerated `docs/e2e-report.json`.
7. G6 two-acquisition diff (or a signed waiver).
8. G7 fixture output and label screenshots.
9. G8 three-surface parity output.
10. G9 validation report sample + schema result (or signed retirement decision).
11. G10 fixture/sample output.
12. G11 `npm run secret-scan` output and the owner's rotation statement.
13. G12 health response and served bundle version (or a signed waiver).

Numbers in the package must be computed from the shipped record. No percentage,
benchmark or validation figure may be asserted without the command that produced it.
