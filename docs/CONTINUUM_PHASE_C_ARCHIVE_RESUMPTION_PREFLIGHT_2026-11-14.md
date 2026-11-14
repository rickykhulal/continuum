# Continuum — Phase C: Archive Resumption Preflight (2026-11-14)

Status: **preflight complete; no archive operation performed.** Read-only throughout: the
daemon was not started, `--heal` was not run, the lock, checkpoint, and staging files
were not modified, nothing was promoted or regenerated, and nothing was committed.

Verdict: **resumption is READY to authorize** (dead PID, stale-but-takeover-safe lock,
consistent checkpoint/staging, credential reachable server-side). **Promotion is NOT
READY**: 4,695 windows remain, 85 windows are failed, and `promote-archive.mjs` has no
completion or failed-window guard.

---

## 1. Verified current state

Measured 2026-11-14 ~14:30 local, all read-only.

| Item | Value |
| --- | --- |
| Lock owner PID 30648 | **dead** (`Get-Process -Id 30648` → no process) |
| Lock contents | `30648` (5 bytes), mtime 2026-11-13 15:51:37 |
| Staging file | `archive_staging.json`, 1,337,993 B, mtime 2026-11-13 21:53:22.498 |
| Checkpoint | `state-archive_staging.json`, 4,712 B, mtime 2026-11-13 21:53:22.500 |
| Stage header | `generated_at` 2026-11-13T16:08:22.241Z, `start` 2000-11-01, schema `continuum-archive-1` |
| Requests (checkpoint and stage) | **22,452** |
| Aggregated rows (checkpoint, stage, and cell sum) | **12,154,655** |
| Lanes present | **56** (8 products × 7 regions) |
| Windows per lane | 1062 / 1887 / 609 / 250 / 19 / 13 / 19 / 19 by product (total **27,146**) |
| Cursor advances (Σ lane `done`) | **22,451** |
| Remaining windows | **4,695** (all in Standard Processing lanes; every NRT lane is complete) |
| Failed windows recorded | **85** (inside the 22,451 cursor; needs `--heal`) |
| Active backfill process | **none** (only Codex runtime node processes are running) |
| `STOP` file | absent |
| Other files | `state.json` (mtime 2026-11-12), `state.race-2026-11-02.json`, `backfill.log` (mtime 2026-11-02) — unchanged |

**Nothing in `data_raw/firms_archive/` has changed since the Phase A handover.** Sizes,
mtimes, request count, row count, lane counts, and failure counts all match the handover
report exactly (`docs/CONTINUUM_ANTIGRAVITY_HANDOVER_AND_BACKFILL_STATUS.md` lines
96–107, 137–140). The only working-tree changes since then are Phase B's live-lane
source/test edits, which touch no archive file (`data_raw` is gitignored, `.gitignore:14`).

### Window accounting reconciles

```
22,366 successful windows + 85 permanently failed = 22,451 cursor advances
22,451 advances + 1 non-advancing attempt        = 22,452 requests
4,695 remaining + 22,451 advances                = 27,146 expected windows
```

The single non-advancing request is the only unexplained unit. The code allows exactly
one such cause: a `fetchWindow` that returned `stop`/`auth` (`scripts/backfill-archive.mjs:476–481`),
or a heal attempt (`:521`). Neither is persisted with a reason, and the 2026-11-13 run
left no log, so it is **attributed by inference, not by evidence**. It must be recorded
as such rather than called "close enough".

### Failed-window distribution (85)

| Lane | Failed | Note |
| --- | --- | --- |
| `VIIRS_SNPP_SP / amazon` | 13 | |
| `VIIRS_SNPP_SP / southeast-australia` | 14 | |
| `MODIS_SP / amazon` | 4 | |
| `VIIRS_NOAA20_SP / california` | 1 | |
| `VIIRS_NOAA20_SP / amazon` | 18 | |
| `VIIRS_NOAA20_SP / nepal` | 3 | |
| `VIIRS_NOAA20_SP / southeast-australia` | 11 | **lane already at 609/609 — queue will never revisit it** |
| `VIIRS_NOAA21_SP / amazon` | 18 | |
| `VIIRS_NOAA21_SP / nepal` | 1 | **lane already at 250/250 — heal-only** |
| `VIIRS_NOAA21_SP / southeast-australia` | 2 | **lane already at 250/250 — heal-only** |

