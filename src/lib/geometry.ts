// Geometry shared by the UI (area drawing, FR-01/FR-05) and the read-only API (PRD §8.4).
// Everything is spherical-Earth aware and validates before it computes.

import type { Region } from './types';
import { DEG, R_EARTH_KM, bboxAreaKm2, normalizeLon } from './geo';

export const MAX_VERTICES = 5000;
export const MIN_RING_POINTS = 4;

export type LonLat = [number, number];
export type RingGeo = LonLat[];
export interface PolygonGeo {
  type: 'Polygon';
  coordinates: RingGeo[];
}

export interface GeometryReport {
  valid: boolean;
  reason?: string;
  areaKm2: number;
  centroid: LonLat;
  bbox: [number, number, number, number];
  vertices: number;
}

function closeRing(ring: RingGeo): RingGeo {
  if (ring.length < 2) return ring;
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a[0] === b[0] && a[1] === b[1]) return ring;
  return [...ring, [a[0], a[1]] as LonLat];
}

export function ringToPolygon(ring: RingGeo): PolygonGeo {
  return { type: 'Polygon', coordinates: [closeRing(ring)] };
}

export function rectRing(w: number, s: number, e: number, n: number): RingGeo {
  return [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [w, s],
  ];
}

/** Circle approximated by a closed ring of `segments` points on the great circle. */
export function circleRing(lat: number, lon: number, radiusKm: number, segments = 96): RingGeo {
  const angular = radiusKm / R_EARTH_KM;
  const lat1 = lat * DEG;
  const lon1 = lon * DEG;
  const out: RingGeo = [];
  for (let i = 0; i <= segments; i++) {
    const bearing = (i / segments) * 2 * Math.PI;
    const sinLat = Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing);
    const lat2 = Math.asin(sinLat);
    const y = Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1);
    const x = Math.cos(angular) - Math.sin(lat1) * sinLat;
    const lon2 = lon1 + Math.atan2(y, x);
    out.push([normalizeLon(lon2 / DEG), lat2 / DEG]);
  }
  return out;
}

/** Spherical excess polygon area (km²), positive regardless of winding order. */
export function polygonAreaKm2(rings: RingGeo[]): number {
  let total = 0;
  for (const raw of rings) {
    const ring = closeRing(raw);
    if (ring.length < MIN_RING_POINTS) continue;
    let sum = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [lon1, lat1] = ring[i];
      const [lon2, lat2] = ring[i + 1];
      sum += (lon2 * DEG - lon1 * DEG) * (2 + Math.sin(lat1 * DEG) + Math.sin(lat2 * DEG));
    }
    total += Math.abs((sum * R_EARTH_KM * R_EARTH_KM) / 2);
  }
  return total;
}

export function ringBBox(rings: RingGeo[]): [number, number, number, number] {
  let w = 180;
  let s = 90;
  let e = -180;
  let n = -90;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < w) w = lon;
      if (lon > e) e = lon;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    }
  }
  return [w, s, e, n];
}

export function ringCentroid(rings: RingGeo[]): LonLat {
  // The closing vertex repeats the first one; counting it twice would drag the centroid toward
  // that corner, so every ring is deduplicated before averaging unit vectors.
  const pts = rings.flatMap((ring) => (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring));
  let x = 0;
  let y = 0;
  let z = 0;
  for (const [lon, lat] of pts) {
    const phi = lat * DEG;
    const theta = lon * DEG;
    x += Math.cos(phi) * Math.cos(theta);
    y += Math.cos(phi) * Math.sin(theta);
    z += Math.sin(phi);
  }
  const n = Math.max(1, pts.length);
  const hyp = Math.hypot(x / n, y / n);
  return [normalizeLon(Math.atan2(y / n, x / n) / DEG), Math.atan2(z / n, hyp) / DEG];
}

export function pointInRing(lon: number, lat: number, ring: RingGeo): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Douglas–Peucker simplification, used when an area is over the vertex budget. */
export function simplifyRing(ring: RingGeo, toleranceDeg: number): RingGeo {
  if (ring.length < 5) return ring;
  const keep = new Array(ring.length).fill(false);
  keep[0] = true;
  keep[ring.length - 1] = true;
  const stack: [number, number][] = [[0, ring.length - 1]];
  const perpDistance = (p: LonLat, a: LonLat, b: LonLat) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
  };
  while (stack.length) {
    const [first, last] = stack.pop() as [number, number];
    let max = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpDistance(ring[i], ring[first], ring[last]);
      if (d > max) {
        max = d;
        index = i;
      }
    }
    if (max > toleranceDeg && index > 0) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }
  return ring.filter((_, i) => keep[i]);
}

/** PRD §8.4 validation: shape, vertex count, coordinate ranges, self-contact. */
export function inspectGeometry(input: PolygonGeo | RingGeo, maxAreaKm2 = Infinity): GeometryReport {
  const probe = input as RingGeo;
  const rings: RingGeo[] = Array.isArray(probe) && Array.isArray(probe[0]) && typeof probe[0][0] === 'number' ? [probe] : (input as PolygonGeo).coordinates;
  const base = {
    areaKm2: 0,
    centroid: [0, 0] as LonLat,
    bbox: [0, 0, 0, 0] as [number, number, number, number],
    vertices: 0,
  };
  if (!Array.isArray(rings) || rings.length === 0) return { ...base, valid: false, reason: 'INVALID_GEOMETRY' };
  let vertices = 0;
  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < MIN_RING_POINTS) return { ...base, valid: false, reason: 'INVALID_GEOMETRY' };
    vertices += ring.length;
    for (const pt of ring) {
      if (!Array.isArray(pt) || pt.length < 2) return { ...base, valid: false, reason: 'INVALID_GEOMETRY' };
      const [lon, lat] = pt;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return { ...base, valid: false, reason: 'INVALID_GEOMETRY' };
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return { ...base, valid: false, reason: 'INVALID_GEOMETRY' };
    }
    const [lat0, lon0] = [ring[0][1], ring[0][0]];
    const [lat1, lon1] = [ring[ring.length - 1][1], ring[ring.length - 1][0]];
    if (lat0 !== lat1 || lon0 !== lon1) return { ...base, valid: false, reason: 'RING_NOT_CLOSED' };
  }
  if (vertices > MAX_VERTICES) return { ...base, valid: false, reason: 'TOO_MANY_VERTICES' };
  const areaKm2 = polygonAreaKm2(rings);
  if (!Number.isFinite(areaKm2) || areaKm2 <= 0) return { ...base, valid: false, reason: 'DEGENERATE_GEOMETRY' };
  if (areaKm2 > maxAreaKm2) return { ...base, areaKm2, valid: false, reason: 'AREA_TOO_LARGE' };
  return { valid: true, areaKm2, centroid: ringCentroid(rings), bbox: ringBBox(rings), vertices };
}

/**
 * Resolve a validated geometry to an analysis area. The record builder is centre-driven, so a
 * polygon is reduced to its centroid plus the radius of the equal-area circle — the same
 * approximation the UI uses when a shape is drawn.
 */
export function geometryToCircle(rings: RingGeo[]): { lat: number; lon: number; radiusKm: number } {
  const [lon, lat] = ringCentroid(rings);
  const area = polygonAreaKm2(rings);
  return { lat, lon, radiusKm: Math.max(20, Math.min(800, Math.sqrt(area / Math.PI))) };
}

export function estimateDataVolume(region: Region, days: number, pointsPerKm2PerDay: number): number {
  return Math.round(bboxAreaKm2(region.bbox) * Math.max(0, days) * pointsPerKm2PerDay);
}
