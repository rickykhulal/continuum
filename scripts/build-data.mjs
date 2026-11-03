#!/usr/bin/env node
/**
 * Builds the immutable live-data snapshot served by Continuum.
 *
 * Input : data_raw/{MODIS_C6_1_Global_7d,SUOMI_VIIRS_C2_Global_7d,J1_VIIRS_C2_Global_7d,J2_VIIRS_C2_Global_7d}.csv
 *         (public NASA FIRMS rolling archives, no key required; downloaded on first run)
 * Output: public/data/live_fires.json   compact real detections
 *         public/data/snapshot.json     provenance, counts, per-sensor freshness
 *
 * The historical reference record is generated deterministically in the app
 * (src/lib/data.ts); this snapshot is the only live data source.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data_raw');
const OUT = path.join(ROOT, 'public', 'data');

const SENSORS = ['MODIS', 'VIIRS-SNPP', 'NOAA-20', 'NOAA-21'];
const FILES = [
  { file: 'MODIS_C6_1_Global_7d.csv', sensor: 0, kind: 'modis', url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_7d.csv' },
  { file: 'SUOMI_VIIRS_C2_Global_7d.csv', sensor: 1, kind: 'viirs', url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_7d.csv' },
  { file: 'J1_VIIRS_C2_Global_7d.csv', sensor: 2, kind: 'viirs', url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_7d.csv' },
  { file: 'J2_VIIRS_C2_Global_7d.csv', sensor: 3, kind: 'viirs', url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_7d.csv' },
];

/** Fetch the official NASA FIRMS rolling archive when no local copy is present,
 * or when FIRMS_REFRESH=1 forces a fresh pull. */
async function ensureCsv(spec) {
  const local = path.join(RAW, spec.file);
  const force = process.env.FIRMS_REFRESH === '1';
  if (!force && fs.existsSync(local)) return local;
  fs.mkdirSync(RAW, { recursive: true });
  const started = Date.now();
  const res = await fetch(spec.url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`FIRMS ${spec.file}: HTTP ${res.status}`);
  const text = await res.text();
  if (!/^\s*latitude\s*,/m.test(text.slice(0, 400))) throw new Error(`FIRMS ${spec.file}: unexpected payload`);
  fs.writeFileSync(local, text);
  console.log(`downloaded ${spec.file} (${(text.length / 1e6).toFixed(1)} MB, ${Date.now() - started} ms)`);
  return local;
}

const regions = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'regions.json'), 'utf8'));

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    // FIRMS fields never contain quoted commas, but tolerate a trailing partial line.
    const cells = line.split(',');
    if (cells.length < headers.length) continue;
    const row = {};
    for (let j = 0; j < headers.length; j++) row[headers[j]] = cells[j];
    rows.push(row);
  }
  return rows;
}

function epochSeconds(date, hhmm) {
  const t = String(hhmm || '0').padStart(4, '0');
  const hh = t.slice(0, 2);
  const mm = t.slice(2, 4);
  return Math.floor(Date.parse(`${date}T${hh}:${mm}:00Z`) / 1000);
}

function confidenceCode(kind, raw) {
  if (kind === 'viirs') {
    if (raw === 'high') return 2;
    if (raw === 'nominal') return 1;
    return 0;
  }
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 30) return 0;
  return v >= 80 ? 2 : 1;
}

function inBbox(lat, lon, bbox) {
  return lon >= bbox[0] && lat >= bbox[1] && lon <= bbox[2] && lat <= bbox[3];
}

const fires = [];
const counts = {};
const sensorMeta = {};
const regionDays = Object.fromEntries(regions.map((r) => [r.id, {}]));

