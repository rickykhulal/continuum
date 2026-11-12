import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const A = await import(pathToFileURL(path.join(ROOT, 'dist-server', 'analytics.mjs')).href);

// TEST ONLY: every count, envelope, coordinate and country below is synthetic.
// No production fire/climate/archive data supplies an expected result. An envelope
// means published-window availability, NOT proof that the ground was observed.
const D0 = '2024-01-01';
const D1 = '2024-01-02';
const D2 = '2024-01-03';
const D3 = '2024-01-04';
const D4 = '2024-01-05';
const NAMES = ['MODIS', 'VIIRS-SNPP', 'NOAA-20', 'NOAA-21'];
const KEYS = ['modis', 'viirs', 'noaa20', 'noaa21'];
const NONE = { modis: false, viirs: false, noaa20: false, noaa21: false };
const ALL = { modis: true, viirs: true, noaa20: true, noaa21: true };
const CENTER = [-29.2, -67.5];

function resetFixtures() {
  A.attachArchive(null);
  A.attachClimate(null);
  A.setCountryWindowLookup(null);
}
beforeEach(resetFixtures);
afterEach(resetFixtures);

function syntheticRegion(name) {
  const region = structuredClone(A.getRegion('chilecito'));
  region.id = `test-only-live-${name}`;
  region.name = `TEST ONLY live coverage: ${name}`;
  region.shortName = 'TEST ONLY';
  region.description = 'Synthetic regression fixture, not a NASA observation.';
  region.aliases = [];
  region.center = [...CENTER];
  region.bbox = [-67.7, -29.4, -67.3, -29.0];
  region.areaKm2 = 1600;
  delete region.countryId;
  return region;
}

function outsideRegion(name, border = false) {
  const region = syntheticRegion(name);
  if (border) region.id = `country-${region.id}`;
  region.countryId = `test-only-country-${name}`;
  region.center = [-24.5, -178.2];
  region.bbox = [-179, -25, -177, -24];
  region.areaKm2 = border ? 10000 : 1000;
  return region;
}

function points(date, counts, center = CENTER, frp = 2) {
  // Distinct, deterministic tuples; all offsets stay well inside the fixture bbox.
  const noon = Date.parse(`${date}T12:00:00Z`) / 1000;
  return counts.flatMap((count, sensor) => Array.from({ length: count }, (_, i) =>
    [center[0] + i * 0.000001, center[1], frp, sensor, 2, noon + i]));
}

function bundle(fires = [], options = {}) {
  const { start = D0, end = D2, sensors = NAMES, envelopes = {} } = options;
  return {
    meta: {
      generatedAt: '2024-01-06T00:00:00Z',
      windowStart: start,
      windowEnd: end,
      sensors: [...sensors],
      // Envelopes are explicit fixture inputs, not inferred from local hits.
      sensorMeta: Object.fromEntries(NAMES.map((name, id) => [name, {
        first: start, last: end, count: fires.filter((f) => f[3] === id).length,
        ...envelopes[name],
      }])),
      counts: { totalQuality: fires.length, kept: fires.length, region: fires.length, globalSampled: 0 },
      regionDays: {},
      sources: [{ name: 'TEST ONLY synthetic availability', url: 'urn:test-only:live-coverage' }],
    },
    fires,
  };
}

function viirsEnds(date) {
  return Object.fromEntries(NAMES.slice(1).map((name) => [name, { last: date }]));
}

function recordAt(records, date) {
  const row = records.find((r) => r.date === date);
  assert.ok(row, `missing TEST ONLY record ${date}`);
  return row;
}

function assertLive(row, observed) {
  assert.equal(row.source, 'live');
  assert.equal(row.live, true);
  assert.equal(row.provisional, true);
  assert.deepEqual(row.observed, observed);
}

function close(actual, expected, message) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < 1e-9,
    `${message}: expected ${expected}, got ${actual}`);
}

function attachSyntheticArchive(region) {
  const index = (Date.parse(`${D0}T00:00:00Z`) - Date.parse('2000-11-01T00:00:00Z')) / 86400000;
  assert.equal(A.attachArchive({
    schema: 'test-only-live-coverage-archive-v1',
    generated_at: '2024-01-06T00:00:00Z',
    start: '2000-11-01',
    method: 'TEST ONLY synthetic archive; not downloaded observations',
    requests: 0,
    rows: 17,
    regions: {
      [region.id]: {
        covered: { m: [[index, index, 0]], v: [[index, index, 0]], n: [[index, index, 0]], n21: [[index, index, 0]] },
        days: { m: [[index, 7, 70]], v: [[index, 5, 50]], n: [[index, 3, 30]], n21: [[index, 2, 20]] },
      },
    },
  }), true);
}

