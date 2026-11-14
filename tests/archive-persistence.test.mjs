import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  LockBusyError,
  RecoveryError,
  acquireWriterLock,
  batchOf,
  commitArchiveFlush,
  defaultIsAlive,
  recoverArchivePair,
  renameWithRetry,
  sumDetections,
} from '../scripts/lib/archive-persistence.mjs';

// Crash-state fixtures only: every test writes to a fresh OS temp directory. Nothing in
// data_raw/ or public/data is read or written.

const registry = [];
function tempPair() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'continuum-archive-'));
  registry.push(dir);
  return { dir, out: path.join(dir, 'archive_staging.json'), state: path.join(dir, 'state-archive_staging.json') };
}
process.on('exit', () => {
  for (const dir of registry) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

const LANE = 'VIIRS_SNPP_SP|chilecito';

/** Batch 0: two day cells / 7 detections. Batch 1 adds one cell / 3 detections. */
function pair({ batch = 0, rows = 7, batch1 = false } = {}) {
  const days = batch1
    ? { v: [[100, 5, 1.2], [101, 2, 0.3], [102, 3, 0.9]] }
    : { v: [[100, 5, 1.2], [101, 2, 0.3]] };
  return {
    out: {
      schema: 'continuum-archive-1',
      start: '2000-11-01',
      batch,
      requests: batch1 ? 4 : 3,
      rows,
      regions: { chilecito: { days, covered: { v: [[100, 102, 0]] } } },
    },
    state: {
      batch,
      rows,
      requests: batch1 ? 4 : 3,
      lanes: { [LANE]: { done: batch1 ? 3 : 2, failed: ['2025-01-04'], rows } },
    },
  };
}

const write = (file, json) => fs.writeFileSync(file, JSON.stringify(json));
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const MODULE_URL = new URL('../scripts/lib/archive-persistence.mjs', import.meta.url).href;

/** Child process: waits on a barrier file, then races for the same lock and holds it briefly. */
const LOCK_CHILD = `
const fs = require('node:fs');
(async () => {
  const [modUrl, lockPath, goPath, outPath] = process.argv.slice(1);
  const m = await import(modUrl);
  while (!fs.existsSync(goPath)) await new Promise((r) => setTimeout(r, 2));
  try {
    const release = m.acquireWriterLock(lockPath);
    fs.writeFileSync(outPath, 'ACQUIRED ' + process.pid);
    await new Promise((r) => setTimeout(r, 2000));
    release();
  } catch (err) {
    fs.writeFileSync(outPath, 'BUSY ' + err.name + ' ' + err.message);
    process.exit(err.name === 'LockBusyError' ? 3 : 1);
  }
})();
`;

function runLockChild(lock, go, out) {
  const child = spawn(process.execPath, ['-e', LOCK_CHILD, MODULE_URL, lock, go, out], { stdio: 'ignore' });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve({ code, out })));
  return { child, exited };
}

/** A PID that has already exited, for a genuinely dead owner record. */
async function deadPid() {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  await new Promise((resolve) => child.on('exit', resolve));
  return child.pid;
}

function seed({ batch = 0, rows = 7, batch1 = false } = {}) {
  const p = tempPair();
  const f = pair({ batch, rows, batch1 });
  write(p.out, f.out);
  write(p.state, f.state);
  return { ...p, fixture: f };
}

/** Crash between the staging rename and the checkpoint rename. */
function crashAfterStaging({ rows = 10 } = {}) {
  const p = seed();
  const next = pair({ batch: 1, rows, batch1: true });
  write(`${p.state}.tmp`, next.state);
  write(p.out, next.out);
  return { ...p, fixture: next };
}

describe('commit protocol', () => {
  test('a flush writes both files at the same batch and leaves no temp', () => {
    const p = seed();
    const next = pair({ batch: 1, rows: 10, batch1: true });
    commitArchiveFlush(p.out, p.state, next.out, next.state);

    assert.equal(batchOf(JSON.parse(fs.readFileSync(p.out, 'utf8'))), 1);
    assert.equal(batchOf(JSON.parse(fs.readFileSync(p.state, 'utf8'))), 1);
    assert.equal(fs.existsSync(`${p.out}.tmp`), false);
    assert.equal(fs.existsSync(`${p.state}.tmp`), false);
    const recovered = recoverArchivePair(p.out, p.state);
    assert.equal(recovered.recovered, false);
    assert.equal(recovered.state.lanes[LANE].done, 3);
  });

  test('a flush with mismatched batch ids is refused before touching either file', () => {
    const p = seed();
    const before = hash(p.out);
    const next = pair({ batch: 1, rows: 10, batch1: true });
    assert.throws(
      () => commitArchiveFlush(p.out, p.state, next.out, { ...next.state, batch: 0 }),
      (err) => err instanceof RecoveryError && err.code === 'BATCH_MISMATCH',
    );
    assert.equal(hash(p.out), before);
    assert.equal(fs.existsSync(`${p.out}.tmp`), false);
  });
});

