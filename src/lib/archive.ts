import type { Region } from './types';

/**
 * The real FIRMS archive, as daily per-spacecraft observations.
 *
 * This is the layer that turns the record from a reconstruction into an
 * observation: every day it covers carries counts that a satellite actually made,
 * pulled from NASA's keyed Area API by `scripts/backfill-archive.mjs`.
 *
 * Coverage is tracked separately from the counts. A day with zero detections and a
 * day the product has not published yet are different facts, and collapsing them
 * would invent zeros.
 */

export interface ArchiveCell {
  m: number;
  v: number;
  n: number;
  n21: number;
  frpM: number;
  frpV: number;
}

/** [startDayIndex, endDayIndex, kind] — kind 0 standard processing, 1 near real time. */
type CoverageRange = [number, number, number];

interface RegionArchiveRaw {
  days?: Record<string, [number, number, number][]>;
  covered?: Record<string, CoverageRange[]>;
}

export interface ArchiveBundle {
  schema: string;
  generated_at: string;
  start: string;
  method: string;
  requests: number;
  rows: number;
  regions: Record<string, RegionArchiveRaw>;
}

export const ARCHIVE_START = '2000-11-01';
const DAY_MS = 86400000;
const EPOCH = Date.parse(`${ARCHIVE_START}T00:00:00Z`);

export function dayIndex(date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - EPOCH) / DAY_MS);
}
export function indexDate(index: number): string {
  return new Date(EPOCH + index * DAY_MS).toISOString().slice(0, 10);
}

class RegionArchive {
  cells = new Map<number, ArchiveCell>();
  covered: Record<string, CoverageRange[]> = {};

  /** -1 not published, 0 standard processing, 1 near real time. */
  coverage(sensor: string, index: number): number {
    for (const [s, e, kind] of this.covered[sensor] || []) {
      if (index < s) return -1;
      if (index <= e) return kind;
    }
    return -1;
  }

  cell(index: number): ArchiveCell {
    let c = this.cells.get(index);
    if (!c) {
      c = { m: 0, v: 0, n: 0, n21: 0, frpM: 0, frpV: 0 };
      this.cells.set(index, c);
    }
    return c;
  }
}

let archive = new Map<string, RegionArchive>();
let meta: ArchiveBundle | null = null;

export function attachArchive(raw: ArchiveBundle | null) {
  archive = new Map();
  weightsCache.clear();
  weightsSource = 'none';
  meta = raw?.regions && raw.schema ? raw : null;
  if (!meta) return false;
  for (const [regionId, block] of Object.entries(meta.regions)) {
    const ra = new RegionArchive();
    ra.covered = block.covered || {};
    for (const [sensor, rows] of Object.entries(block.days || {})) {
      for (const [index, count, frp] of rows) {
        if (ra.coverage(sensor, index) < 0) continue;
        const cell = ra.cell(index);
        if (sensor === 'm') { cell.m = count; cell.frpM = frp; }
        else if (sensor === 'v') { cell.v = count; cell.frpV += frp; }
        // FRP from the later spacecraft belongs in the same platform sum as the counts.
        else if (sensor === 'n') { cell.n = count; cell.frpV += frp; }
        else if (sensor === 'n21') { cell.n21 = count; cell.frpV += frp; }
      }
    }
    archive.set(regionId, ra);
  }
  return true;
}

export function archiveLoaded(): boolean {
  return archive.size > 0;
}

/** Identifies the attached archive so record caches can be invalidated when it changes. */
export function archiveStamp(): string {
  return meta?.generated_at ?? 'none';
}

/** Per-region coverage: which sensors are observed, over which span, and how many days. */
export interface ArchiveCoverage {
  days: number;
  first: string;
  last: string;
  sensors: Record<string, number>;
}

