# Continuum — Phase D.2: Archive Lock Hardening

**Date:** 2026-11-14
**Scope:** close findings F1–F3 of
`docs/CONTINUUM_PHASE_D1_PERSISTENCE_INDEPENDENT_REVIEW_2026-11-14.md`.
**Status:** implemented and verified. The batch persistence protocol was not changed. The backfill,
`--heal`, promotion, dataset/bundle generation, and git commit/push were not run. The real archive
lock, staging file, and checkpoint were not touched (mtimes unchanged: staging/checkpoint
2026-11-13 21:53:22, lock 2026-11-13 15:51:37).

---

## 1. Exact changes

### `scripts/lib/archive-persistence.mjs`

Batch persistence (`commitArchiveFlush`, `recoverArchivePair`, `batchOf`, `sumDetections`,
`renameWithRetry`) is untouched. The lock section was replaced.

| Location | Change |
|---|---|
| `:22-24` | Header now states the lock invariants: atomic publish, guard-serialised takeover, empty/unrecognized lock never assumed abandoned, `EPERM` assumed alive |
| `:24` | `import crypto from 'node:crypto'` for ownership tokens |
| `:219-221` | `LOCK_ATTEMPTS = 8`, `TAKEOVER_RETRIES = 10`, `TAKEOVER_RETRY_MS = 5` |
| `:223-229` | `lockPayload` — JSON `{ v: 1, pid, token, at }` |
| `:232-245` | `parseLockOwner` — accepts the new JSON payload and legacy bare-PID locks; **returns `null` for empty/unrecognized content** |
| `:247-251` | `unresolvedOwnerError` — uniform fail-closed message (`owner cannot be determined`) |
| `:254-266` | `writeInitLock` — private init file opened `wx`, full payload written, fsync best-effort |
| `:273-290` | `publishLock` — **atomic hard-link publish**: `linkSync(init, lock)` either creates the lock fully-formed or fails `EEXIST`; non-`EEXIST` link failures raise `LOCK_UNSUPPORTED` rather than falling back to a racy create |
| `:294-301` | `makeRelease` — deletes the lock only when stored **PID and token** match |
| `:311-361` | `takeOverStale` — stale takeover inside a short-lived `.takeover` guard directory; **re-reads the lock inside the guard**, verifies the owner again, then renames `lockPath → tombstone` and unlinks the tombstone; only one process can hold the guard, and a rename has exactly one winner |
| `:365-379` | `defaultIsAlive(pid, kill = …)` — own PID is not a competing owner; `ESRCH` ⇒ dead; **any other error (`EPERM`, `EACCES`, unknown) ⇒ alive** |
| `:385-414` | `acquireWriterLock` — publish → on `EEXIST` read owner → unknown ⇒ fail closed; alive ⇒ busy; dead ⇒ guard takeover; loop bounded by `LOCK_ATTEMPTS` |

### `tests/archive-persistence.test.mjs`

| Location | Change |
|---|---|
| `:1-18` | `spawn` import, `defaultIsAlive` import |
| `:65-93` | Child-process harness: barrier-file lock child and `deadPid()` helper (temp dirs only) |
| `:292-470` | `writer lock` suite expanded from 4 to 13 tests (below) |

No other source files changed; `scripts/backfill-archive.mjs` consumes the same API and exit codes.

## 2. How the D.1 findings are closed

### F1 — concurrent stale takeover (WARNING → closed)

Old: two contenders read the same dead PID, both `unlink` by path. A could delete the lock B had just
created.

New: every takeover first enters the guard directory via `mkdirSync(lockPath + '.takeover')`, which is
atomic and exclusive. Inside the guard the lock is **re-read** and re-validated, then moved by one
`renameSync`. Two contenders cannot both be inside the guard; and a rename of the same source path has
exactly one winner (`ENOENT` for the loser, verified on this filesystem). The guard is released in
`finally`. The lock path is never `unlink`ed during acquisition.

### F2 — empty lock during initialization (WARNING → closed)

New locks are published by linking a **complete** private file, so an initializing lock is never
observable at the lock path — the path either does not exist or holds the full payload. A pre-existing
empty or unrecognized lock (external actor, older tool, torn write) returns `null` from
`parseLockOwner` and raises `LockBusyError` with owner 0: **fail closed**, liveness is not consulted,
nothing is deleted. Probe from D.1 now produces this refusal instead of a takeover.

### F3 — EPERM treated as death (WARNING → closed)

`defaultIsAlive` now returns `err.code !== 'ESRCH'`, so permission denial means "may be alive" and the
lock is refused, never taken over. `ESRCH` is the only death signal.

## 3. Exit codes

Unchanged in the backfill; the meaning of exit 3 widened:

| Code | Meaning |
|---|---|
| 0 | pass finished / stop file honoured |
| 2 | no MAP key configured |
| 3 | lock refused: live owner, **unresolvable owner (empty/unrecognized)**, **stuck `.takeover` guard**, or attempts exhausted |
| 4 | ambiguous staging/checkpoint pair — nothing fetched |
| 130 | SIGINT after a forced flush |

## 4. Tests

`node --test tests/archive-persistence.test.mjs` → **30 tests, 30 pass, 0 fail** (run twice; the
two-process test was stable in both).

