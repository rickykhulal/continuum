# Continuum — Phase D: Backfill Crash-Consistency Repair

**Date:** 2026-11-14
**Scope:** crash recovery of `scripts/backfill-archive.mjs` before the staged archive is resumed.
**Status:** implemented and unit-verified; the backfill itself was **not** run, `--heal` was **not** run,
the live staging pair, checkpoint, and lock were **not** modified, nothing was promoted, rebuilt, or committed.

---

## 1. Root cause

The previous `flush()` wrote the staging download and the resume checkpoint as two independent
operations:

```js
fs.writeFileSync(`${OUT}.tmp`, JSON.stringify(serialize()));
fs.renameSync(`${OUT}.tmp`, OUT);   // staging now has batch N+1
fs.writeFileSync(STATE, JSON.stringify(state)); // checkpoint may still be at batch N
```

Two separate renames/writes are not one transaction. Between the staging rename and the checkpoint
write, a crash, kill, or power loss leaves:

- **staging at batch N+1** (rows for the last windows are present), and
- **checkpoint at batch N** (cursor does not know those windows were fetched).

On restart the cursor re-requests the same windows. `aggregate()` adds their detections on top of
cells that are already in the file, and `state.rows` is advanced again — the exact double-count the
lock exists to prevent, now reachable through a single-process crash. The reverse interleaving (a
checkpoint written but staging lost) would claim coverage whose rows are gone, which the archive
overlay turns into observed zeros.

The prior lock did a check-then-write (`existsSync` → read PID → `writeFileSync`), so two processes
starting together could both believe they owned it.

## 2. Recovery protocol (implemented)

Module: `scripts/lib/archive-persistence.mjs`.

### 2.1 Batch ids

Both artefacts carry a monotonic integer `batch`:

- staging top level: `batch: <n>` — written by `serialize()` (`scripts/backfill-archive.mjs:309`);
- checkpoint top level: `state.batch` — incremented before every flush
  (`scripts/backfill-archive.mjs:338`).

Files written before this repair have no `batch` key and are read as batch 0
(`scripts/lib/archive-persistence.mjs:82-85`). Both existing pairs (frozen staging pair, published
pair) are batch-less, so the migration is nothing more than the first new flush writing batch 1.

### 2.2 Commit order

`commitArchiveFlush` (`scripts/lib/archive-persistence.mjs:119-132`):

1. refuse unless staging and checkpoint carry the same batch id;
2. write `<state>.tmp` (checkpoint payload, durable open/write/fsync);
3. write `<out>.tmp` (staging payload, durable);
4. rename `<out>.tmp` → `<out>` — **commit point**;
5. rename `<state>.tmp` → `<state>` — completion.

Each rename goes through `renameWithRetry` (5 attempts, 20–100 ms synchronous backoff) for the
transient Windows codes `EPERM/EBUSY/EACCES/ENOTEMPTY` (`:41-66`). `fsync` is best-effort; process-crash
safety does not depend on it (`:68-80`).

### 2.3 Recovery state machine

`recoverArchivePair` (`scripts/lib/archive-persistence.mjs:139-201`) runs at startup before any
window is fetched (`scripts/backfill-archive.mjs:232-248`):

| On-disk state | Action |
|---|---|
| neither file | remove stray temps, start empty |
| one file only | `PAIR_INCOMPLETE` — stop (the missing side cannot be rebuilt from the other) |
| same batch, rows agree | remove stray temps, resume normally (`recovered:false`) |
| staging = checkpoint + 1, `<state>.tmp` present, parses, same batch as staging, has `lanes`, rows agree | rename the temp into place, resume from it (`recovered:true`) |
| staging = checkpoint + 1, temp missing/corrupt/foreign batch | `CHECKPOINT_LAG` / `CHECKPOINT_TMP_UNREADABLE` — stop |
| checkpoint ahead of staging | `CHECKPOINT_AHEAD` — stop |
| same batch but `state.rows` ≠ staging cell sum | `PAIR_MISMATCH` — stop |
| staging or checkpoint unreadable | `STAGING_UNREADABLE` / `CHECKPOINT_UNREADABLE` — stop |

Every ambiguity exits the script with code **4** and the message
`backfill: refusing to guess; no window was fetched.` (`scripts/backfill-archive.mjs:243-245`).
Recovery never resets a cursor, never clears `lane.failed`, and never rewrites staging — it only
finishes a rename the previous process already committed.

### 2.4 Lock

`acquireWriterLock` (`scripts/lib/archive-persistence.mjs:228-263`):

- `writeFileSync(lock, pid, { flag: 'wx' })` — exclusive create removes the check-then-write race;
- an existing lock is refused if its PID is alive (exit 3); a dead PID is replaced with a log line;
- the release function deletes the lock only when its content is still this PID;
- retries the takeover up to 3 times, then throws `LockBusyError`.

Locks are per output path (`--out`), so independent outputs do not contend.

## 3. Changed files