export function archiveCoverage(regionId: string): ArchiveCoverage {
  const ra = archive.get(regionId);
  if (!ra) return { days: 0, first: '', last: '', sensors: {} };
  const sensors: Record<string, number> = {};
  const covered = new Set<number>();
  let lo = Infinity;
  let hi = -Infinity;
  for (const [sensor, ranges] of Object.entries(ra.covered)) {
    const lane = new Set<number>();
    for (const [s, e] of ranges) {
      for (let i = s; i <= e; i++) { lane.add(i); covered.add(i); }
      lo = Math.min(lo, s);
      hi = Math.max(hi, e);
    }
    sensors[sensor] = lane.size;
  }
  return { days: covered.size, first: covered.size ? indexDate(lo) : '', last: covered.size ? indexDate(hi) : '', sensors };
}

export function archiveStatus() {
  if (!meta) return { loaded: false, regions: [] as string[], generatedAt: '', requests: 0, rows: 0 };
  return {
    loaded: true,
    regions: Object.keys(meta.regions),
    generatedAt: meta.generated_at,
    requests: meta.requests,
    rows: meta.rows,
    method: meta.method,
  };
}

/** What each instrument recorded on this day, with the publishing kind per sensor.
 *  -1 means the product has not published that sensor for that day. */
export interface ArchiveDayHit {
  cell: ArchiveCell;
  kindM: number;
  kindV: number;
  kindN: number;
  kindN21: number;
}

export function archiveDay(regionId: string, date: string): ArchiveDayHit | null {
  const ra = archive.get(regionId);
  if (!ra) return null;
  const index = dayIndex(date);
  const kindM = ra.coverage('m', index);
  const kindV = ra.coverage('v', index);
  const kindN = ra.coverage('n', index);
  const kindN21 = ra.coverage('n21', index);
  if (kindM < 0 && kindV < 0 && kindN < 0 && kindN21 < 0) return null;
  const stored = ra.cells.get(index);
  const cell = stored || { m: 0, v: 0, n: 0, n21: 0, frpM: 0, frpV: 0 };
  return { cell, kindM, kindV, kindN, kindN21 };
}

export function archiveSupplementary(regionId: string, date: string) {
  const hit = archiveDay(regionId, date);
  if (!hit) return null;
  return { noaa20: hit.cell.n, noaa21: hit.cell.n21 };
}

export interface ConstellationWeights {
  snpp: number;
  noaa20: number;
  noaa21: number;
  days: number;
}

/**
 * The VIIRS constellation grew twice: NOAA-20 joined in 2018-04 and NOAA-21 in 2023-03.
 * A day observed by one spacecraft is therefore not comparable to a day observed by three,
 * and taking the raw sum would manufacture two phantom breaks on top of the 2012 one.
 * The completion factors are measured on the archive's own all-three-spacecraft days —
 * no constant is typed anywhere.
 */
const weightsCache = new Map<string, ConstellationWeights | null>();
let weightsSource: 'archive' | 'none' = 'none';

export function constellationWeights(regionId: string): ConstellationWeights | null {
  if (weightsCache.has(regionId)) return weightsCache.get(regionId) ?? null;
  const ra = archive.get(regionId);
  let snpp = 0;
  let noaa20 = 0;
  let noaa21 = 0;
  let days = 0;
  if (ra) {
    for (const [s, e] of ra.covered.n21 || []) {
      for (let i = s; i <= e; i++) {
        if (ra.coverage('v', i) < 0 || ra.coverage('n', i) < 0) continue;
        const cell = ra.cells.get(i);
        snpp += cell?.v ?? 0;
        noaa20 += cell?.n ?? 0;
        noaa21 += cell?.n21 ?? 0;
        days++;
      }
    }
  }
  const total = snpp + noaa20 + noaa21;
  const w = days >= 30 && total > 0
    ? { snpp: snpp / total, noaa20: noaa20 / total, noaa21: noaa21 / total, days }
    : null;
  weightsCache.set(regionId, w);
  if (w) weightsSource = 'archive';
  return w;
}

export function constellationSource(): 'archive' | 'none' {
  return weightsSource;
}

