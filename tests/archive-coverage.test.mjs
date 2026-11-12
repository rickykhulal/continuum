import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const A = await import(pathToFileURL(path.join(ROOT, 'dist-server', 'analytics.mjs')).href);
const realLive = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'live_fires.json'), 'utf8'));
const DAY_MS = 86400000;
const BASE = Date.parse('2024-01-01T00:00:00Z');
const BASE_INDEX = (BASE - Date.parse('2000-11-01T00:00:00Z')) / DAY_MS;
const MEASURED_FALLBACK = { snpp: 0.5, noaa20: 0.3, noaa21: 0.2 };
const SENSOR_KEYS = ['modis', 'viirs', 'noaa20', 'noaa21'];
let fixtureNumber = 0;

beforeEach(() => A.attachArchive(null));
afterEach(() => A.attachArchive(null));

function syntheticRegion(name, outsidePilots = false) {
  const region = structuredClone(A.getRegion('chilecito'));
  region.id = `test-only-synthetic-archive-${name}`;
  region.name = `TEST ONLY synthetic archive: ${name}`;
  region.shortName = 'Synthetic test area';
  region.description = 'Synthetic archive fixture; not a NASA observation.';
  region.aliases = [];
  delete region.countryId;
  if (outsidePilots) {
    region.center = [-24.5, -178.2];
    region.bbox = [-179, -25, -177, -24];
  }
  return region;
}

function dateAt(offset) {
  return new Date(BASE + offset * DAY_MS).toISOString().slice(0, 10);
}

function range(from, through = from, kind = 0) {
  return [BASE_INDEX + from, BASE_INDEX + through, kind];
}

function row(offset, count, frp = 0) {
  return [BASE_INDEX + offset, count, frp];
}

function rows(from, through, count, frp = 0) {
  return Array.from({ length: through - from + 1 }, (_, i) => row(from + i, count, frp));
}

function attachSynthetic(region, block) {
  const bundle = {
    schema: 'test-only-synthetic-archive-v1',
    generated_at: new Date(Date.UTC(2024, 0, 1, 0, 0, fixtureNumber++)).toISOString(),
    start: '2000-11-01',
    method: 'TEST ONLY synthetic coverage and counts; not downloaded observations',
    requests: 0,
    rows: Object.values(block.days ?? {}).flat().reduce((sum, [, count]) => sum + count, 0),
    regions: { [region.id]: block },
  };
  assert.equal(A.attachArchive(bundle), true);
}

function trainingBlock() {
  // Sparse storage omits the other 29 covered zero days.
  return {
    covered: { v: [range(40, 69)], n: [range(40, 69)], n21: [range(40, 69)] },
    days: { v: [row(40, 50, 500)], n: [row(40, 30, 300)], n21: [row(40, 20, 200)] },
  };
}

function recordAt(records, offset, live = null) {
  const date = dateAt(offset);
  if (live) assert.ok(date < live.meta.windowStart, 'fixture must precede the rolling overlay');
  const record = records.find((r) => r.date === date);
  assert.ok(record, `missing synthetic record ${date}`);
  return record;
}

function assertArchiveRecord(record) {
  assert.equal(record.source, 'archive');
  assert.equal(record.live, false, 'a synthetic archive fixture must not acquire the LIVE flag');
}

test('synthetic archive: no covered lanes means no archive day, even with orphan counts', () => {
  const region = syntheticRegion('uncovered');
  attachSynthetic(region, {
    covered: {},
    days: { m: [row(0, 7)], v: [row(0, 5)], n: [row(0, 3)], n21: [row(0, 2)] },
  });
  assert.equal(A.archiveDay(region.id, dateAt(0)), null);
  assert.equal(A.archiveSupplementary(region.id, dateAt(0)), null);
  assert.equal(A.archiveDay('test-only-synthetic-archive-absent', dateAt(0)), null);
  assert.deepEqual(A.archiveCoverage(region.id), { days: 0, first: '', last: '', sensors: {} });
  const live = structuredClone(realLive);
  const record = recordAt(A.regionRecord(region, live), 0, live);
  assert.equal(record.source, 'model');
  assert.equal(record.live, false);
  assert.equal(record.observed, undefined);
});

