import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

const world = read('countries.json');
const fires = read('country_fires.json');
const manifest = read('bundle_manifest.json');
const regions = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'regions.json'), 'utf8'));

/** Countries the world layer must name on every inhabited continent, from the user's own list size. */
const CONTINENTAL = [
  'United States', 'Canada', 'Mexico', 'Brazil', 'Argentina', 'Chile',
  'United Kingdom', 'France', 'Germany', 'Italy', 'Spain', 'Poland', 'Ukraine',
  'Nigeria', 'Egypt', 'Kenya', 'South Africa', 'Ethiopia', 'Algeria',
  'India', 'China', 'Japan', 'Indonesia', 'Thailand', 'Turkey', 'Saudi Arabia', 'Kazakhstan', 'Nepal',
  'Australia', 'New Zealand', 'Papua New Guinea', 'Fiji',
];

test('world layer: every country polygon is indexed, id-unique and geometrically sane', () => {
  const cs = world.countries;
  assert.equal(cs.length, 241, `expected the 241 Natural Earth 50m countries, got ${cs.length}`);
  assert.equal(new Set(cs.map((c) => c.id)).size, cs.length, 'country ids must be unique');
  assert.equal(new Set(cs.map((c) => c.name)).size, cs.length, 'country names must be unique');
  for (const c of cs) {
    const [w, s, e, n] = c.bbox;
    assert.ok(w <= e && s <= n, `${c.name}: bbox must be ordered`);
    assert.ok(w >= -180.5 && e <= 180.5 && s >= -90 && n <= 90, `${c.name}: bbox out of range`);
    assert.ok(c.areaKm2 > 0, `${c.name}: polygon area must be positive`);
    const [lat, lon] = c.center;
    assert.ok(Math.abs(lat) <= 90 && Math.abs(lon) <= 180, `${c.name}: centre out of range`);
    // A centroid belongs inside its own bbox unless the polygon straddles the antimeridian.
    if (e - w < 180) {
      assert.ok(lon >= w - 0.6 && lon <= e + 0.6 && lat >= s - 0.6 && lat <= n + 0.6, `${c.name}: centre ${lat},${lon} outside bbox ${c.bbox}`);
    }
  }
});

test('world layer: the whole world is reachable, not a curated shortlist', () => {
  const byName = new Map(world.countries.map((c) => [c.name, c]));
  const missing = CONTINENTAL.filter((n) => !byName.has(n));
  assert.deepEqual(missing, [], `continents must all resolve: ${missing.join(', ')}`);
  const withFires = CONTINENTAL.filter((n) => byName.get(n).detections > 0);
  assert.ok(withFires.length >= 28, `at least 28 of the 32 sampled countries must have detections, got ${withFires.length}`);
});

test('world layer: per-country counts tie exactly to the four global FIRMS CSVs', () => {
  const csvRows = manifest.files
    .filter((f) => f.name.startsWith('data_raw/') && f.name.endsWith('.csv'))
    .reduce((s, f) => s + f.rows, 0);
  assert.equal(
    fires.meta.rows_read + fires.meta.rows_dropped,
    csvRows,
    `rows read (${fires.meta.rows_read}) + dropped (${fires.meta.rows_dropped}) must equal the CSV rows in the manifest (${csvRows})`,
  );
  // The same window the bundle was validated against.
  assert.equal(fires.meta.rows_read, manifest.counts.totalQuality, 'quality rows must agree with the bundle snapshot');
  assert.equal(fires.meta.window.end, manifest.data_through, 'the country window must be the bundled window');

  const sum = fires.countries.reduce((s, c) => s + c.total, 0);
  assert.equal(sum, fires.meta.rows_in_countries, 'country totals must equal the attributed rows');
  assert.ok(fires.meta.coverage_pct > 90, `${fires.meta.coverage_pct}% attributed is below the 90% floor`);

  for (const c of fires.countries) {
    const perDay = Object.values(c.perDay).reduce((a, b) => a + b, 0);
    assert.equal(perDay, c.total, `${c.name}: per-day counts must sum to the total`);
    const sensors = Object.values(c.sensors).reduce((a, b) => a + b, 0);
    assert.equal(sensors, c.total, `${c.name}: sensor split must sum to the total`);
    assert.equal(c.day + c.night, c.total, `${c.name}: day/night split must sum to the total`);
    for (const d of Object.keys(c.perDay)) {
      assert.ok(d >= fires.meta.window.start && d <= fires.meta.window.end, `${c.name}: ${d} outside the window`);
    }
    const known = world.countries.find((g) => g.id === c.id);
    assert.ok(known, `${c.name} (${c.id}) must exist in the gazetteer`);
  }
});

