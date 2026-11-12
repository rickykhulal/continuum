#!/usr/bin/env node
/**
 * Data-integrity gate (deployment PRD §7.5).
 *
 * Every check is a hard fail — a corrupted or mislabelled bundle must stop the build, not warn.
 * Exit codes: 0 all checks pass, 1 a check failed, 2 the bundle could not be read at all.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// DATA_BUNDLE_PATH relocates the served bundle exactly as it does in server/api.mjs, and the two gates
// have to agree on which bytes they certify. A relocated bundle is judged on its own — falling back to
// public/data would let a partially mounted bundle pass.
const DATA_BUNDLE_PATH = process.env.DATA_BUNDLE_PATH || null;
const DATA = DATA_BUNDLE_PATH ? path.resolve(ROOT, DATA_BUNDLE_PATH) : path.join(ROOT, 'public', 'data');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  return Boolean(ok);
}

function readJson(abs) {
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

const livePath = path.join(DATA, 'live_fires.json');
const snapPath = path.join(DATA, 'snapshot.json');
const manPath = path.join(DATA, 'bundle_manifest.json');

if (!fs.existsSync(livePath) || !fs.existsSync(snapPath)) {
  console.error('validate: public/data/live_fires.json and snapshot.json are required — run `npm run data`.');
  process.exit(2);
}

let live;
let snapshot;
try {
  live = readJson(livePath);
  snapshot = readJson(snapPath);
} catch (err) {
  console.error(`validate: bundle is not readable JSON — ${err.message}`);
  process.exit(2);
}

const fires = Array.isArray(live.fires) ? live.fires : [];
const meta = live.meta || {};
const regions = readJson(path.join(ROOT, 'src', 'data', 'regions.json'));

// 1. Row reconciliation — the point list must equal the counts the build reported.
check(
  'row reconciliation',
  fires.length === (meta.counts?.kept ?? -1) && fires.length === (snapshot.counts?.kept ?? -2),
  `fires=${fires.length} live.counts.kept=${meta.counts?.kept} snapshot.counts.kept=${snapshot.counts?.kept}`,
);
check(
  'reconciliation of region + global sample',
  meta.counts ? meta.counts.region + meta.counts.globalSampled === meta.counts.kept : false,
  `region=${meta.counts?.region} global=${meta.counts?.globalSampled} kept=${meta.counts?.kept}`,
);
check(
  'sensor counts sum to total',
  Object.values(meta.sensorMeta || {}).reduce((s, m) => s + (m.count || 0), 0) === (meta.counts?.totalQuality ?? -1),
  `sensor sum=${Object.values(meta.sensorMeta || {}).reduce((s, m) => s + (m.count || 0), 0)} totalQuality=${meta.counts?.totalQuality}`,
);

// 2. Time range — every timestamp inside the declared window, window ordered.
const inWindow = meta.windowStart && meta.windowEnd ? [meta.windowStart, meta.windowEnd] : null;
const dates = fires.map((f) => new Date(f[5] * 1000).toISOString().slice(0, 10));
let outside = 0;
if (inWindow) for (const d of dates) if (d < inWindow[0] || d > inWindow[1]) outside++;
check('acquisition time inside window', outside === 0, `${outside} points outside ${inWindow?.join('..')}`);
check('window is ordered and matches the data', Boolean(inWindow) && dates.length > 0 && dates.sort()[0] === inWindow[0], `window=${inWindow?.join('..')}`);
check('timestamps are monotonic in the file', fires.every((f, i) => i === 0 || f[5] >= fires[i - 1][5]), 'sorted by acquisition time');

// 3. Coordinates valid, and points flagged as region data really are inside a pilot box.
const badCoord = fires.filter((f) => !Number.isFinite(f[0]) || Math.abs(f[0]) > 90 || !Number.isFinite(f[1]) || Math.abs(f[1]) > 180).length;
check('coordinates in range', badCoord === 0, `${badCoord} invalid lat/lon`);
const inRegion = ([lat, lon]) => regions.some((r) => lon >= r.bbox[0] && lat >= r.bbox[1] && lon <= r.bbox[2] && lat <= r.bbox[3]);
const regionCount = fires.filter(inRegion).length;
check('region point count matches', regionCount === (meta.counts?.region ?? -1), `recounted=${regionCount} declared=${meta.counts?.region}`);

// 4. Physical values.
const badFrp = fires.filter((f) => !Number.isFinite(f[2]) || f[2] < 0).length;
check('FRP non-negative and finite', badFrp === 0, `${badFrp} bad FRP values`);
const badSensor = fires.filter((f) => ![0, 1, 2, 3].includes(f[3])).length;
check('sensor id in 0..3', badSensor === 0, `${badSensor} unknown sensor ids`);
const badConf = fires.filter((f) => ![0, 1, 2].includes(f[4])).length;
check('confidence code in 0..2', badConf === 0, `${badConf} unknown confidence codes`);

// 5. Uniqueness — the exact same detection may not appear twice (that would mean a file was
// ingested twice). FIRMS reports several pixels of one scan line at the same rounded coordinate
// and acq_time, so differing FRP means a genuinely different detection, not a dupe.
const keys = new Set();
let dupes = 0;
let sharedFootprint = 0;
const footprints = new Set();
for (const f of fires) {
  const k = `${f[0]}|${f[1]}|${f[2]}|${f[3]}|${f[4]}|${f[5]}`;
  if (keys.has(k)) dupes++;
  else keys.add(k);
  const fp = `${f[0]}|${f[1]}|${f[3]}|${f[5]}`;
  if (footprints.has(fp)) sharedFootprint++;
  else footprints.add(fp);
}
check('no exact duplicate detections', dupes === 0, `${dupes} exact duplicate rows; ${sharedFootprint} share a rounded footprint (normal scan-line coincidence)`);

// 6. Freshness is monotonic per sensor and consistent with the window.
let freshOk = true;
const freshDetail = [];
for (const [name, m] of Object.entries(meta.sensorMeta || {})) {
  const ok = m.first <= m.last && m.first >= meta.windowStart && m.last <= meta.windowEnd;
  if (!ok) freshDetail.push(`${name}: ${m.first}..${m.last} outside ${meta.windowStart}..${meta.windowEnd}`);
}
freshOk = freshDetail.length === 0 && Object.keys(meta.sensorMeta || {}).length > 0;
check('per-sensor freshness ordered and inside window', freshOk, freshDetail.join('; ') || `${Object.keys(meta.sensorMeta || {}).length} sensors`);

// 7. Schema version + manifest checksums.
let provFrom = null;
if (!fs.existsSync(manPath)) {
  check('bundle manifest present', false, 'run `npm run bundle`');
} else {
  const manifest = readJson(manPath);
  check('manifest schema_version', manifest.schema_version === 1, `schema_version=${manifest.schema_version}`);
  check('manifest has bundle_version and data_through', Boolean(manifest.bundle_version) && Boolean(manifest.data_through), `v=${manifest.bundle_version} through=${manifest.data_through}`);
  const bad = [];
  // The four global FIRMS CSVs under data_raw/ are build inputs, not shipped artifacts, and are
  // deliberately not in the published repository: they are 94 MB and the backfill logs beside them
  // carry the download URLs. A clone that has them verifies their hashes like any other entry; one
  // that does not says so in the detail line, so the count of verified files is never read as if it
  // covered the inputs too. `npm run live` re-downloads them and this check tightens by itself.
  const inputsAbsent = !fs.existsSync(path.join(ROOT, 'data_raw'));
  let skippedInputs = 0;
  for (const e of manifest.files || []) {
    // Manifest names are public/-relative (`data/live_fires.json`) while the bundle directory is flat
    // (`<DATA>/live_fires.json`), so a relocated data file is the prefix stripped, not joined, and a
    // relocated bundle gets no fallback to the repo copy. Non-data entries (tle, textures) and the
    // data_raw build inputs are always read from the repo.
    const relocated = e.name.startsWith('data/') ? path.join(DATA, e.name.slice('data/'.length)) : null;
    const abs = (
      DATA_BUNDLE_PATH && relocated
        ? [relocated]
        : [relocated, path.join(ROOT, 'public', e.name), path.join(ROOT, e.name)]
    ).filter(Boolean).find((p) => fs.existsSync(p));
    if (!abs) {
      if (inputsAbsent && e.name.startsWith('data_raw/')) {
        skippedInputs++;
        continue;
      }
      bad.push(`${e.name}: missing`);
      continue;
    }
    const buf = fs.readFileSync(abs);
    if (sha256(buf) !== e.sha256) bad.push(`${e.name}: checksum mismatch`);
    if (e.bytes && buf.length !== e.bytes) bad.push(`${e.name}: size mismatch (${buf.length} vs ${e.bytes})`);
  }
  const shipped = (manifest.files || []).length - skippedInputs;
  const coverage = skippedInputs
    ? `${shipped} files verified, ${skippedInputs} data_raw build inputs absent (run npm run live to verify them)`
    : `${shipped} files verified`;
  check('manifest checksums and sizes match files', bad.length === 0 && shipped > 0, bad.join('; ') || coverage);
  check(
    'manifest window agrees with the snapshot',
    manifest.data_through === snapshot.windowEnd && manifest.provisional_from >= snapshot.windowStart,
    `manifest through=${manifest.data_through} provisional_from=${manifest.provisional_from} snapshot through=${snapshot.windowEnd}`,
  );

  // 8. Provisional days: every day at or after provisional_from must be flagged, never silently filled.
  provFrom = manifest.provisional_from;
  const staleSensors = Object.entries(snapshot.sensorMeta || {}).filter(([, m]) => m.last < snapshot.windowEnd).map(([n]) => n);
  check(
    'provisional_from names the sensors that lag the window',
    Boolean(provFrom) && staleSensors.length === 0 ? true : Boolean(provFrom),
    `provisional_from=${provFrom}; sensors not current: ${staleSensors.join(', ') || 'none'}`,
  );
}

// 9. Interval ordering in the derived record (lo <= harmonized <= hi) for every pilot region.
const bundlePath = path.join(ROOT, 'dist-server', 'analytics.mjs');
if (!fs.existsSync(bundlePath)) {
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-api.mjs')], { stdio: 'pipe' });
  } catch (err) {
    check('analytics bundle builds', false, String(err?.stderr || err?.message).slice(0, 200));
  }
}
if (fs.existsSync(bundlePath)) {
  const A = await import(pathToFileURL(bundlePath).href);
  const problems = [];
  let rowsChecked = 0;
  let provMismatch = 0;
  for (const r of A.REGIONS) {
    const records = A.regionRecord(r, live);
    for (const rec of records) {
      rowsChecked++;
      if (!(rec.lo <= rec.hi)) problems.push(`${r.id} ${rec.date}: lo>hi`);
      if (rec.harmonized < rec.lo - 1e-6 || rec.harmonized > rec.hi + 1e-6) problems.push(`${r.id} ${rec.date}: H outside CI`);
      if (!(rec.modis >= 0 && rec.viirs >= 0 && rec.noaa20 >= 0 && rec.noaa21 >= 0)) problems.push(`${r.id} ${rec.date}: negative sensor count`);
      if (provFrom && rec.date >= provFrom && !rec.provisional) provMismatch++;
    }
    if (problems.length > 5) break;
  }
  check('record interval ordering and non-negative counts', problems.length === 0, problems.slice(0, 5).join('; ') || `${rowsChecked} rows across pilot regions`);
  check('no duplicate dates in a record', A.REGIONS.every((r) => { const d = A.regionRecord(r, live).map((x) => x.date); return new Set(d).size === d.length; }), 'one row per day');
  check(
    'provisional flag covers the stale tail',
    provMismatch === 0,
    `${provMismatch} days at or after ${provFrom ?? 'n/a'} are not flagged provisional`,
  );

  // 10. Keyed archive: every observation the backfill holds must reach the record with the
  // same counts. Days inside the live window are excluded — that pull is fresher and owns
  // them. Absent file is not a failure: the archive is an optional layer of the bundle.
  const archivePath = path.join(DATA, 'archive_daily.json');
  if (fs.existsSync(archivePath)) {
    const rawArchive = readJson(archivePath);
    const epoch = Date.parse(`${rawArchive.start}T00:00:00Z`);
    const at = (i) => new Date(epoch + i * 86400000).toISOString().slice(0, 10);
    const drift = [];
    let labelled = 0;
    let observed = 0;
    for (const r of A.REGIONS) {
      const block = rawArchive.regions?.[r.id];
      if (!block?.days) continue;
      const want = new Map();
      for (const [sensor, rows] of Object.entries(block.days)) {
        for (const [i, n] of rows) {
          const day = at(i);
          const cell = want.get(day) || { m: 0, v: 0, n: 0, n21: 0 };
          cell[sensor] = n;
          want.set(day, cell);
        }
      }
      const byDate = new Map(A.regionRecord(r, live).map((x) => [x.date, x]));
      for (const [day, cell] of want) {
        observed++;
        const rec = byDate.get(day);
        if (!rec) {
          drift.push(`${r.id} ${day}: no row`);
          continue;
        }
        if (meta.windowStart && day >= meta.windowStart) continue;
        if (rec.source !== 'archive') drift.push(`${r.id} ${day}: labelled ${rec.source}, not archive`);
        else if (rec.modis !== cell.m || rec.viirs !== cell.v || rec.noaa20 !== cell.n || rec.noaa21 !== cell.n21) {
          drift.push(`${r.id} ${day}: record ${rec.modis}/${rec.viirs}/${rec.noaa20}/${rec.noaa21} vs archive ${cell.m}/${cell.v}/${cell.n}/${cell.n21}`);
        } else labelled++;
      }
    }
    check(
      'archive observations reach the record unchanged',
      drift.length === 0 && labelled > 0,
      drift.slice(0, 3).join('; ') ||
        `${labelled} archive dates carried into the record; ${observed} populated archive dates inspected, with the rolling window overlaid separately`,
    );
  }
} else {
  check('record checks', false, 'analytics bundle unavailable');
}

// What the browser is served has to be what was verified. `vite build` copies public/data into
// dist/data, so a bundle run after the build leaves dist/ holding the previous record — measured
// 2026-11-02, where the API served continuum-…-107911de714d while the manifest on disk said
// continuum-…-84cea7615e37. Only enforced once dist/ exists, i.e. after the first build.
const distData = path.join(ROOT, 'dist', 'data');
if (fs.existsSync(distData)) {
  const json = fs.readdirSync(distData).filter((f) => f.endsWith('.json'));
  const stale = json.filter((f) => {
    const served = path.join(ROOT, 'public', 'data', f);
    return fs.existsSync(served) && !fs.readFileSync(served).equals(fs.readFileSync(path.join(distData, f)));
  });
  check('dist/ serves exactly the verified bundle', stale.length === 0,
    stale.length ? `${stale.join(', ')} differ from public/data — run npm run build after npm run bundle` : `${json.length} data files identical`);
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name} — ${r.detail}`);
console.log(`\nvalidate: ${results.length - failed.length}/${results.length} checks passed`);
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(
  path.join(ROOT, 'docs', 'validation-report.json'),
  JSON.stringify({ generated_at: new Date().toISOString(), bundle_version: snapshot.windowEnd, passed: results.length - failed.length, total: results.length, checks: results }, null, 2) + '\n',
);
process.exit(failed.length ? 1 : 0);
