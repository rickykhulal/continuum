// Geometry and area-validation tests (deployment PRD §7.5, §8.2 vertex and area caps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const A = await import(pathToFileURL(path.join(ROOT, 'dist-server', 'analytics.mjs')).href);

const ring = (w, s, e, n) => [
  [w, s], [e, s], [e, n], [w, n], [w, s],
];

test('circle ring closes and its area matches the radius', () => {
  const r = A.circleRing(-29.85, -64.75, 120);
  assert.equal(r[0][0], r[r.length - 1][0], 'ring must close');
  const area = A.polygonAreaKm2([r]);
  assert.ok(Math.abs(area - Math.PI * 120 * 120) / area < 0.05, `sphere area ${area} should be near ${Math.PI * 14400}`);
});

test('inspectGeometry rejects an open ring', () => {
  const rep = A.inspectGeometry({ type: 'Polygon', coordinates: [[[-65, -30], [-64, -30], [-64, -29]]] });
  assert.equal(rep.valid, false);
  assert.ok(rep.reason);
});

test('inspectGeometry enforces the 5000-vertex cap', () => {
  const big = [];
  for (let i = 0; i < 6000; i++) big.push([-65 + i * 0.0001, -30 + (i % 5) * 0.0001]);
  big.push(big[0]);
  const rep = A.inspectGeometry({ type: 'Polygon', coordinates: [big] }, 1e9);
  assert.equal(rep.valid, false);
  assert.equal(rep.reason, 'TOO_MANY_VERTICES');
});

test('inspectGeometry enforces the area cap', () => {
  const rep = A.inspectGeometry({ type: 'Polygon', coordinates: [ring(-70, -35, -60, -25)] }, 50000);
  assert.equal(rep.valid, false);
  assert.equal(rep.reason, 'AREA_TOO_LARGE');
});

test('a valid polygon reports area, centroid and bbox', () => {
  const rep = A.inspectGeometry({ type: 'Polygon', coordinates: [ring(-65.5, -30.5, -64.5, -29.5)] }, 250000);
  assert.equal(rep.valid, true, JSON.stringify(rep));
  assert.ok(rep.areaKm2 > 8000 && rep.areaKm2 < 14000, `area ${rep.areaKm2}`);
  const [lon, lat] = A.ringCentroid([ring(-65.5, -30.5, -64.5, -29.5)]);
  assert.ok(lat > -30.6 && lat < -29.4 && lon < -64.4 && lon > -65.6, `centroid ${lat},${lon}`);
  const bb = A.ringBBox([ring(-65.5, -30.5, -64.5, -29.5)]);
  assert.deepEqual(bb, [-65.5, -30.5, -64.5, -29.5]);
});

test('geometryToCircle stays inside the app radius range', () => {
  const c = A.geometryToCircle([ring(-66, -31, -63, -28)]);
  assert.ok(c.radiusKm >= 20 && c.radiusKm <= 800, `radius ${c.radiusKm}`);
  assert.ok(Math.abs(c.lat + 29.5) < 0.2 && Math.abs(c.lon + 64.5) < 0.2, `center ${c.lat},${c.lon}`);
});

test('pointInRing is inclusive on edges and exclusive outside', () => {
  const r = ring(-65, -30, -64, -29);
  assert.equal(A.pointInRing(-64.5, -29.5, r), true);
  assert.equal(A.pointInRing(-66, -29.5, r), false);
});

test('simplifyRing reduces vertices without changing the shape much', () => {
  const dense = A.circleRing(-20, -50, 200, 512);
  const few = A.simplifyRing(dense, 0.02);
  assert.ok(few.length < dense.length, 'simplified should be shorter');
  assert.ok(few.length >= 4, `simplified keeps a ring (${few.length})`);
  const before = A.polygonAreaKm2([dense]);
  const after = A.polygonAreaKm2([few]);
  assert.ok(Math.abs(before - after) / before < 0.02, `area drift ${before} → ${after}`);
  assert.equal(few[0][0], few[few.length - 1][0], 'simplification keeps the ring closed');
});

test('data-volume estimate scales with area and days', () => {
  const region = A.getRegion('chilecito');
  const small = A.estimateDataVolume(region, 7, 0.02);
  const large = A.estimateDataVolume(region, 35, 0.02);
  assert.ok(large > small && large / small > 4, `${small} vs ${large}`);
  assert.ok(Number.isFinite(small) && small > 0, 'estimate is a positive count');
});

test('a custom region resolves through the same code the UI uses', () => {
  const region = A.customRegion(-29.85, -64.75, 140, 'Test point');
  assert.ok(region.areaKm2 > 60000 && region.areaKm2 < 63000, `area ${region.areaKm2}`);
  assert.equal(region.bbox.length, 4);
  assert.ok(region.id.length > 0);
});

test('every pilot region has a record with unique ordered dates', () => {
  const live = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'live_fires.json'), 'utf8'));
  for (const region of A.REGIONS) {
    const records = A.regionRecord(region, live);
    assert.ok(records.length > 9000, `${region.id} has ${records.length} rows`);
    const dates = records.map((r) => r.date);
    assert.equal(new Set(dates).size, dates.length, `${region.id} has duplicate dates`);
    assert.deepEqual([dates[0] < dates[dates.length - 1]], [true], `${region.id} dates must ascend`);
  }
});