/**
 * Detections on this day expressed in the full-constellation unit, or null when the day
 * is not observed at all. MODIS-only days are bridged by the caller with the measured
 * ratio, exactly as the reconstruction's pre-2012 days are.
 *
 * `fallback` carries the shares measured on the live window. Without it a day seen by one
 * spacecraft would be printed in a smaller unit than the modelled day before it, which is
 * the phantom break this function exists to prevent; the caller labels which source was used.
 */
export function platformEquivalent(
  regionId: string,
  cell: ArchiveCell,
  kindV: number,
  kindN: number,
  kindN21: number,
  fallback: Pick<ConstellationWeights, 'snpp' | 'noaa20' | 'noaa21'> | null = null,
): number | null {
  if (kindV < 0 && kindN < 0 && kindN21 < 0) return null;
  const observed = (kindV >= 0 ? cell.v : 0) + (kindN >= 0 ? cell.n : 0) + (kindN21 >= 0 ? cell.n21 : 0);
  if (kindV >= 0 && kindN >= 0 && kindN21 >= 0) return observed;
  const w = constellationWeights(regionId) ?? fallback;
  const share = w ? (kindV >= 0 ? w.snpp : 0) + (kindN >= 0 ? w.noaa20 : 0) + (kindN21 >= 0 ? w.noaa21 : 0) : 0;
  return share > 0 ? observed / share : observed;
}

/**
 * The bridge ratio measured on the archive itself: VIIRS-equivalent detections per MODIS
 * detection over the days both instruments were observed. With the archive this is
 * thousands of real days rather than the seven-day live window.
 */
/**
 * A ratio measured over less than one annual cycle is seasonally biased. Every area whose MODIS
 * and VIIRS lanes currently overlap only in the near-real-time tail (Aug–Nov) would otherwise
 * bridge twenty-five years of MODIS-only days with a peak-season factor — Nepal measured 46.7×
 * on 63 days against a calibrated ~10×. Requiring a full year keeps the archive bridge honest:
 * Chilecito and Pantanal clear it by years, the newly opened areas keep the calibrated ratio
 * until their standard-processing lanes overlap.
 */
const MIN_BRIDGE_DAYS = 365;

export function archiveRatio(region: Region, fallback: Pick<ConstellationWeights, 'snpp' | 'noaa20' | 'noaa21'> | null = null): { k: number; days: number; sumV: number; sumM: number } | null {
  const ra = archive.get(region.id);
  if (!ra) return null;
  let sumM = 0;
  let sumV = 0;
  let days = 0;
  const w = constellationWeights(region.id) ?? fallback;
  const visited = new Set<number>();
  for (const [s, e] of [...(ra.covered.v || []), ...(ra.covered.n || []), ...(ra.covered.n21 || [])]) {
    for (let i = s; i <= e; i++) {
      if (visited.has(i) || ra.coverage('m', i) < 0) continue;
      visited.add(i);
      const kindV = ra.coverage('v', i);
      const kindN = ra.coverage('n', i);
      const kindN21 = ra.coverage('n21', i);
      const full = kindV >= 0 && kindN >= 0 && kindN21 >= 0;
      const share = w ? (kindV >= 0 ? w.snpp : 0) + (kindN >= 0 ? w.noaa20 : 0) + (kindN21 >= 0 ? w.noaa21 : 0) : 0;
      if (!full && share <= 0) continue;
      const cell = ra.cells.get(i) ?? { m: 0, v: 0, n: 0, n21: 0, frpM: 0, frpV: 0 };
      const equivalent = platformEquivalent(region.id, cell, kindV, kindN, kindN21, fallback);
      if (equivalent == null) continue;
      sumV += equivalent;
      sumM += cell.m;
      days++;
    }
  }
  if (!days || days < MIN_BRIDGE_DAYS || sumM <= 0) return null;
  return { k: sumV / sumM, days, sumV, sumM };
}
