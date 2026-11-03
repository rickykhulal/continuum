import type { Region } from './types';
import type { Topology } from './geo';
import { normalizeLon } from './geo';
import { registerCountryRegions, setCountryWindowLookup } from './data';

const BASE = import.meta.env.BASE_URL || './';

export interface CountryEntry {
  id: string;
  name: string;
  src?: string;
  aliases: string[];
  center: [number, number];
  bbox: [number, number, number, number];
  areaKm2: number;
  rasterKm2: number;
  detections: number;
}

export interface CountryWindow {
  id: string;
  name: string;
  total: number;
  perDay: Record<string, number>;
  sensors: Record<string, number>;
  day: number;
  night: number;
  frpMean: number;
  frpMax: number;
  per10kKm2: number;
  areaKm2: number;
}

interface Gazetteer {
  meta: { count: number; cell_deg: number; source: string };
  countries: CountryEntry[];
}
interface FireWindow {
  meta: {
    window: { start: string; end: string };
    rows_read: number;
    rows_in_countries: number;
    rows_outside: number;
    coverage_pct: number;
    countries_with_detections: number;
    countries_total: number;
    built_at: string;
  };
  days: string[];
  countries: CountryWindow[];
}

let gazetteer: CountryEntry[] = [];
let byId = new Map<string, CountryEntry>();
let windows = new Map<string, CountryWindow>();
let windowMeta: FireWindow['meta'] | null = null;
let shapes: { entry: CountryEntry; polys: Poly[] }[] = [];
let topoPromise: Promise<void> | null = null;

const json = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
};

/** Loads the gazetteer and the per-country live-window tally. One call, cached, safe to race. */
export function loadWorldLayer(): Promise<void> {
  if (!topoPromise) {
    topoPromise = Promise.all([
      json(`${BASE}data/countries.json`) as Promise<Gazetteer>,
      json(`${BASE}data/country_fires.json`) as Promise<FireWindow>,
    ])
      .then(([g, f]) => {
        hydrateWorldLayer(g, f);
      })
      .catch(() => {
        topoPromise = null;
      });
  }
  return topoPromise;
}

/**
 * Fill the same tables from files that are already parsed. The browser gets them by fetch; the
 * Node API reads them off disk. Both then call installWorldLayer(), so the 241 areas — and the
 * numbers attached to them — are constructed by exactly one code path.
 */
export function hydrateWorldLayer(gazetteerFile: Gazetteer, firesFile: FireWindow): void {
  gazetteer = gazetteerFile.countries ?? [];
  byId = new Map(gazetteer.map((c) => [c.id, c]));
  windows = new Map((firesFile.countries ?? []).map((c) => [c.id, c]));
  windowMeta = firesFile.meta ?? null;
}

/**
 * Register the world layer with the analytics pipeline: every border becomes an analysable area,
 * and every border's calibration comes from its own measured window. Returns the number of
 * countries installed; zero means the layer is missing and callers must stay on the pilot areas.
 */
export function installWorldLayer(): number {
  if (!gazetteer.length || !windowMeta) return 0;
  const meta = windowMeta;
  registerCountryRegions(gazetteer.map(countryRegion));
  setCountryWindowLookup((countryId) => {
    const w = windows.get(countryId);
    if (w) {
      return {
        name: w.name,
        total: w.total,
        perDay: w.perDay,
        sensors: w.sensors,
        areaKm2: w.areaKm2,
        frpMean: w.frpMean,
        windowEnd: meta.window.end,
      };
    }
    // A border that appears in the gazetteer but not in the window table was still scanned for
    // the whole window and produced nothing. Zero measured detections is that country's rate;
    // without the row it would inherit the pooled pilot density instead.
    const entry = byId.get(countryId);
    if (!entry) return null;
    return { name: entry.name, total: 0, perDay: {}, sensors: {}, areaKm2: entry.areaKm2, windowEnd: meta.window.end };
  });
  return gazetteer.length;
}

/** Undo both registrations — a test that installs the layer must not leak it into the next one. */
export function uninstallWorldLayer(): void {
  registerCountryRegions([]);
  setCountryWindowLookup(null);
}

