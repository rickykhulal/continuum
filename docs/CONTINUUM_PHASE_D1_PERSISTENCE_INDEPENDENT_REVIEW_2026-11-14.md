# Continuum — Phase D.1: Independent Persistence Review

**Date:** 2026-11-14
**Mode:** read-only. No backfill, heal, promotion, bundle, or dataset run. The staging archive,
checkpoint, lock, and published data were not modified. Two probes were executed in OS temp
directories only and are cited as evidence.
**Artifacts under review:**

- `scripts/lib/archive-persistence.mjs` (commit/recovery/lock protocol)
- `scripts/backfill-archive.mjs` (call sites, ordering, rehydrate, flush)
- `tests/archive-persistence.test.mjs` (21 simulations)
- `docs/CONTINUUM_PHASE_D_BACKFILL_CRASH_CONSISTENCY_2026-11-14.md` (Phase D claims)

**Verdict: SAFE TO RESUME** — for a single, supervised backfill process against the staging pair,
under the pre-resume conditions in §7. No BLOCKER was found in the commit/recovery protocol.
Three lock-liveness weaknesses (F1–F3) do not affect a single-writer run but must be fixed before
any supervised/automatic restart that could start two processes; if single-start cannot be
guaranteed, the verdict degrades to **SAFE ONLY AFTER FIXES**.

---

## 1. Scenario matrix

| # | Scenario | Exact code path | Result | Class |
|---|---|---|---|---|
| 1 | Crash before staging write | `commitArchiveFlush` dies before `renameWithRetry(outTmp,out)` (`archive-persistence.mjs:126-130`); recovery same-batch branch (`:167-172`) discards both temps | Committed pair stays at batch N, byte-identical; the uncommitted windows are re-fetched against a staging that never held them | **PASS** |
| 2 | Crash during staging temp write | `writeFileDurable(outTmp)` (`:129`, `:68-80`); partial `outTmp` never renamed; recovery same-batch discards it (`:169-170`) | A torn temp is never promoted; staging unchanged | **PASS** |
| 3 | Crash after staging replace, before checkpoint replace | Commit point `rename outTmp→out` (`:130`) done, `rename stateTmp→state` (`:131`) not; recovery `outBatch === stateBatch+1` branch (`:174-195`) validates the temp and renames it (`:192`) | The batch is completed forward, never applied twice; staging is not rewritten | **PASS** |
| 4 | Crash during checkpoint temp write | `writeFileDurable(stateTmp)` (`:128`) torn, no rename occurs; recovery same-batch discards it | Torn checkpoint temp cannot be adopted; batch re-fetched | **PASS** |
| 5 | Crash after checkpoint replace | Both files at N+1, no temps; recovery same-batch (`:167-172`) verifies rows, removes nothing | No-op resume | **PASS** |
| 6 | Repeated recovery of a committed batch | Second call sees equal batches (`:167`); `removeQuietly` no-ops | Idempotent; test proves 5 iterations with sum unchanged at 10 (`tests:143-159`) | **PASS** |
| 7 | Two processes acquire the lock | `writeFileSync(lock,pid,{flag:'wx'})` (`:235`) is atomic; loser gets `EEXIST` | Fresh lock: safe (loser refuses on live PID). Stale lock: **not fully race-safe** — F1/F2 | **WARNING** |
| 8 | PID reuse / stale-lock detection | `defaultIsAlive` (`:214-222`) → `process.kill(pid,0)`; any throw means dead; `owner===0` skipped (`:251`) | Fail-closed on a recycled live PID (spurious exit 3); fail-open on access-denied and empty content — F2/F3/F4 | **WARNING** |
| 9 | Windows rename/replace | `renameWithRetry` (`:53-66`), 5 attempts, 20/40/60/80 ms backoff on `EPERM/EBUSY/EACCES/ENOTEMPTY` | Replace-over-existing is exercised on this NTFS host by every commit test (21/21 pass); retry path is not fault-injected; exhaustion aborts with a recoverable pair — F9 | **PASS (with WARNING F9)** |
| 10 | Legacy pairs without `batch` | `batchOf` maps absent/invalid to 0 (`:82-85`); same-batch branch requires rows agreement (`:203-212`) | Staged pair reads 0/0 and agrees (12,154,655 = 12,154,655) → clean resume; published pair diverges (4,066,557 vs 15) → exit 4, nothing fetched | **PASS** |

---

## 2. Required properties