const singleLanes = [
  {
    lane: 'm', count: 7, frp: 70,
    cell: { m: 7, v: 0, n: 0, n21: 0, frpM: 70, frpV: 0 },
    kinds: [0, -1, -1, -1],
    observed: { modis: true, viirs: false, noaa20: false, noaa21: false },
    counts: [7, 0, 0, 0], display: ['7', '—', '—', '—'],
  },
  {
    lane: 'v', count: 5, frp: 25,
    cell: { m: 0, v: 5, n: 0, n21: 0, frpM: 0, frpV: 25 },
    kinds: [-1, 0, -1, -1],
    observed: { modis: false, viirs: true, noaa20: false, noaa21: false },
    counts: [0, 5, 0, 0], display: ['—', '5', '—', '—'],
  },
  {
    lane: 'n', count: 3, frp: 12,
    cell: { m: 0, v: 0, n: 3, n21: 0, frpM: 0, frpV: 12 },
    kinds: [-1, -1, 0, -1],
    observed: { modis: false, viirs: false, noaa20: true, noaa21: false },
    counts: [0, 0, 3, 0], display: ['—', '—', '3', '—'],
  },
  {
    lane: 'n21', count: 2, frp: 6,
    cell: { m: 0, v: 0, n: 0, n21: 2, frpM: 0, frpV: 6 },
    kinds: [-1, -1, -1, 0],
    observed: { modis: false, viirs: false, noaa20: false, noaa21: true },
    counts: [0, 0, 0, 2], display: ['—', '—', '—', '2'],
  },
];

for (const fixture of singleLanes) {
  test(`synthetic archive: ${fixture.lane}-only positive and covered zero retain coverage downstream`, () => {
    const region = syntheticRegion(`single-${fixture.lane}`);
    const block = trainingBlock();
    block.covered[fixture.lane] = [range(0), range(1, 1, 1), ...(block.covered[fixture.lane] ?? [])];
    block.days[fixture.lane] = [row(0, fixture.count, fixture.frp), ...(block.days[fixture.lane] ?? [])];
    attachSynthetic(region, block);

    const hit = A.archiveDay(region.id, dateAt(0));
    assert.ok(hit);
    assert.deepEqual(hit.cell, fixture.cell);
    assert.deepEqual([hit.kindM, hit.kindV, hit.kindN, hit.kindN21], fixture.kinds);
    const zeroHit = A.archiveDay(region.id, dateAt(1));
    assert.ok(zeroHit);
    assert.deepEqual(zeroHit.cell, { m: 0, v: 0, n: 0, n21: 0, frpM: 0, frpV: 0 });
    assert.deepEqual(
      [zeroHit.kindM, zeroHit.kindV, zeroHit.kindN, zeroHit.kindN21],
      fixture.kinds.map((kind) => kind === 0 ? 1 : -1),
    );
    assert.equal(A.archiveDay(region.id, dateAt(2)), null);
    assert.deepEqual(A.constellationWeights(region.id), { snpp: 0.5, noaa20: 0.3, noaa21: 0.2, days: 30 });

    const live = structuredClone(realLive);
    assert.ok(A.calibrationFor(region, live), 'the real live bundle must provide calibration');
    const records = A.regionRecord(region, live);
    const positive = recordAt(records, 0, live);
    const zero = recordAt(records, 1, live);
    for (const record of [positive, zero]) {
      assertArchiveRecord(record);
      assert.deepEqual(record.observed, fixture.observed);
      assert.equal(record.constellation, fixture.lane === 'm' ? undefined : 'estimated');
    }
    assert.deepEqual(SENSOR_KEYS.map((key) => positive[key]), fixture.counts);
    assert.deepEqual(SENSOR_KEYS.map((key) => A.sensorCount(positive, key)), fixture.display);
    assert.deepEqual(SENSOR_KEYS.map((key) => zero[key]), [0, 0, 0, 0]);
    assert.deepEqual(SENSOR_KEYS.map((key) => A.sensorCount(zero, key)),
      SENSOR_KEYS.map((key) => fixture.observed[key] ? '0' : '—'));
    assert.equal(positive.raw, fixture.count);
    assert.equal(positive.frp, fixture.frp);
    assert.equal(positive.provisional, false);
    assert.equal(zero.provisional, true);
    assert.equal(zero.raw, 0);
    assert.equal(zero.harmonized, 0);
    assert.equal(zero.frp, 0);
    if (fixture.lane === 'm') {
      const bridge = A.bridgeFor(region, live);
      assert.ok(bridge.k > 0);
      assert.equal(positive.harmonized, 7 * bridge.k);
    } else {
      assert.equal(positive.harmonized, 10);
    }
    if (fixture.lane === 'n') {
      assert.equal(A.archiveSupplementary(region.id, dateAt(0)).noaa20, 3);
      assert.equal(A.archiveSupplementary(region.id, dateAt(1)).noaa20, 0);
    }
    if (fixture.lane === 'n21') {
      assert.equal(A.archiveSupplementary(region.id, dateAt(0)).noaa21, 2);
      assert.equal(A.archiveSupplementary(region.id, dateAt(1)).noaa21, 0);
    }
  });
}