By product: SNPP_SP 27, MODIS_SP 4, NOAA20_SP 33, NOAA21_SP 21.
By region: amazon 53, southeast-australia 27, nepal 4, california 1, others 0.
Full date lists are in the checkpoint (`lane.failed`) and reproduced in Appendix A.

**14 of the 85 failures sit in lanes whose cursor is already at the end.** A normal
resume pass skips those lanes entirely (`backfill-archive.mjs:335`); only `--heal`
re-requests them. Resuming without healing would leave those 14 windows as permanent
implied zeros while the lane reports "complete".

### Remaining work by lane

| Lane | done / windows | remaining |
| --- | --- | --- |
| `VIIRS_SNPP_SP / california` | 508 / 1062 | 554 |
| `VIIRS_SNPP_SP / greece` | 354 / 1062 | 708 |
| `VIIRS_SNPP_SP / amazon` | 409 / 1062 | 653 |
| `VIIRS_SNPP_SP / southeast-australia` | 961 / 1062 | 101 |
| `MODIS_SP / pantanal` | 1295 / 1887 | 592 |
| `MODIS_SP / amazon` | 1376 / 1887 | 511 |
| `MODIS_SP / nepal` | 1486 / 1887 | 401 |
| `VIIRS_NOAA20_SP / california` | 177 / 609 | 432 |
| `VIIRS_NOAA20_SP / amazon` | 178 / 609 | 431 |
| `VIIRS_NOAA20_SP / nepal` | 435 / 609 | 174 |
| `VIIRS_NOAA21_SP / amazon` | 112 / 250 | 138 |

All 28 NRT lanes (4 products × 7 regions) are complete with zero failures.

### Staging integrity (read-only recomputation)

- 85,229 day-cells; Σ detection counts = **12,154,655** = `stage.rows` = checkpoint rows.
- 111,776 covered sensor-days → **26,547 implied zero days** (covered, no cell), and
  **0 cells outside their covered ranges**.
- 28 sensor lanes with day data; `covered` present for all 4 sensors × 7 regions.
- Provenance fields present: `schema`, `generated_at`, `start`, `method`, `sources`
  (id, sensor, min, max per product), `requests`, `rows`.
- The stage would pass the current promotion guards, which is exactly why a completion
  guard is required — it is internally consistent but **partial**.
- Published baseline for comparison: `public/data/archive_daily.json` (generated
  2026-11-02) holds 30,529 day-cells / 4,066,557 detections from 9,822 requests. The
  staged partial overlay is 2.8× larger and would pass the no-shrink guard, publishing
  4,695 missing windows and 85 failures without complaint.

## 2. Resume command and exact behavior

### Command

```
npm run archive -- --out=data_raw/firms_archive/archive_staging.json
```

(`package.json:20` → `node scripts/backfill-archive.mjs`; the `--out` flag selects the
staging path and the matching checkpoint, `backfill-archive.mjs:33–39`.)

Optional, safe knobs: `--lanes=6` (concurrency, default 6), `--rate=60` (requests/min
cap, default 60), `--flush=60` (windows between checkpoint writes, minimum 10),
`--max-windows=N` (bounded pass, useful for a first supervised run).

Never use `--reset-failed` (see §4). Do not run `--heal` in the same invocation as the
resume pass; run it as a separate pass afterwards.

### Verified behaviors

