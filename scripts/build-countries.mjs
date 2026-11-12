#!/usr/bin/env node
/**
 * Builds the world layer: a gazetteer of every country polygon plus an exact per-country
 * tally of the live FIRMS window.
 *
 *   public/data/countries.json       — 241 Natural Earth 50m countries: id, name, centre,
 *                                      bbox, polygon area, raster area cross-check.
 *   public/data/country_fires.json   — detections inside the 7-day window attributed to a
 *                                      country by point-in-polygon against those same
 *                                      polygons, per day, per sensor, per FRP.
 *
 * The polygons come from world-atlas (Natural Earth 50m, public domain). The detections come
 * from the four NASA FIRMS Global 7-day CSVs already hashed into the bundle, so every number
 * here is a measurement of the live window — never a reconstruction and never a model output.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
function directoryArg(flag, fallback) {
  const at = process.argv.indexOf(flag);
  if (at < 0) return fallback;
  const value = process.argv[at + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a directory`);
  return path.resolve(value);
}
const RAW = directoryArg('--raw-dir', path.join(ROOT, 'data_raw'));
const OUT = directoryArg('--out-dir', DATA);
// The topology is always read-only, independent of the output directory.
const TOPO = path.join(DATA, 'countries-50m.json');
const SENSORS = [
  { file: 'MODIS_C6_1_Global_7d.csv', sensor: 'MODIS' },
  { file: 'SUOMI_VIIRS_C2_Global_7d.csv', sensor: 'VIIRS-SNPP' },
  { file: 'J1_VIIRS_C2_Global_7d.csv', sensor: 'NOAA-20' },
  { file: 'J2_VIIRS_C2_Global_7d.csv', sensor: 'NOAA-21' },
];
if (!process.argv.includes('--probe')) {
  const missing = SENSORS.filter(({ file }) => !fs.existsSync(path.join(RAW, file)));
  if (missing.length) throw new Error(`Missing required FIRMS CSV files: ${missing.map(({ file }) => file).join(', ')}`);
}
const R_EARTH_KM = 6371.0088;
const DEG = Math.PI / 180;
const CELL_DEG = Number(process.argv.includes('--cell') ? process.argv[process.argv.indexOf('--cell') + 1] : 0.2);

const t0 = Date.now();
const log = (...a) => console.log(...a);

/* ------------------------------------------------------------------ topology */
function decodeArc(arc, transform) {
  let x = 0, y = 0;
  const out = [];
  for (const [dx, dy] of arc) {
    x += dx; y += dy;
    out.push(transform ? [x * transform.scale[0] + transform.translate[0], y * transform.scale[1] + transform.translate[1]] : [x, y]);
  }
  return out;
}
function stitchRing(indices, arcs) {
  const ring = [];
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
/** One entry per country geometry: its polygons (ring 0 outer, rest holes) and metadata. */
function decodeCountries(topo) {
  const arcs = topo.arcs.map((a) => decodeArc(a, topo.transform));
  const geoms = topo.objects.countries.geometries;
  const out = [];
  for (let g = 0; g < geoms.length; g++) {
    const geom = geoms[g];
    const name = (geom.properties && geom.properties.name) || `Area ${g}`;
    /** @type {[number,number][][][]} */
    const polygons = [];
    if (geom.type === 'Polygon') polygons.push(geom.arcs.map((r) => stitchRing(r, arcs)));
    else if (geom.type === 'MultiPolygon') for (const p of geom.arcs) polygons.push(p.map((r) => stitchRing(r, arcs)));
    const kept = polygons.filter((p) => p.length && p[0].length > 3);
    if (!kept.length) continue;
    out.push({ gid: g, name, polygons });
  }
  return out;
}

/* -------------------------------------------------------------------- geometry */
function ringAreaKm2(ring) {
  let sum = 0;
  for (let i = 1; i < ring.length; i++) {
    const [lon1, lat1] = ring[i - 1];
    const [lon2, lat2] = ring[i];
    sum += (lon2 - lon1) * DEG * (2 + Math.sin(lat1 * DEG) + Math.sin(lat2 * DEG));
  }
  return Math.abs((sum * R_EARTH_KM * R_EARTH_KM) / 2);
}
function ringBbox(ring) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < w) w = lon;
    if (lon > e) e = lon;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  return [w, s, e, n];
}
const normLon = (x) => ((((x + 180) % 360) + 360) % 360) - 180;
/** The meridian a ring is cut on: the widest empty gap among its vertex longitudes. Unrolling the
 *  ring into the 360° window that starts there turns a shape crossing ±180 (Russia, the Aleutians,
 *  Fiji, Antarctica) into a plain closed curve, so ray casting needs no wrap handling at all. */