export function worldCountries(): CountryEntry[] {
  return gazetteer;
}

export function countryById(id: string): CountryEntry | null {
  return byId.get(id) ?? null;
}

/** Exact detections for one country inside the shipped FIRMS window — measured, not modelled. */
export function countryWindow(id: string): CountryWindow | null {
  return windows.get(id) ?? null;
}

export function windowMeta_(): FireWindow['meta'] | null {
  return windowMeta;
}

/** Countries ranked by measured density, derived at call time from the shipped window. */
export function worldLeaderboard(limit = 12): (CountryWindow & { sharePct: number })[] {
  const total = windowMeta?.rows_in_countries ?? 1;
  return [...windows.values()]
    .sort((a, b) => b.per10kKm2 - a.per10kKm2)
    .slice(0, limit)
    .map((c) => ({ ...c, sharePct: Number(((c.total / total) * 100).toFixed(2)) }));
}

/* ------------------------------------------------------------------ geometry */
type Ring = [number, number][];
type Box = [number, number, number, number];
interface Poly {
  /** Rings in the polygon's own longitude frame, largest first. */
  u: Ring[];
  seam: number;
  /** Bounds in that frame. */
  ub: Box;
  bbox: Box;
  /** True for a ring that runs the full 360°: it encloses a cap around a pole. */
  polar: boolean;
  pole: number;
}

const R_EARTH_KM = 6371.0088;
const DEG = Math.PI / 180;

function decodeArc(arc: number[][], transform?: Topology['transform']): Ring {
  let x = 0;
  let y = 0;
  const out: Ring = [];
  for (const [dx, dy] of arc) {
    x += dx;
    y += dy;
    out.push(transform ? [x * transform.scale[0] + transform.translate[0], y * transform.scale[1] + transform.translate[1]] : [x, y]);
  }
  return out;
}
function stitchRing(indices: number[], arcs: Ring[]): Ring {
  const ring: Ring = [];
  for (const idx of indices) {
    const reverse = idx < 0;
    const seq = reverse ? [...arcs[~idx]].reverse() : arcs[idx];
    for (let i = 0; i < seq.length; i++) {
      if (ring.length && i === 0) continue;
      ring.push(seq[i]);
    }
  }
  if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push(ring[0]);
  return ring;
}
function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 1; i < ring.length; i++) {
    const [lon1, lat1] = ring[i - 1];
    const [lon2, lat2] = ring[i];
    sum += (lon2 - lon1) * (2 + Math.sin(lat1 * DEG) + Math.sin(lat2 * DEG));
  }
  return (sum * R_EARTH_KM * R_EARTH_KM) / 2;
}
const normLon = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;
/** The meridian a ring is cut on — the widest empty gap among its longitudes. Unrolling into the
 *  window that starts there makes a shape crossing ±180 (Russia, the Aleutians, Fiji) an ordinary
 *  closed curve, so the ray cast needs no wrap handling. Mirrors seamOf() in
 *  scripts/build-countries.mjs; keep the two in step or clicks and counts disagree. */
function seamOf(ring: Ring): number {
  const lons = [...new Set(ring.map((p) => p[0]))].sort((a, b) => a - b);
  if (lons.length < 2) return -180;
  let gap = lons[0] + 360 - lons[lons.length - 1];
  let at = lons[lons.length - 1];
  for (let i = 1; i < lons.length; i++) {
    const d = lons[i] - lons[i - 1];
    if (d > gap) { gap = d; at = lons[i - 1]; }
  }
  return normLon(at + gap / 2);
}
const unroll = (ring: Ring, seam: number): Ring => ring.map(([lon, lat]) => [seam + (((lon - seam) % 360 + 360) % 360), lat]);
function rayEast(lon: number, lat: number, rings: Ring[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
function meridianCrossings(lon: number, rings: Ring[]): number[] {
  const ys: number[] = [];
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      const [x1, y1] = ring[i - 1];
      const [x2, y2] = ring[i];
      if (y1 === y2) continue;
      if ((x1 <= lon && lon < x2) || (x2 <= lon && lon < x1)) ys.push(y1 + ((y2 - y1) * (lon - x1)) / (x2 - x1));
    }
  }
  return ys;
}
function poleParity(lon: number, lat: number, rings: Ring[], pole: number): boolean {
  let n = 0;
  for (const y of meridianCrossings(lon, rings)) if (pole < 0 ? y < lat : y > lat) n++;
  return n % 2 === 0;
}
function bboxOf(rings: Ring[]): [number, number, number, number] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const ring of rings) for (const [lon, lat] of ring) {
    if (lon < w) w = lon;
    if (lon > e) e = lon;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  return [w, s, e, n];
}
/** A polygon in its own longitude frame: largest ring first (the source does not always put the
 *  mainland in ring 0 — Antarctica's outer ring is a degenerate clip line), then holes. A ring
 *  that runs the full 360° encloses a polar cap instead of a planar shape. */