// Independent country marginals AND intersections: allocating the marginals
// proportionally cannot reproduce these per-day sensor counts or the FRP sums.
function countryWindow() {
  return {
    name: 'TEST ONLY synthetic country',
    windowStart: D0,
    windowEnd: D2,
    areaKm2: 10000,
    total: 160,
    sensors: { MODIS: 50, 'VIIRS-SNPP': 55, 'NOAA-20': 33, 'NOAA-21': 22 },
    perDay: { [D0]: 40, [D1]: 100, [D2]: 20 },
    perDaySensors: {
      [D0]: { MODIS: 40, 'VIIRS-SNPP': 0, 'NOAA-20': 0, 'NOAA-21': 0 },
      [D1]: { MODIS: 0, 'VIIRS-SNPP': 50, 'NOAA-20': 30, 'NOAA-21': 20 },
      [D2]: { MODIS: 10, 'VIIRS-SNPP': 5, 'NOAA-20': 3, 'NOAA-21': 2 },
    },
    perDayFrp: { [D0]: 400, [D1]: 250, [D2]: 123 },
    frpMean: 773 / 160,
  };
}

function installCountry(region, stats) {
  A.setCountryWindowLookup((id) => id === region.countryId ? stats : null);
}

test('TEST ONLY availability intersects sensor membership, envelopes and inclusive window bounds', () => {
  const meta = bundle([], {
    start: D1, end: D3,
    sensors: ['NOAA-21', 'MODIS', 'VIIRS-SNPP'],
    envelopes: {
      MODIS: { first: D0, last: D4 },
      'VIIRS-SNPP': { first: D1, last: D2 },
      'NOAA-20': { first: D0, last: D4 },
      'NOAA-21': { first: D2, last: D3 },
    },
  }).meta;
  // count=0 does not negate a valid publishing envelope; missing membership does.
  for (const [date, expected] of [
    [D0, NONE],
    [D1, { modis: true, viirs: true, noaa20: false, noaa21: false }],
    [D2, { modis: true, viirs: true, noaa20: false, noaa21: true }],
    [D3, { modis: true, viirs: false, noaa20: false, noaa21: true }],
    [D4, NONE],
  ]) assert.deepEqual(A.liveSensorAvailability(meta, date), expected, date);
});

test('TEST ONLY availability requires a usable first/last envelope for every advertised lane', () => {
  const meta = bundle().meta;
  meta.sensorMeta = {
    MODIS: { first: '', last: '', count: 99 },
    'VIIRS-SNPP': { first: D0, count: 99 },
    'NOAA-20': { first: D2, last: D0, count: 99 },
  };
  assert.deepEqual(A.liveSensorAvailability(meta, D1), NONE);
  assert.deepEqual(A.liveSensorAvailability(null, D1), NONE);
});

test('TEST ONLY published-zero VIIRS wins over positive MODIS in both headline and calibration', () => {
  const region = syntheticRegion('published-zero');
  const live = bundle([...points(D0, [40, 50, 30, 20]), ...points(D1, [8, 0, 0, 0])], { end: D1 });
  const row = recordAt(A.regionRecord(region, live), D1);
  assertLive(row, ALL);
  assert.equal(row.modis, 8);
  assert.equal(row.raw, 0);
  assert.equal(row.harmonized, 0);
  assert.equal(row.frp, 16);
  assert.equal(row.constellation, 'complete');
  const cal = A.calibrationFor(region, live);
  assert.ok(cal);
  close(cal.levelPerDay, 50, 'only the first day contributes 100 VIIRS detections');
});

test('TEST ONLY an entirely quiet published day replaces every model headline and sensor value', () => {
  const region = syntheticRegion('quiet-clears-model');
  const live = bundle(points(D0, [100, 500, 300, 200]), { end: D1 });
  const row = recordAt(A.regionRecord(region, live), D1);
  assertLive(row, ALL);
  assert.ok(row.modelled?.raw > 0 && row.modelled?.harmonized > 0,
    'the fixture must actually replace a positive reconstruction, not vacuously test zeros');
  assert.deepEqual(KEYS.map((key) => row[key]), [0, 0, 0, 0]);
  assert.deepEqual(KEYS.map((key) => A.sensorCount(row, key)), ['0', '0', '0', '0']);
  assert.equal(row.raw, 0);
  assert.equal(row.harmonized, 0);
  assert.equal(row.frp, 0);
  assert.equal(row.lo, 0);
  close(row.hi, 0.41125, 'zero-count live uncertainty is recomputed, not inherited from the model');
  assert.equal(row.constellation, 'complete');
  assert.equal(A.dailyValue(row, 'firedays', 'raw'), 0);
  assert.equal(A.dailyValue(row, 'firedays', 'harmonized'), 0);
});

