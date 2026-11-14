# Continuum — Git and File Integrity Audit (2026-11-14)

**Scope**: Working-tree state, tracked/untracked classification, and the `src/lib/archive.ts`
restoration incident.
**Mode**: Read-only. No staging, commit, checkout, stash, restore or reflog operation was performed.
**Baseline**: `coder/live-data` @ `b81a57d`.

---

## 1. Repository state (verified)

`[EXEC]`

```
git rev-parse --abbrev-ref HEAD      -> coder/live-data
git log -1 --oneline                 -> b81a57d fix(map): correct LiveMap data-source label …
git status --short
 M docs/api-smoke-report.json
 M docs/e2e-report.json
 M docs/validation-report.json
 M docs/validation.md
 M server/api.mjs
 M src/components/LiveMap.tsx
 M src/lib/data.ts
?? audit-report.md
?? docs/AGENT_FINDINGS_RECONCILIATION.md
?? docs/CLAUDE_RUNTIME_AUDIT.md
?? docs/CODEX_SCIENCE_AUDIT.md
?? docs/COMPLETION_BASELINE.md
?? docs/COMPLETION_REPORT.md
?? docs/DATA_FRESHNESS_REPORT.md
?? docs/P0_REPAIR_REPORT.md
?? docs/QODER_PRODUCT_AUDIT.md
?? docs/TEST_RESULTS.md
?? docs/project-audit-2026-11-13.md
?? server/live.mjs
?? src/lib/liveClient.ts
?? tests/coder-live.test.mjs
```

`git diff --stat`:

```
 docs/api-smoke-report.json  | 252 +----------------------
 docs/e2e-report.json        | 481 +++++++++++++++++++++++++++++++++++++++++++-
 docs/validation-report.json |   2 +-
 docs/validation.md          |  23 +++
 server/api.mjs              |  14 +-
 src/components/LiveMap.tsx  |  55 ++++-
 src/lib/data.ts             | 221 ++++++++++++++++++++
```

`git diff --stat src/lib/archive.ts` → empty. `archive.ts` is byte-identical to `HEAD`.

---

## 2. Resolving the tracked/untracked contradiction

The earlier reconciliation report showed `server/live.mjs` and `src/lib/liveClient.ts` as `??` in
its git-status block but described them as tracked in its file-state table. Raw Git evidence:

`[EXEC]` `git ls-tree -r --name-only HEAD -- server src/lib tests`

```
server/analytics.ts
server/api.mjs
src/lib/archive.ts
src/lib/basemap.ts
src/lib/countries.ts
src/lib/data.ts
src/lib/export.ts
src/lib/format.ts
src/lib/geo.ts
src/lib/geometry.ts
src/lib/i18n.ts
src/lib/pdf.ts
src/lib/random.ts
src/lib/satellites.ts
src/lib/sgp4.ts
src/lib/sound.ts
src/lib/store.tsx
src/lib/types.ts
src/lib/weather.ts
tests/analog-index.test.mjs
tests/api.test.mjs
tests/archive-coverage.test.mjs
tests/bundle.test.mjs
tests/geometry.test.mjs
tests/live-coverage.test.mjs
tests/science.test.mjs
tests/sovereign-coverage.test.mjs
tests/world-layer.test.mjs
```

**Verdict**: the table in `docs/AGENT_FINDINGS_RECONCILIATION.md` §1.3 is wrong. All three live
files are **untracked and absent from `HEAD`**. The `??` markers were correct.

### 2.1 Consequences of the untracked set

| File | Imported by | Effect on a clean clone |
| --- | --- | --- |
| `server/live.mjs` | `server/api.mjs:11` (top-level import) | API crashes at module load: `ERR_MODULE_NOT_FOUND` |
| `src/lib/liveClient.ts` | `src/components/LiveMap.tsx:3` | `tsc -b` and `vite build` fail on an unresolvable module |
| `tests/coder-live.test.mjs` | test discovery only | live-provider tests silently absent |

`render.yaml` sets `branch: main` with `autoDeploy: true` (`[SRC]`), so any push that brings
`api.mjs` and `LiveMap.tsx` but not these three files produces a deployment that cannot start.

**Classification**: CONFIRMED — clean-clone / deployment blocker.

---

## 3. The `archive.ts` restoration incident

### 3.1 What is established

`[EXEC]`

* Current file: **299 lines**, mtime `2026-11-14 11:13:26`.
* `git diff src/lib/archive.ts` → no output; `git status` shows it unmodified.
* Exports (all 19): `ArchiveCell`, `ArchiveBundle`, `ARCHIVE_START`, `dayIndex`, `indexDate`,
  `attachArchive`, `archiveLoaded`, `archiveStamp`, `ArchiveCoverage`, `archiveCoverage`,
  `archiveStatus`, `ArchiveDayHit`, `archiveDay`, `archiveSupplementary`, `ConstellationWeights`,
  `constellationWeights`, `constellationSource`, `platformEquivalent`, `archiveRatio`.
* The three symbols `dailyCycleWeight`, `applyDailyCycleCorrection`,
  `archiveRatioWithDailyCycle` appear **zero times** in the file.

`[SRC]` `data.ts:51-53` still contains:

```ts
export {
  dailyCycleWeight,
  applyDailyCycleCorrection,
  archiveRatioWithDailyCycle,
} from './archive';
```

`[SRC]` `data.ts:1920` still calls `archiveRatioWithDailyCycle(region)`.
`[SRC]` `data.ts:532` defines a private `dailyCycleFromOverlap(...)` that has **no caller**
(`grep` across `src/ server/ scripts/ tests/` returns only the definition line).

### 3.2 Recovery sources examined