test('world layer: each pilot region finds its own country in the gazetteer', () => {
  const expected = {
    chilecito: 'Argentina',
    pantanal: 'Brazil',
    california: 'United States',
    greece: 'Greece',
    amazon: 'Brazil',
    nepal: 'Nepal',
    'southeast-australia': 'Australia',
  };
  for (const r of regions) {
    const want = expected[r.id];
    const entry = world.countries.find((c) => c.name === want);
    assert.ok(entry, `${want} must be indexed`);
    const [w, s, e, n] = entry.bbox;
    const [lat, lon] = r.center;
    assert.ok(lon >= w && lon <= e && lat >= s && lat <= n, `${r.id} centre ${lat},${lon} must sit inside ${want}'s bbox`);
    assert.ok(entry.detections > 0, `${want} must have measured detections in the live window`);
  }
});

test('world layer: polygon area agrees with the independent raster count', () => {
  // The builder counts 0.2° cells as a second, unrelated measurement of the same border.
  // Antarctica is the one shape the two estimators cannot agree on by construction: its mainland
  // ring runs a full 360° around the pole, so the grid count also fills the Weddell and Ross
  // embayments. It is checked against the published continent area in its own assertion below.
  const polarCap = new Set(['Antarctica']);
  let worst = { ratio: 0, name: '' };
  for (const c of world.countries) {
    if (c.areaKm2 < 20000 || polarCap.has(c.name)) continue; // small islands are dominated by coastline rounding
    const ratio = Math.min(c.areaKm2, c.rasterKm2) / Math.max(c.areaKm2, c.rasterKm2);
    if (worst.ratio === 0 || ratio < worst.ratio) worst = { ratio, name: c.name, poly: c.areaKm2, raster: c.rasterKm2 };
  }
  assert.ok(worst.ratio > 0.85, `polygon vs raster disagreement: ${worst.name} ${worst.poly} vs ${worst.raster} (${(worst.ratio * 100).toFixed(1)}%)`);
});

test('world layer: the polar and antimeridian shapes measure like the published numbers', () => {
  // Three shapes the naive lon/lat ray cast got wrong: a continent around the pole, the country
  // that straddles ±180, and the planet's land total as an independent cross-check.
  const ant = world.countries.find((c) => c.name === 'Antarctica');
  assert.ok(ant.areaKm2 > 12e6 && ant.areaKm2 < 16e6, `Antarctica area ${ant.areaKm2} should bracket the published 14.2M km²`);
  assert.ok(ant.bbox[1] <= -89.9 && ant.bbox[3] >= -61, 'Antarctica must reach the pole and the peninsula');
  const russia = world.countries.find((c) => c.name === 'Russia');
  assert.ok(Math.abs(russia.areaKm2 - 17_098_242) / 17_098_242 < 0.03, `Russia area ${russia.areaKm2} vs published 17,098,242 km²`);
  assert.ok(russia.rasterKm2 / russia.areaKm2 > 0.9 && russia.rasterKm2 / russia.areaKm2 < 1.1, 'the antimeridian must not double-count Russia');
  const land = world.countries.reduce((a, c) => a + c.areaKm2, 0);
  assert.ok(Math.abs(land - 148.9e6) / 148.9e6 < 0.06, `all country polygons sum to ${Math.round(land / 1e6)}M km², Earth land is 148.9M`);
});