describe('crash before staging persistence', () => {
  test('stale temp files are discarded and the previous batch is kept', () => {
    const p = seed();
    const next = pair({ batch: 1, rows: 10, batch1: true });
    write(`${p.out}.tmp`, next.out);
    write(`${p.state}.tmp`, next.state);
    const outBefore = hash(p.out);

    const recovered = recoverArchivePair(p.out, p.state);
    assert.equal(recovered.recovered, false);
    assert.equal(batchOf(recovered.state), 0);
    assert.equal(recovered.state.rows, 7);
    assert.equal(hash(p.out), outBefore, 'staging must be byte-identical');
    assert.equal(fs.existsSync(`${p.out}.tmp`), false);
    assert.equal(fs.existsSync(`${p.state}.tmp`), false);
  });
});

describe('crash after staging persistence, before checkpoint persistence', () => {
  test('recovery completes the checkpoint from its temp; no re-fetch is implied', () => {
    const p = crashAfterStaging();
    const outBefore = hash(p.out);

    const recovered = recoverArchivePair(p.out, p.state);
    assert.equal(recovered.recovered, true);
    assert.equal(batchOf(recovered.state), 1);
    assert.equal(recovered.state.rows, 10);
    assert.equal(recovered.state.lanes[LANE].done, 3);
    assert.equal(hash(p.out), outBefore, 'recovery must not rewrite staging');
    assert.equal(fs.existsSync(`${p.state}.tmp`), false);
    assert.equal(batchOf(JSON.parse(fs.readFileSync(p.state, 'utf8'))), 1);
  });

  test('the batch is applied exactly once — repeated recovery cannot duplicate detections', () => {
    const p = crashAfterStaging();
    const first = recoverArchivePair(p.out, p.state);
    const sumAfterFirst = sumDetections(JSON.parse(fs.readFileSync(p.out, 'utf8')));
    assert.equal(sumAfterFirst, 10);
    assert.equal(first.state.rows, sumAfterFirst);

    for (let i = 0; i < 5; i++) {
      const again = recoverArchivePair(p.out, p.state);
      assert.equal(again.recovered, false);
      assert.equal(again.state.rows, 10);
    }
    assert.equal(sumDetections(JSON.parse(fs.readFileSync(p.out, 'utf8'))), 10);
    // The old behaviour — re-fetching the committed batch into the reloaded cells — would
    // have produced 13. Recovery must never reach that number.
    assert.notEqual(sumAfterFirst, 13);
  });
});

describe('crash after checkpoint persistence', () => {
  test('a fully written pair recovers as a no-op', () => {
    const p = seed();
    const next = pair({ batch: 1, rows: 10, batch1: true });
    write(p.out, next.out);
    write(p.state, next.state);

    const recovered = recoverArchivePair(p.out, p.state);
    assert.equal(recovered.recovered, false);
    assert.equal(batchOf(recovered.state), 1);
    assert.equal(sumDetections(JSON.parse(fs.readFileSync(p.out, 'utf8'))), 10);
  });
});

describe('ambiguous states stop instead of guessing', () => {
  test('a corrupt checkpoint temp stops with CHECKPOINT_TMP_UNREADABLE', () => {
    const p = crashAfterStaging();
    fs.writeFileSync(`${p.state}.tmp`, '{"lanes":');
    const stateBefore = hash(p.state);

    assert.throws(
      () => recoverArchivePair(p.out, p.state),
      (err) => err instanceof RecoveryError && err.code === 'CHECKPOINT_TMP_UNREADABLE',
    );
    assert.equal(hash(p.state), stateBefore, 'checkpoint must not be replaced');
  });

  test('a missing checkpoint temp stops with CHECKPOINT_LAG', () => {
    const p = crashAfterStaging();
    fs.rmSync(`${p.state}.tmp`);
    assert.throws(
      () => recoverArchivePair(p.out, p.state),
      (err) => err instanceof RecoveryError && err.code === 'CHECKPOINT_LAG',
    );
  });

  test('a checkpoint temp from a different batch stops with CHECKPOINT_LAG', () => {
    const p = crashAfterStaging();
    const wrong = pair({ batch: 2, rows: 10, batch1: true });
    write(`${p.state}.tmp`, wrong.state);
    assert.throws(
      () => recoverArchivePair(p.out, p.state),
      (err) => err instanceof RecoveryError && err.code === 'CHECKPOINT_LAG',
    );
  });

  test('same batch with disagreeing row totals stops with PAIR_MISMATCH', () => {
    const p = seed({ rows: 9 });
    assert.throws(
      () => recoverArchivePair(p.out, p.state),
      (err) => err instanceof RecoveryError && err.code === 'PAIR_MISMATCH',
    );
  });

  test('a checkpoint ahead of staging stops with CHECKPOINT_AHEAD', () => {
    const p = seed();
    write(p.state, pair({ batch: 1, rows: 7 }).state);
    assert.throws(
      () => recoverArchivePair(p.out, p.state),
      (err) => err instanceof RecoveryError && err.code === 'CHECKPOINT_AHEAD',
    );
  });

  test('a half pair stops with PAIR_INCOMPLETE', () => {
    const p = seed();
    fs.rmSync(p.state);
    assert.throws(
      () => recoverArchivePair(p.out, p.state),
      (err) => err instanceof RecoveryError && err.code === 'PAIR_INCOMPLETE',
    );
  });

  test('an unreadable staging file stops with STAGING_UNREADABLE', () => {
    const p = seed();
    fs.writeFileSync(p.out, 'not json');
    assert.throws(
      () => recoverArchivePair(p.out, p.state),
      (err) => err instanceof RecoveryError && err.code === 'STAGING_UNREADABLE',
    );
  });
});