for (const spec of FILES) {
  let p;
  try {
    p = await ensureCsv(spec);
  } catch (err) {
    console.warn(`[skip] ${spec.file}: ${err.message}`);
    continue;
  }
  const rows = parseCsv(fs.readFileSync(p, 'utf8'));
  const sensorName = SENSORS[spec.sensor];
  let kept = 0;
  let minDate = '9999-99-99';
  let maxDate = '0000-00-00';
  for (const row of rows) {
    const lat = Number(row.latitude);
    const lon = Number(row.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const conf = confidenceCode(spec.kind, row.confidence);
    if (conf === 0) continue;
    const frp = Number(row.frp);
    const t = epochSeconds(row.acq_date, row.acq_time);
    if (!Number.isFinite(t)) continue;
    const fire = [Number(lat.toFixed(4)), Number(lon.toFixed(4)), Number.isFinite(frp) ? Number(frp.toFixed(1)) : 0, spec.sensor, conf, t];
    fires.push({ f: fire, region: false });
    kept++;
    if (row.acq_date < minDate) minDate = row.acq_date;
    if (row.acq_date > maxDate) maxDate = row.acq_date;

    for (const region of regions) {
      if (!inBbox(lat, lon, region.bbox)) continue;
      const day = regionDays[region.id][row.acq_date] ||= {
        m: 0, v: 0, n: 0, n21: 0, frpm: 0, frpv: 0, frpn: 0, frpn21: 0, firstT: t, lastT: t,
      };
      const key = spec.sensor === 0 ? 'm' : spec.sensor === 1 ? 'v' : spec.sensor === 2 ? 'n' : 'n21';
      day[key] += 1;
      day[`frp${key}`] += Number.isFinite(frp) ? frp : 0;
      if (t < day.firstT) day.firstT = t;
      if (t > day.lastT) day.lastT = t;
    }
  }
  counts[sensorName] = kept;
  sensorMeta[sensorName] = { first: minDate, last: maxDate, count: kept };
  console.log(`${sensorName}: ${rows.length} rows -> ${kept} quality detections (${minDate}..${maxDate})`);
}

// Keep every detection inside a pilot region; keep a deterministic global
// subsample so the globe stays light but representative.
const regionFires = fires.filter((x) => regions.some((r) => inBbox(x.f[0], x.f[1], r.bbox)));
const globalFires = fires.filter((x) => !regions.some((r) => inBbox(x.f[0], x.f[1], r.bbox)));
const MAX_GLOBAL = 22000;
const stride = Math.max(1, Math.ceil(globalFires.length / MAX_GLOBAL));
const sampledGlobal = globalFires.filter((_, i) => i % stride === 0);
const all = [...regionFires.map((x) => x.f), ...sampledGlobal.map((x) => x.f)];
all.sort((a, b) => a[5] - b[5]);

const dates = all.map((f) => new Date(f[5] * 1000).toISOString().slice(0, 10)).sort();
const meta = {
  generatedAt: new Date().toISOString(),
  windowStart: dates[0] || null,
  windowEnd: dates[dates.length - 1] || null,
  sensors: SENSORS,
  sensorMeta,
  counts: {
    totalQuality: fires.length,
    kept: all.length,
    region: regionFires.length,
    globalSampled: sampledGlobal.length,
  },
  regionDays,
  sources: [
    { name: 'NASA FIRMS MODIS C6.1 (7-day rolling)', url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_7d.csv' },
    { name: 'NASA FIRMS VIIRS S-NPP C2 (7-day rolling)', url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_7d.csv' },
    { name: 'NASA FIRMS NOAA-20 VIIRS C2 (7-day rolling)', url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_7d.csv' },
    { name: 'NASA FIRMS NOAA-21 VIIRS C2 (7-day rolling)', url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_7d.csv' },
  ],
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'live_fires.json'), JSON.stringify({ meta, fires: all }));
fs.writeFileSync(path.join(OUT, 'snapshot.json'), JSON.stringify(meta, null, 2));
console.log(`wrote ${all.length} points (${regionFires.length} in pilot regions, ${sampledGlobal.length} global sample)`);
console.log(`snapshot: ${meta.windowStart} .. ${meta.windowEnd}`);
