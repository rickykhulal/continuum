/**
 * Crash-safe persistence for the archive backfill's staging file and checkpoint.
 *
 * The pair is committed in this order on every flush:
 *
 *   1. write `<state>.tmp` (checkpoint payload, durable)
 *   2. write `<out>.tmp`   (staging payload, durable)
 *   3. rename `<out>.tmp`  -> `<out>`     <-- commit point
 *   4. rename `<state>.tmp` -> `<state>`
 *
 * A process crash between 3 and 4 leaves staging one batch ahead of the checkpoint,
 * but step 1 already wrote the checkpoint payload, so startup recovery completes the
 * rename instead of re-fetching the batch. A crash before 3 leaves both files at the
 * previous batch; the in-memory batch is lost and its windows are re-fetched into a
 * pair that never contained them, so nothing is applied twice.
 *
 * Both files carry a monotonic `batch` id. Legacy files (written before this protocol)
 * have no id and are read as batch 0. A pair whose ids or row totals disagree, or whose
 * checkpoint temp is missing/unreadable, is an ambiguous state: recovery throws
 * `RecoveryError` and the caller must stop rather than guess.
 *
 * The writer lock is published with its full payload by an atomic hard link and taken over by
 * a rename serialized under a short-lived guard directory; an empty or unrecognized lock is
 * never assumed abandoned, and a liveness probe that is refused (EPERM) is assumed alive.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class RecoveryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RecoveryError';
    this.code = code;
  }
}

export class LockBusyError extends Error {
  constructor(owner, message) {
    super(message);
    this.name = 'LockBusyError';
    this.owner = owner;
  }
}

const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']);

/** Synchronous backoff for the main thread (Atomics.wait is allowed in Node). */
function sleepSync(ms) {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Windows can transiently refuse a rename while a scanner or reader holds the target.
 * Retry the same rename a few times; a non-transient error is rethrown immediately.
 */
export function renameWithRetry(src, dest, attempts = 5) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      fs.renameSync(src, dest);
      return;
    } catch (err) {
      last = err;
      if (!RETRYABLE_RENAME_CODES.has(err.code)) throw err;
      sleepSync(20 * (i + 1));
    }
  }
  throw last;
}

function writeFileDurable(file, text) {
  const fd = fs.openSync(file, 'w');
  try {
    fs.writeFileSync(fd, text);
    try {
      fs.fsyncSync(fd);
    } catch {
      /* fsync is best-effort; process-crash safety does not depend on it */
    }
  } finally {
    fs.closeSync(fd);
  }
}

export function batchOf(json) {
  const b = json && json.batch;
  return Number.isInteger(b) && b >= 0 ? b : 0;
}

/** Sum of every aggregated detection cell — the quantity `state.rows` must equal. */
export function sumDetections(archive) {
  let sum = 0;
  for (const block of Object.values(archive?.regions || {})) {
    for (const rows of Object.values(block?.days || {})) {
      for (const row of rows) sum += Number(row?.[1]) || 0;
    }
  }
  return sum;
}

function readJsonOrThrow(file, code) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new RecoveryError(code, `${file} is not readable JSON (${err.message})`);
  }
}

function removeQuietly(file) {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    /* a leftover temp is harmless; never fail recovery over it */
  }
}

/**
 * Persist staging and checkpoint as one flush. `outJson` and `stateJson` must carry the
 * same batch id. Returns only after both files are in place; on any throw the pair is
 * either fully at the previous batch or recoverable by `recoverArchivePair`.
 */
export function commitArchiveFlush(outPath, statePath, outJson, stateJson) {
  if (batchOf(outJson) !== batchOf(stateJson)) {
    throw new RecoveryError(
      'BATCH_MISMATCH',
      `flush refused: staging batch ${batchOf(outJson)} but checkpoint batch ${batchOf(stateJson)}`,
    );
  }
  const outTmp = `${outPath}.tmp`;
  const stateTmp = `${statePath}.tmp`;
  writeFileDurable(stateTmp, JSON.stringify(stateJson));
  writeFileDurable(outTmp, JSON.stringify(outJson));
  renameWithRetry(outTmp, outPath);
  renameWithRetry(stateTmp, statePath);
}

/**
 * Reconcile staging and checkpoint at startup. Returns `{ state, recovered }` where
 * `state` is the checkpoint object to resume from (or null when neither file exists).
 * Throws `RecoveryError` for every ambiguous state; callers must exit non-zero.
 */
