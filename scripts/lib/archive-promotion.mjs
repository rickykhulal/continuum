/**
 * Publish a completed staging archive, with the checks that make "completed" provable.
 *
 * The sequence is: judge the staging/checkpoint pair, refuse a stage that would shrink the
 * published record, copy the current published file to a recoverable backup, write a uniquely
 * named temp beside the destination, fsync it, rename it into place, then write a promotion
 * record carrying both hashes. A failure before the rename leaves the published file untouched;
 * a failure after it leaves a backup and a record that name exactly what was replaced.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { inspectArchivePair, SOURCES } from './archive-plan.mjs';

export class PromotionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PromotionError';
    this.code = code;
    this.details = details;
  }
}

export function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readJson(file, code, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new PromotionError(code, `${label} ${file} is not readable JSON (${err.message})`);
  }
}

function countDays(archive) {
  let days = 0;
  for (const block of Object.values(archive?.regions || {})) {
    for (const rows of Object.values(block?.days || {})) days += rows.length;
  }
  return days;
}

function writeDurable(file, text) {
  const fd = fs.openSync(file, 'w');
  try {
    fs.writeFileSync(fd, text);
    try {
      fs.fsyncSync(fd);
    } catch {
      /* best effort, as for the archive pair */
    }
  } finally {
    fs.closeSync(fd);
  }
}

const stamp = (d = new Date()) => d.toISOString().replace(/[:.]/g, '-');

export function judgePair({ stagePath, statePath, regionIds, sources = SOURCES, acceptUnresolvedFailures = false, allowPartial = false }) {
  for (const file of [stagePath, statePath]) {
    if (fs.existsSync(`${file}.tmp`)) {
      throw new PromotionError(
        'PAIR_IN_FLIGHT',
        `${file}.tmp exists — the pair may be mid-commit; finish or recover the writer before promoting`,
      );
    }
  }
  const stage = readJson(stagePath, 'STAGE_UNREADABLE', 'staging');
  const state = readJson(statePath, 'STATE_UNREADABLE', 'checkpoint');
  const report = inspectArchivePair({ stage, state, regionIds, sources, acceptUnresolvedFailures, allowPartial });
  if (!report.ok) {
    const summary = report.issues.map((i) => `[${i.code}] ${i.message}`).join('\n  ');
    throw new PromotionError(
      'QUALITY_GATE',
      `staging fails the archive quality gate:\n  ${summary}`,
      { issues: report.issues, stats: report.stats },
    );
  }
  return { stage, state, report };
}

/**
 * Promote a judged pair. Throws `PromotionError` rather than returning a partial success; the
 * destination is either the previous published file or the new one.
 */
export function promoteArchive({
  stagePath,
  statePath,
  destPath,
  backupDir,
  recordDir,
  regionIds,
  sources = SOURCES,
  acceptUnresolvedFailures = false,
  allowPartial = false,
  log = () => {},
  now = () => new Date(),
}) {
  const judged = judgePair({ stagePath, statePath, regionIds, sources, acceptUnresolvedFailures, allowPartial });
  const { stage, report } = judged;
  const days = countDays(stage);
  if (days === 0) {
    throw new PromotionError('EMPTY_STAGE', 'staging archive has no observed days — refusing to publish an empty overlay');
  }

  let backup = null;
  let previous = null;
  if (fs.existsSync(destPath)) {
    const prior = readJson(destPath, 'DEST_UNREADABLE', 'published archive');
    const priorDays = countDays(prior);
    if (priorDays > 0 && days < priorDays) {
      throw new PromotionError(
        'COVERAGE_SHRINK',
        `staging has ${days} observed days, the published bundle has ${priorDays} — refusing to shrink coverage`,
      );
    }
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `archive_daily-${stamp(now())}-${sha256(destPath).slice(0, 8)}.json`);
    fs.copyFileSync(destPath, backupPath);
    const backupHash = sha256(backupPath);
    if (backupHash !== sha256(destPath)) {
      throw new PromotionError('BACKUP_MISMATCH', `backup ${backupPath} does not match the published file it copies`);
    }
    backup = { path: backupPath, sha256: backupHash };
    previous = { days: priorDays, sha256: backupHash };
    log(`backup: ${backupPath} (${backupHash.slice(0, 12)})`);
  }

  const token = crypto.randomBytes(6).toString('hex');
  const tmp = `${destPath}.promote-${process.pid}-${token}.tmp`;
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  writeDurable(tmp, JSON.stringify(stage));
  let renamed = false;
  try {
    fs.renameSync(tmp, destPath);
    renamed = true;
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* the temp name is printed below if removal fails */
    }
    throw new PromotionError(
      'RENAME_FAILED',
      `could not replace ${destPath} (${err.code || err.message}); the published file is unchanged. Temp was ${tmp}`,
    );
  }
  if (!renamed) throw new PromotionError('RENAME_FAILED', `unknown rename failure for ${destPath}`);

  const promotedAt = now().toISOString();
  const record = {
    schema: 'continuum-promotion-1',
    promoted_at: promotedAt,
    dest: path.relative(process.cwd(), destPath) || destPath,
    dest_sha256: sha256(destPath),
    stage: {
      path: path.relative(process.cwd(), stagePath) || stagePath,
      sha256: sha256(stagePath),
      batch: report.stats.batch,
      requests: report.stats.requests,
      rows: report.stats.rows,
      generated_at: stage.generated_at ?? null,
    },
    checkpoint: {
      path: path.relative(process.cwd(), statePath) || statePath,
      sha256: sha256(statePath),
      batch: report.stats.batch,
    },
    gate: report.stats,
    unresolved_failures_accepted: Boolean(acceptUnresolvedFailures && report.stats.failedWindows),
    backup,
    previous,
  };
  fs.mkdirSync(recordDir, { recursive: true });
  const recordPath = path.join(recordDir, `promotion-${stamp(now())}.json`);
  writeDurable(recordPath, JSON.stringify(record, null, 2));
  return { record, recordPath, days, backup };
}
