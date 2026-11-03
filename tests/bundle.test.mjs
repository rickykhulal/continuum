// Bundle reproducibility and provenance tests (deployment PRD §7.4/§7.5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'bundle_manifest.json'), 'utf8'));
const snapshot = JSON.parse(fs.readFileSync(path.join(DATA, 'snapshot.json'), 'utf8'));

test('the manifest hashes every served file and the hashes verify', () => {
  assert.ok(manifest.files.length >= 3, `${manifest.files.length} entries`);
  for (const e of manifest.files) {
    const abs = [path.join(ROOT, 'public', e.name), path.join(ROOT, e.name)].find((p) => fs.existsSync(p));
    assert.ok(abs, `${e.name} is listed but missing`);
    const buf = fs.readFileSync(abs);
    assert.equal(sha256(buf), e.sha256, `${e.name} checksum`);
    assert.equal(buf.length, e.bytes, `${e.name} size`);
  }
});

test('raw CSV inputs are recorded with row counts', () => {
  const csvs = manifest.files.filter((f) => f.name.endsWith('.csv'));
  assert.equal(csvs.length, 4, `expected 4 FIRMS CSVs, found ${csvs.length}`);
  for (const c of csvs) {
    assert.ok(c.rows > 0, `${c.name} has ${c.rows} rows`);
    assert.match(c.name, /Global_7d\.csv$/, 'the shipped pipeline uses the keyless 7-day rolling archives');
  }
});

test('the bundle version is content-derived and stable across rebuilds', () => {
  const before = manifest.bundle_version;
  const target = path.join(DATA, 'bundle_manifest.json');
  const original = fs.readFileSync(target);
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'bundle.mjs')], { cwd: ROOT, stdio: 'pipe' });
    const again = JSON.parse(fs.readFileSync(target, 'utf8'));
    assert.equal(again.bundle_version, before, 're-running bundle.mjs on unchanged inputs must not change the version');
    assert.notEqual(again.created_at, undefined, 'created_at is still recorded');
  } finally {
    // Rebuilding in place moves `created_at`, and `npm run build` shipped the pre-test bytes into
    // dist/. validate/byte-compares public/data against dist/data, so a reproducibility check that
    // leaves its own rewrite behind makes the served artifact differ from the verified one. Prove the
    // version is stable, then restore the bytes that were actually built and hashed.
    fs.writeFileSync(target, original);
  }
});

test('provenance labels match what the app claims', () => {
  assert.equal(manifest.data_through, snapshot.windowEnd);
  assert.equal(manifest.window.start, snapshot.windowStart);
  assert.equal(manifest.window.end, snapshot.windowEnd);
  assert.ok(manifest.reconstruction.not.includes('historical FIRMS archive'), 'reconstruction is disclaimed');
  assert.ok(manifest.sources.length >= 4, 'every upstream source is named');
  assert.ok(manifest.sources.every((s) => s.url.startsWith('https://firms.modaps.eosdis.nasa.gov/')), 'live sources are NASA FIRMS only');
});

test('no key-bearing upstream is required to rebuild the bundle', () => {
  const script = fs.readFileSync(path.join(ROOT, 'scripts', 'build-data.mjs'), 'utf8');
  assert.ok(!/FIRMS_MAP_KEY|EARTHDATA_TOKEN/.test(script), 'the shipped ingest path is keyless');
  const urls = script.match(/https:\/\/[^'"]+/g) || [];
  assert.ok(urls.every((u) => u.includes('firms.modaps.eosdis.nasa.gov')), 'ingest only calls NASA FIRMS');
});

test('the textures and TLE shipped are the attributed public assets', () => {
  const tle = manifest.files.find((f) => f.name.startsWith('tle/'));
  assert.ok(tle, 'a bundled TLE file is listed');
  const text = fs.readFileSync(path.join(ROOT, 'public', tle.name), 'utf8');
  assert.match(text, /^1 \d{5}U/m, 'TLE lines carry catalog numbers');
  assert.ok(!/celesttrak\.org\/api|localhost/.test(text), 'no runtime endpoint baked into the snapshot');
  // The globe picks an 8K tier where the GPU supports it and a 4K tier otherwise, so both
  // tiers of day and night must ship. The 2K sheets and the cloud map are the original
  // Visible Earth records retained as public assets; nothing outside this list may be served.
  const textures = manifest.files.filter((f) => f.name.startsWith('textures/'));
  assert.deepEqual(
    textures.map((f) => f.name).sort(),
    [
      'textures/earth_clouds.jpg',
      'textures/earth_day.jpg',
      'textures/earth_day_4k.jpg',
      'textures/earth_day_8k.jpg',
      'textures/earth_night.jpg',
      'textures/earth_night_4k.jpg',
      'textures/earth_night_8k.jpg',
    ],
    'the shipped texture set is exactly the attributed Visible Earth sheets',
  );
  const globe = fs.readFileSync(path.join(ROOT, 'src', 'components', 'Globe.tsx'), 'utf8');
  for (const name of ['earth_day_4k.jpg', 'earth_day_8k.jpg', 'earth_night_4k.jpg', 'earth_night_8k.jpg']) {
    assert.ok(globe.includes(`textures/${name}`), `${name} ships but the globe never loads it`);
  }
});
