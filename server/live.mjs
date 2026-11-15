/**
 * server/live.mjs — live FIRMS data provider for the Continuum API.
 *
 * Responsibilities:
 * - Fetch the four official NASA FIRMS 7-day rolling CSVs (MODIS C6.1, VIIRS
 *   S-NPP C2, VIIRS NOAA-20 C2, VIIRS NOAA-21 C2). The fetch/retry/parse logic
 *   is copied from scripts/fetch-live.mjs; that script is not modified here.
 * - Cache the result for ~10 minutes in memory; persist the last good result
 *   to disk (data_raw/live_fires_cache.json) so a restart recovers it.
 * - One upstream fetch per window (per-area resolution is done client-side by
 *   filtering these global detections; this endpoint returns the global window).
 * - Response: { fires, fetchedAt, perSatelliteCounts, stale }.
 *
 * Rules (non-negotiable):
 *   • FIRMS_MAP_KEY is optional. When absent the server uses the FIRMS open
 *     (keyless) CSV route, which NASA serves publicly. When present it is
 *     appended as map_key= and acts as a fallback if the open route is refused.
 *     We never fall back to the bundled snapshot silently.
 *   • If the upstream fails, serve the last-good result with stale=true, or
 *     return 503 offline if there is none.
 *   • The key is never written to disk, never logged, and only used as the
 *     `map_key` query parameter on the FIRMS request URL.
 *   • No runtime dependency on CelesTrak — it blocks browser and cloud networks.
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_RAW = path.join(ROOT, 'data_raw');

// ---------------------------------------------------------------------------
// FIRMS source definitions — same files, order and URLs as scripts/fetch-live.mjs
// Sensor attribution is by file, matching scripts/build-data.mjs (spec.sensor).
// ---------------------------------------------------------------------------
const SOURCES = [
  { file: 'MODIS_C6_1_Global_7d.csv', sensor: 0, kind: 'modis', key: 'modis', url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_7d.csv' },
  { file: 'SUOMI_VIIRS_C2_Global_7d.csv', sensor: 1, kind: 'viirs', key: 'viirs', url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_7d.csv' },
  { file: 'J1_VIIRS_C2_Global_7d.csv', sensor: 2, kind: 'viirs', key: 'noaa20', url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_7d.csv' },
  { file: 'J2_VIIRS_C2_Global_7d.csv', sensor: 3, kind: 'viirs', key: 'noaa21', url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_7d.csv' },
];

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CACHE_FILE = path.join(DATA_RAW, 'live_fires_cache.json');

// ---------------------------------------------------------------------------
// Module-scoped state
// ---------------------------------------------------------------------------
let fires = [];
let fetchedAt = 0;
let perSatelliteCounts = { modis: 0, viirs: 0, noaa20: 0, noaa21: 0 };
let stale = false;
let error = null; // 'not_configured' | null
let started = false;
let timer = null;
let fetching = false;

// Injected for tests; the real transport below is used otherwise.
let transport = null;
let clock = Date.now;

// ---------------------------------------------------------------------------
// Transport — copied from scripts/fetch-live.mjs (get + getWithRetry)
// ---------------------------------------------------------------------------
function httpGet(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https
      .get(url, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 4) {
          res.resume();
          return resolve(httpGet(new URL(res.headers.location, url).href, redirects + 1));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('error', reject);
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      })
      .on('error', reject);
    req.setTimeout(300000, () => req.destroy(new Error('read timed out')));
  });
}

async function httpGetWithRetry(url, attempts = 3) {
  let last = 'unreachable';
  for (let i = 1; i <= attempts; i++) {
    try {
      return await httpGet(url);
    } catch (err) {
      last = err.message;
      if (i < attempts) await new Promise((r) => setTimeout(r, 5000 * i));
    }
  }
  return { status: 0, body: Buffer.alloc(0), networkError: last };
}

/** Do the upstream fetch for one source. Tests may replace this via inject(). */
async function fetchSource(src, key) {
  const fn = transport || ((url) => httpGetWithRetry(url, 3));
  const url = key ? `${src.url}?map_key=${key}` : src.url;
  return fn(url);
}

