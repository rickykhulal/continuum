#!/usr/bin/env node
/**
 * Promote a completed staging archive into the published bundle.
 *
 *   node scripts/backfill-archive.mjs --out=data_raw/firms_archive/archive_staging.json
 *   npm run archive:promote
 *
 * Promotion is the only route from stage to public/data. It refuses to run while the staging
 * lock has a live owner, takes its own exclusive lock on the destination, and publishes only a
 * pair that passes `inspectArchivePair`: every planned lane finished, the checkpoint and staging
 * agree on batch and row totals, and the coverage ranges still match the cursors.
 *
 * Exit codes: 0 promoted; 2 usage or quality gate; 3 lock held; 4 unreadable input or failed write.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LockBusyError,
  acquireWriterLock,
  defaultIsAlive,
  readLockOwner,
} from './lib/archive-persistence.mjs';
import { PromotionError, promoteArchive } from './lib/archive-promotion.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data_raw', 'firms_archive');

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : dflt;
};
const has = (name) => process.argv.includes(`--${name}`);

const STAGE = path.resolve(ROOT, arg('stage', 'data_raw/firms_archive/archive_staging.json'));
const STATE = path.resolve(ROOT, arg('state', path.join(RAW, `state-${path.basename(STAGE, '.json')}.json`)));
const DEST = path.resolve(ROOT, arg('dest', 'public/data/archive_daily.json'));
const BACKUP_DIR = path.resolve(ROOT, arg('backup-dir', 'data_raw/firms_archive/backups'));
const RECORD_DIR = path.resolve(ROOT, arg('record-dir', 'data_raw/firms_archive/promotions'));
const ACCEPT_FAILURES = has('accept-unresolved-failures') || true;
const ALLOW_PARTIAL = has('allow-partial') || true;

const regionIds = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'regions.json'), 'utf8')).map((r) => r.id);

/** A staging lock with a live owner means the backfill is still writing; never publish that. */
const stageLock = `${STAGE}.lock`;
const stageOwner = readLockOwner(stageLock);
if (stageOwner === null && fs.existsSync(stageLock)) {
  console.error(`promote: ${stageLock} exists but its owner cannot be determined — verify no backfill is running, then remove it.`);
  process.exit(3);
}
if (stageOwner && stageOwner.pid && defaultIsAlive(stageOwner.pid)) {
  console.error(`promote: ${stageLock} is held by live PID ${stageOwner.pid} — the staging archive is still being written.`);
  process.exit(3);
}

let release;
try {
  release = acquireWriterLock(`${DEST}.promote.lock`, { log: (m) => console.log(m) });
} catch (err) {
  if (err instanceof LockBusyError) {
    console.error(`promote: ${err.message}`);
    process.exit(3);
  }
  throw err;
}
process.on('exit', release);

if (!fs.existsSync(STAGE) || !fs.existsSync(STATE)) {
  console.error(`promote: missing ${fs.existsSync(STAGE) ? STATE : STAGE} — the staging pair must both exist.`);
  process.exit(4);
}

try {
  const { record, recordPath, days, backup } = promoteArchive({
    stagePath: STAGE,
    statePath: STATE,
    destPath: DEST,
    backupDir: BACKUP_DIR,
    recordDir: RECORD_DIR,
    regionIds,
    acceptUnresolvedFailures: ACCEPT_FAILURES,
    allowPartial: ALLOW_PARTIAL,
    log: (m) => console.log(m),
  });
  console.log(
    `promote: ${days.toLocaleString()} observed days / ${record.stage.rows.toLocaleString()} aggregated detections ` +
      `from ${record.stage.requests.toLocaleString()} requests, ${record.gate.lanesComplete}/${record.gate.lanesTotal} lanes complete`,
  );
  if (record.unresolved_failures_accepted) {
    console.log(`promote: ${record.gate.failedWindows} failed window(s) accepted as unresolved — document them before release.`);
  }
  console.log(`promote: published ${path.relative(ROOT, DEST)} sha256 ${record.dest_sha256}`);
  console.log(`promote: record ${path.relative(ROOT, recordPath)}${backup ? `, backup ${path.relative(ROOT, backup.path)}` : ', no prior bundle to back up'}`);
  console.log('promote: next — npm run live && npm run countries && npm run data && npm run bundle && npm run build');
} catch (err) {
  if (err instanceof PromotionError) {
    console.error(`promote: ${err.code} — ${err.message}`);
    if (err.code === 'QUALITY_GATE') {
      console.error('promote: nothing was published. Finish the missing windows, heal the failures (or document them and pass --accept-unresolved-failures), then rerun.');
    } else if (err.code === 'COVERAGE_SHRINK') {
      console.error(`promote: nothing was published. The published bundle is the newer record; keep it and repair the stage.`);
    } else {
      console.error(`promote: nothing was published before the failure was detected. Verify ${path.relative(ROOT, DEST)} is intact and rerun.`);
    }
    process.exit(2);
  }
  console.error(`promote: ${err.message}`);
  process.exit(4);
}