function makePoly(rings: Ring[]): Poly | null {
  const usable = rings.filter((r) => r.length > 3);
  if (!usable.length) return null;
  const ordered = usable.map((ring) => ({ ring, area: Math.abs(ringArea(ring)) })).sort((a, b) => b.area - a.area).map((x) => x.ring);
  const seam = seamOf(ordered[0]);
  const u = ordered.map((r) => unroll(r, seam));
  const ub = bboxOf(u);
  const [w, , e] = bboxOf([u[0]]);
  return { u, seam, ub: [w, ub[1], e, ub[3]], polar: e - w >= 350, pole: u[0].reduce((a, p) => a + p[1], 0) / u[0].length >= 0 ? 1 : -1, bbox: [w, ub[1], e, ub[3]] };
}
function hitPoly(lon: number, lat: number, p: Poly): boolean {
  const lonU = p.seam + ((((lon - p.seam) % 360) + 360) % 360);
  const [w, s, e, n] = p.ub;
  if (lonU < w || lonU > e || lat < s || lat > n) return false;
  return p.polar ? poleParity(lonU, lat, p.u, p.pole) : rayEast(lonU, lat, p.u);
}

let shapesPromise: Promise<void> | null = null;
/** The same 50m polygons the globe draws its outlines from, kept per country for hit-testing. */
export function loadCountryShapes(): Promise<void> {
  if (!shapesPromise) {
    shapesPromise = loadWorldLayer()
      .then(() => json(`${BASE}data/countries-50m.json`) as Promise<Topology>)
      .then((topo) => {
        const arcs = topo.arcs.map((a) => decodeArc(a, topo.transform));
        const geoms = topo.objects.countries.geometries as any[];
        const byName = new Map(gazetteer.map((c) => [c.src || c.name, c]));
        const next: typeof shapes = [];
        for (const geom of geoms) {
          const name = geom?.properties?.name;
          const entry = byName.get(name);
          if (!entry) continue;
          const polygons = geom.type === 'Polygon' ? [geom.arcs] : geom.type === 'MultiPolygon' ? geom.arcs : [];
          const polys = polygons
            .map((poly: number[][]) => {
              const rings = poly.map((r) => stitchRing(r, arcs));
              return makePoly(rings);
            })
            .filter(Boolean) as Poly[];
          if (polys.length) next.push({ entry, polys });
        }
        shapes = next;
      })
      .catch(() => {
        shapesPromise = null;
      });
  }
  return shapesPromise;
}

function hit(lon: number, lat: number): CountryEntry | null {
  for (const c of shapes) {
    for (const p of c.polys) {
      if (hitPoly(lon, lat, p)) return c.entry;
    }
  }
  return null;
}

export interface WhereResult {
  country: CountryEntry | null;
  /** Present when the point itself fell in water and the label came from the nearest land. */
  nearKm: number | null;
  label: string;
}

/**
 * Name any point on Earth. A click inside a polygon returns that country; a click in the water
 * searches outward on a ring of probes and reports the nearest country with the distance it had to
 * travel, so a harbour city is never silently labelled "open ocean".
 */