describe('completed and failed windows are preserved', () => {
  test('recovery adopts the pending checkpoint without altering lanes or failures', () => {
    const p = crashAfterStaging();
    const expected = pair({ batch: 1, rows: 10, batch1: true }).state;
    const recovered = recoverArchivePair(p.out, p.state);
    assert.deepEqual(recovered.state.lanes, expected.lanes);
    assert.deepEqual(recovered.state.lanes[LANE].failed, ['2025-01-04']);
    assert.equal(recovered.state.lanes[LANE].done, 3);
    assert.equal(recovered.state.requests, 4);
  });
});

describe('writer lock', () => {
  const lock = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'continuum-lock-'));
    registry.push(dir);
    return { dir, file: path.join(dir, 'archive_staging.json.lock') };
  };

  test('a lock from a dead PID is replaced', () => {
    const { dir, file } = lock();
    fs.writeFileSync(file, '999999');
    const logs = [];
    const release = acquireWriterLock(file, { pid: 4242, isAlive: () => false, log: (m) => logs.push(m) });
    const owner = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(owner.pid, 4242);
    assert.ok(owner.token, 'the lock carries an ownership token');
    assert.ok(logs.some((m) => m.includes('dead PID 999999')));
    const leftovers = fs.readdirSync(dir).filter((f) => f.includes('.stale-') || f.includes('.takeover') || f.includes('.init-'));
    assert.deepEqual(leftovers, [], 'takeover artifacts are cleaned up');
    release();
    assert.equal(fs.existsSync(file), false);
  });

  test('a lock held by a live PID is refused', () => {
    const { file } = lock();
    fs.writeFileSync(file, '12345');
    assert.throws(
      () => acquireWriterLock(file, { pid: 4242, isAlive: () => true }),
      (err) => err instanceof LockBusyError && err.owner === 12345,
    );
    assert.equal(fs.readFileSync(file, 'utf8'), '12345', 'the live owner keeps the lock');
  });

  test('release does not delete a lock now owned by another PID', () => {
    const { file } = lock();
    const release = acquireWriterLock(file, { pid: 4242, isAlive: () => false });
    fs.writeFileSync(file, '7777');
    release();
    assert.equal(fs.readFileSync(file, 'utf8'), '7777');
  });

  test('release verifies the ownership token, not only the PID', () => {
    const { file } = lock();
    const release = acquireWriterLock(file, { pid: 4242, isAlive: () => false });
    fs.writeFileSync(file, JSON.stringify({ v: 1, pid: 4242, token: 'other-owner' }));
    release();
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).token, 'other-owner');
  });

  test('an absent lock is created exclusively', () => {
    const { file } = lock();
    const release = acquireWriterLock(file, { pid: 4242, isAlive: () => false });
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).pid, 4242);
    release();
  });

  test('an empty lock file is refused, never taken over', () => {
    const { file } = lock();
    fs.writeFileSync(file, '');
    let probed = false;
    assert.throws(
      () =>
        acquireWriterLock(file, {
          pid: 4242,
          isAlive: () => {
            probed = true;
            return false;
          },
        }),
      (err) => err instanceof LockBusyError && err.owner === 0 && /owner cannot be determined/.test(err.message),
    );
    assert.equal(probed, false, 'an unknown owner is never probed for liveness');
    assert.equal(fs.readFileSync(file, 'utf8'), '', 'the unknown lock is left untouched');
  });

  test('an unrecognized lock file is refused, never taken over', () => {
    const { file } = lock();
    fs.writeFileSync(file, 'not a lock payload');
    assert.throws(
      () => acquireWriterLock(file, { pid: 4242, isAlive: () => false }),
      (err) => err instanceof LockBusyError && err.owner === 0,
    );
    assert.equal(fs.readFileSync(file, 'utf8'), 'not a lock payload');
  });

  test('a permission denial during the liveness probe is treated as alive', () => {
    const { file } = lock();
    fs.writeFileSync(file, '12345');
    const deny = () => {
      const err = new Error('access denied');
      err.code = 'EPERM';
      throw err;
    };
    assert.throws(
      () => acquireWriterLock(file, { pid: 4242, isAlive: (p) => defaultIsAlive(p, deny) }),
      (err) => err instanceof LockBusyError && err.owner === 12345,
    );
    assert.equal(fs.readFileSync(file, 'utf8'), '12345', 'an inaccessible owner keeps the lock');
  });

  test('defaultIsAlive distinguishes ESRCH from every other probe error', () => {
    const thrower = (code) => () => {
      const err = new Error(code);
      err.code = code;
      throw err;
    };
    assert.equal(defaultIsAlive(4242, thrower('EPERM')), true);
    assert.equal(defaultIsAlive(4242, thrower('EACCES')), true);
    assert.equal(defaultIsAlive(4242, thrower('ESRCH')), false);
  });

  test('defaultIsAlive: a live child is alive, its exited PID is dead', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { stdio: 'ignore' });
    await new Promise((resolve) => child.on('spawn', resolve));
    try {
      assert.equal(defaultIsAlive(child.pid), true);
      assert.equal(defaultIsAlive(process.pid), false, 'own PID is not a competing owner');
    } finally {
      child.kill();
    }
    await new Promise((resolve) => child.on('exit', resolve));
    assert.equal(defaultIsAlive(child.pid), false);
  });

  test('a process that died during lock initialization leaves no lock behind', () => {
    const { file } = lock();
    fs.writeFileSync(`${file}.init-4242-deadbeef`, JSON.stringify({ v: 1, pid: 4242, token: 'deadbeef' }));
    const release = acquireWriterLock(file, { pid: 4242, isAlive: () => false });
    const owner = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(owner.pid, 4242);
    assert.notEqual(owner.token, 'deadbeef', 'the live lock is this acquisition, not the orphan temp');
    release();
    assert.equal(fs.existsSync(file), false);
  });

  test('a leftover takeover guard fails closed and leaves the stale lock alone', () => {
    const { file } = lock();
    fs.writeFileSync(file, '999999');
    fs.mkdirSync(`${file}.takeover`);
    assert.throws(
      () => acquireWriterLock(file, { pid: 4242, isAlive: () => false }),
      (err) => err instanceof LockBusyError && /takeover/.test(err.message),
    );
    assert.equal(fs.readFileSync(file, 'utf8'), '999999');
    assert.ok(fs.existsSync(`${file}.takeover`), 'the guard is not removed by a process that did not create it');
  });

  test('two simultaneous stale-lock takeovers cannot both succeed', async () => {
    const { dir, file } = lock();
    fs.writeFileSync(file, String(await deadPid()));
    const go = path.join(dir, 'go');
    const outA = path.join(dir, 'a.out');
    const outB = path.join(dir, 'b.out');
    const a = runLockChild(file, go, outA);
    const b = runLockChild(file, go, outB);
    try {
      await new Promise((resolve) => setTimeout(resolve, 150));
      fs.writeFileSync(go, '');
      const results = await Promise.all([a.exited, b.exited]);
      const reads = [outA, outB].map((f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : 'MISSING'));
      assert.equal(reads.filter((t) => t.startsWith('ACQUIRED')).length, 1, reads.join(' | '));
      assert.equal(reads.filter((t) => t.startsWith('BUSY LockBusyError')).length, 1, reads.join(' | '));
      assert.deepEqual(results.map((r) => r.code).sort(), [0, 3], 'one holder exits 0, the loser exits 3');
      assert.equal(fs.existsSync(file), false, 'the winner released the lock');
    } finally {
      a.child.kill();
      b.child.kill();
    }
  });
});

describe('helpers', () => {
  test('batchOf treats legacy files as batch 0', () => {
    assert.equal(batchOf(undefined), 0);
    assert.equal(batchOf({}), 0);
    assert.equal(batchOf({ batch: -1 }), 0);
    assert.equal(batchOf({ batch: 4 }), 4);
  });

  test('renameWithRetry moves a file within one directory', () => {
    const p = tempPair();
    fs.writeFileSync(`${p.out}.tmp`, 'x');
    renameWithRetry(`${p.out}.tmp`, p.out);
    assert.equal(fs.readFileSync(p.out, 'utf8'), 'x');
    assert.equal(fs.existsSync(`${p.out}.tmp`), false);
  });

  test('sumDetections counts every aggregated cell', () => {
    assert.equal(sumDetections(pair({ batch: 1, rows: 10, batch1: true }).out), 10);
    assert.equal(sumDetections({}), 0);
  });
});