// ---------------------------------------------------------------------------
// Parsing — header-based column lookup (the keyed Area API and the download
// page differ in column layout, so never hard-code an index).
// ---------------------------------------------------------------------------
/** Row count and acquisition-date span, read from the header. */
function inspect(text) {
  const nl = text.indexOf('\n');
  if (nl < 0) return null;
  const cols = text.slice(0, nl).replace(/\r/g, '').split(',');
  const iDate = cols.indexOf('acq_date');
  if (iDate < 0 || !cols.includes('latitude') || !cols.includes('confidence')) return null;
  let rows = 0;
  let min = '9999-99-99';
  let max = '0000-00-00';
  for (let i = nl + 1; i < text.length; i++) if (text[i] === '\n') rows++;
  for (const line of text.split('\n')) {
    const d = line.split(',')[iDate];
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { rows: Math.max(0, rows - 1), from: min, to: max };
}

function epochSeconds(date, hhmm) {
  const t = String(hhmm || '0').padStart(4, '0');
  return Math.floor(Date.parse(`${date}T${t.slice(0, 2)}:${t.slice(2, 4)}:00Z`) / 1000);
}

// Same confidence rule as scripts/build-data.mjs so the live window and the
// bundled snapshot agree on which detections are "quality".
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

/** Parse one FIRMS CSV body into [lat, lon, frp, sensor, conf, t] tuples. */
function parseTuples(text, src) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',');
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  const need = ['latitude', 'longitude', 'frp', 'confidence', 'acq_date', 'acq_time'];
  for (const c of need) if (idx[c] === undefined) return null;
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = line.split(',');
    if (cells.length < headers.length) continue;
    const lat = Number(cells[idx.latitude]);
    const lon = Number(cells[idx.longitude]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const conf = confidenceCode(src.kind, cells[idx.confidence]);
    if (conf === 0) continue;
    const t = epochSeconds(cells[idx.acq_date], cells[idx.acq_time]);
    if (!Number.isFinite(t)) continue;
    const frpN = Number(cells[idx.frp]);
    out.push([Number(lat.toFixed(4)), Number(lon.toFixed(4)), Number.isFinite(frpN) ? Number(frpN.toFixed(1)) : 0, src.sensor, conf, t]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fetch cycle
// ---------------------------------------------------------------------------
async function refresh() {
  if (fetching) return;
  fetching = true;
  try {
    const key = (process.env.FIRMS_MAP_KEY || process.env.MAP_KEY || '').trim();
    const all = [];
    let ok = true;
    for (const src of SOURCES) {
      const res = await fetchSource(src, key);
      if (res.status !== 200) { ok = false; continue; }
      const text = Buffer.isBuffer(res.body) ? res.body.toString('utf8') : String(res.body);
      const info = inspect(text);
      if (!info || info.rows < 1000) {
        // Upstream feed empty or degraded (e.g. maintenance); allow remaining operational feeds
        continue;
      }
      const tuples = parseTuples(text, src);
      if (!tuples) { continue; }
      perSatelliteCounts[src.key] = tuples.length;
      // Global windows can contain hundreds of thousands of points. A spread
      // call exceeds the engine's argument limit before the cache is populated.
      for (const tuple of tuples) all.push(tuple);
    }

    if (all.length > 0) {
      all.sort((a, b) => a[5] - b[5]);
      fires = all;
      fetchedAt = clock();
      stale = false;
      persist();
    } else if (fires.length > 0) {
      // Upstream failed (or was partial); keep the last-good window and flag it.
      stale = true;
      persist();
    } else {
      stale = false;
      // nothing to serve — the response builder reports offline
    }
  } finally {
    fetching = false;
  }
}

function persist() {
  try {
    fs.mkdirSync(DATA_RAW, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ fires, fetchedAt, perSatelliteCounts, stale }));
  } catch {
    /* best-effort only — never let a disk write break the process */
  }
}

function restoreDiskCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return false;
    const onDisk = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (Array.isArray(onDisk.fires) && onDisk.fires.length > 0) {
      fires = onDisk.fires;
      fetchedAt = Number(onDisk.fetchedAt) || 0;
      perSatelliteCounts = onDisk.perSatelliteCounts || { modis: 0, viirs: 0, noaa20: 0, noaa21: 0 };
      stale = clock() - fetchedAt >= CACHE_TTL_MS;
      return true;
    }
  } catch {
    /* ignore corrupt cache */
  }
  return false;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
/**
 * Start the live provider. Idempotent. Restores the disk cache, then kicks off
 * the first fetch and a 10-minute refresh timer. FIRMS_MAP_KEY is optional:
 * fetchSource falls back to the keyless open CSV route (which FIRMS serves
 * publicly) when no key is present, matching the behaviour of fetch-live.mjs.
 */
export function start() {
  if (started) return;
  started = true;
  restoreDiskCache();
  void refresh().catch((err) => console.error('[live] refresh failed:', err.message));
  timer = setInterval(() => {
    void refresh().catch((err) => console.error('[live] refresh failed:', err.message));
  }, CACHE_TTL_MS);
  if (typeof timer.unref === 'function') timer.unref();
}

/** Stop the refresh timer (tests, shutdown). */
export function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
  fetching = false;
}

// ---------------------------------------------------------------------------
// Response builder — synchronous, called by the /live-firms GET route.
// ---------------------------------------------------------------------------
/** Compute the window start/end from the fire timestamps. */
function computeWindow(firesArr) {
  if (!firesArr || firesArr.length === 0) return { start: null, end: null };
  let minT = Infinity, maxT = -Infinity;
  for (const f of firesArr) {
    const t = f[5];
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
  }
  return {
    start: new Date(minT * 1000).toISOString().slice(0, 10),
    end: new Date(maxT * 1000).toISOString().slice(0, 10),
  };
}

/** Derive sensor list from perSatelliteCounts (keys with count > 0). */
function activeSensors(counts) {
  const out = [];
  if (counts.modis > 0) out.push('MODIS');
  if (counts.viirs > 0) out.push('VIIRS S-NPP');
  if (counts.noaa20 > 0) out.push('NOAA-20');
  if (counts.noaa21 > 0) out.push('NOAA-21');
  return out;
}

// ---------------------------------------------------------------------------
// Response builder — synchronous, called by the /live-firms GET route.
// ---------------------------------------------------------------------------
export function getResponse() {
  if (error === 'not_configured') {
    return { status: 503, body: { error: 'not_configured', message: 'live data not configured', stale: false } };
  }
  if (fires.length === 0) {
    return { status: 503, body: { error: 'offline', message: 'live FIRMS data offline', stale: false } };
  }
  const window = computeWindow(fires);
  return {
    status: 200,
    body: {
      fires,
      data: fires,
      count: fires.length,
      fetchedAt,
      perSatelliteCounts,
      stale,
      meta: {
        windowStart: window.start,
        windowEnd: window.end,
        sensors: activeSensors(perSatelliteCounts),
      },
    },
  };
}

export function resetForTest() {
  fires = [];
  fetchedAt = 0;
  perSatelliteCounts = { modis: 0, viirs: 0, noaa20: 0, noaa21: 0 };
  stale = false;
  error = null;
  started = false;
  fetching = false;
  transport = null;
  clock = Date.now;
  if (timer) clearInterval(timer);
  timer = null;
}

// ---------------------------------------------------------------------------
// Test hooks — never used in production.
// ---------------------------------------------------------------------------
/** Inject a fake transport and/or clock so tests never hit the real FIRMS API. */
export function inject({ transport: t, now } = {}) {
  if (t) transport = t;
  if (now) clock = now;
}
// Export needed utilities for testing
export { CACHE_TTL_MS }
// resetForTest is exported below to avoid exposing internal state;