test('synthetic archive: complete VIIRS excludes MODIS from counts and FRP survives n,n21,v order', () => {
  const region = syntheticRegion('complete-reordered');
  attachSynthetic(region, {
    covered: { m: [range(0, 1)], v: [range(0, 1)], n: [range(0, 1)], n21: [range(0, 1)] },
    days: {
      n: [row(0, 3, 30)],
      n21: [row(0, 2, 20)],
      v: [row(0, 5, 50)],
      m: [row(0, 7, 700), row(1, 11, 1100)],
    },
  });
  assert.deepEqual(A.archiveDay(region.id, dateAt(0)).cell,
    { m: 7, v: 5, n: 3, n21: 2, frpM: 700, frpV: 100 });
  assert.deepEqual(A.archiveSupplementary(region.id, dateAt(0)), { noaa20: 3, noaa21: 2 });
  assert.equal(A.constellationWeights(region.id), null);
  const live = structuredClone(realLive);
  const records = A.regionRecord(region, live);
  const positive = recordAt(records, 0, live);
  const quietViirs = recordAt(records, 1, live);
  for (const record of [positive, quietViirs]) {
    assertArchiveRecord(record);
    assert.deepEqual(record.observed, { modis: true, viirs: true, noaa20: true, noaa21: true });
    assert.equal(record.constellation, 'complete');
  }
  assert.deepEqual(SENSOR_KEYS.map((key) => positive[key]), [7, 5, 3, 2]);
  assert.equal(positive.raw, 10);
  assert.equal(positive.harmonized, 10);
  assert.equal(positive.frp, 800);
  assert.equal(quietViirs.modis, 11);
  assert.equal(quietViirs.raw, 0);
  assert.equal(quietViirs.harmonized, 0);
  assert.equal(quietViirs.frp, 1100);
});

test('synthetic platform equivalent: measured fallback scales any covered subset and retains zeros', () => {
  const region = syntheticRegion('fallback');
  const cell = { m: 999, v: 5, n: 6, n21: 8, frpM: 0, frpV: 0 };
  const zero = { ...cell, v: 0, n: 0, n21: 0 };
  const cases = [
    { kinds: [-1, -1, -1], equivalent: null, subset: null },
    { kinds: [0, -1, -1], equivalent: 10, subset: 5 },
    { kinds: [-1, 0, -1], equivalent: 20, subset: 6 },
    { kinds: [-1, -1, 1], equivalent: 40, subset: 8 },
    { kinds: [-1, 0, 1], equivalent: 28, subset: 14 },
    { kinds: [0, 0, 0], equivalent: 19, subset: 19 },
  ];
  for (const { kinds, equivalent, subset } of cases) {
    assert.equal(A.platformEquivalent(region.id, cell, ...kinds, MEASURED_FALLBACK), equivalent, String(kinds));
    assert.equal(A.platformEquivalent(region.id, cell, ...kinds), subset, `unweighted ${kinds}`);
    assert.equal(A.platformEquivalent(region.id, zero, ...kinds, MEASURED_FALLBACK),
      equivalent === null ? null : 0, `covered zero ${kinds}`);
  }
});

