import { twoline2satrec, propagate, gstime, eciToGeodetic, degreesLat, degreesLong, type SatRec } from 'satellite.js';
import { bearingDeg, haversineKm, normalizeLon, R_EARTH_KM } from './geo';
import type { OrbitSatellite, SatPosition } from './satellites';

const satrecs = new Map<string, SatRec>();

function recordFor(sat: OrbitSatellite): SatRec | null {
  const cached = satrecs.get(sat.id);
  if (cached) return cached;
  if (!sat.line1 || !sat.line2) return null;
  const rec = twoline2satrec(sat.line1, sat.line2);
  satrecs.set(sat.id, rec);
  return rec;
}

export function propagateAt(sat: OrbitSatellite, date: Date): SatPosition | null {
  const rec = recordFor(sat);
  if (!rec) return null;
  const pv = propagate(rec, date);
  if (!pv.position) return null;
  const gmst = gstime(date);
  const geo = eciToGeodetic(pv.position, gmst);
  return {
    lat: degreesLat(geo.latitude),
    lon: normalizeLon(degreesLong(geo.longitude)),
    altKm: geo.height,
    x: pv.position.x,
    y: pv.position.y,
    z: pv.position.z,
  };
}

/** Ground track sampled ahead and behind the current epoch. */
export function groundTrack(sat: OrbitSatellite, date: Date, minutes = 100, stepSec = 60): [number, number][] {
  const out: [number, number][] = [];
  for (let s = -minutes * 30; s <= minutes * 30; s += stepSec) {
    const pos = propagateAt(sat, new Date(date.getTime() + s * 1000));
    if (pos) out.push([pos.lat, pos.lon]);
  }
  return out;
}

function destinationPoint(lat: number, lon: number, bearing: number, km: number): [number, number] {
  const d = km / R_EARTH_KM;
  const b = (bearing * Math.PI) / 180;
  const p1 = (lat * Math.PI) / 180;
  const l1 = (lon * Math.PI) / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [(p2 * 180) / Math.PI, normalizeLon((l2 * 180) / Math.PI)];
}

/** Swath footprint polygon around a ground track, in [lat, lon] pairs. */
export function swathPolygon(track: [number, number][], widthKm: number): [number, number][] {
  if (track.length < 2) return [];
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  const half = widthKm / 2;
  for (let i = 0; i < track.length; i++) {
    const p = track[i];
    const ahead = track[Math.min(track.length - 1, i + 1)];
    const behind = track[Math.max(0, i - 1)];
    const b = bearingDeg(behind, ahead);
    left.push(destinationPoint(p[0], p[1], b - 90, half));
    right.push(destinationPoint(p[0], p[1], b + 90, half));
  }
  return [...left, ...right.reverse()];
}

export function swathCovers(sat: OrbitSatellite, date: Date, lat: number, lon: number): { covered: boolean; distanceKm: number; edgeKm: number } {
  const pos = propagateAt(sat, date);
  if (!pos) return { covered: false, distanceKm: Infinity, edgeKm: 0 };
  const halfGround = (sat.swathKm / 2) * 0.92;
  const d = haversineKm([pos.lat, pos.lon], [lat, lon]);
  return { covered: d <= halfGround, distanceKm: d, edgeKm: halfGround };
}