for (const [id, name, key] of [[1, 'VIIRS-SNPP', 'viirs'], [2, 'NOAA-20', 'noaa20'], [3, 'NOAA-21', 'noaa21']]) {
  test(`TEST ONLY ${name} alone prints missing lanes as em dashes and keeps an unsupported subtotal`, () => {
    const region = syntheticRegion(`single-${key}`);
    const counts = [0, 0, 0, 0];
    counts[id] = 5;
    const live = bundle(points(D0, counts), { end: D1, sensors: [name] });
    const records = A.regionRecord(region, live);
    for (const [date, expected] of [[D0, 5], [D1, 0]]) {
      const row = recordAt(records, date);
      assertLive(row, { ...NONE, [key]: true });
      assert.equal(row.raw, expected);
      assert.equal(row.harmonized, expected);
      assert.equal(row.constellation, 'partial');
      assert.deepEqual(KEYS.map((lane) => A.sensorCount(row, lane)),
        KEYS.map((lane) => lane === key ? String(expected) : '—'));
    }
  });
}

test('TEST ONLY missing NOAA-21 uses shares learned only on earlier fully joint VIIRS dates', () => {
  const region = syntheticRegion('joint-shares');
  const live = bundle([
    ...points(D0, [40, 50, 30, 20]), ...points(D1, [40, 50, 30, 20]),
    ...points(D2, [8, 5, 3, 0]), ...points(D3, [11, 0, 0, 0]),
  ], { end: D3, envelopes: { 'NOAA-21': { last: D1 } } });
  const records = A.regionRecord(region, live);
  for (const date of [D0, D1]) {
    const row = recordAt(records, date);
    assertLive(row, ALL);
    assert.equal(row.raw, 100);
    assert.equal(row.harmonized, 100);
    assert.equal(row.constellation, 'complete');
  }
  const partial = recordAt(records, D2);
  assertLive(partial, { ...ALL, noaa21: false });
  assert.equal(partial.raw, 8);
  assert.equal(partial.harmonized, 10); // 8 / (0.5 + 0.3), not a share diluted by D2.
  assert.equal(partial.constellation, 'estimated');
  assert.equal(partial.noaa21, 0, 'completion must not fabricate a measured lane count');
  assert.equal(A.sensorCount(partial, 'noaa21'), '—');
  const quiet = recordAt(records, D3);
  assertLive(quiet, { ...ALL, noaa21: false });
  assert.equal(quiet.modis, 11);
  assert.equal(quiet.raw, 0);
  assert.equal(quiet.harmonized, 0, 'a zero covered VIIRS subtotal must not fall back to MODIS');
  assert.equal(quiet.constellation, 'estimated');
  const cal = A.calibrationFor(region, live);
  assert.ok(cal);
  assert.deepEqual(cal.viirsShares, { snpp: 0.5, noaa20: 0.3, noaa21: 0.2 });
  close(cal.levelPerDay, 52.5, '(100 + 100 + 10 + 0) / 4');
});

test('TEST ONLY no fully joint dates means a two-lane subtotal, not inferred full coverage', () => {
  const region = syntheticRegion('unsupported-two-lane');
  const live = bundle([...points(D0, [40, 50, 30, 0]), ...points(D1, [7, 5, 3, 0])], {
    end: D1, sensors: ['MODIS', 'VIIRS-SNPP', 'NOAA-20'],
  });
  const row = recordAt(A.regionRecord(region, live), D1);
  assertLive(row, { ...ALL, noaa21: false });
  assert.equal(row.raw, 8);
  assert.equal(row.harmonized, 8);
  assert.equal(row.constellation, 'partial');
  assert.equal(A.sensorCount(row, 'noaa21'), '—');
});