| Question | Answer | Source |
| --- | --- | --- |
| Are completed windows skipped? | Yes. Lanes at `done >= wins.length` are dropped from the queue; each lane resumes at `wins[lane.done]`. | `backfill-archive.mjs:327–339`, `:465`, `:474` |
| Is the checkpoint authoritative? | Yes. Lane cursors and failure lists are read from `state-archive_staging.json`; coverage ranges are derived from the cursors, never from rows. | `:39`, `:226`, `:243–263`, `:333` |
| Can a rerun duplicate completed records? | Not in normal operation. One narrow exception: a crash between the staging rename and the checkpoint write re-fetches the last flush batch and double-counts it (see §4, R1). | `:313–317` |
| Can an interrupted write corrupt staging? | Staging no: written to `OUT.tmp` then renamed. Checkpoint yes: `writeFileSync` is not atomic; a crash mid-write can truncate it, and the next run aborts at `JSON.parse`. | `:313–316`, `:317`, `:226` |
| Are retries automatic? | Yes for network (5 backoff attempts), throttle (6 cooldowns), auth (8 cooldowns), and budget (20 waits). Only after those does a window become permanently failed. | `:390–459`, `:419–428`, `:431–440`, `:442–451` |
| Is `--heal` limited to failed windows? | Yes. It iterates only `lane.failed`, never completed windows, and clears a window from the list only when it answers. | `:502–542` |
| Are failure details recoverable? | The **dates** are (checkpoint `lane.failed`). The **reason** is printed to console only and is not persisted; the 2026-11-13 run has no log, so past reasons are unavailable. | `:483–488` |
| Is resume idempotent? | Yes at window granularity, except R1 and barring manual checkpoint edits. | `:463–500`, §4 |
| Is the lock used safely? | Mostly. Alive-owner refusal, dead-owner takeover, release on exit; but the existence check and write are not atomic, so two simultaneous starters could both acquire it. | `:66–82` |
| Can it stop cleanly and keep progress? | Yes. `STOP` file is checked between windows and forces a flush; SIGINT flushes; `--max-windows` ends the pass and flushes. | `:365–368`, `:467–472`, `:555`, `:561` |

### What a resume pass will do

1. Read the key (environment, else `~/.continuum/firms_map_key`), abort if absent.
2. Take over the stale lock from dead PID 30648 (prints `[lock] replacing stale lock...`).
3. Delete nothing. Rehydrate the 85,229 existing cells from staging.
4. Queue only the **11 lanes that still have windows** (4,695 windows), NRT-first then
   SP, least-covered lane first. All 28 NRT lanes and the 17 SP lanes whose cursor has
   reached the end are skipped — including the 3 end-of-lane SP lanes that still hold 14
   failed windows, which only `--heal` can repair.
5. Fetch at ≤60 requests/min, 5 transactions per window. **4,695 windows ≈ 79 minutes of
   pacing minimum**, plus ~85 heal requests, transaction-budget waits (≈23,475
   transactions at 5/window), and throttles. Plan **1.5–2.5 hours**, not minutes.
6. Flush staging + checkpoint every 60 windows and on stop. On completion every lane has
   `done == wins.length`; the 85 failures remain until `--heal`.

## 3. Credential readiness

| Check | Result |
| --- | --- |
| `FIRMS_MAP_KEY` in this shell environment | **absent** (value never read; presence test only) |
| `MAP_KEY` alternative | absent |
| Key file `C:\Users\Ricky\.continuum\firms_map_key` | **present** (32 bytes; content not read) |
| Can the resume process reach it? | **Yes.** `readKey()` tries env first, then `HOME \|\| USERPROFILE` + `.continuum/firms_map_key`; Git Bash sets `HOME=C:\Users\Ricky`, PowerShell sets `USERPROFILE` to the same. Value is trimmed, so a trailing newline is harmless. | `backfill-archive.mjs:44–51` |
| Server-side only? | **Yes.** The key is used only by the Node CLI for FIRMS requests and the status endpoint. `serialize()` writes schema, sources, requests, rows, regions — no key. Errors log a 60-char body slice, not the URL. No browser bundle reads it. | `:129`, `:282–304`, `:414` |
| Command history exposure? | **Avoidable.** Because the file fallback exists, `npm run archive -- --out=...` needs no inline key, so nothing secret enters shell history. Setting `FIRMS_MAP_KEY=...` inline (especially in PowerShell) would persist it in PSReadLine history — do not do that. | `:44–51` |