export function recoverArchivePair(outPath, statePath, { log = () => {} } = {}) {
  const outTmp = `${outPath}.tmp`;
  const stateTmp = `${statePath}.tmp`;
  const hasOut = fs.existsSync(outPath);
  const hasState = fs.existsSync(statePath);

  if (!hasOut && !hasState) {
    removeQuietly(outTmp);
    removeQuietly(stateTmp);
    return { state: null, recovered: false };
  }
  if (!hasOut || !hasState) {
    throw new RecoveryError(
      'PAIR_INCOMPLETE',
      hasOut
        ? `staging exists at ${outPath} but the checkpoint ${statePath} is missing — the cursor cannot be rebuilt from cells; restore the checkpoint (e.g. a pre-resume copy)`
        : `checkpoint exists at ${statePath} but staging ${outPath} is missing — refusing to resume into a file that would lose the checkpoint's rows`,
    );
  }

  const out = readJsonOrThrow(outPath, 'STAGING_UNREADABLE');
  const state = readJsonOrThrow(statePath, 'CHECKPOINT_UNREADABLE');
  if (!state.lanes || typeof state.lanes !== 'object') {
    throw new RecoveryError('CHECKPOINT_UNREADABLE', `${statePath} has no lanes object`);
  }
  const outBatch = batchOf(out);
  const stateBatch = batchOf(state);

  if (outBatch === stateBatch) {
    assertRowsAgree(out, state, outPath, statePath, outBatch);
    removeQuietly(outTmp);
    removeQuietly(stateTmp);
    return { state, recovered: false };
  }

  if (outBatch === stateBatch + 1) {
    if (!fs.existsSync(stateTmp)) {
      throw new RecoveryError(
        'CHECKPOINT_LAG',
        `staging is at batch ${outBatch} but the checkpoint is at batch ${stateBatch}, and ${stateTmp} is missing — the committed batch's cursor cannot be rebuilt; restore a checkpoint copy whose batch matches staging, or roll staging back to a known-good copy`,
      );
    }
    const pending = readJsonOrThrow(stateTmp, 'CHECKPOINT_TMP_UNREADABLE');
    if (batchOf(pending) !== outBatch) {
      throw new RecoveryError(
        'CHECKPOINT_LAG',
        `checkpoint temp is batch ${batchOf(pending)} but staging is batch ${outBatch} — refusing to adopt a checkpoint that does not belong to the visible staging file`,
      );
    }
    if (!pending.lanes || typeof pending.lanes !== 'object') {
      throw new RecoveryError('CHECKPOINT_TMP_UNREADABLE', `${stateTmp} has no lanes object`);
    }
    assertRowsAgree(out, pending, outPath, stateTmp, outBatch);
    renameWithRetry(stateTmp, statePath);
    log(`[recover] completed checkpoint batch ${outBatch} from ${path.basename(stateTmp)}`);
    return { state: pending, recovered: true };
  }

  throw new RecoveryError(
    'CHECKPOINT_AHEAD',
    `checkpoint is at batch ${stateBatch} but staging is at batch ${outBatch} — the checkpoint claims windows the staging file does not contain; restore a matching pair before resuming`,
  );
}

function assertRowsAgree(out, state, outPath, stateLabel, batch) {
  const cells = sumDetections(out);
  if (typeof state.rows === 'number' && state.rows !== cells) {
    const legacy = batch === 0 ? ' (legacy files have no batch marker)' : '';
    throw new RecoveryError(
      'PAIR_MISMATCH',
      `staging ${outPath} sums to ${cells} detections but ${stateLabel} reports ${state.rows}${legacy} — resuming would double-count or lose rows; reconcile the pair before running`,
    );
  }
}

const LOCK_ATTEMPTS = 8;
const TAKEOVER_RETRIES = 10;
const TAKEOVER_RETRY_MS = 5;

function lockPayload(pid, token) {
  return JSON.stringify({ v: 1, pid, token, at: new Date().toISOString() });
}

/**
 * Return `{ pid, token }` for a lock written by this module, or for a legacy bare-PID lock.
 * Anything else — an empty file, a torn write, an unknown format — returns null. Null is not
 * evidence of a dead owner: ownership could not be established, so callers fail closed.
 */
function parseLockOwner(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  try {
    const o = JSON.parse(t);
    if (o && Number.isInteger(o.pid) && o.pid > 0) {
      return { pid: o.pid, token: typeof o.token === 'string' ? o.token : '' };
    }
  } catch {
    /* legacy lock: a bare PID */
  }
  if (/^\d+$/.test(t)) return { pid: Number(t), token: '' };
  return null;
}

function unresolvedOwnerError(lockPath, raw) {
  return new LockBusyError(
    0,
    `${lockPath} exists but its owner cannot be determined (${raw.trim() ? 'unrecognized content' : 'empty'}) — verify no writer is running, then remove it.`,
  );
}

/** Inspect a lock without changing it. Null means absent; null is also returned when the
 *  content is unrecognizable, so callers must treat it as "cannot prove the writer is gone". */