| File | Status | Change |
|---|---|---|
| `scripts/lib/archive-persistence.mjs` | new | `RecoveryError`, `LockBusyError`, `renameWithRetry`, `batchOf`, `sumDetections`, `commitArchiveFlush`, `recoverArchivePair`, `acquireWriterLock`, `defaultIsAlive` |
| `scripts/backfill-archive.mjs` | modified (+42/−20) | imports the module (:26-33); lock via `acquireWriterLock` with exit 3 (:76-85); startup recovery with exit 4 (:232-248); `serialize()` emits `batch` (:309); `flush()` increments the batch and calls `commitArchiveFlush` (:330-340); header comment (:18-21) |
| `tests/archive-persistence.test.mjs` | new | 21 tests over temporary fixtures — no repository data is read or written |

`scripts/promote-archive.mjs` was reviewed, not changed; its integrity gates and remaining gaps are
recorded in §8.

## 4. Tests and exit codes

Command and result:

```
$ node --test tests/archive-persistence.test.mjs
ℹ tests 21  ℹ pass 21  ℹ fail 0
```

Mapping to the required scenarios:

| Required scenario | Test(s) |
|---|---|
| crash before staging persistence | "stale temp files are discarded and the previous batch is kept" — staging stays byte-identical (sha256) |
| crash after staging, before checkpoint | "recovery completes the checkpoint from its temp; no re-fetch is implied" |
| crash after checkpoint | "a fully written pair recovers as a no-op" |
| repeated recovery of the same batch | "the batch is applied exactly once — repeated recovery cannot duplicate detections" — 5 consecutive recoveries, cell sum stays 10, asserted ≠ 13 |
| corrupt/incomplete temp checkpoint | `CHECKPOINT_TMP_UNREADABLE` (garbage bytes) and `CHECKPOINT_LAG` (missing temp) |
| staging/checkpoint mismatch | `PAIR_MISMATCH` (row totals disagree), `CHECKPOINT_AHEAD`, foreign-batch temp → `CHECKPOINT_LAG` |
| stale lock recovery | dead-PID takeover with log line; live-PID refusal keeps the file; release never deletes another owner's lock; exclusive create |
| preservation of completed/failed windows | deep-equality on `lanes`, `failed`, `done`, `requests` across recovery |
| commit hygiene | both files carry the same batch and no `.tmp` remains; mismatched batch ids are refused before either file is touched |

Additional verification:

```
$ node --check scripts/backfill-archive.mjs && node --check scripts/lib/archive-persistence.mjs
SYNTAX_OK

$ node scripts/test.mjs
ℹ tests 192  ℹ pass 188  ℹ fail 0  ℹ skipped 4
```

The 4 skips are the keyed `coder-live` cases that require `FIRMS_MAP_KEY`; they skip by design in a
keyless environment. `git diff --check` exits 0 (one pre-existing CRLF notice on
`docs/validation.md`, untouched by this change).

Exit codes of `scripts/backfill-archive.mjs` after this repair:

| Code | Meaning |
|---|---|
| 0 | pass finished (or stop file honoured) |
| 2 | no MAP key configured |
| 3 | lock held by a live PID |
| 4 | ambiguous staging/checkpoint pair — nothing fetched |
| 130 | SIGINT after a forced flush |

## 5. Crash scenarios, end to end

1. **Crash before the staging rename.** Both files sit at batch N; `.tmp` files may exist. Recovery
   sees equal batches, verifies rows, deletes the temps, resumes at batch N. The windows held only
   in memory are re-requested against a staging file that never contained them — no duplication is
   possible because there is nothing to duplicate onto.
2. **Crash between the staging rename and the checkpoint rename.** Staging is batch N+1, checkpoint
   N, `<state>.tmp` holds batch N+1. Recovery validates the temp (batch, `lanes`, row sum), renames
   it, and resumes. The windows are not re-fetched; the batch is visible exactly once.