test('TEST ONLY MODIS bridges only after all VIIRS lanes become unavailable', () => {
  const region = syntheticRegion('modis-bridge');
  const live = bundle([...points(D0, [40, 50, 30, 20]), ...points(D1, [8, 0, 0, 0])], {
    end: D1, envelopes: viirsEnds(D0),
  });
  const row = recordAt(A.regionRecord(region, live), D1);
  assertLive(row, { ...NONE, modis: true });
  assert.deepEqual(KEYS.map((key) => A.sensorCount(row, key)), ['8', '—', '—', '—']);
  assert.equal(row.raw, 8);
  assert.equal(row.harmonized, 20); // Bridge from the shared day only: 100 / 40 = 2.5.
  assert.notEqual(row.constellation, 'complete');
  const cal = A.calibrationFor(region, live);
  assert.ok(cal);
  close(cal.k, 2.5, 'MODIS-only days must not contaminate the shared bridge denominator');
  close(cal.levelPerDay, 60, '(100 + 8 * 2.5) / 2');
});

const unavailableBundles = [
  ['absent-meta', (live) => { delete live.meta; }],
  ['null-meta', (live) => { live.meta = null; }],
  ['empty-sensors', (live) => { live.meta.sensors = []; }],
  ['absent-sensor-metadata', (live) => { delete live.meta.sensorMeta; }],
  ['empty-sensor-metadata', (live) => { live.meta.sensorMeta = {}; }],
];
for (const [name, removeCoverage] of unavailableBundles) {
  test(`TEST ONLY ${name} never labels even stored positive tuples as LIVE`, () => {
    const region = syntheticRegion(name);
    const live = bundle(points(D0, [40, 50, 30, 20]));
    removeCoverage(live);
    const row = recordAt(A.regionRecord(region, live), D0);
    assert.equal(row.source, 'model');
    assert.equal(row.live, false);
    assert.equal(row.modelled, undefined, 'no live overlay should have run');
  });

  test(`TEST ONLY ${name} retains an existing archive day instead of overwriting it`, () => {
    const region = syntheticRegion(`archive-retained-${name}`);
    attachSyntheticArchive(region);
    const live = bundle(points(D0, [40, 50, 30, 20]));
    removeCoverage(live);
    const row = recordAt(A.regionRecord(region, live), D0);
    assert.equal(row.source, 'archive');
    assert.equal(row.live, false);
    assert.equal(row.provisional, false);
    assert.deepEqual(row.observed, ALL);
    assert.deepEqual(KEYS.map((key) => row[key]), [7, 5, 3, 2]);
    assert.equal(row.raw, 10);
    assert.equal(row.harmonized, 10);
    assert.equal(row.frp, 170);
    assert.equal(row.constellation, 'complete');
  });
}

test('TEST ONLY equal-length bundles on identical dates refresh observations and cached calibration', () => {
  const region = syntheticRegion('same-length-bundles');
  const first = bundle([...points(D0, [40, 50, 30, 20]), ...points(D1, [8, 0, 0, 0])], {
    end: D1, envelopes: viirsEnds(D0),
  });
  const second = bundle([...points(D0, [70, 35, 21, 14]), ...points(D1, [8, 0, 0, 0])], {
    end: D1, envelopes: viirsEnds(D0),
  });
  assert.equal(first.fires.length, 148);
  assert.equal(second.fires.length, 148);
  assert.equal(first.meta.generatedAt, second.meta.generatedAt);
  for (const [live, expectedK, expectedLevel, expectedFirst, expectedLast] of [
    [first, 2.5, 60, 100, 20], [second, 1, 39, 70, 8], [first, 2.5, 60, 100, 20],
  ]) {
    close(A.bridgeFor(region, live).k, expectedK, 'cached bridge follows bundle contents');
    const records = A.regionRecord(region, live);
    assert.equal(recordAt(records, D0).harmonized, expectedFirst);
    assert.equal(recordAt(records, D1).harmonized, expectedLast);
    const cal = A.calibrationFor(region, live);
    assert.ok(cal);
    close(cal.k, expectedK, 'uncached calibration follows observed contents');
    close(cal.levelPerDay, expectedLevel, 'calibration level follows observed contents');
  }
});

