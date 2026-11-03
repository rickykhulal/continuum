import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const A = await import(pathToFileURL(path.join(ROOT, 'dist-server', 'analytics.mjs')).href);
const live = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'live_fires.json'), 'utf8'));
const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'snapshot.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'bundle_manifest.json'), 'utf8'));

const rows = [];
for (const id of A.REGIONS.map((r) => r.id)) {
  const region = A.getRegion(id);
  const records = A.regionRecord(region, live);
  const today = records[records.length - 1].date;
  const out = A.twinAnalogs(records, today, 8);
  rows.push({
    region: id,
    hitRate: out.backtestHitRate,
    sampleYears: out.sampleYears,
    analogs: out.analogs.map((a) => ({
      year: a.year,
      similarity: a.similarity,
      correlation: a.correlation,
      next4: a.next4WeeksAnomalyPct,
    })),
  });
}

console.log('bundle', manifest.bundle_version, 'windowEnd', snapshot.windowEnd, 'anchor', rows[0].region);
for (const r of rows) {
  console.log(JSON.stringify(r));
}

/** `--write` replaces the fixture block in place, so a recapture is one command and cannot be
 *  half-pasted. The reason for the change still has to be written into the header by hand. */
if (process.argv.includes('--write')) {
  const file = path.join(ROOT, 'tests', 'analog-index.test.mjs');
  const body = fs.readFileSync(file, 'utf8');
  const block = `const GOLDEN = [\n${rows.map((r) => '  ' + JSON.stringify(r) + ',').join('\n')}\n];`;
  const next = body.replace(/const GOLDEN = \[[\s\S]*?\n\];/, block);
  if (next === body) {
    console.error('capture: no GOLDEN block found in tests/analog-index.test.mjs — refusing to guess');
    process.exit(1);
  }
  fs.writeFileSync(file, next);
  console.log(`capture: wrote ${rows.length} golden rows (${manifest.bundle_version}) into tests/analog-index.test.mjs — update the header reason`);
}

const bias = [];
for (const id of A.REGIONS.map((r) => r.id)) {
  const region = A.getRegion(id);
  const records = A.regionRecord(region, live);
  const b = A.biasXray(records);
  const cal = A.calibrationFor(region, live);
  bias.push({
    region: id,
    k: Number(cal.k.toFixed(4)),
    kSource: cal.kSource,
    levelSource: cal.levelSource,
    ratio: Number(b.ratio.toFixed(4)),
    ci: [Number(b.ratioLo.toFixed(2)), Number(b.ratioHi.toFixed(2))],
    overlapDays: b.overlapDays,
    rawBreakPct: Number(b.rawBreakPct.toFixed(1)),
    correctedBreakPct: Number(b.correctedBreakPct.toFixed(1)),
  });
}
for (const r of bias) {
  const recs = A.regionRecord(A.getRegion(r.region), live);
  const b2 = A.biasXray(recs);
  console.log(
    r.region.padEnd(20),
    'k', r.k, `(${r.kSource}/${r.levelSource})`,
    'ratio', r.ratio, 'CI', r.ci.join('-'), 'overlap', r.overlapDays,
    'raw', r.rawBreakPct, 'corrected', r.correctedBreakPct, 'removed', b2.reductionPct,
  );
}

// The figures the Method page shows for the default area (README quotes these).
const defRegion = A.getRegion('chilecito');
const defRecords = A.regionRecord(defRegion, live);
const db = A.biasXray(defRecords);
const ds = A.runSandbox(defRecords, { overpassHour: 13.5, pixelM: 1000, minFrp: 10, correction: true, seed: 42 });
const dt = A.twinAnalogs(defRecords, defRecords[defRecords.length - 1].date, 8);
console.log('METHOD(default area)', JSON.stringify({
  ratio: db.ratio, ci: [db.ratioLo, db.ratioHi], overlapDays: db.overlapDays,
  raw: db.rawBreakPct, corrected: db.correctedBreakPct, reduction: db.reductionPct,
  hitRate: dt.backtestHitRate, sampleYears: dt.sampleYears,
  recovery: ds.recoveryError, rawBias: ds.rawBiasPct, residBias: ds.residualBiasPct,
}));
console.log('weatherCoverage', A.REGIONS.map((r) => r.id + '=' + A.weatherCoverage(r.id, A.START, live.meta.windowEnd).share.toFixed(4)).join(' '));
