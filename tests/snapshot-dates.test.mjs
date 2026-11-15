import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignLiveToRealtime, alignCountryFiresToRealtime } from '../dist-server/analytics.mjs';

test('a stale snapshot retains acquisition dates, aggregates and provenance', () => {
  // Synthetic fixture. A future clock must never turn old observations into LIVE today.
  const timestamp = Date.parse('2024-01-02T12:00:00Z') / 1000;
  const bundle = {
    meta: {
      generatedAt: '2024-01-03T00:00:00Z', windowStart: '2024-01-01', windowEnd: '2024-01-03',
      sensorMeta: { MODIS: { first: '2024-01-02', last: '2024-01-02', count: 1 } },
      regionDays: { test: { '2024-01-02': { m: 1, firstT: timestamp, lastT: timestamp } } },
    },
    fires: [[1, 2, 3, 0, 2, timestamp]],
  };
  const before = structuredClone(bundle);
  assert.deepEqual(alignLiveToRealtime(bundle, '2030-02-01'), before);
  assert.deepEqual(bundle, before);
});

test('unavailable sensor dates cannot discard otherwise valid fire observations', () => {
  const bundle = {
    meta: { windowEnd: '2024-01-03', sensorMeta: { 'VIIRS-SNPP': { first: '9999-99-99', last: '0000-00-00', count: 0 } } },
    fires: [[1, 2, 3, 0, 2, 1704196800]],
  };
  assert.equal(alignLiveToRealtime(bundle, '2030-02-01'), bundle);
});

test('country totals and pilot detections keep the same observed window', () => {
  const file = {
    meta: { window: { start: '2024-01-01', end: '2024-01-03' } }, days: ['2024-01-02'],
    countries: [{ windowStart: '2024-01-01', windowEnd: '2024-01-03',
      perDay: { '2024-01-02': 3 }, perDaySensors: { '2024-01-02': { modis: 3 } }, perDayFrp: { '2024-01-02': 12 } }],
  };
  assert.deepEqual(alignCountryFiresToRealtime(file, '2030-02-01'), file);
});
