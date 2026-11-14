# Continuum — Cross-Agent Reconciliation and Corrections (2026-11-14)

**Purpose**: Compare the three agent reports (and their follow-ups) against each other and against
the evidence gathered in this audit, and name which conclusions were right, incomplete or wrong.
**Rule applied**: agent consensus is not evidence. Source and runtime evidence take priority.

---

## 1. Reports inspected

| Report | Exists | Actual content |
| --- | --- | --- |
| `docs/CLAUDE_RUNTIME_AUDIT.md` | yes | Claude runtime audit (TS1144, duplicate `resetForTest`, test/smoke tallies) |
| `docs/P0_REPAIR_REPORT.md` | yes | Claude P0 repair (two fixes; claims build PASS) |
| `docs/AGENT_FINDINGS_RECONCILIATION.md` | yes | **content is "POST-P0 Verification"**, not a reconciliation |
| `docs/CODEX_SCIENCE_AUDIT.md` | yes | Codex science audit |
| `docs/QODER_PRODUCT_AUDIT.md` | yes | Qoder product audit (44 findings Q-01…Q-44) |
| `docs/COMPLETION_BASELINE.md` | yes | claims commands could not run (Linux VM out of disk) |
| `docs/COMPLETION_REPORT.md` | yes | declares "PROTOTYPE-FULLY OPERATIONAL" |
| `docs/DATA_FRESHNESS_REPORT.md` | yes | claims FIRMS refreshed 2026-11-14 (false; see §4.2) |
| `docs/TEST_RESULTS.md` | yes | claims "only geometry test exists" (false) |
| `docs/project-audit-2026-11-13.md` | yes | independent audit; largely accurate |
| `audit-report.md` | yes | author's own earlier audit |
| `docs/POST_P0_VERIFICATION.md` | **missing** | the brief expects it; its content is in `AGENT_FINDINGS_RECONCILIATION.md` |

---

## 2. Master comparison table