test('synthetic archive: without weights or live calibration a VIIRS subset stays explicitly partial', () => {
  const region = syntheticRegion('unweighted-outside-pilots', true);
  assert.equal(A.REGIONS.some((pilot) => region.center[1] >= pilot.bbox[0]
    && region.center[1] <= pilot.bbox[2] && region.center[0] >= pilot.bbox[1]
    && region.center[0] <= pilot.bbox[3]), false);
  attachSynthetic(region, {
    covered: { v: [range(0)], n: [range(1), range(3, 4)], n21: [range(2, 3)] },
    days: { v: [row(0, 5, 50)], n: [row(1, 6, 60), row(3, 6, 60)], n21: [row(2, 8, 80), row(3, 8, 80)] },
  });
  assert.equal(A.constellationWeights(region.id), null);
  assert.equal(A.calibrationFor(region, null), null);
  const records = A.regionRecord(region, null);
  for (const [offset, count, frp] of [[0, 5, 50], [1, 6, 60], [2, 8, 80], [3, 14, 140], [4, 0, 0]]) {
    const record = recordAt(records, offset);
    assertArchiveRecord(record);
    assert.equal(record.raw, count);
    assert.equal(record.harmonized, count);
    assert.equal(record.frp, frp);
    assert.equal(record.constellation, 'partial');
    assert.equal(record.provisional, false);
    assert.equal(A.sensorCount(record, 'modis'), '—');
  }
  const quietNoaa = recordAt(records, 4);
  assert.deepEqual(quietNoaa.observed, { modis: false, viirs: false, noaa20: true, noaa21: false });
  assert.deepEqual(SENSOR_KEYS.map((key) => A.sensorCount(quietNoaa, key)), ['—', '—', '0', '—']);
});

test('synthetic archive coverage counts the union of observed dates, not its bounding span', () => {
  const region = syntheticRegion('coverage-union');
  attachSynthetic(region, {
    covered: {
      m: [range(0, 2), range(10, 11)],
      v: [range(2, 4)],
      n: [range(10), range(20)],
      n21: [range(20, 21)],
    },
    days: {},
  });
  assert.deepEqual(A.archiveCoverage(region.id), {
    days: 9, first: '2024-01-01', last: '2024-01-22', sensors: { m: 5, v: 3, n: 2, n21: 2 },
  });
  assert.equal(A.archiveDay(region.id, dateAt(5)), null);
  assert.deepEqual(A.archiveCoverage('test-only-synthetic-archive-absent'),
    { days: 0, first: '', last: '', sensors: {} });
});

test('synthetic constellation weights count sparse covered zeros toward the 30 shared days', () => {
  const region = syntheticRegion('weights-covered-zeros');
  attachSynthetic(region, trainingBlock());
  assert.deepEqual(A.constellationWeights(region.id), { snpp: 0.5, noaa20: 0.3, noaa21: 0.2, days: 30 });
});

test('synthetic constellation weights require 30 shared days, not 30 days in each lane', () => {
  const region = syntheticRegion('weights-intersection');
  const block = {
    covered: { v: [range(0, 29)], n: [range(1, 30)], n21: [range(0, 30)] },
    days: { v: [row(1, 50)], n: [row(1, 30)], n21: [row(1, 20)] },
  };
  attachSynthetic(region, block);
  assert.equal(A.constellationWeights(region.id), null);
  block.covered.v = [range(0, 30)];
  attachSynthetic(region, block);
  assert.deepEqual(A.constellationWeights(region.id), { snpp: 0.5, noaa20: 0.3, noaa21: 0.2, days: 30 });
});

test('synthetic constellation weights cannot infer shares from an entirely quiet shared month', () => {
  const region = syntheticRegion('weights-all-zero');
  attachSynthetic(region, {
    covered: { v: [range(0, 29)], n: [range(0, 29)], n21: [range(0, 29)] }, days: {},
  });
  assert.equal(A.constellationWeights(region.id), null);
});

