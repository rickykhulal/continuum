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

// `data_raw/` is deliberately not published: 94 MB of global FIRMS CSVs plus the download logs that
// sit beside them. The manifest still records each one's sha256, byte count and row count, so a clone
// can prove which bytes produced the bundle without carrying the bytes. Everything that ships is
// opened and verified here; the build inputs are verified only in a working copy that has them, and
// the count below says which case this was instead of quietly reporting fewer checks.
const isBuildInput = (name) => name.startsWith('data_raw/');
const hasInputs = fs.existsSync(path.join(ROOT, 'data_raw'));
const shippedOnly = (list) => list.filter((e) => !isBuildInput(e.name));

test('the manifest hashes every served file and the hashes verify', () => {
  assert.ok(manifest.files.length >= 3, `${manifest.files.length} entries`);
  let opened = 0;
  for (const e of manifest.files) {
    const abs = [path.join(ROOT, 'public', e.name), path.join(ROOT, e.name)].find((p) => fs.existsSync(p));
    if (!abs && !hasInputs && isBuildInput(e.name)) continue;
    assert.ok(abs, `${e.name} is listed but missing`);
    const buf = fs.readFileSync(abs);
    assert.equal(sha256(buf), e.sha256, `${e.name} checksum`);
    assert.equal(buf.length, e.bytes, `${e.name} size`);
    opened++;
  }
  const expected = hasInputs ? manifest.files.length : shippedOnly(manifest.files).length;
  assert.equal(opened, expected, `${opened} entries opened, ${expected} expected${hasInputs ? ' (raw inputs present)' : ` — ${manifest.files.length - shippedOnly(manifest.files).length} raw inputs are not in this clone`}`);
});

test('raw CSV inputs are recorded with row counts', () => {
  const csvs = manifest.files.filter((f) => f.name.endsWith('.csv'));
  assert.equal(csvs.length, 4, `expected 4 FIRMS CSVs, found ${csvs.length}`);
  let active = 0;
  for (const c of csvs) {
    // A keyless 7-day rolling archive can legitimately be empty when a given
    // spacecraft's feed is down (e.g. Suomi-NPP). Recorded rows may be 0, but
    // the file must still be listed and well-formed.
    assert.ok(c.rows >= 0, `${c.name} has ${c.rows} rows`);
    assert.match(c.name, /Global_7d\.csv$/, 'the shipped pipeline uses the keyless 7-day rolling archives');
    if (c.rows > 0) active++;
  }
  // MODIS, NOAA-20 and NOAA-21 are the live feeds; at least those must carry data.
  assert.ok(active >= 3, `expected at least 3 active CSVs, found ${active}`);
});

test('the bundle version is content-derived and stable across rebuilds', () => {
  const before = manifest.bundle_version;
  const target = path.join(DATA, 'bundle_manifest.json');
  const original = fs.readFileSync(target);
  const keyOf = (e) => `${e.name}|${e.sha256}|${e.bytes}|${e.rows ?? ''}`;
  const shipped = (list) => list.filter((e) => !isBuildInput(e.name));
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'bundle.mjs')], { cwd: ROOT, stdio: 'pipe' });
    const again = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (!hasInputs) {
      // A published clone has no raw CSVs to re-record, so bundle.mjs emits 4 fewer rows and the
      // content-derived version legitimately moves. Requiring equality there would fail a clone for
      // carrying fewer bytes, which is not a reproducibility defect. What must be identical is every
      // entry the clone actually serves, by name, hash, byte count and recorded row count.
      assert.deepEqual(again.files.map(keyOf).sort(), shipped(manifest.files).map(keyOf).sort(), 'a clone rebuild must reproduce every shipped entry exactly');
      return;
    }
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
