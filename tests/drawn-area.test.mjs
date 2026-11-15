import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../dist-server/analytics.mjs';

test('globe rectangle retains its exact bounds and spherical area', () => {
  const bounds = A.boundsBetween([-30, -68], [-28, -66]);
  const region = A.customBounds(bounds);
  assert.deepEqual(region.bbox, [-68, -30, -66, -28]);
  assert.deepEqual(region.center, [-29, -67]);
  assert.equal(region.areaKm2, A.bboxAreaKm2(bounds));
  assert.notEqual(region.id, A.customBounds([-68, -30, -65, -28]).id);
  assert.throws(() => A.customBounds([0, 0, 0, 2]));
  assert.throws(() => A.customBounds([0, -91, 1, 2]));
});

test('date-line rectangle filters identical points for map and daily counts', () => {
  const region = A.customBounds(A.boundsBetween([10, 179], [12, -179]));
  assert.equal(region.bbox[2] - region.bbox[0], 2);
  const time = Date.parse('2026-11-14') / 1000;
  const fires = [179.5, -179.5, 0, 178].map(lon => [11, lon, 4, 1, 1, time]);
  fires.push([13, 179.5, 4, 1, 1, time]);
  assert.deepEqual(A.livePointsForRegion(region, fires), fires.slice(0, 2));
  assert.deepEqual(A.countLiveByDay(fires, region), { '2026-11-14': 2 });
  assert.equal(A.livePointsForRegion(region, fires, '2026-11-13').length, 0);
});

test('historical summary distinguishes observed zero, absent coverage and reconstruction', () => {
  const date = '2022-08-01';
  const record = { date, source: 'archive', observed: { modis: true, viirs: false, noaa20: false, noaa21: false }, modis: 0, viirs: 900, noaa20: 900, noaa21: 900, harmonized: 0, provisional: false };
  const summary = A.historicalMapSummary(record, date, 'all');
  assert.equal(summary.detections, 0);
  assert.equal(summary.partial, true);
  assert.equal(summary.label, 'ARCHIVE');
  assert.equal(A.historicalMapSummary(record, date, 1).detections, null);
  assert.equal(A.historicalMapSummary(record, '2022-08-02', 'all'), null);
  const model = A.historicalMapSummary({ ...record, source: 'model' }, date, 'all');
  assert.equal(model.label, 'RECONSTRUCTION');
  assert.equal(model.detections, 2700);
});