No blocker: the credential is reachable without any chat exposure or inline command.
Key ownership: the preflight never printed, copied, or hashed the value.

## 4. Completion and quality gate

Promotion is refused unless **all** of the following hold. Total row count alone is
never sufficient.

1. **56 lanes accounted for.** Every `${source.id}|${region.id}` exists in the
   checkpoint (8 products × 7 regions). No lane may be absent, and no extra lane may
   appear.
2. **Every lane complete.** For each lane, `done == windows(source.min, source.max)`.
   Expected total: 27,146 windows.
3. **Failures resolved or explicitly waived.** Every lane has `failed.length == 0`, or a
   dated, written waiver lists the exact dates and the reason. A failure may never be
   erased with `--reset-failed` — that clears the record without re-fetching, because the
   cursor has already advanced past those windows (`:334`, `:485–486`).
4. **Request accounting closes.** Starting from 22,452, every increment equals a fetched
   window, a failed window, a heal attempt, or a recorded non-advancing attempt. The
   current `+1` must stay labelled "inferred" until a logged run supersedes it.
5. **No duplicate-window accounting.** Σ `done` + remaining == 27,146; Σ lane `rows` ==
   `state.rows` == stage Σ cells; a healed window increases rows by exactly its counts
   and is removed from `failed` once.
6. **Coverage reconciled per product and per region.** Recompute the 8×7 matrix
   (`done`, `remaining`, `failed`, `rows`) from the checkpoint and require remaining = 0
   and failed = 0 everywhere. Region totals must sum to `state.rows`.
7. **Missing ≠ observed zero.** Covered ranges synthesize zeros only for covered days;
   currently 26,547 implied zeros across 111,776 covered sensor-days. After the resume,
   the covered-day count grows by exactly the newly completed windows' days, and the
   zero share must be reported, not hidden.
8. **Acquisition dates and provenance preserved.** `acq_date` is aggregated to a day
   index; `generated_at`, `start`, `method`, and per-product `sources` (with min/max)
   must remain in the stage. Per-sensor provenance stays separated in
   `regions[].days[sensor]`.
9. **Invalid-coordinate and missing-value counts: unavailable.** `aggregate()` silently
   drops non-finite lat/lon (`:211`), out-of-bbox rows (`:212`), non-finite day indexes
   (`:215`), and non-positive FRP (`:220`). The archive records none of those counts.
   The completion report must state **"not recorded by the archive — unavailable"**
   rather than infer a number.
10. **Language.** 12,154,655 is an aggregated detection-row count, never "unique fires".

## 5. Recovery risks