for (const [lane, count] of [['n', 3], ['n21', 2]]) {
  test(`synthetic archive ratio: ${lane}-only overlap reaches the 365-day annual gate`, () => {
    const region = syntheticRegion(`ratio-${lane}`);
    attachSynthetic(region, {
      covered: { m: [range(0, 363)], [lane]: [range(0, 363)] },
      days: { m: rows(0, 363, 2), [lane]: rows(0, 363, count) },
    });
    assert.equal(A.archiveRatio(region, MEASURED_FALLBACK), null);
    attachSynthetic(region, {
      covered: { m: [range(0, 364)], [lane]: [range(0, 364)] },
      days: { m: rows(0, 364, 2), [lane]: rows(0, 364, count) },
    });
    assert.deepEqual(A.archiveRatio(region, MEASURED_FALLBACK), { k: 5, days: 365, sumV: 3650, sumM: 730 });
    assert.equal(A.archiveRatio(region), null, 'an unsupported subset cannot calibrate a full-constellation bridge');
  });
}

test('synthetic archive ratio unions NOAA coverage and counts shared NOAA dates only once', () => {
  const region = syntheticRegion('ratio-noaa-union');
  attachSynthetic(region, {
    covered: { m: [range(0, 399)], n: [range(0, 249)], n21: [range(150, 399)] },
    days: { m: rows(0, 399, 2), n: rows(0, 249, 3), n21: rows(150, 399, 2) },
  });
  assert.deepEqual(A.archiveRatio(region, MEASURED_FALLBACK), { k: 5, days: 400, sumV: 4000, sumM: 800 });
});

test('synthetic archive ratio excludes days missing either instrument despite stored counts', () => {
  const region = syntheticRegion('ratio-unavailable');
  attachSynthetic(region, {
    covered: { m: [range(0, 399)], n: [range(0, 364), range(450, 484)] },
    days: {
      m: [...rows(0, 364, 2), ...rows(365, 399, 500), ...rows(450, 484, 999)],
      n: [...rows(0, 364, 3), ...rows(365, 399, 900), ...rows(450, 484, 600)],
    },
  });
  assert.deepEqual(A.archiveRatio(region, MEASURED_FALLBACK), { k: 5, days: 365, sumV: 3650, sumM: 730 });
});

test('synthetic archive ratio does not use unsupported partial days to reach its annual gate', () => {
  const region = syntheticRegion('ratio-unsupported-partial');
  attachSynthetic(region, {
    covered: { m: [range(0, 399)], v: [range(0, 19)], n: [range(0, 399)], n21: [range(0, 19)] },
    days: { m: rows(0, 399, 2), v: rows(0, 19, 5), n: rows(0, 399, 3), n21: rows(0, 19, 2) },
  });
  assert.equal(A.constellationWeights(region.id), null);
  assert.equal(A.archiveRatio(region), null);
});

test('synthetic archive ratio excludes a partial lane with no measured completion share', () => {
  const region = syntheticRegion('ratio-zero-share');
  attachSynthetic(region, {
    covered: { m: [range(0, 399)], n21: [range(0, 364)], n: [range(365, 399)] },
    days: { m: rows(0, 399, 2), n21: rows(0, 364, 5), n: rows(365, 399, 3) },
  });
  assert.deepEqual(A.archiveRatio(region, { snpp: 0.5, noaa20: 0, noaa21: 0.5 }),
    { k: 5, days: 365, sumV: 3650, sumM: 730 });
});

test('synthetic archive ratio includes covered zero days only with supported constellation coverage', () => {
  const region = syntheticRegion('ratio-covered-zeros');
  const block = {
    covered: { m: [range(0, 364)], n: [range(0, 364)] },
    days: { m: [row(0, 2)], n: [row(0, 3)] },
  };
  attachSynthetic(region, block);
  assert.deepEqual(A.archiveRatio(region, MEASURED_FALLBACK), { k: 5, days: 365, sumV: 10, sumM: 2 });
  assert.equal(A.archiveRatio(region), null);

  attachSynthetic(region, {
    covered: { m: [range(0, 364)], v: [range(0, 364)], n: [range(0, 364)], n21: [range(0, 364)] },
    days: { m: [row(0, 2)] },
  });
  assert.equal(A.constellationWeights(region.id), null);
  assert.deepEqual(A.archiveRatio(region), { k: 0, days: 365, sumV: 0, sumM: 2 });
});