| Requirement | Test | What it proves |
|---|---|---|
| Two concurrent stale-lock takeovers | `two simultaneous stale-lock takeovers cannot both succeed` | Two real OS processes synchronised on a barrier race for one legacy stale lock; exactly one reports `ACQUIRED` and exits 0, exactly one reports `BUSY LockBusyError` and exits 3; the winner's release removes the lock; no `.stale-`/`.takeover`/`.init-` artifacts remain |
| Empty lock during initialization | `an empty lock file is refused, never taken over`; `a process that died during lock initialization leaves no lock behind` | Empty lock ⇒ `LockBusyError` owner 0, liveness never probed, file untouched. A leftover `.init-*` private file neither blocks nor spoofs the next acquisition |
| PID alive | `defaultIsAlive: a live child is alive, its exited PID is dead` | A running child reports alive; own PID reports false (not a competing owner) |
| PID dead | same test after the child exits; `a lock from a dead PID is replaced` | ESRCH ⇒ dead ⇒ guarded takeover; new lock carries PID + token; artifacts cleaned |
| PID inaccessible (EPERM) | `defaultIsAlive distinguishes ESRCH from every other probe error`; `a permission denial during the liveness probe is treated as alive` | EPERM/EACCES ⇒ alive; acquire refuses and leaves the owner's lock intact |
| Ownership verification before release | `release verifies the ownership token, not only the PID`; `release does not delete a lock now owned by another PID` | Same PID with a different token is not deleted (PID-reuse safety); a different PID is not deleted |
| Process termination during initialization | orphan `.init-*` test; guard test | An init death before publicaton leaves no lock; a death inside takeover leaves the guard and **fails closed** without touching the stale lock |
| Regression | `a lock held by a live PID is refused`, `an absent lock is created exclusively`, `an unrecognized lock file is refused`, `a leftover takeover guard fails closed` | Prior behavior preserved; unknown artifacts never adopted |

Full suite: `node scripts/test.mjs` → **201 tests, 197 pass, 0 fail, 4 skipped** (the 4 are the keyed
`coder-live` cases without `FIRMS_MAP_KEY`). The 21 → 30 count increase is the lock suite expansion.
`node --check` clean on both changed files. `git diff --check` exits 0.

The D.1 probes were re-run implicitly by the suite: an empty lock is now refused (exit-3 path), and
the fresh-output half pair (`PAIR_INCOMPLETE`) is unchanged — that finding (F5) is out of scope here.

## 5. Remaining risks

- **R1 — stuck takeover guard.** A crash inside the few-microsecond guard section leaves
  `<lock>.takeover`. Every later acquisition fails closed with an explicit message naming the guard.
  This is deliberate: the operator confirms no backfill runs, then removes the guard. The guard is
  never removed automatically, so no process can break another's critical section.
- **R2 — hard-link requirement.** Atomic publish requires hard links. Verified on NTFS here;
  NTFS/ext4 support them. Filesystems without hard links (some SMB/FAT/exFAT targets) raise
  `LOCK_UNSUPPORTED` and the backfill refuses to start. This is a portability cost, not a safety cost.
- **R3 — PID reuse remains fail-closed.** A stale lock whose PID now belongs to a live process exits 3
  until the operator investigates (unchanged from D.1 F4; correct behaviour).
- **R4 — token is anti-misdeletion, not authentication.** The PID+token check prevents accidental
  deletion of a replaced lock. It does not defend against a hostile process with write access to the
  directory; that is outside the single-user threat model.
- **R5 — D.1 findings F5–F11 remain open** (fresh-output `PAIR_INCOMPLETE` with a valid temp,
  rows-check skip for non-numeric `state.rows`, writer-order regression test gap, ~300 ms rename retry
  budget, non-content-addressed batch ids, documentation nits). None is a lock issue and none was
  touched.
- **R6 — the two-process test depends on scheduling.** It uses a 150 ms start barrier and the winner
  holds for 2 s; on a pathologically loaded host a child could start after the release and acquire
  legitimately, yielding two sequential `ACQUIRED`. The test would then fail (loudly) rather than
  pass a bad run; two consecutive runs were green here.
- **R7 — the guard retry sleeps synchronously** (`Atomics.wait`, up to 50 ms). This blocks the event
  loop briefly during contention; the backfill has no latency requirement.
- **R8 — legacy lock takeover on resume.** The real lock still contains the bare PID `30648`. The new
  parser reads it as a token-less legacy owner; if the PID is dead it is taken over under the guard
  and replaced with a JSON lock; if it is alive or inaccessible the run exits 3.

## 6. Verification summary

| Check | Result |
|---|---|
| new lock tests | verified — 30/30 pass, file run twice |
| full Node suite | verified — 201 tests, 197 pass, 0 fail, 4 keyed skips |
| syntax | verified — `node --check` clean |
| real archive lock / staging / checkpoint | verified untouched — mtimes 2026-11-13, lock still 5 bytes |
| `public/data`, `dist`, `dist-server` | verified untouched |
| concurrent-process takeover | verified with two OS processes |
| crash inside takeover guard | verified by construction (pre-created guard) — fails closed |
| crash inside the real backfill during takeover | not verified — would require starting the backfill (forbidden) |

**Outcome:** D.1 F1, F2, and F3 are closed with tests. No change to the batch commit/recovery protocol.
The Phase D.1 verdict conditions still apply for resuming (single supervised process, staging pair,
verify the current lock PID, stop on exit 3/4); the concurrent-start caveat in that verdict is now
addressed by this hardening. Stopping here — no backfill was started, and no authorization to resume
is assumed.