export async function whereAt(lat: number, lon: number): Promise<WhereResult> {
  await loadCountryShapes();
  const p = hit(lon, lat);
  if (p) return { country: p, nearKm: null, label: p.name };
  const la = Math.max(-89.9, Math.min(89.9, lat));
  const stepKm = [12, 30, 70, 150, 300];
  for (const km of stepKm) {
    const dLat = km / 111.32;
    const dLon = km / (111.32 * Math.max(0.15, Math.cos((la * Math.PI) / 180)));
    for (let a = 0; a < 360; a += 15) {
      const rad = (a * Math.PI) / 180;
      const found = hit(lon + Math.cos(rad) * dLon, la + Math.sin(rad) * dLat);
      if (found) return { country: found, nearKm: km, label: `Near ${found.name}` };
    }
  }
  return { country: null, nearKm: null, label: 'Open ocean' };
}

/* -------------------------------------------------------------------- search */
const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export interface WorldHit {
  kind: 'country' | 'place';
  id: string;
  name: string;
  sub: string;
  lat: number;
  lon: number;
  regionId?: string;
  detections?: number;
  score: number;
}

/** Ranks the shipped gazetteer (every country polygon) against the hand-listed places. */
export function searchWorld(query: string, limit = 8, places: { name: string; country: string; lat: number; lon: number; regionId?: string; aliases: string[] }[] = []): WorldHit[] {
  const q = norm(query);
  if (q.length < 2) return [];
  const out: WorldHit[] = [];
  for (const c of gazetteer) {
    const hay = [norm(c.name), ...(c.aliases || []).map(norm)];
    let s = -1;
    for (const h of hay) {
      if (h === q) s = Math.max(s, 100);
      else if (h.startsWith(q)) s = Math.max(s, 84 - (h.length - q.length));
      else if (h.includes(q)) s = Math.max(s, 60 - (h.length - q.length));
    }
    if (s > 0) out.push({ kind: 'country', id: c.id, name: c.name, sub: `${Math.round(c.areaKm2).toLocaleString()} km² · ${c.detections.toLocaleString()} detections this window`, lat: c.center[0], lon: c.center[1], detections: c.detections, score: s });
  }
  for (const p of places) {
    const hay = [norm(p.name), norm(p.country), ...p.aliases.map(norm)];
    let s = -1;
    for (const h of hay) {
      if (h === q) s = Math.max(s, 96);
      else if (h.startsWith(q)) s = Math.max(s, 80 - (h.length - q.length));
      else if (h.includes(q)) s = Math.max(s, 56 - (h.length - q.length));
    }
    if (s > 0) out.push({ kind: 'place', id: p.regionId || `place:${p.name}`, name: p.name, sub: p.country, lat: p.lat, lon: p.lon, regionId: p.regionId, score: s });
  }
  return out.sort((a, b) => b.score - a.score || (b.detections ?? 0) - (a.detections ?? 0)).slice(0, limit);
}

/* -------------------------------------------------------------------- region */
const biomeFor = (lat: number) => (Math.abs(lat) > 60 ? 'Boreal / polar' : Math.abs(lat) < 23.5 ? 'Tropical' : 'Temperate');

/** A country polygon as an analysable area: real bbox, real polygon area, real window counts. */
export function countryRegion(entry: CountryEntry): Region {
  const w = countryWindow(entry.id);
  const [la, lo] = entry.center;
  return {
    id: `country-${entry.id}`,
    countryId: entry.id,
    name: `${entry.name} — country wide`,
    shortName: entry.name,
    country: entry.name,
    admin: 'Country border · Natural Earth 50m',
    center: [la, lo],
    bbox: entry.bbox,
    areaKm2: entry.areaKm2,
    biome: biomeFor(la),
    language: 'en',
    timezone: `UTC${Math.round(lo / 15) >= 0 ? '+' : ''}${Math.round(lo / 15)}`,
    description: `Every detection the four FIRMS satellites measured inside the ${entry.name} border during the live FIRMS window (${w ? `${w.total.toLocaleString()} detections` : 'no detections so far'}), harmonised across instruments and compared with the same area's seasonal history. The border is Natural Earth 50m; the counts are measured, not modelled.`,
    aliases: entry.aliases,
  };
}

export { normalizeLon };