| Property | Answer | Evidence |
|---|---|---|
| Batch IDs durable and uniquely associated with committed data | **Yes, with a caveat.** The id is inside the JSON payload fsynced to the temp *before* the rename that publishes it (`:128-131`, `:68-80`). Per single writer it is monotonic and identifies exactly one payload pair. It is **not** a content hash; lineage is only as unique as the writer lineage (F10). | code + `batchOf` tests (`tests:301-306`) |
| Recovery distinguishes committed / uncommitted / ambiguous batches | **Yes.** Committed: equal batches + rows agree. Uncommitted: equal batches + temps (temps discarded). Committed-staging-only: `out = state+1` + validated temp. Everything else raises a named `RecoveryError` and exits 4 before any window is fetched (`backfill:236-247`, `:244`). One misclassification exists for a **fresh** output (F5): `PAIR_INCOMPLETE` although a complete checkpoint temp exists. | code + tests `176-242`; probe in §5 |
| Temporary files can be mistaken for committed state | **No.** Staging is only read from `outPath`; `outTmp` is never adopted. `stateTmp` is consulted only in the `out = state+1` branch and must parse, carry the same batch as staging, expose a `lanes` object, and agree on row totals (`:181-191`) before the rename. | code + tests `177-206` |
| Checkpoint and archive can silently diverge | **Not in a single-writer run.** The only committed writes are one synchronous `commitArchiveFlush` (`:119-132`), and recovery runs before `rehydrate` reads staging (`backfill:236-247` then `:291-300`). During a run, files change only at flush and always as a pair. The rows check is skipped if `state.rows` is non-numeric (F6); the current pair is numeric, so the guard is active. | code + `PAIR_MISMATCH` tests |
| Filesystem durability assumptions documented | **Partially.** Process-crash ordering and best-effort `fsync` are documented in the module header and `writeFileDurable` (`:1-21`, `:68-80`); power-loss is disclaimed in the Phase D report §8. The atomicity assumption for same-volume rename on NTFS and the absence of a directory fsync are not stated (F11). | code + Phase D doc §8 |
| Lock takeover race-safe | **No** (F1/F2). Requires two concurrent starts; a single supervised resume cannot hit it. | code; empty-lock probe §5 |

---

## 3. Findings

### F1 — WARNING — stale-lock takeover has an ABA race (`archive-persistence.mjs:243-259`)

Both contenders read the same dead owner, both decide "stale", and both call `unlinkSync`
unconditionally (`:255-259`). Sequence: A unlinks the stale lock and creates its own; B (holding the
older read result) unlinks **A's fresh lock** and creates its own. Both now believe they own it.
The comment "lost the race… the next attempt re-evaluates" does not cover this: the loser's next
attempt succeeds because it deleted the winner's lock.

Impact if it happened: two writers rehydrate the same batch, fetch disjoint windows, and alternately
overwrite staging with their own in-memory view. The cursor/rows pair written by each is self-consistent,
so the next startup may not detect it; the archive can lose windows that promotion's self-consistency
and rows checks would still accept (only a coverage comparison would notice). This is the exact
failure class the lock exists to prevent.

Fix (small, recommended before any supervised restart): take over by `renameSync(lock,
lock + '.stale-' + pid)` — an atomic same-directory rename where exactly one contender succeeds
(the second gets `ENOENT`) — then retry the exclusive create; or, minimally, re-read the lock content
immediately before `unlink` and abort the takeover if it changed.

### F2 — WARNING — empty/unreadable lock content is treated as stale (`:246-250`, `:254`)

`writeFileSync(path, pid, {flag:'wx'})` creates the file, then writes the PID. A competitor that
reads between those two operations sees `''` → `owner = 0` → the liveness guard at `:251` is skipped
because `0` is falsy → the lock is logged as stale and **deleted**. Same for any unreadable lock.

Probe (OS temp dir, no repository paths): an empty lock file causes
`[lock] replacing stale lock from dead PID unknown` and takeover, with `isAlive` never consulted.

Impact: same dual-writer class as F1, with a sub-millisecond window.

Fix: `owner === 0` (empty/unreadable) must be **busy**, not stale — throw `LockBusyError` (fail
closed) or re-read once after a short delay before declaring it stale.

### F3 — WARNING — liveness treats every error as dead (`:214-222`)

```js
try { process.kill(pid, 0); return true; } catch { return false; }
```

On Windows, a process that exists but cannot be opened can surface `EPERM`; the catch cannot
distinguish that from `ESRCH`. A live lock owner that is inaccessible would be declared dead and its
lock replaced. For this project both writers run as the same user, so the practical exposure is an
unrelated recycled PID running elevated; the correct semantic is "alive unless `ESRCH`".

Fix: `catch (err) { return err.code !== 'ESRCH'; }`, and treat `EPERM` as alive.

### F4 — WARNING (operational) — PID reuse can block a legitimate resume (`:243-253`)

The frozen lock contains PID 30648 (mtime 2026-11-13 15:51). Windows recycles PIDs; if an unrelated
live process now holds that number, `acquireWriterLock` refuses with `LockBusyError` (exit 3) even
though no backfill is running. This fails closed — no corruption — but resume must verify the PID's
identity (e.g., Task Manager / `Get-Process 30648`) before treating the refusal as real. Manual lock
removal is then an authorised resume action, not a workaround.

