import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  SOURCES,
  dayIndex,
  expectedCoverage,
  inspectArchivePair,
  planStats,
  windows,
} from '../scripts/lib/archive-plan.mjs';
import { PromotionError, promoteArchive } from '../scripts/lib/archive-promotion.mjs';

// Every fixture is a miniature two-window plan in an OS temp directory. Nothing in
// data_raw/ or public/data is read or written.

const SOURCE = { id: 'TEST_SP', sensor: 'v', min: '2020-01-01', max: '2020-01-10' };
const TEST_SOURCES = [SOURCE];
const REGIONS = ['r1'];
const WINS = windows(SOURCE.min, SOURCE.max);
const D0 = dayIndex(WINS[0]);
const D1 = dayIndex(WINS[1]);

const registry = [];
function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  registry.push(dir);
  return dir;
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

function pair({ done = 2, failed = [], rows = 7, batch = 3, requests = 2, cells = [[D0, 5, 1.2], [D1, 2, 0.3]] } = {}) {
  const state = { batch, rows, requests, lanes: { 'TEST_SP|r1': { done, failed, rows } } };
  const stage = {
    schema: 'continuum-archive-1',
    start: '2000-11-01',
    generated_at: '2026-11-14T09:00:00.000Z',
    batch,
    requests,
    rows,
    sources: [{ ...SOURCE }],
    regions: { r1: { days: cells.length ? { v: cells } : {}, covered: {} } },
  };
  stage.regions.r1.covered.v = expectedCoverage(state, 'r1', 'v', TEST_SOURCES);
  return { stage, state };
}

const inspect = (fixture, opts = {}) =>
  inspectArchivePair({ ...fixture, regionIds: REGIONS, sources: TEST_SOURCES, ...opts });
const codes = (report) => report.issues.map((i) => i.code);

function writePair(dir, fixture) {
  const stagePath = path.join(dir, 'archive_staging.json');
  const statePath = path.join(dir, 'state-archive_staging.json');
  fs.writeFileSync(stagePath, JSON.stringify(fixture.stage));
  fs.writeFileSync(statePath, JSON.stringify(fixture.state));
  return { stagePath, statePath };
}

const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const destFixture = (days = 1) => ({
  regions: { r1: { days: { v: Array.from({ length: days }, (_, i) => [D0 + i, 1, 0]) } } },
});

describe('plan', () => {
  test('the real plan is 8 products x 7 regions = 56 lanes and 27,146 windows', () => {
    const regionIds = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src', 'data', 'regions.json'), 'utf8')).map(
      (r) => r.id,
    );
    assert.deepEqual(planStats(regionIds), { sources: 8, regions: 7, lanes: 56, windows: 27146 });
    assert.equal(SOURCES.length, 8);
  });

  test('coverage merges adjacent windows and clips at the product end', () => {
    const coverage = expectedCoverage(pair().state, 'r1', 'v', TEST_SOURCES);
    assert.deepEqual(coverage, [[D0, D1 + 4, 0]]);
  });

  test('a failed window is excluded from coverage — missing, not an observed zero', () => {
    const fixture = pair({ done: 2, failed: [WINS[1]], rows: 5, cells: [[D0, 5, 1.2]] });
    assert.deepEqual(fixture.stage.regions.r1.covered.v, [[D0, D0 + 4, 0]]);
  });
});

describe('quality gate', () => {
  test('a complete, consistent pair passes', () => {
    const report = inspect(pair());
    assert.equal(report.ok, true, JSON.stringify(report.issues));
    assert.equal(report.stats.remainingWindows, 0);
    assert.equal(report.stats.lanesComplete, 1);
    assert.equal(report.stats.cells, 7);
  });

  test('an incomplete lane fails and names the remaining window count', () => {
    const report = inspect(pair({ done: 1, rows: 5, cells: [[D0, 5, 1.2]] }));
    assert.equal(report.ok, false);
    assert.ok(codes(report).includes('LANE_INCOMPLETE'));
    assert.ok(codes(report).includes('WINDOWS_REMAINING'));
    assert.equal(report.stats.remainingWindows, 1);
  });

  test('an unresolved failed window fails the gate unless it is explicitly accepted', () => {
    const fixture = pair({ done: 2, failed: [WINS[1]], rows: 5, cells: [[D0, 5, 1.2]] });
    assert.ok(codes(inspect(fixture)).includes('FAILED_WINDOWS_UNRESOLVED'));
    const accepted = inspect(fixture, { acceptUnresolvedFailures: true });
    assert.equal(accepted.ok, true, JSON.stringify(accepted.issues));
    assert.equal(accepted.stats.failedWindows, 1);
  });

  test('a failed window outside the plan is rejected', () => {
    const fixture = pair({ done: 2, failed: ['2019-12-01'], rows: 5, cells: [[D0, 5, 1.2]] });
    assert.ok(codes(inspect(fixture, { acceptUnresolvedFailures: true })).includes('FAILED_WINDOW_INVALID'));
  });

  test('a batch mismatch between staging and checkpoint is rejected', () => {
    const fixture = pair();
    fixture.stage.batch = 4;
    assert.ok(codes(inspect(fixture)).includes('BATCH_MISMATCH'));
  });

  test('cells that do not sum to the cursor are rejected', () => {
    const fixture = pair({ rows: 9 });
    assert.ok(codes(inspect(fixture)).includes('ROWS_MISMATCH'));
  });

  test('a missing or extra lane is rejected', () => {
    const missing = pair();
    missing.state.lanes = {};
    assert.ok(codes(inspect(missing)).includes('LANE_MISSING'));

    const extra = pair();
    extra.state.lanes['TEST_SP|elsewhere'] = { done: 0, failed: [], rows: 0 };
    assert.ok(codes(inspect(extra)).includes('LANE_EXTRA'));
  });

  test('a duplicated day cell is rejected', () => {
    const fixture = pair({ cells: [[D0, 5, 1.2], [D0, 2, 0.3]], rows: 7 });
    assert.ok(codes(inspect(fixture)).includes('DUPLICATE_DAY'));
  });

  test('coverage that disagrees with the cursors is rejected', () => {
    const fixture = pair();
    fixture.stage.regions.r1.covered.v = [[D0, D0 + 4, 0]];
    assert.ok(codes(inspect(fixture)).includes('COVERAGE_MISMATCH'));
  });

  test('a manifest that has lost a product is rejected', () => {
    const fixture = pair();
    fixture.stage.sources = [];
    assert.ok(codes(inspect(fixture)).includes('SOURCES_MISMATCH'));
  });

  test('a missing region is rejected', () => {
    const fixture = pair();
    delete fixture.stage.regions.r1;
    assert.ok(codes(inspect(fixture)).includes('REGIONS_MISMATCH'));
  });
});