export function readLockOwner(lockPath) {
  try {
    return parseLockOwner(fs.readFileSync(lockPath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function writeInitLock(file, content) {
  const fd = fs.openSync(file, 'wx');
  try {
    fs.writeFileSync(fd, content);
    try {
      fs.fsyncSync(fd);
    } catch {
      /* best effort, as for the archive pair */
    }
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Publish the lock atomically *with* its content. An `O_EXCL` create followed by a PID write has
 * an observable empty interval that a competitor can mistake for abandonment; linking a complete
 * private file into place has no such interval, and two concurrent links cannot both succeed.
 */
function publishLock(initPath, lockPath, content) {
  writeInitLock(initPath, content);
  try {
    fs.linkSync(initPath, lockPath);
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    const wrapped = new Error(
      `cannot publish the writer lock atomically (${err.code}); this filesystem must support hard links — refusing to run`,
    );
    wrapped.code = 'LOCK_UNSUPPORTED';
    throw wrapped;
  } finally {
    try {
      fs.unlinkSync(initPath);
    } catch {
      /* the published link owns the inode */
    }
  }
}

function makeRelease(lockPath, pid, token) {
  return () => {
    try {
      const owner = parseLockOwner(fs.readFileSync(lockPath, 'utf8'));
      if (owner && owner.pid === pid && owner.token === token) fs.unlinkSync(lockPath);
    } catch {
      /* gone, unreadable, or not ours — nothing we may delete */
    }
  };
}

/**
 * Takeover of a stale lock is serialized by a short-lived guard directory, so two starters cannot
 * both move the same path. Inside the guard the lock is re-read: the rename only ever moves the
 * file just inspected, never one a competitor published after an earlier read. A guard left by a
 * crash fails closed; it is removed by a person who has confirmed no writer is running.
 */
function takeOverStale(lockPath, pid, token, content, initPath, attempt, isAlive, log) {
  const guard = `${lockPath}.takeover`;
  let held = false;
  for (let i = 0; i < TAKEOVER_RETRIES && !held; i++) {
    try {
      fs.mkdirSync(guard);
      held = true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (i < TAKEOVER_RETRIES - 1) sleepSync(TAKEOVER_RETRY_MS);
    }
  }
  if (!held) {
    throw new LockBusyError(
      0,
      `${guard} exists — another process is taking over the stale lock, or a previous takeover died. Verify no backfill is running, then remove ${guard}.`,
    );
  }
  try {
    let raw;
    try {
      raw = fs.readFileSync(lockPath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw new LockBusyError(0, `${lockPath} exists but cannot be read (${err.code}) — refusing to guess ownership.`);
    }
    const owner = parseLockOwner(raw);
    if (!owner) throw unresolvedOwnerError(lockPath, raw);
    if (owner.pid !== pid && isAlive(owner.pid)) {
      throw new LockBusyError(owner.pid, `PID ${owner.pid} already writes ${lockPath} — refusing to race it.`);
    }
    const tomb = `${lockPath}.stale-${pid}-${token}-${attempt}`;
    try {
      fs.renameSync(lockPath, tomb);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
    log(`[lock] moved stale lock from dead PID ${owner.pid} aside (${path.basename(tomb)})`);
    try {
      fs.unlinkSync(tomb);
    } catch {
      /* a leftover tomb is harmless and never at the lock path */
    }
    return publishLock(initPath, lockPath, content) ? makeRelease(lockPath, pid, token) : null;
  } finally {
    try {
      fs.rmdirSync(guard);
    } catch {
      /* best effort */
    }
  }
}

const defaultKill = (pid) => process.kill(pid, 0);

/**
 * `ESRCH` is the only evidence of death. Anything else — `EPERM`, `EACCES`, an unknown error —
 * means the process may exist and could not be inspected, so it is treated as alive.
 */
export function defaultIsAlive(pid, kill = defaultKill) {
  if (!pid || pid === process.pid) return false;
  try {
    kill(pid);
    return true;
  } catch (err) {
    return err.code !== 'ESRCH';
  }
}

/**
 * One writer per output. The lock is published atomically with its payload; a lock from a dead
 * PID is taken over under a guard; a lock whose owner cannot be established is refused.
 */
export function acquireWriterLock(
  lockPath,
  { pid = process.pid, isAlive = defaultIsAlive, log = () => {}, attempts = LOCK_ATTEMPTS } = {},
) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const token = crypto.randomBytes(8).toString('hex');
  const content = lockPayload(pid, token);
  const initPath = `${lockPath}.init-${pid}-${token}`;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (publishLock(initPath, lockPath, content)) return makeRelease(lockPath, pid, token);
    let raw;
    try {
      raw = fs.readFileSync(lockPath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw new LockBusyError(0, `${lockPath} exists but cannot be read (${err.code}) — refusing to guess ownership.`);
    }
    const owner = parseLockOwner(raw);
    if (!owner) throw unresolvedOwnerError(lockPath, raw);
    if (owner.pid !== pid && isAlive(owner.pid)) {
      throw new LockBusyError(owner.pid, `PID ${owner.pid} already writes ${lockPath} — refusing to race it.`);
    }
    const release = takeOverStale(lockPath, pid, token, content, initPath, attempt, isAlive, log);
    if (release) return release;
  }
  throw new LockBusyError(
    0,
    `could not acquire ${lockPath} after ${attempts} attempts — another writer keeps winning the race.`,
  );
}