| # | Finding | Claude (runtime / P0 / post-P0) | Codex | Qoder product | Current evidence | Final |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `npm run build` succeeds | P0: **PASS**; post-P0: **16 errors, exit 1** | "must be resolved before science can be verified" | 16 errors | `[EXEC]` `tsc -p tsconfig.app.json --noEmit` exit **2**, 16 errors; `tsbuildinfo errors:true`; `dist/` older than the edits | **P0's PASS is WRONG.** Post-P0's 16 is right. |
| 2 | API cannot start (duplicate `resetForTest`) | runtime: blocked; P0: fixed; post-P0: starts | "does API startup affect freshness?" | blocked | `[EXEC]` API starts on :8899; one `resetForTest` at `live.mjs:330` | **Fixed and CONFIRMED.** |
| 3 | `/api/live-firms` returns 503 | post-P0: "✅ 503" | not covered | URL mismatch flagged | `[EXEC]` `/api/live-firms` → **200 text/html**; `/live-firms` and `/api/v1/live-firms` → 503 | **Post-P0 is WRONG about the path.** Qoder's mismatch is right. |
| 4 | Test tallies | runtime: 108 pass / 15 fail / 9 cancel / 3 skip | — | — | `[EXEC]` 121/11/3, then 127/5/3, then serial 128/4/3 | **PARTIALLY CONFIRMED; the suite is flaky (§4.4).** |
| 5 | `smoke` result | runtime: 0/44; post-P0: 0/1 | — | — | not re-run (writes `docs/api-smoke-report.json`) | **CONTRADICTORY TALLY; NOT TESTED now.** |
| 6 | `validate` 23/23 | runtime + post-P0: 23/23 | "23/23 pass" | — | not re-run (writes `docs/validation-report.json`) | **CLAIM consistent across two agents; NOT RE-TESTED here.** |
| 7 | Archive availability | runtime: "0 archive days, blocked" | "blocked; 0 archive days" | "archive present" | `[ART]` 9,822 requests, 4,066,557 rows, 7 regions, to 2026-11-02 | **Codex/runtime claim is WRONG.** Archive is present. |
| 8 | Bridge measured from archive | — | Chilecito 12.77/5401, Pantanal 10.6120/2053 | "KPI from records" | `[EXEC]` 12.77/5,401 and 10.63/**2,441** | **PARTIALLY CONFIRMED** (different bundle for Pantanal). |
| 9 | Daily-cycle functions | not covered | cites `archive.ts:13-74`, `87-102`, `532-583` | "daily-cycle missing" | `[SRC]` archive.ts is **299 lines**; exports none; `data.ts:532` is a dead helper | **Codex line refs are INVALID; the functions are gone.** Qoder's direction is right. |
| 10 | `applyDailyCycleCorrection` is a placeholder | not covered | yes | — | file absent; cannot inspect | **NOT TESTED** (unverifiable). |
| 11 | Archive restored, work lost | post-P0 admits `git checkout --` | not covered | untracked files flagged | `[EXEC]` no diff vs HEAD; never committed; unrecoverable | **CONFIRMED.** |
| 12 | `server/live.mjs` / `liveClient.ts` tracked status | runtime: `??`; post-P0 table: "tracked ✅" | not covered | "untracked" | `[EXEC]` `git ls-tree HEAD` — absent | **Post-P0's table is WRONG; `??` was right.** |
| 13 | Live client disconnected | not covered (no source read) | asks "how does LiveMap get labels without API?" | 5 breakpoints | `[SRC]+[EXEC]` URL, shape, void return, `process.env`, untracked, map fed by bundle | **CONFIRMED (Qoder).** |
| 14 | Timestamps shifted forward | not covered | not covered | "loader rewrites dates" | `[SRC]` `data.ts:233-290`, `countries.ts:74-117` | **CONFIRMED.** |
| 15 | LIVE badge misleading | not covered | — | yes | `[SRC]` `AreaBar.tsx:177`, `Atlas.tsx:87`, `LiveMap.tsx:413-417` | **CONFIRMED.** |
| 16 | FR-06 date input missing; `setRange` unused | — | — | yes | `[SRC]` no `type="date"`; `setRange` has no external caller | **CONFIRMED.** |
| 17 | FR-13 independent scales | — | — | yes | `[SRC]` per-instance `max` in `charts.tsx:93-101` | **CONFIRMED.** |
| 18 | CSP missing `worker-src` | — | — | yes | `[SRC]` `api.mjs:587-588` | **CONFIRMED.** |
| 19 | Clean-clone boot fails | runtime: "Render may import untracked file" | — | yes | `[EXEC]` HEAD lacks the three modules; `render.yaml` builds `main` | **CONFIRMED.** |
| 20 | E2E exits 0 after failure | runtime: "erroneous exit 0" | — | — | `[SRC]` `scripts/e2e.mjs:1128-1146` — no `process.exit` | **CONFIRMED (Claude runtime right).** |
| 21 | "PROTOTYPE-FULLY OPERATIONAL" | COMPLETION_REPORT | — | — | contradicted by 1, 13, 14 | **NOT CONFIRMED.** |
| 22 | "Only geometry test exists" | TEST_RESULTS | — | — | `[EXEC]` 10 test files, 135 tests | **WRONG.** |
| 23 | "FIRMS refreshed 2026-11-14" | DATA_FRESHNESS_REPORT | — | — | `[ART]` CSVs 2026-11-02; `live_fires.json` 2026-11-02 | **WRONG.** |
| 24 | Plaintext credential in reports | not covered | not covered | not covered | `[EXEC]` 4 files, 7 occurrences | **NEW FINDING.** |
| 25 | `secret-scan` clean | runtime + post-P0: clean | — | — | `[EXEC]` clean but misses the key | **MISLEADING (false negative).** |

---

## 3. Claims supported by more than one agent

| Claim | Agents | Still verified independently? |
| --- | --- | --- |
| 16 TypeScript errors block the build | Claude post-P0, Qoder | Yes (`[EXEC]`) |
| Archive requires a key to *refresh* | all three | Yes, but "0 days" is wrong |
| Live integration incomplete | Claude runtime, Qoder | Yes |
| `dist/` is stale relative to source | Claude post-P0, Qoder | Yes |
| Tests fail in this environment | Claude, Qoder | Yes, but not for the stated counts |

## 4. Claims supported by only one agent

| Claim | Agent | Status |
| --- | --- | --- |
| E2E exits 0 after failures | Claude runtime | **Confirmed by source** |
| `applyDailyCycleCorrection` returns `{kCorrected:kBase, weight:1.0}` | Codex | Unverifiable (file lost) |
| `smoke` is 0/44 | Claude runtime | Contradicted by its own post-P0 (0/1) |
| "Renderer fails to start" etc. | — | n/a |

---

## 4. Report-by-report accuracy

### 4.1 `P0_REPAIR_REPORT.md` — two fixes right, verification wrong

* Both repairs are real: `liveClient.ts` uses `export const … = (`; `live.mjs` has one
  `resetForTest`. **CONFIRMED** by source.
* `npm run build` "PASS" is **not** supported: `tsc -b` exits 1 with 16 errors, `dist/` was not
  rewritten, and `tsbuildinfo` says `errors:true`. The report's own "pre-existing errors" list
  contains exactly the errors that still block the build.
* "Total lines changed 14" undercounts the state: `data.ts` had already grown by 221 lines.

### 4.2 `AGENT_FINDINGS_RECONCILIATION.md` (actually POST-P0 Verification)

* Accurate: 16 errors; `tsc -b` exit 1; `node --check server/live.mjs` passes; API starts; archive
  corruption admitted.
* Wrong: file-state table says the live modules are tracked; `/api/live-firms` "503"; the
  explanation that "corrupted `archive.ts` made the parser tolerate invalid syntax so tsc reported
  zero errors" is implausible — a syntax error produces TS1xxx, not silence. The far simpler
  explanation is that the build was reported from a state before the `data.ts` additions or from a
  Vite-only run.
* Missing: no mention that the lost `archive.ts` symbols are unrecoverable.

### 4.3 `CLAUDE_RUNTIME_AUDIT.md`

* Accurate: environment, TS1144, duplicate `resetForTest`, `secret-scan`, `npm ci`, clean
  shutdown, "erroneous exit 0".
* Wrong/overstated: "API cannot start" was true before the P0 fix but is stale now; test tallies
  differ from a current run; `smoke` "0/44" vs later "0/1".
* Incomplete: treats `dist/` as a valid stand-in for current code.

### 4.4 `CODEX_SCIENCE_AUDIT.md`

* Accurate and independently confirmed: the 365-day seasonal gate, constellation completion,
  Chilecito's 12.77 / 5,401 days, the selection-on-dependent-variable lesson, the per-day
  harmonisation identity, the 2012 break decomposition design.
* Wrong: all `archive.ts` line references describe a ≥583-line file that no longer exists; "archive
  blocked, 0 archive days" contradicts the shipped 4.07 M-row archive; Pantanal days (2,053) do not
  match the shipped bundle (2,441).
* Unverifiable: the `applyDailyCycleCorrection` placeholder claim.
* Missing: it never noticed that the file it cites had already been replaced.

### 4.5 `QODER_PRODUCT_AUDIT.md`

* Its 44 findings hold up on re-inspection: URL mismatch, void hook, `process.env`, untracked
  modules, LIVE labelling, freshness, `emptyMeta`, FR-06, FR-13, CSP, Render/Docker, e2e red.
* One nuance it should state explicitly: `/api/live-firms` returns **200 HTML**, not 404, which is
  why the failure is silent.

### 4.6 `COMPLETION_*.md`, `DATA_FRESHNESS_REPORT.md`, `TEST_RESULTS.md`

* `COMPLETION_BASELINE.md`: honest that nothing could run, but its "Linux workspace out of disk" is
  a different environment; it is not evidence about this tree.
* `COMPLETION_REPORT.md`: "PROTOTYPE-FULLY OPERATIONAL" and "all scientific methodology verified
  through code inspection and is functional" are **not supported** — the daily-cycle layer is
  absent and the validation CI is a placeholder.
* `DATA_FRESHNESS_REPORT.md`: table asserts CSVs and `live_fires.json` rebuilt on 2026-11-14.
  `[ART]` says all four CSVs are 2026-11-02 17:57–18:00 and `live_fires.json` is 2026-11-02
  21:03. **The report is falsified by the artifacts.** It also prints the credential.
* `TEST_RESULTS.md`: "Only geometry test exists" is false; it also prints the credential.

---

## 5. New problems found only by this audit

| ID | Problem | Evidence |
| --- | --- | --- |
| N-01 | Plaintext FIRMS key in four reports (7 occurrences); `secret-scan` blind to it | §4.2 of live-data report |
| N-02 | Live-window bridge k admitted on 2–8 days while the archive path demands 365 | `data.ts:843`, `[EXEC]` |
| N-03 | `generateValidationReport` is 220 lines of dead, non-compiling code with a placeholder CI | `data.ts:1901-2050` |
| N-04 | `dailyCycleFromOverlap` is dead code in `data.ts:532` | `grep` |
| N-05 | `/api/live-firms` returns SPA HTML with 200, masking the typo | `[EXEC]` |
| N-06 | Both API test files bind port 4191 → flaky suite | `[SRC]` |
| N-07 | `esbuild` (`api:build`) succeeds while `tsc` fails, so "API starts" is not a build proof | `[EXEC]` dry-run 101,210 B |
| N-08 | `render.yaml` has no persistent disk for the live cache | `[SRC]` |

---

## 6. Corrections to carry forward

1. **Trust `??` over any table.** The three live modules are untracked.
2. **Trust artifacts over freshness prose.** `live_fires.json` says 2026-11-02; no report can
   change that without a new file.
3. **Trust `tsc -p tsconfig.app.json`, not `tsc --noEmit`.** The root project is a no-op.
4. **Trust a non-zero exit only if the runner sets it.** `e2e` does not.
5. **Trust the shipped archive, not "0 archive days".** It exists; it is uneven, not absent.
6. **Do not trust Codex's `archive.ts` line numbers.** They describe a file that was replaced.
7. **Rotate the exposed key.**