describe('promotion', () => {
  function workspace(fixture = pair()) {
    const dir = tempDir('continuum-promote-');
    const { stagePath, statePath } = writePair(dir, fixture);
    const destPath = path.join(dir, 'public', 'data', 'archive_daily.json');
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, JSON.stringify(destFixture(1)));
    return { dir, stagePath, statePath, destPath };
  }

  const run = (ws, overrides = {}) =>
    promoteArchive({
      stagePath: ws.stagePath,
      statePath: ws.statePath,
      destPath: ws.destPath,
      backupDir: path.join(ws.dir, 'backups'),
      recordDir: path.join(ws.dir, 'promotions'),
      regionIds: REGIONS,
      sources: TEST_SOURCES,
      ...overrides,
    });

  test('a complete pair is published with a backup and a hash record', () => {
    const ws = workspace();
    const priorHash = hash(ws.destPath);
    const result = run(ws);

    assert.deepEqual(JSON.parse(fs.readFileSync(ws.destPath, 'utf8')), pair().stage);
    assert.equal(result.record.dest_sha256, hash(ws.destPath));
    assert.equal(result.record.stage.sha256, hash(ws.stagePath));
    assert.equal(result.record.checkpoint.sha256, hash(ws.statePath));
    assert.equal(result.record.backup.sha256, priorHash);
    assert.ok(fs.existsSync(result.record.backup.path));
    assert.equal(JSON.parse(fs.readFileSync(result.record.backup.path, 'utf8')).regions.r1.days.v.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(result.recordPath, 'utf8')).schema, 'continuum-promotion-1');
    assert.equal(fs.readdirSync(path.dirname(ws.destPath)).some((f) => f.includes('.promote-')), false);
  });

  test('an incomplete pair is refused and the published file is untouched', () => {
    const ws = workspace(pair({ done: 1, rows: 5, cells: [[D0, 5, 1.2]] }));
    const before = hash(ws.destPath);
    assert.throws(() => run(ws), (err) => err instanceof PromotionError && err.code === 'QUALITY_GATE');
    assert.equal(hash(ws.destPath), before);
    assert.equal(fs.existsSync(path.join(ws.dir, 'promotions')), false);
    assert.equal(fs.readdirSync(path.dirname(ws.destPath)).some((f) => f.includes('.promote-')), false);
  });

  test('a stage that would shrink coverage is refused', () => {
    const ws = workspace();
    fs.writeFileSync(ws.destPath, JSON.stringify(destFixture(3)));
    const before = hash(ws.destPath);
    assert.throws(() => run(ws), (err) => err instanceof PromotionError && err.code === 'COVERAGE_SHRINK');
    assert.equal(hash(ws.destPath), before);
  });

  test('a pair with a leftover temp file is refused', () => {
    const ws = workspace();
    fs.writeFileSync(`${ws.stagePath}.tmp`, '{}');
    assert.throws(() => run(ws), (err) => err instanceof PromotionError && err.code === 'PAIR_IN_FLIGHT');
  });

  test('accepted failures publish and are recorded as accepted', () => {
    const ws = workspace(pair({ done: 2, failed: [WINS[1]], rows: 5, cells: [[D0, 5, 1.2]] }));
    const result = run(ws, { acceptUnresolvedFailures: true });
    assert.equal(result.record.unresolved_failures_accepted, true);
    assert.equal(result.record.gate.failedWindows, 1);
  });

  test('without a prior bundle there is no backup and the record says so', () => {
    const ws = workspace();
    fs.rmSync(ws.destPath);
    const result = run(ws);
    assert.equal(result.record.backup, null);
    assert.equal(result.record.previous, null);
    assert.ok(fs.existsSync(ws.destPath));
  });
});