| # | Risk | Evidence | Severity | Mitigation (not applied) |
| --- | --- | --- | --- | --- |
| R1 | Crash between staging rename and checkpoint write re-fetches one flush batch and double-counts it; the `rows == cells` check cannot see symmetric double counting. | `:313–317` | Low likelihood, high silence | Write checkpoint before staging (a rows>cells mismatch then fails promotion safely), or flush both through tmp+rename with a combined commit marker. |
| R2 | Checkpoint `writeFileSync` is non-atomic; a crash can truncate it and abort the next run at `JSON.parse`. | `:317`, `:226` | Low | Copy the checkpoint before the run (`state-archive_staging.pre-resume.json`); if truncated, the staging file still holds the cells — rebuild the cursor only by accounting for them. |
| R3 | Lock acquisition is check-then-write, not atomic; two simultaneous starters can both write. | `:67–80` | Low (single operator) | Use an exclusive create (`wx` flag). |
| R4 | `--reset-failed` erases failure records without re-fetching; those windows become permanent zeros behind the cursor. | `:334`, `:485–486` | High if misused | Never run it. Use `--heal`. |
| R5 | Lanes already at `done == wins.length` with failures are never queued; a plain resume leaves them incomplete silently. | `:335` | High | Run `--heal` after the resume; verify `failed == 0` for all 56 lanes before promotion. |
| R6 | PID reuse can make a stale lock look alive (refuses to start) — a safe failure, but confusing. | `:68–76` | Low | Inspect the PID; do not delete the lock blindly. |
| R7 | No run log for the interrupted pass; failure reasons and the `+1` request are unrecoverable. | no log after 2026-11-02 | Medium (evidence) | Capture stdout of the resume to `data_raw/firms_archive/backfill-2026-11-14.log` (gitignored). It contains no secret. |
| R8 | FIRMS budget/key throttling can stop the pass with the cursor untouched. | `:415–440`, `:419–428` | Medium | Expected and safe: the pass is resumable; re-run when the key answers. |

No risk requires touching the lock or checkpoint now. R1/R2 are pre-existing design gaps
to record, not reasons to block resumption.

## 6. Promotion safety review (`scripts/promote-archive.mjs`)

### Current guards

| Guard | Present? | Behavior |
| --- | --- | --- |
| Stage exists | Yes | exit 2 (`:24–27`) |
| Schema `continuum-archive-1` | Yes | exit 2 (`:30–33`) |
| Non-empty overlay | Yes | exit 2 when 0 observed days (`:54–57`) |
| Cells sum == cursor rows | Yes, only when `rows` is numeric | exit 2 (`:66–69`); a stage without numeric `rows` bypasses it |
| No coverage shrink vs published | Yes, by total day count only | exit 2 (`:71–76`) |
| 56-lane completion | **No** | a partial but consistent stage is accepted — the current stage would pass |
| Failed-window guard | **No** | 85 failed windows are invisible to promotion |
| Concurrency lock | **No** | two promotions can race the same temp file |
| Unique temp filename | **No** | fixed `${DEST}.tmp` (`:79`) |
| Backup / rollback | **No** | prior bundle overwritten by rename, no copy |
| Hash recording | **No** | no sha256 of stage or destination |
| Write verification | **No** | no re-read after rename |
| Idempotency | Effectively yes | rewriting identical stage bytes is harmless |

### Minimum changes to prevent promoting incomplete staging

Ordered by necessity; **none implemented**.

1. **P0 — completion guard.** Before writing, read the sibling checkpoint
   `state-<basename>.json`, require exactly 56 lanes, and for every lane
   `done === windows(min, max)` and `failed.length === 0`. Compute the expected window
   counts from `stage.sources` (already serialized) so the guard cannot drift from the
   backfill constants. Refuse with exit 2 and the offending lane list.
2. **P0 — same-flush identity.** Require `stage.rows === checkpoint.rows` and
   `stage.requests === checkpoint.requests`, so a stale stage is never promoted after the
   checkpoint has moved.
3. **P1 — no promotion during a run.** If `<stage>.lock` exists with a live PID, refuse;
   if dead, allow (and say so).
4. **P1 — promotion lock + unique temp.** Acquire `public/data/archive_daily.json.lock`
   (PID, stale takeover), write `${DEST}.tmp.${process.pid}.${Date.now()}`, rename, release.
5. **P1 — backup/rollback.** Copy the existing `archive_daily.json` to
   `data_raw/firms_archive/archive_daily.previous.json` before rename; restore it if the
   post-write hash check fails.
6. **P2 — hash record.** sha256 the stage before and the destination after; require
   equality, print both, and leave the value for `npm run bundle` to fold into the
   manifest (`scripts/bundle.mjs:48`).
7. **P2 — per-region non-shrink.** Compare per-region day counts and detection sums, not
   just the global day total, so one region cannot shrink while another grows.