| Source | Method | Result |
| --- | --- | --- |
| `HEAD` | `git show HEAD:src/lib/archive.ts` | No symbols |
| All branches / history | `git log --all --oneline -S "dailyCycleWeight"` | **Empty** — never committed anywhere |
| Stash | `git stash list` | Empty |
| Reflog | `git reflog --all --date=iso` | No commit ever referenced the symbols; last moves are branch create / checkout |
| Dangling objects | `git fsck --lost-found --no-reflogs` → 30 blobs scanned with `git cat-file -p` | None contains `dailyCycleWeight`, `applyDailyCycleCorrection`, `archiveRatioWithDailyCycle`, `dailyCycleFromOverlap` |
| Archive-like blobs | scanned for `constellationWeights`/`ARCHIVE_START` | 8 blobs are `data.ts` variants (75–78 KB); the 3 KB hit is `server/analytics.ts`; **no `archive.ts` variant** |
| VS Code local history | History folder scan | No entry |
| Alternate copies | recursive filename search | None |
| Build artifacts | `dist-server/analytics.mjs`, `dist/assets/*.js` | Zero occurrences (esbuild tree-shakes the dead re-export) |
| Qoder session transcript | JSONL substring scan | Only self-referential matches from this audit; no function bodies |

### 3.3 Answers to the four Phase-2 questions

1. **What is recoverable?** Only the *consumer* shape: the names, their call site
   (`data.ts:1920`), and a partial, uncalled `dailyCycleFromOverlap` helper in `data.ts:532-589`.
2. **What is not recoverable?** The bodies of `dailyCycleWeight`, `applyDailyCycleCorrection` and
   `archiveRatioWithDailyCycle`. They were never staged, so Git never stored them; `git checkout --`
   discarded the working-tree copy and nothing else captured it.
3. **What is unknown?** Whether the lost `applyDailyCycleCorrection` was already a placeholder (as
   `[CLAIM]` Codex states) or a completed correction. The current tree cannot answer this.
4. **Which scientific functions were lost?** The daily-cycle weighting and the
   bridge-ratio-with-daily-cycle wrapper — i.e. the entire time-of-day correction layer that the
   Method page and five UI strings claim is applied.
5. **Does `data.ts` still depend on them?** Yes: the re-export block (51-53) and the call (1920).
   That dependency is the direct cause of 4 of the 16 TypeScript errors.

### 3.4 Independent corroboration that the loss is real

`[CLAIM]` The Codex science report cites `archive.ts:13-74` for `dailyCycleWeight`,
`archive.ts:87-102` for `applyDailyCycleCorrection`, and `archive.ts:532-583` for
`dailyCycleFromOverlap`. The current file is **299 lines**, so lines 405, 446, 477 and 532 cannot
exist, and lines 13-74 are the `ArchiveCell` interface and constants. Codex was therefore reading a
**pre-restoration file of at least 583 lines**, which no longer exists. Its line references are
stale; its descriptions cannot be verified against the tree.

### 3.5 Recovery recommendation

Do **not** attempt a byte-level restore. Re-implement the three functions against the surviving
contracts (`data.ts:1901-2050` shows the expected return shapes and the 13:30 reference hour) and
pin them with new tests. See roadmap item **P1-OS2 / P2-OS1**.

---

## 4. Files whose HEAD version differs from disk

| File | Tracked | Modified | Nature of the change |
| --- | --- | --- | --- |
| `server/api.mjs` | yes | yes (+14/−2) | adds `import './live.mjs'`, `startLive()`, `/live-firms` route, rate class A, exports `startLive/stopLive` |
| `src/components/LiveMap.tsx` | yes | yes (+55/−?) | adds live hook, status state, LIVE badge, slider, footer copy |
| `src/lib/data.ts` | yes | yes (+221) | adds re-export block, dead `dailyCycleFromOverlap`, dead `generateValidationReport` |
| `docs/validation.md`, `docs/validation-report.json`, `docs/e2e-report.json`, `docs/api-smoke-report.json` | yes | yes | regenerated report timestamps/results from earlier runs |

`src/lib/data.ts` mtime `2026-11-13 21:35`; `dist/` mtime `2026-11-13 17:38`; therefore **no build
has ever included the 221 added lines**. `dist/assets/*.js` contains no `/live-firms` string
(`[ART]`), confirming the running bundle predates the live work.

---

## 5. Ignored vs untracked

`[SRC]` `.gitignore` excludes `dist`, `dist-server`, `data_raw`. The three live modules are **not**
ignored — they are genuinely untracked new work that has not been `git add`-ed. No file in the
audited set is ignored-but-required.

---

## 6. Findings summary

| ID | Finding | Classification |
| --- | --- | --- |
| G-01 | `server/live.mjs` untracked and imported at module load | CONFIRMED |
| G-02 | `src/lib/liveClient.ts` untracked and imported by LiveMap | CONFIRMED |
| G-03 | `tests/coder-live.test.mjs` untracked | CONFIRMED |
| G-04 | Reconciliation table §1.3 mislabels tracked/untracked | CONFIRMED |
| G-05 | `archive.ts` restored to HEAD; daily-cycle functions lost | CONFIRMED |
| G-06 | Lost functions unrecoverable from Git, IDE history, artifacts or transcript | CONFIRMED (negative result) |
| G-07 | `data.ts` still depends on lost symbols | CONFIRMED |
| G-08 | Codex line references describe a ≥583-line file that no longer exists | CONFIRMED |
| G-09 | No build has included the 2026-11-13 data.ts additions | CONFIRMED (mtimes + bundle strings) |
| G-10 | Pre-existing uncommitted `archive.ts` work, if any, is unrecoverable | UNKNOWN (cannot prove what was there) |
