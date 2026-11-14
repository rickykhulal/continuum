#!/usr/bin/env node
/**
 * Writes public/data/bundle_manifest.json — the provenance record the API and the briefs cite.
 * Deterministic for a given set of inputs: same CSVs and same outputs produce the same manifest
 * apart from created_at, which is excluded from bundle_version.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const RAW = path.join(ROOT, 'data_raw');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function entry(abs, name) {
  if (!fs.existsSync(abs)) return null;
  const buf = fs.readFileSync(abs);
  const e = { name, sha256: sha256(buf), bytes: buf.length };
  if (name.endsWith('.csv')) {
    e.rows = buf.toString('utf8').split('\n').filter((l) => l.trim()).length - 1;
  }
  return e;
}

function listDir(dir, prefix, exts) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => exts.some((x) => f.toLowerCase().endsWith(x)))
    .map((f) => entry(path.join(dir, f), `${prefix}/${f}`))
    .filter(Boolean);
}

const snapshotPath = path.join(DATA, 'snapshot.json');
if (!fs.existsSync(snapshotPath)) {
  console.error('bundle: public/data/snapshot.json is missing — run `npm run data` first.');
  process.exit(2);
}

const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));

const dataFiles = [
  entry(path.join(DATA, 'live_fires.json'), 'data/live_fires.json'),
  entry(path.join(DATA, 'climate_daily.json'), 'data/climate_daily.json'),
  entry(path.join(DATA, 'archive_daily.json'), 'data/archive_daily.json'),
  entry(path.join(DATA, 'countries.json'), 'data/countries.json'),
  entry(path.join(DATA, 'country_fires.json'), 'data/country_fires.json'),
  entry(path.join(DATA, 'countries-50m.json'), 'data/countries-50m.json'),
  entry(snapshotPath, 'data/snapshot.json'),
  entry(path.join(DATA, 'land-110m.json'), 'data/land-110m.json'),
].filter(Boolean);

const rawFiles = listDir(RAW, 'data_raw', ['.csv']);
const tleFiles = listDir(path.join(ROOT, 'public', 'tle'), 'tle', ['.txt', '.json']);
const textureFiles = listDir(path.join(ROOT, 'public', 'textures'), 'textures', ['.jpg', '.jpeg', '.png', '.webp']);

const files = [...dataFiles, ...rawFiles, ...tleFiles, ...textureFiles];

// bundle_version is content-only so a rebuild at the same second is still comparable.
const versionDigest = sha256(
  files
    .filter((f) => !f.name.startsWith('textures/'))
    .map((f) => `${f.name}:${f.sha256}`)
    .sort()
    .join('\n'),
).slice(0, 12);

const sensorLast = Object.values(snapshot.sensorMeta || {})
  .map((s) => s?.last)
  .filter((d) => Boolean(d) && /^\d{4}-\d{2}-\d{2}$/.test(d) && d !== '0000-00-00' && d !== '9999-99-99')
  .sort();
const provisionalFrom = sensorLast.length
  ? ((first) => {
      const y = Number(first.slice(0, 4));
      const m = Number(first.slice(5, 7)) - 1;
      const d = Number(first.slice(8, 10));
      const dt = new Date(Date.UTC(y, m, d + 1));
      return dt.toISOString().slice(0, 10);
    })(sensorLast[0])
  : null;

const manifest = {
  schema_version: 1,
  bundle_version: `continuum-${snapshot.windowEnd || 'na'}-${versionDigest}`,
  method_version: 'continuum-harmonize-v1',
  created_at: new Date().toISOString(),
  window: { start: snapshot.windowStart, end: snapshot.windowEnd },
  data_through: snapshot.windowEnd,
  provisional_from: provisionalFrom,
  generated_at: snapshot.generatedAt,
  counts: snapshot.counts,
  sensors: snapshot.sensors,
  sensor_meta: snapshot.sensorMeta,
  sources: snapshot.sources,
  reconstruction: {
    record_start: '2000-11-01',
    kind: 'deterministic reconstruction calibrated to the live window',
    not: 'a re-download of the historical FIRMS archive',
  },
  files,
};

const out = path.join(DATA, 'bundle_manifest.json');
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
console.log(
  `bundle: ${manifest.bundle_version} — ${files.length} files (${rawFiles.length} raw CSVs, ${tleFiles.length} TLE, ${textureFiles.length} textures) → ${path.relative(ROOT, out)}`,
);
console.log(`bundle: data through ${manifest.data_through}, provisional from ${manifest.provisional_from}`);