8. **P2 — stage self-description.** Add a small `lanes: {done, failed}` summary to
   `serialize()` so the artifact states its own completeness and promotion needs no
   sibling file. (Backfill change; requires an authorized edit phase.)

Current promotion of the existing stage would **succeed** and publish a partial archive
with 4,695 missing windows and 85 failures — this is the concrete hazard the P0 guards
close.

## 7. Recommended execution sequence (after explicit authorization)

1. **Snapshot evidence (read-only copy):** copy `state-archive_staging.json` to
   `state-archive_staging.pre-resume-2026-11-14.json`; record staging sha256. Do not edit
   the originals.
2. **Supervised probe:** run one bounded pass, e.g.
   `npm run archive -- --out=data_raw/firms_archive/archive_staging.json --max-windows=20`,
   with stdout captured to `data_raw/firms_archive/backfill-2026-11-14.log`. Confirm the
   lock was taken over, windows advance, staging and checkpoint grow together, and no
   auth/throttle stop occurred.
3. **Full resume pass:** same command without `--max-windows`. Let it run to completion or
   stop it with the `STOP` file (never kill mid-write). Expect ~1.5–2.5 h.
4. **Heal pass:** `npm run archive -- --out=... --heal`. Expect ≤85 requests; record
   recovered vs still-failing per lane and date.
5. **Completion audit (read-only):** recompute the 8×7 matrix; require 56 lanes,
   `done == expected` everywhere, `failed == 0` (or written waivers), Σrows == stage
   cells == checkpoint rows, and request accounting closed.
6. **Promotion-safeguard implementation:** a separate authorized code phase adds the P0
   guards (and, if approved, P1/P2). No promotion before this lands.
7. **Promote:** `npm run archive:promote`, then `npm run data`, `npm run bundle`,
   `npm run build`, `npm test`, `npm run validate` in the documented chain order.
8. **Record:** update the handover/evidence docs with the measured before/after numbers.
   Never describe 12,154,655 as unique fires.

Step 6 is a precondition for step 7, not optional.

## 8. Explicit blockers

| Blocker | Status | Resolution |
| --- | --- | --- |
| Authorization to start the daemon | **blocked by instruction** (this phase is preflight only) | owner authorizes step 2 |
| 4,695 windows incomplete | **blocked until resume** | steps 2–3 |
| 85 failed windows, 14 in end-of-lane lanes | **blocked until heal** | step 4 |
| Promotion has no completion/failed guard | **blocked until code change** | step 6 |
| `+1` request discrepancy lacks a log | **unresolved** — inference only | new run log; keep the label honest |
| Credential | **not a blocker** — file present, env absent, no exposure needed | use file fallback |
| Stale lock PID 30648 | **not a blocker** — dead; script takes over safely | automatic |
| Failure reasons for the 2026-11-13 run | **unavailable** — no log, not persisted | record as unavailable |

## 9. Evidence and source references

- `scripts/backfill-archive.mjs:44–57` key resolution; `:66–82` lock; `:95, 502–542` heal;
  `:157–166` product date ranges; `:170–181` window generator; `:226–279` checkpoint and
  rehydration; `:281–318` serialization and flush; `:327–360` queue; `:368, 467–472, 555`
  stop paths; `:388–461` fetch/retry/budget; `:463–500` lane loop and failure recording.
- `scripts/promote-archive.mjs:16–18` stage/destination; `:24–57` existence/schema/empty
  guards; `:59–69` rows-vs-cells; `:71–76` no-shrink; `:78–81` fixed temp + rename.
- `package.json:20–22` archive, promote, bundle scripts.
- `scripts/bundle.mjs:48` `archive_daily.json` in the manifest.
- `docs/CONTINUUM_ANTIGRAVITY_HANDOVER_AND_BACKFILL_STATUS.md:96–107, 137–140, 209–213,
  232, 237, 350` prior state, window math, partial-stage hazard, request-accounting rule.