test('TEST ONLY equal-length bundles refresh the pooled bridge used by a thin AOI', () => {
  const region = syntheticRegion('same-length-pool');
  const outsideAOI = [-29.2, -68.0]; // Still inside Chilecito, outside the synthetic AOI.
  const first = bundle([...points(D0, [40, 50, 30, 20], outsideAOI), ...points(D1, [8, 0, 0, 0])], {
    end: D1, envelopes: viirsEnds(D0),
  });
  const second = bundle([...points(D0, [70, 35, 21, 14], outsideAOI), ...points(D1, [8, 0, 0, 0])], {
    end: D1, envelopes: viirsEnds(D0),
  });
  assert.equal(first.fires.length, second.fires.length);
  for (const [live, expectedK, expectedH] of [[first, 2.5, 20], [second, 1, 8]]) {
    const bridge = A.bridgeFor(region, live);
    assert.equal(bridge.source, 'pilot-regions');
    close(bridge.k, expectedK, 'pooled cache follows the changed bundle');
    assert.equal(recordAt(A.regionRecord(region, live), D1).harmonized, expectedH);
  }
});

test('TEST ONLY metadata-only coverage changes invalidate calibration and record availability', () => {
  const region = syntheticRegion('metadata-cache');
  const covered = bundle([...points(D0, [40, 50, 30, 20]), ...points(D1, [8, 0, 0, 0])], { end: D1 });
  const unavailable = structuredClone(covered);
  for (const name of NAMES.slice(1)) unavailable.meta.sensorMeta[name].last = D0;
  const first = recordAt(A.regionRecord(region, covered), D1);
  assertLive(first, ALL);
  assert.equal(first.raw, 0);
  assert.equal(first.harmonized, 0);
  const second = recordAt(A.regionRecord(region, unavailable), D1);
  assertLive(second, { ...NONE, modis: true });
  assert.equal(second.raw, 8);
  assert.equal(second.harmonized, 20);
  close(A.bridgeFor(region, covered).k, 25 / 12, 'both published days contribute 48 MODIS detections');
  close(A.bridgeFor(region, unavailable).k, 2.5, 'only the shared day contributes 40 MODIS detections');
});

test('TEST ONLY custom AOIs with the same id and center but different bbox/area recalibrate', () => {
  const small = syntheticRegion('geometry-cache');
  const large = structuredClone(small);
  large.bbox = [-68.1, -29.6, -66.9, -28.8];
  large.areaKm2 = 8000;
  const outer = [-29.2, -68.0];
  const live = bundle([
    ...points(D0, [40, 50, 30, 20]), ...points(D0, [40, 20, 12, 8], outer),
    ...points(D1, [8, 0, 0, 0]), ...points(D1, [8, 0, 0, 0], outer),
  ], { end: D1, envelopes: viirsEnds(D0) });
  for (const [region, expectedK, expectedRaw, expectedH, expectedLevel] of [
    [small, 2.5, 8, 20, 60], [large, 1.75, 16, 28, 84], [small, 2.5, 8, 20, 60],
  ]) {
    close(A.bridgeFor(region, live).k, expectedK, 'geometry must be part of the calibration key');
    const row = recordAt(A.regionRecord(region, live), D1);
    assert.equal(row.raw, expectedRaw);
    assert.equal(row.harmonized, expectedH);
    close(A.calibrationFor(region, live).levelPerDay, expectedLevel, 'AOI-specific level');
  }
});

test('TEST ONLY a center inside a pilot does not make a partly outside bbox a complete live pull', () => {
  const region = syntheticRegion('bbox-crosses-pilot');
  region.bbox = [-68.6, -29.4, -67.3, -29.0]; // Chilecito's western limit is -68.45.
  const live = bundle(points(D0, [40, 50, 30, 20]));
  for (const date of [D0, D1, D2]) {
    const row = recordAt(A.regionRecord(region, live), date);
    assert.equal(row.source, 'model');
    assert.equal(row.live, false);
  }
  assert.equal(A.calibrationFor(region, live).levelSource, 'pilot-density');
});

test('TEST ONLY a country reads exact sensor-day intersections and exact daily FRP, not allocation', () => {
  const region = outsideRegion('exact-intersections', true);
  installCountry(region, countryWindow());
  const live = bundle();
  const records = A.regionRecord(region, live);
  for (const [date, expectedLanes, expectedHeadline, expectedFrp] of [
    [D0, [40, 0, 0, 0], 0, 400],
    [D1, [0, 50, 30, 20], 100, 250],
    [D2, [10, 5, 3, 2], 10, 123],
  ]) {
    const row = recordAt(records, date);
    assertLive(row, ALL);
    assert.deepEqual(KEYS.map((key) => row[key]), expectedLanes);
    assert.equal(row.raw, expectedHeadline);
    assert.equal(row.harmonized, expectedHeadline);
    assert.equal(row.frp, expectedFrp);
    assert.equal(row.constellation, 'complete');
  }
  const cal = A.calibrationFor(region, live);
  assert.ok(cal);
  assert.equal(cal.levelSource, 'country-window');
  close(cal.levelPerDay, 110 / 3, 'published-zero VIIRS on D0 contributes zero to the country level');
});