function seamOf(ring) {
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
const unroll = (ring, seam) => ring.map(([lon, lat]) => [seam + ((((lon - seam) % 360) + 360) % 360), lat]);
/** Longitude is unrolled against the ring's own meridian so Russia and Fiji stay sane. */
function ringCentroid(ring) {
  const lon0 = ring[0][0];
  let a = 0, cx = 0, cy = 0;
  for (let i = 1; i < ring.length; i++) {
    const x1 = ((ring[i - 1][0] - lon0 + 540) % 360) - 180;
    const y1 = ring[i - 1][1];
    const x2 = ((ring[i][0] - lon0 + 540) % 360) - 180;
    const y2 = ring[i][1];
    const cross = x1 * y2 - x2 * y1;
    a += cross / 2;
    cx += ((x1 + x2) / 6) * cross;
    cy += ((y1 + y2) / 6) * cross;
  }
  if (Math.abs(a) < 1e-9) return ring[0];
  // A = a (the shoelace sum already carries the half), and Σ((y1+y2)/6)·cross = Cy·A, so the
  // centroid is cy/a. Dividing by 3a compresses every latitude toward the equator.
  return [((cx / a + lon0 + 540) % 360) - 180, cy / a];
}
/** Eastward ray cast on [lon,lat] in the polygon's own unrolled frame; holes cancel because the
 *  parity flips once more inside them. */
function rayEast(lon, lat, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
/** Which pole a ring that runs all the way around the globe encloses: the one its own latitudes
 *  lean toward. Antarctica's mainland ring is such a curve — the boundary is the coast and the
 *  interior is everything between it and the South Pole. */
function poleOf(ring) {
  let sum = 0;
  for (const [, lat] of ring) sum += lat;
  return sum / ring.length >= 0 ? 1 : -1;
}
/** Boundary latitudes the meridian at `lon` crosses. A point is inside when the crossings
 *  between it and the enclosed pole number even (0 = same cap side as the pole). */
function meridianCrossings(lon, rings) {
  const ys = [];
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
function poleParity(lon, lat, rings, pole) {
  const ys = meridianCrossings(lon, rings);
  let n = 0;
  for (const y of ys) if (pole < 0 ? y < lat : y > lat) n++;
  return n % 2 === 0;
}
/** One filled polygon in its own longitude frame. */
function makePoly(rings) {
  const withArea = rings.map((r) => ({ ring: r, area: Math.abs(ringAreaKm2(r)) }));
  withArea.sort((a, b) => b.area - a.area);
  const outer = withArea[0].ring;
  const seam = seamOf(outer);
  const u = withArea.map((x) => unroll(x.ring, seam));
  const ub = ringBbox(u[0]);
  let s = ub[1];
  let n = ub[3];
  for (const r of u) { s = Math.min(s, ringBbox(r)[1]); n = Math.max(n, ringBbox(r)[3]); }
  let w = Infinity, e = -Infinity;
  for (const [lon] of outer) { w = Math.min(w, lon); e = Math.max(e, lon); }
  const span = ub[2] - ub[0];
  return { u, seam, ub: [ub[0], s, ub[2], n], polar: span >= 350, pole: poleOf(outer), bbox: [w, s, e, n] };
}
function hitPoly(lon, lat, p) {
  const lonU = p.seam + ((((lon - p.seam) % 360) + 360) % 360);
  const [w, s, e, n] = p.ub;
  if (lonU < w || lonU > e || lat < s || lat > n) return false;
  return p.polar ? poleParity(lonU, lat, p.u, p.pole) : rayEast(lonU, lat, p.u);
}
const L0 = -180 + CELL_DEG / 2; // centre longitude of column 0
/** A ring that runs all the way around the pole encloses the cap between its coast and that pole,
 *  which the planar ring integral cannot express: unrolled, the curve is closed only by the seam.
 *  Integrate the cap instead — at every meridian the land runs from its northernmost crossing down
 *  to the pole. This is the one shape where the two area estimators legitimately disagree, so the
 *  number is measured here rather than borrowed from the grid count. */
function capAreaKm2(p) {
  const [w, , e] = p.ub;
  const k0 = Math.ceil((w - L0) / CELL_DEG);
  const k1 = Math.floor((e - L0) / CELL_DEG);
  const toPole = p.pole < 0 ? -1 : 1;
  let total = 0;
  for (let k = k0; k <= k1; k++) {
    const ys = meridianCrossings(L0 + k * CELL_DEG, p.u);
    if (!ys.length) continue;
    const coast = p.pole < 0 ? Math.max(...ys) : Math.min(...ys);
    total += R_EARTH_KM * R_EARTH_KM * (CELL_DEG * DEG) * Math.abs(Math.sin(coast * DEG) - toPole);
  }
  return total;
}
function slug(name) {  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return base || 'area';
}
function inBbox(lon, lat, [w, s, e, n]) {
  return lon >= w && lon <= e && lat >= s && lat <= n;
}
function inCountry(lon, lat, country) {
  for (const p of country.polys) if (hitPoly(lon, lat, p)) return true;
  return false;
}
const normName = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Natural Earth abbreviates several names for map labels. The app shows people-facing names and
 *  keeps the source spelling as an alias, so "Dem. Rep. Congo" still resolves for a search. */
const DISPLAY = {
  'Antigua and Barb.': 'Antigua and Barbuda',
  'Ashmore and Cartier Is.': 'Ashmore and Cartier Islands',
  'Bosnia and Herz.': 'Bosnia and Herzegovina',
  'Br. Indian Ocean Ter.': 'British Indian Ocean Territory',
  'British Virgin Is.': 'British Virgin Islands',
  'Cayman Is.': 'Cayman Islands',
  'Central African Rep.': 'Central African Republic',
  'Dem. Rep. Congo': 'DR Congo',
  'Dominican Rep.': 'Dominican Republic',
  'Eq. Guinea': 'Equatorial Guinea',
  'Faeroe Is.': 'Faroe Islands',
  'Falkland Is.': 'Falkland Islands',
  'Fr. Polynesia': 'French Polynesia',
  'Fr. S. Antarctic Lands': 'French Southern Territories',
  'Heard I. and McDonald Is.': 'Heard Island and McDonald Islands',
  'N. Cyprus': 'Northern Cyprus',
  'N. Mariana Is.': 'Northern Mariana Islands',
  'Pitcairn Is.': 'Pitcairn Islands',
  'S. Geo. and the Is.': 'South Georgia and the South Sandwich Islands',
  'S. Sudan': 'South Sudan',
  'Solomon Is.': 'Solomon Islands',
  'St. Vin. and Gren.': 'Saint Vincent and the Grenadines',
  'St. Pierre and Miquelon': 'Saint Pierre and Miquelon',
  'St. Kitts and Nevis': 'Saint Kitts and Nevis',
  'Turks and Caicos Is.': 'Turks and Caicos Islands',
  'U.S. Virgin Is.': 'United States Virgin Islands',
  'Wallis and Futuna Is.': 'Wallis and Futuna',
  eSwatini: 'Eswatini',
  Macedonia: 'North Macedonia',
  Vatican: 'Vatican City',
  'W. Sahara': 'Western Sahara',
  'United States of America': 'United States',
};
const ALIASES = {
  Turkey: ['turkiye', 'turkey'],
  Taiwan: ['taiwan province'],
  'United States': ['usa', 'united states'],
  'United Kingdom': ['uk', 'great britain', 'england'],
  'DR Congo': ['dem rep congo', 'congo kinshasa', 'drc'],
  Congo: ['congo brazzaville', 'republic of the congo'],
  Russia: ['russian federation'],
  Iran: ['islamic republic of iran'],
  Nepal: ['neverland'],
  'South Korea': ['korea', 'republic of korea'],
  'North Korea': ['dprk', 'democratic peoples republic of korea'],
  Vietnam: ['viet nam'],
  Laos: ['lao'],
  Myanmar: ['burma'],
  Czechia: ['czech republic'],
  'Côte d\'Ivoire': ["ivory coast", "cote divoire"],
  'Timor-Leste': ['east timor'],
  'Papua New Guinea': ['png'],
  'São Tomé and Principe': ['sao tome'],
  'Bosnia and Herzegovina': ['bosnia'],
  'North Macedonia': ['macedonia'],
  'Eswatini': ['swaziland'],
  'Bolivia': ['plurinational state of bolivia'],
  Venezuela: ['bolivarian republic of venezuela'],
  Palestine: ['west bank', 'gaza'],
  'Siachen Glacier': ['siachen'],
};

/* ------------------------------------------------------------------ rasterise */
const nx = Math.round(360 / CELL_DEG);
const ny = Math.round(180 / CELL_DEG);
const grid = new Int16Array(nx * ny).fill(-1);
const cellAreaKm2 = (lat) => {
  const dLon = CELL_DEG * DEG;
  return R_EARTH_KM * R_EARTH_KM * dLon * Math.abs(Math.sin((lat + CELL_DEG / 2) * DEG) - Math.sin((lat - CELL_DEG / 2) * DEG));
};

function cellIndex(lon, lat) {
  const i = Math.min(nx - 1, Math.max(0, Math.floor((lon + 180) / CELL_DEG)));
  const j = Math.min(ny - 1, Math.max(0, Math.floor((90 - lat) / CELL_DEG)));
  return j * nx + i;
}

/* --------------------------------------------------------------- country table */
const topo = JSON.parse(fs.readFileSync(TOPO, 'utf8'));
const countries = decodeCountries(topo);
log(`countries: ${countries.length} polygons decoded from ${path.relative(ROOT, TOPO)} in ${Date.now() - t0} ms`);

const table = [];
for (const c of countries) {
  let area = 0, biggest = null, biggestArea = 0;
  /** Each polygon keeps its own longitude frame: Russia and Fiji straddle the antimeridian and
   *  Antarctica's mainland ring runs all the way around the pole, so a single union bbox would
   *  stretch across the whole map and poison the cell prefilter. */
  const polys = [];
  for (const poly of c.polygons) {
    const p = makePoly(poly);
    let pa = 0;
    if (p.polar) {
      pa = capAreaKm2(p);
    } else {
      p.u.forEach((ring, r) => {
        const a = ringAreaKm2(ring);
        pa += r === 0 ? a : -a;
      });
      pa = Math.abs(pa);
    }
    area += pa;
    if (Math.abs(pa) > biggestArea) { biggestArea = Math.abs(pa); biggest = p.u[0]; }
    polys.push(p);
  }
  if (!biggest) continue;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const p of polys) { w = Math.min(w, p.bbox[0]); s = Math.min(s, p.bbox[1]); e = Math.max(e, p.bbox[2]); n = Math.max(n, p.bbox[3]); }
  const centroid = ringCentroid(biggest);
  table.push({
    name: c.name,
    polys,
    bbox: [w, s, e, n],
    center: [Number(centroid[1].toFixed(3)), Number(centroid[0].toFixed(3))],
    areaKm2: Math.round(Math.abs(area)),
    cells: 0,
    rasterKm2: 0,
  });
}
log(`countries: ${table.length} named areas, ${table.reduce((a, c) => a + c.polys.length, 0)} polygons, ${table.filter((c) => c.polys.some((p) => p.polar)).length} with a polar-cap ring`);

// Fill the raster with each country's own cells, scanning only inside each polygon's longitude frame.
let filled = 0;
for (let ci = 0; ci < table.length; ci++) {
  const c = table[ci];
  for (const p of c.polys) {
    const [w, s, e, n] = p.ub;
    // Columns run in the polygon's own unrolled frame, so they can sit outside 0…nx-1; the grid
    // column is that index folded back by modulo. Clamping here would drop every country west of
    // its own seam — Brazil, and with it most of South America, would never be filled.
    const k0 = Math.ceil((w - L0) / CELL_DEG);
    const k1 = Math.floor((e - L0) / CELL_DEG);
    const j0 = Math.max(0, Math.floor((90 - n) / CELL_DEG));
    const j1 = Math.min(ny - 1, Math.ceil((90 - s) / CELL_DEG));
    /** A polar-cap ring is swept once per meridian instead of ray-cast per cell: 1800 crossing
     *  lists rather than a quarter of a million full-ring scans. */
    const cols = p.polar ? new Array(k1 - k0 + 1) : null;
    if (cols) {
      for (let k = k0; k <= k1; k++) cols[k - k0] = meridianCrossings(L0 + k * CELL_DEG, p.u).sort((a, b) => a - b);
    }
    for (let j = j0; j <= j1; j++) {
      const lat = 90 - (j + 0.5) * CELL_DEG;
      if (lat < s || lat > n) continue;
      for (let k = k0; k <= k1; k++) {
        const lonU = L0 + k * CELL_DEG;
        if (lonU < w || lonU > e) continue;
        let inside;
        if (cols) {
          const ys = cols[k - k0];
          let hits = 0;
          while (hits < ys.length && (p.pole < 0 ? ys[hits] < lat : ys[hits] > lat)) hits++;
          inside = hits % 2 === 0;
        } else {
          inside = rayEast(lonU, lat, p.u);
        }
        if (!inside) continue;
        const idx = j * nx + (((k % nx) + nx) % nx);
        if (grid[idx] >= 0) continue; // first writer wins; overlaps are maritime claims
        grid[idx] = ci;
        c.cells++;
        c.rasterKm2 += cellAreaKm2(lat);
        filled++;
      }
    }
  }
}
log(`countries: raster filled ${filled} cells at ${CELL_DEG}° (${nx}×${ny}) in ${Date.now() - t0} ms`);

/** The grid is only a fast positive candidate, never evidence that no polygon contains a row.
 *  Keep single attribution: a confirmed grid candidate wins, otherwise the first exact hit in
 *  topology order wins. inCountry prefilters each polygon in its own unrolled bounding box. */
function countryIndex(lon, lat) {
  const candidate = grid[cellIndex(lon, lat)];
  if (candidate >= 0 && inCountry(lon, lat, table[candidate])) return candidate;
  return table.findIndex((c, ci) => ci !== candidate && inCountry(lon, lat, c));
}

if (process.argv.includes('--probe')) {
  for (let k = process.argv.indexOf('--probe') + 1; k < process.argv.length; k += 2) {
    const lat = Number(process.argv[k]);
    const lon = Number(process.argv[k + 1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) break;
    const ci = grid[cellIndex(lon, lat)];
    const cands = table.filter((c) => inCountry(lon, lat, c));
    log(`probe ${lat},${lon} → cell ${ci >= 0 ? table[ci].name : 'unassigned'}; exact hits: ${cands.map((c) => c.name).join(', ') || 'none'}`);
  }
  process.exit(0);
}

/* ---------------------------------------------------------------- FIRMS tally */
const byCountry = new Map(table.map((_, ci) => [ci, {
  total: 0, frp: 0, frpMax: 0, day: 0, night: 0, sensors: {}, days: {}, perDaySensors: {}, perDayFrp: {},
}]));
const dates = new Set();
let rows = 0, dropped = 0, outside = 0, inland = 0;

// Do not let blank fields (Number('') === 0) or non-decimal JS literals become measurements.
const csvNumber = (s) => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s) ? Number(s) : NaN;
const COLUMNS = { lat: 'latitude', lon: 'longitude', date: 'acq_date', time: 'acq_time', frp: 'frp', conf: 'confidence', dn: 'daynight' };
for (const { file, sensor } of SENSORS) {
  const text = fs.readFileSync(path.join(RAW, file), 'utf8');
  const lines = text.split('\n');
  const head = lines[0].trim().split(',').map((s) => s.trim());
  const missing = Object.values(COLUMNS).filter((name) => !head.includes(name));
  if (missing.length || head.some((name) => !name) || new Set(head).size !== head.length) {
    throw new Error(`Invalid FIRMS header in ${file}: missing columns [${missing.join(', ')}]; column names must be nonempty and unique`);
  }
  const ix = Object.fromEntries(Object.entries(COLUMNS).map(([key, name]) => [key, head.indexOf(name)]));
  const isModis = sensor === 'MODIS';
  for (let l = 1; l < lines.length; l++) {
    const line = lines[l].trim();
    if (!line || line.startsWith('#')) continue;
    const f = line.split(',').map((s) => s.trim());
    if (f.length !== head.length) { dropped++; continue; }
    const lat = csvNumber(f[ix.lat]);
    const lon = csvNumber(f[ix.lon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) { dropped++; continue; }
    const conf = f[ix.conf];
    // Same quality rule as build-data.mjs: finite MODIS confidence >= 30; VIIRS nominal/high only.
    if (isModis ? !Number.isFinite(csvNumber(conf)) || csvNumber(conf) < 30 : conf !== 'nominal' && conf !== 'high') { dropped++; continue; }
    const acq = f[ix.date];
    const midnight = Date.parse(`${acq}T00:00:00Z`);
    const time = f[ix.time].padStart(4, '0');
    const frp = csvNumber(f[ix.frp]);
    const dn = f[ix.dn];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(acq) || !Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== acq
      || !/^\d{1,4}$/.test(f[ix.time]) || !/^(?:[01]\d|2[0-3])[0-5]\d$/.test(time)
      || !Number.isFinite(frp) || frp < 0 || (dn !== 'D' && dn !== 'N')) { dropped++; continue; }
    rows++;
    dates.add(acq);
    const ci = countryIndex(lon, lat);
    if (ci < 0) { outside++; continue; }
    inland++;
    const st = byCountry.get(ci);
    st.total++;
    st.frp += frp;
    if (frp > st.frpMax) st.frpMax = frp;
    if (dn === 'D') st.day++; else st.night++;
    st.sensors[sensor] = (st.sensors[sensor] || 0) + 1;
    st.days[acq] = (st.days[acq] || 0) + 1;
    const daySensors = st.perDaySensors[acq] ||= {};
    daySensors[sensor] = (daySensors[sensor] || 0) + 1;
    st.perDayFrp[acq] = (st.perDayFrp[acq] || 0) + frp;
  }
  log(`tally: ${file} → ${sensor} (running rows ${rows})`);
}
log(`tally: ${rows} quality rows, ${inland} inside a country, ${outside} outside polygons/unassigned, ${dropped} dropped`);

/* ------------------------------------------------------------------- gazetteer */
const used = new Set();
for (const c of table) {
  const display = DISPLAY[c.name] || c.name;
  let id = slug(display);
  while (used.has(id)) id = `${id}-x`;
  used.add(id);
  c.id = id;
  c.display = display;
  c.aliases = ALIASES[display] || [];
}
const winStart = [...dates].sort()[0] || null;
const winEnd = [...dates].sort().pop() || null;
const gazetteer = table
  .map((c) => {
    const st = byCountry.get(table.indexOf(c));
    return {
      id: c.id,
      name: c.display,
      src: c.name === c.display ? undefined : c.name,
      aliases: c.aliases,
      center: c.center,
      bbox: c.bbox.map((v) => Number(v.toFixed(3))),
      areaKm2: c.areaKm2,
      rasterKm2: Math.round(c.rasterKm2),
      detections: st ? st.total : 0,
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const fires = {
  meta: {
    schema_version: 2,
    source: 'NASA FIRMS Global 7-day CSVs (data_raw) attributed by point-in-polygon to Natural Earth 50m country polygons',
    projection_note: `country polygons at 50m; ${CELL_DEG}° grid used only for a fast positive candidate, with exact polygon fallback; unmatched rows are outside polygons/unassigned`,
    window: { start: [...dates].sort()[0] || null, end: [...dates].sort().pop() || null },
    rows_read: rows,
    rows_dropped: dropped,
    rows_in_countries: inland,
    rows_outside: outside,
    coverage_pct: Number(((inland / Math.max(1, rows)) * 100).toFixed(2)),
    countries_with_detections: [...byCountry.values()].filter((st) => st.total > 0).length,
    countries_total: gazetteer.length,
    built_at: new Date().toISOString(),
  },
  days: [...dates].sort(),
  countries: table
    .map((c) => {
      const st = byCountry.get(table.indexOf(c));
      if (!st) return null;
      return {
        id: c.id,
        name: c.display,
        total: st.total,
        perDay: st.days,
        perDaySensors: st.perDaySensors,
        perDayFrp: st.perDayFrp,
        sensors: st.sensors,
        day: st.day,
        night: st.night,
        frpMean: Number((st.frp / st.total).toFixed(2)),
        frpMax: Number(st.frpMax.toFixed(2)),
        per10kKm2: Number(((st.total / Math.max(1, c.areaKm2)) * 10000).toFixed(1)),
        areaKm2: c.areaKm2,
        windowStart: winStart,
        windowEnd: winEnd,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.total - a.total),
};

/** Reverse-lookup spot checks: 20 inland coordinates with unambiguous answers, measured the same
 *  way a click will be measured. Coastal points are deliberately avoided here — 50m shorelines are
 *  simplified, so a harbour coordinate can fall in the water; the browser layer resolves those by
 *  nearest claimed cell and labels them "near <country>". A failure here stops the build. */
const SPOT = [
  [-23.55, -46.63, 'brazil'], [28.61, 77.21, 'india'], [35.36, 138.73, 'japan'], [-1.29, 36.82, 'kenya'],
  [-35.28, 149.13, 'australia'], [55.75, 37.62, 'russia'], [-31.42, -64.18, 'argentina'], [19.43, -99.13, 'mexico'],
  [48.86, 2.35, 'france'], [51.5, -0.13, 'united-kingdom'], [-26.2, 28.05, 'south-africa'], [39.93, 32.85, 'turkey'],
  [9.08, 8.02, 'nigeria'], [30.04, 31.24, 'egypt'], [-7.0, 110.0, 'indonesia'], [13.75, 100.5, 'thailand'],
  [45.46, 9.19, 'italy'], [-29.0, 25.0, 'south-africa'], [50.69, -119.66, 'canada'], [24.2, 55.65, 'united-arab-emirates'],
];
const failed = [];
for (const [lat, lon, want] of SPOT) {
  const ci = grid[cellIndex(lon, lat)];
  const got = ci >= 0 && inCountry(lon, lat, table[ci]) ? table[ci].id : null;
  if (got !== want) failed.push(`${lat},${lon} expected ${want} got ${got ?? 'ocean'}`);
}
if (failed.length) {
  console.error(`countries: reverse-lookup spot check FAILED\n  ${failed.join('\n  ')}`);
  process.exit(2);
}
log(`countries: ${SPOT.length}/${SPOT.length} reverse-lookup spot checks pass`);

fs.writeFileSync(path.join(DATA, 'countries.json'), JSON.stringify({ meta: { schema_version: 1, built_at: fires.meta.built_at, count: gazetteer.length, cell_deg: CELL_DEG, source: 'Natural Earth 50m via world-atlas' }, countries: gazetteer }) + '\n');
fs.writeFileSync(path.join(DATA, 'country_fires.json'), JSON.stringify(fires) + '\n');
log(`write: public/data/countries.json ${(fs.statSync(path.join(DATA, 'countries.json')).size / 1024).toFixed(0)} kB`);
log(`write: public/data/country_fires.json ${(fs.statSync(path.join(DATA, 'country_fires.json')).size / 1024).toFixed(0)} kB`);
log(`top 8: ${fires.countries.slice(0, 8).map((c) => `${c.name} ${c.total}`).join(' | ')}`);
log(`done in ${Date.now() - t0} ms`);