- `docs/CONTINUUM_PHASE_B_LIVE_LANE_REPAIR_2026-11-14.md` the only working-tree changes
  since the handover, none in `data_raw/`.
- File measurements taken this phase: staging/checkpoint/lock sizes and mtimes as listed
  in §1; PID liveness via `Get-Process -Id 30648` (dead); `Get-CimInstance Win32_Process`
  for node/backfill matches (none); key-file presence only (never read).

## Appendix A — the 85 failed window dates (from the checkpoint)

```
VIIRS_SNPP_SP|amazon (13):
2014-08-12 2014-08-17 2015-08-12 2015-08-17 2015-09-06 2015-09-16 2015-09-21
2015-10-01 2015-10-16 2015-10-21 2016-09-05 2016-09-10 2016-10-15
VIIRS_SNPP_SP|southeast-australia (14):
2019-11-04 2019-11-09 2019-11-14 2019-11-19 2019-11-29 2019-12-04 2019-12-14
2019-12-19 2019-12-24 2019-12-29 2020-01-03 2020-01-08 2020-01-13 2020-01-28
MODIS_SP|amazon (4):
2004-09-06 2005-09-16 2007-09-06 2007-09-11
VIIRS_NOAA20_SP|california (1):
2020-08-18
VIIRS_NOAA20_SP|amazon (18):
2018-09-03 2018-09-08 2019-07-30 2019-08-04 2019-08-09 2019-08-14 2019-08-19
2019-08-24 2019-08-29 2019-09-08 2019-09-13 2019-09-18 2020-07-29 2020-08-03
2020-08-08 2020-08-13 2020-08-18 2020-09-02
VIIRS_NOAA20_SP|nepal (3):
2019-04-16 2021-03-31 2021-04-10
VIIRS_NOAA20_SP|southeast-australia (11):
2019-05-06 2019-11-07 2019-11-12 2019-11-17 2019-12-02 2019-12-07 2019-12-17
2019-12-27 2020-01-01 2020-01-11 2020-01-31
VIIRS_NOAA21_SP|amazon (18):
2023-08-13 2023-08-18 2023-08-23 2023-09-02 2023-09-07 2023-09-12 2023-09-17
2023-10-07 2023-10-27 2024-07-28 2024-08-02 2024-08-07 2024-08-12 2024-08-17
2024-08-22 2024-08-27 2024-09-01 2024-09-06
VIIRS_NOAA21_SP|nepal (1):
2024-04-29
VIIRS_NOAA21_SP|southeast-australia (2):
2024-03-30 2026-01-09
```

## Appendix B — lane totals after this phase (56 lanes, unchanged)

| Product | Windows/lane | Done | Remaining | Failed | Rows |
| --- | --- | --- | --- | --- | --- |
| VIIRS_SNPP_SP | 1062 | 5,418 | 2,016 | 27 | 4,548,503 |
| MODIS_SP | 1887 | 11,705 | 1,504 | 4 | 3,362,223 |
| VIIRS_NOAA20_SP | 609 | 3,226 | 1,037 | 33 | 2,305,734 |
| VIIRS_NOAA21_SP | 250 | 1,612 | 138 | 21 | 1,184,709 |
| VIIRS_SNPP_NRT | 19 | 133 | 0 | 0 | 240,130 |
| MODIS_NRT | 13 | 91 | 0 | 0 | 42,299 |
| VIIRS_NOAA20_NRT | 19 | 133 | 0 | 0 | 238,386 |
| VIIRS_NOAA21_NRT | 19 | 133 | 0 | 0 | 232,671 |
| **Total** | **27,146** | **22,451** | **4,695** | **85** | **12,154,655** |

## Stop point

Preflight complete. No daemon started, no `--heal`, no lock or checkpoint change, no
promotion, no dataset or bundle regeneration, no commit or push. Waiting for explicit
authorization before any archive operation.