3. **Crash after both renames.** Equal batches, no temps; recovery is a no-op.
4. **Recovery fails mid-way** (kill during step 2's rename): staging stays N+1, state temp stays in
   place, checkpoint stays N. The next startup repeats the same deterministic recovery.
5. **Anything that does not match the two clean shapes** stops with exit 4 and a named code. A human
   restores a matching pair (for example the pre-resume copy of either file) rather than the script
   inventing a cursor.

## 6. Compatibility with the existing artefacts

Verified read-only against the frozen pair:

```
data_raw/firms_archive/archive_staging.json        batch: (absent → 0)
data_raw/firms_archive/state-archive_staging.json  batch: (absent → 0)
staging cell sum 12,154,655 = checkpoint rows 12,154,655  → agree
56 lanes, 22,452 requests
```

So the staged pair recovers as a consistent pair with `recovered:false` and the cursor resumes at the
recorded `done` counts; all 85 failed dates and every `lane.failed` entry are preserved because
recovery only reads and re-uses the checkpoint object.

The **default** published pair is already divergent from an older run and the new guard measures it:

```
public/data/archive_daily.json   cell sum 4,066,557
data_raw/firms_archive/state.json  rows 15
```

A run without `--out` now stops at `PAIR_MISMATCH` (exit 4) instead of silently adding to a staging
bundle that already holds rows its checkpoint does not know about. That is intended: the published
`archive_daily.json` is the output of a completed backfill, not a resume target. Resumption targets
the staged pair only.

Format impact: both artefacts gain a top-level `batch` integer on the first new flush. Existing
readers (`scripts/validate.mjs`, `scripts/promote-archive.mjs`, the archive tests, `src/lib/data.ts`
consumers) read named fields and ignore unknown keys; the full suite above confirms this.

## 7. Exact proposed resume procedure (not executed — awaits authorization)

Requirements before the step is taken: the archive is resumed only with explicit owner authorization,
and the MAP key is supplied through `FIRMS_MAP_KEY` or `~/.continuum/firms_map_key` — never pasted
into chat, logs, or this repository.

1. Confirm no writer is alive. Read the lock content and test liveness without printing any
   credential; expected PID is the dead `30648`. No manual lock removal is required — the new lock
   logic replaces a dead-PID lock automatically and logs `[lock] replacing stale lock from dead PID
   30648`.
2. Confirm the pair still agrees (read-only): staging cell sum must equal checkpoint `rows`, both
   batch-less. It is `12,154,655 = 12,154,655` at the time of this report. If these numbers no longer
   agree, stop — the environment changed after this verification.
3. Start the pass on the staged output only:

   ```
   npm run archive -- --out=data_raw/firms_archive/archive_staging.json --lanes=6
   ```

   Expected startup: `backfill start — … 22,452 requests already made, 12,154,655 rows already
   aggregated`, then `progress <lane> …` lines. No `[recover]` line should appear on this pair
   (it is consistent); if one does, it means a crash happened during the pass and was completed
   forward — the run can continue.
4. Stop conditions, in precedence:
   - exit **3** — another writer holds a live lock. Do not delete the lock; identify the process.
   - exit **4** — the pair became ambiguous. Do not edit, reset, or "repair" the files by hand
     without a recorded decision and a copy; report the code.
   - `AUTH —` lines — the key was refused; nothing recorded, resumable.
   - the `STOP` file (`data_raw/firms_archive/STOP`) — graceful checkpoint at the next window.
5. After the pass completes, re-measure every lane's `done` against its window count; only lanes at
   their end are complete. Row totals are aggregation counts, never unique fires, and are not proof
   of completion on their own.
6. `--heal` remains a separate operation and is **not** part of this resume procedure; it needs its
   own authorization.

## 8. Remaining risks and limits

- **Two renames are not one atomic transaction.** That is exactly what the checkpoint temp + batch
  ids exist to cover. A crash is recoverable; a *human* copying only one of the two files creates an
  ambiguous pair on purpose, and recovery will refuse it.
- **A temp file deleted externally before recovery** turns case 2 into `CHECKPOINT_LAG`: the script
  stops rather than guess. The remedy is manual restoration of a matching checkpoint copy.
- **Power-loss durability** relies on OS rename ordering, not on fsync (best-effort). Process-kill
  safety is the guaranteed property; disk-level crash consistency is not verified.
- **PID reuse**: a stale lock whose PID now belongs to an unrelated live process is refused. Safe,
  but requires manual investigation rather than automatic takeover.
- **Not verified:** a real kill-in-flight of the backfill process. Injecting it would start the
  backfill, which this phase forbids. The crash states are reproduced by constructing the on-disk
  files the crash would leave; the module code path is verified, the live process wiring is verified
  only by syntax/static inspection.
- **Promotion is unchanged and still outside this repair.** `scripts/promote-archive.mjs` validates
  schema, cell/cursor equality, and no-shrink coverage, and uses a single temp + rename, but takes no
  lock and keeps no backup. Do not run promotion concurrently with a backfill pass.
- The **default published pair remains divergent** (4,066,557 vs 15). This repair deliberately makes
  that path stop (exit 4). Reconciling or regenerating the published bundle is a later, separately
  authorised step.

## 9. Verification summary

| Check | Result |
|---|---|
| crash-consistency tests | verified — 21/21 pass |
| syntax of changed scripts | verified — `node --check` clean |
| full Node suite | verified — 192 tests, 188 pass, 0 fail, 4 keyed skips |
| frozen staging pair agreement | verified read-only — 12,154,655 = 12,154,655 |
| staging/checkpoint/lock unchanged | verified — mtimes 2026-11-13, contents untouched |
| `public/data`, `dist`, `dist-server` unchanged | verified — not modified |
| `src/lib/data.ts`, `src/pages/Brief.tsx`, `tests/b1-science.test.mjs` | verified untouched by this phase |
| real in-flight crash injection | not verified — would require starting the backfill |
| archive promotion | not run — out of scope |