### F5 — WARNING — fresh-output crash between renames is not auto-recovered (`:150-157`)

Order of on-disk events for a brand-new output: write `stateTmp` (N+1) → write `outTmp` (N+1) →
rename out (N+1) → rename state. If the process dies between the two renames, staging exists at N+1
and **no checkpoint file exists** — only the complete, valid `stateTmp`. Recovery's `!hasOut ||
!hasState` branch throws `PAIR_INCOMPLETE` without consulting the temp, and the message suggests
"restore the checkpoint (e.g. a pre-resume copy)" — which does not exist on a fresh output.

Probe (OS temp dir): `PAIR_INCOMPLETE`, the temp is left in place, and a second attempt produces the
same code. Data is not corrupted, and the correct manual remedy is to rename `<state>.tmp` into
place; but the script does not help.

This cannot occur on the current resume: both files exist (legacy batch 0). It matters for future
`--out` targets and for a first-ever run.

Fix: in the "staging exists, checkpoint missing" case, adopt `stateTmp` when it parses, carries
`batch === batchOf(out)`, has `lanes`, and agrees on rows — the same validation as the `+1` branch.
Otherwise keep failing closed and name the temp in the error.

### F6 — WARNING — rows agreement is skipped when `state.rows` is not numeric (`:203-212`)

```js
if (typeof state.rows === 'number' && state.rows !== cells) throw …
```

The row-sum check is the only content-integrity guard (batch ids are not hashes). A checkpoint that
lacks a numeric `rows` disables it; combined with the rehydrate fallback in `backfill:291-300`
(a staging file that parses but has no usable regions starts observations fresh while the cursor is
kept), that pair would publish a cursor claiming windows whose cells are gone.

Current files are numeric (12,154,655), so this is latent, not active. Fix: for a non-empty staging
file at legacy batch 0, require `Number.isFinite(state.rows)` or refuse.

### F7 — WARNING (test) — writer write/rename order is not regression-guarded

The protocol's recoverability depends on writing the **checkpoint temp before the staging temp** and
renaming **staging before checkpoint**. `commitArchiveFlush` encodes that (`:128-131`), but no test
would fail if the two write calls were swapped: the crash fixtures construct the *resulting* state
rather than exercising the writer. A reordered writer would turn scenario 3 into `CHECKPOINT_LAG`
(unrecoverable) and scenario 1 into an adoptable-but-foreign temp.

Recommended: an injectable `fs` seam (or a test that monkey-patches `fs.renameSync` in a temp dir) that
asserts the call order `stateTmp write → outTmp write → out rename → state rename`.

### F8 — WARNING (minor) — a failing recovery rename escapes unstructured (`:192`, `backfill:246`)

`renameWithRetry(stateTmp, statePath)` can throw a raw `EPERM` after retries; the backfill's catch
only translates `RecoveryError`, so the process exits 1 with a stack trace instead of the exit-4
guidance. The pair remains recoverable (temp intact). Wrap it in `RecoveryError` for a uniform
diagnosis.

### F9 — WARNING (minor) — rename retry budget is ~300 ms (`:53-66`)

Five attempts at 20+40+60+80 ms. An antivirus/indexer holding the 1.3 MB staging file longer than
that aborts the run. The consequence is safe (clean abort at a recoverable pair; process exit releases
the lock), but a resumed run may abort repeatedly on a busy host. Consider a longer budget or logging
the final error code distinctly.

### F10 — WARNING (info) — batch IDs are not content-addressed

Two different payloads can carry the same id only through manual file manipulation or a compromised
single-writer assumption. In that case the rows sum is the substantive guard, and totals could
coincidentally agree across differently allocated regions. This is contrived and out of scope; noted
so the batch id is not over-trusted.

### F11 — WARNING (documentation) — implicit atomic-rename assumption

The module header documents crash-before/after semantics but not that same-volume `rename` is assumed
atomic with respect to visibility (true for NTFS `MoveFileEx(REPLACE_EXISTING)`, not universal), nor
that no directory fsync exists, so power-loss may lose a rename after contents survived. Phase D §8
disclaims power-loss durability; stating the rename assumption in the module header would close the
documentation gap.

---

## 4. What passes cleanly

- **Commit ordering and the commit point.** Staging rename commits; checkpoint rename completes.
  A committed batch always has a complete payload (both temps are fully written before any rename).
- **Recovery can only move forward by one batch**, and only after validating batch equality, `lanes`,
  and row totals of the pending checkpoint. It never rolls back committed rows and never rewrites
  staging.
- **Uncommitted batches are safe to discard and re-fetch**: the staging file never saw them, so
  re-fetching cannot double-count. (The Phase D test's 10-vs-13 assertion captures exactly this.)
- **Idempotency**: repeated recovery after the completing rename is a no-op (verified 5×).
- **Cursor and failure preservation**: recovery returns the checkpoint object untouched; `done`,
  `failed`, `requests` survive (tests `244-254`).
- **Legacy compatibility**: absent `batch` → 0 on both sides; the frozen pair agrees and will resume
  without a migration. The first new flush writes batch 1 to both files.
- **Ambiguity fails closed before the network**: recovery is at `backfill:236-247`; `fetchWindow` is
  reached only from `runLane`/`healPass` under `main`. Exit 4 means zero requests were made.
- **Lock precedes recovery**: acquisition at `:76-85`, recovery at `:236` — the completing rename is
  covered by exclusivity (subject to F1/F2 only under concurrent starts).
- **The default (published) pair stops at `PAIR_MISMATCH`** instead of double-counting 4 M rows. This
  is the correct fail-closed behaviour for an output that is not a resume target.
- **Windows replace-over-existing is actually exercised** on this host by the commit tests
  (both `pair()` files exist before `commitArchiveFlush`), 21/21 pass.

## 5. Simulated failures vs real filesystem behaviour — test gaps

| Gap | Why it matters | Status |
|---|---|---|
| Faults are encoded as pre-built file states; `fs.writeFileSync`/`fs.renameSync` are never made to fail or interleave | The writer's order (F7), retry path (F9), disk-full mid-temp, and rename-exhaustion states are untested | open |
| No two-process lock test | F1/F2 are precisely concurrent-start races; single-process unit tests cannot see them | open (WARNING) |
| Lock tests inject `isAlive`, so `defaultIsAlive`'s EPERM semantics (F3) are untested | platform-specific misclassification | open |
| No test for an **empty** lock file | F2 verified only by the probe above, not by the suite | open |
| No test for "staging exists, checkpoint missing, valid checkpoint temp" | F5 (fresh-output) misclassification | open (verified by probe) |
| No end-to-end legacy pair **without** the `batch` key (only `batchOf` unit) | Migration path is verified by code + real-file measurement, not by a fixture | minor |
| No test for a non-numeric `state.rows` | F6 guard skip | minor |
| `removeQuietly` failure paths not exercised | Stale-temp cleanup is best-effort by design; consequence benign | minor |
| No test that `commitArchiveFlush` leaves the **checkpoint** unchanged on `BATCH_MISMATCH` (only staging hash is asserted) | ordering assertion gap | minor |
| Actual crash of the running backfill | Would require starting it (forbidden); state-space fixtures are the legitimate substitute | restricted |

Tests were re-run during this review? No — this phase is read-only; the 21/21 result cited is from
Phase D, and the module was not modified. The review's own probes ran only in `os.tmpdir()`.

## 6. Pre-resume conditions (all mandatory)

1. **One process only.** Do not run the backfill under any wrapper that can double-start or retry it
   concurrently; F1/F2 make concurrent starts unsafe.
2. **Verify the lock owner before starting.** PID 30648 must be confirmed dead by identity, not only
   by number. If the script exits 3, investigate; do not delete the lock blindly.
3. **Staging path only.** Resume with
   `npm run archive -- --out=data_raw/firms_archive/archive_staging.json` — never the default output,
   whose pair diverges and will (correctly) stop at `PAIR_MISMATCH`.
4. **Stop on exit 3 or 4.** Exit 4 means an ambiguous pair; do not hand-edit files without a recorded
   decision and a copy. Exit 3 means a live owner.
5. **No concurrent promotion or second backfill** while the pass runs.
6. **Treat row totals as aggregation counts, not unique fires**, and do not use them alone as proof
   of completion.

## 7. Recommendation

**SAFE TO RESUME** (single supervised process, staging pair, conditions §6).

- The commit/recovery protocol satisfies the four safety properties that matter for the resume:
  a batch cannot be applied twice; committed data is durable in the same payload as its id; recovery
  only moves forward and only after validating the pending checkpoint; every ambiguous state stops
  with a named code before a request is made.
- No defect found can corrupt a single-writer run. F5–F11 are fail-closed or documentation/test gaps.
- F1–F3 are real lock weaknesses but are reachable only when two processes start concurrently. If the
  operator cannot guarantee a single start (supervisor, script retry, double invocation), the verdict
  is **SAFE ONLY AFTER FIXES** until F1 (atomic stale takeover), F2 (empty lock = busy), and F3
  (`EPERM` = alive) are closed.
- Recommended before the next automated or supervised restart: F1–F3, plus F5/F7 as cheap
  robustness/regression additions.

No BLOCKER was identified. Nothing was run against the archive, and no repository data changed.