test('TEST ONLY country calibration intersects MODIS/VIIRS availability rather than window marginals', () => {
  const region = outsideRegion('country-overlap', true);
  const stats = countryWindow();
  stats.total = 1440;
  stats.sensors = { MODIS: 440, 'VIIRS-SNPP': 500, 'NOAA-20': 300, 'NOAA-21': 200 };
  stats.perDay = { [D0]: 900, [D1]: 140, [D2]: 400 };
  stats.perDaySensors = {
    [D0]: { MODIS: 0, 'VIIRS-SNPP': 450, 'NOAA-20': 270, 'NOAA-21': 180 },
    [D1]: { MODIS: 40, 'VIIRS-SNPP': 50, 'NOAA-20': 30, 'NOAA-21': 20 },
    [D2]: { MODIS: 400, 'VIIRS-SNPP': 0, 'NOAA-20': 0, 'NOAA-21': 0 },
  };
  stats.perDayFrp = { [D0]: 101, [D1]: 202, [D2]: 303 };
  stats.frpMean = 606 / 1440;
  installCountry(region, stats);
  const live = bundle([], { envelopes: { MODIS: { first: D1 }, ...viirsEnds(D1) } });
  const cal = A.calibrationFor(region, live);
  assert.ok(cal);
  assert.equal(cal.kSource, 'country-window');
  close(cal.k, 2.5, 'only D1 has shared coverage: 100 / 40, not 1000 / 440');
  close(cal.levelPerDay, 2000 / 3, '(900 + 100 + 400 * 2.5) / 3');
  const records = A.regionRecord(region, live);
  const last = recordAt(records, D2);
  assertLive(last, { ...NONE, modis: true });
  assert.equal(last.raw, 400);
  assert.equal(last.harmonized, 1000);
  assert.equal(last.frp, 303);
});

test('TEST ONLY mismatched country windowStart is rejected even when windowEnd matches', () => {
  const region = outsideRegion('mismatched-window', true);
  installCountry(region, countryWindow());
  const live = bundle([], { start: D1, end: D2 });
  assert.equal(A.calibrationFor(region, live), null, 'a stale country window cannot supply calibration');
  const records = A.regionRecord(region, live);
  for (const date of [D1, D2]) {
    const row = recordAt(records, date);
    assert.equal(row.source, 'model');
    assert.equal(row.live, false);
  }
});

test('TEST ONLY an outside custom countryId AOI may use a country prior but never its whole-border LIVE counts', () => {
  const region = outsideRegion('country-prior');
  installCountry(region, countryWindow());
  const live = bundle();
  const cal = A.calibrationFor(region, live);
  assert.ok(cal);
  assert.equal(cal.levelSource, 'country-window');
  close(cal.levelPerDay, 11 / 3, '110 / 3 detections per day scaled from 10000 to 1000 km2');
  const records = A.regionRecord(region, live);
  for (const date of [D0, D1, D2]) {
    const row = recordAt(records, date);
    assert.equal(row.source, 'model');
    assert.equal(row.live, false);
    assert.equal(row.observed, undefined, 'a country prior is not an AOI observation');
  }
});

test('TEST ONLY area-only changes at the same custom center/bbox invalidate reconstruction calibration', () => {
  const small = outsideRegion('area-only-cache');
  const large = structuredClone(small);
  large.areaKm2 = 2000;
  installCountry(small, countryWindow());
  const live = bundle();
  close(A.calibrationFor(small, live).levelPerDay, 11 / 3, '1000 km2 country prior');
  const first = A.regionRecord(small, live);
  close(A.calibrationFor(large, live).levelPerDay, 22 / 3, '2000 km2 country prior');
  const second = A.regionRecord(large, live);
  // Same deterministic region seed and geometry; changing only area must change
  // the reconstructed level. No model-generated number is used as an oracle.
  assert.notDeepEqual(first.map((r) => r.harmonized), second.map((r) => r.harmonized),
    'the second reconstruction must not reuse the smaller area calibration');
  assert.ok(second.every((r) => r.source === 'model' && !r.live));
});