test('world layer: a country record is its measured border counts, day by day', async () => {
  // The pipeline used to build a country's live days from the bundle's stride sample, so a
  // 245-detection border printed 1, 2, 4 detections a day and any day the sample missed kept its
  // modelled Poisson value. The shipped per-country window is a complete measurement of the same
  // border, so it must be what the record carries — and what the calibration level ties to.
  const A = await import('../dist-server/analytics.mjs');
  const live = read('live_fires.json');
  const byId = new Map(fires.countries.map((c) => [c.id, c]));
  const windowEnd = fires.meta.window.end;
  // Install through the shipped installer — the one the browser fetches into and the API reads off
  // disk — so this test proves the production path rather than a test-local copy of it.
  A.hydrateWorldLayer(world, fires);
  const registered = A.installWorldLayer();
  const regionOf = (id) => A.lookupRegion(`country-${id}`);
  const dayCount = Math.round((Date.parse(`${windowEnd}T00:00:00Z`) - Date.parse(`${live.meta.windowStart}T00:00:00Z`)) / 86400000) + 1;
  try {
    assert.equal(registered, world.countries.length, 'every gazetteer country must become an analysable area');
    for (const id of ['kenya', 'brazil', 'russia', 'australia', 'iceland']) {
      const region = regionOf(id);
      assert.ok(region, `${id}: the border must resolve to an area`);
      const days = A.recordsInRange(A.regionRecord(region, live), live.meta.windowStart, windowEnd);
      const detections = days.reduce((s, r) => s + r.modis + r.viirs + r.noaa20 + r.noaa21, 0);
      assert.equal(days.length, dayCount, `${id}: every day of the window must be an observation`);
      assert.ok(days.every((r) => r.source === 'live'), `${id}: no window day may be labelled modelled`);
      assert.equal(detections, byId.get(id).total, `${id}: the daily counts must add back to the measured border total`);
      const cal = A.calibrationFor(region, live);
      assert.equal(cal.levelSource, 'country-window', `${id}: the level must come from the border, not a pooled density`);
      const harmonized = days.reduce((s, r) => s + r.harmonized, 0);
      assert.ok(Math.abs(cal.levelPerDay * dayCount - harmonized) < 1e-6, `${id}: level ${cal.levelPerDay} × ${dayCount} days must equal the record's ${harmonized}`);
    }
    // A border the satellites produced nothing for is a measurement of zero, not a pilot average.
    const quiet = regionOf('antarctica');
    const cal = A.calibrationFor(quiet, live);
    assert.equal(cal.levelSource, 'country-window');
    assert.equal(cal.levelPerDay, 0, 'Antarctica has no detections; it must not inherit the pilot density');
    const days = A.recordsInRange(A.regionRecord(quiet, live), live.meta.windowStart, windowEnd);
    assert.equal(days.reduce((s, r) => s + r.harmonized, 0), 0, 'a measured zero must print zero, not a model');
    // Installing the world layer must not move a pilot area: pilot regions carry no countryId, so
    // their own complete pull still outranks a border that is orders of magnitude larger.
    for (const pilot of A.REGIONS) {
      const c = A.calibrationFor(pilot, live);
      assert.equal(c.levelSource, 'area', `${pilot.id}: a pilot area keeps its own measured level`);
      assert.notEqual(c.kSource, 'country-window', `${pilot.id}: a pilot area keeps its own bridge`);
    }
    // And a hand-picked AOI inside a pilot bbox keeps its own radius-level measurement, even when the
    // gazetteer can name the country it sits in.
    const ca = A.REGIONS.find((r) => r.id === 'california');
    const aoi = A.customRegion(ca.center[0], ca.center[1], 60, 'California AOI', 'united-states');
    assert.equal(A.calibrationFor(aoi, live).levelSource, 'area', 'a fully observed AOI must not be overwritten by its country average');
  } finally {
    A.uninstallWorldLayer();
  }
});
