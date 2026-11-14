/**
 * Refresh the live window: pull the four official NASA FIRMS 7-day rolling CSVs into data_raw,
 * exactly the files scripts/build-data.mjs reads.
 *
 *   node scripts/fetch-live.mjs
 *   FIRMS_MAP_KEY=… node scripts/fetch-live.mjs   # keyed route, used only if the open one is refused
 *
 * These are near-real-time MODIS/VIIRS detections straight from the source that produced the live
 * rows in the bundle, so the app's LIVE window can be advanced without a human in the loop. The
 * key is never written to disk, never logged, and never needed unless FIRMS refuses the open route.
 *
 * A download that does not parse is discarded and leaves the previous file in place: a half-written
 * rolling CSV would silently shrink the live window, which is worse than a stale one.
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data_raw');

// `.env` is not loaded by Node. Fill missing names from the repo-root file so
// `npm run live` sees FIRMS_MAP_KEY without a manual export. A value already
// in the process environment wins, and the key is never logged.
function loadDotEnv(root) {
  let text;
  try {
    text = fs.readFileSync(path.join(root, '.env'), 'utf8');
  } catch {
    return;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[name] == null || process.env[name] === '') process.env[name] = value;
  }
}
loadDotEnv(ROOT);

// Same files, same order, same sensor ids build-data.mjs declares.
const SOURCES = [
  { file: 'MODIS_C6_1_Global_7d.csv', label: 'MODIS C6.1 Terra+Aqua', url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_7d.csv' },
  { file: 'SUOMI_VIIRS_C2_Global_7d.csv', label: 'VIIRS S-NPP C2', url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_7d.csv' },
  { file: 'J1_VIIRS_C2_Global_7d.csv', label: 'VIIRS NOAA-20 C2', url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_7d.csv' },
  { file: 'J2_VIIRS_C2_Global_7d.csv', label: 'VIIRS NOAA-21 C2', url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_7d.csv' },
];

const KEY = (process.env.FIRMS_MAP_KEY || process.env.MAP_KEY || '').trim();

function mib(b) {
  return Number((b / 1024 / 1024).toFixed(1));
}

let lastPrint = 0;

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https
      .get(url, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 4) {
          res.resume();
          return resolve(get(new URL(res.headers.location, url).href, redirects + 1));
        }
        const total = Number(res.headers['content-length'] || 0);
        let received = 0;
        const chunks = [];
        const label = path.basename(new URL(url).pathname);
        res.on('data', (c) => {
          chunks.push(c);
          received += c.length;
          const now = Date.now();
          if (total > 0 && now - lastPrint > 1000) {
            const pct = Math.round((received / total) * 100);
            process.stdout.write(`\rDownloading ${label}: ${mib(received)} MB / ${mib(total)} MB (${pct}%)`);
            lastPrint = now;
          }
        });
        res.on('error', reject);
        res.on('end', () => {
          if (total > 0) {
            const pct = Math.round((received / total) * 100);
            process.stdout.write(`\rDownloading ${label}: ${mib(received)} MB / ${mib(total)} MB (${pct}%) complete\n`);
          }
          resolve({ status: res.statusCode, body: Buffer.concat(chunks) });
        });
      })
      .on('error', reject);
    req.setTimeout(300000, () => req.destroy(new Error('read timed out')));
  });
}

/** A 30 MB rolling CSV gets its socket reset now and then. That is a retryable transport answer,
 *  not a dead feed, and it must not take the other three files down with it — so errors come back
 *  as a status the caller already handles instead of an uncaught rejection. */
async function getWithRetry(url, attempts = 3) {
  let last = 'unreachable';
  for (let i = 1; i <= attempts; i++) {
    try {
      return await get(url);
    } catch (err) {
      last = err.message;
      if (i < attempts) {
        console.log(`  retrying after ${last} (attempt ${i + 1}/${attempts})`);
        await new Promise((r) => setTimeout(r, 5000 * i));
      }
    }
  }
  return { status: 0, body: Buffer.alloc(0), networkError: last };
}

/** Rows and the acquisition-date span, read from the header rather than a fixed column index —
 *  the keyed Area API interleaves an `instrument` column and the download page does not. */
function inspect(text) {
  const nl = text.indexOf('\n');
  if (nl < 0) return null;
  const cols = text.slice(0, nl).replace(/\r/g, '').split(',');
  const iDate = cols.indexOf('acq_date');
  if (iDate < 0 || !cols.includes('latitude') || !cols.includes('confidence')) return null;
  let rows = 0;
  let min = '9999-99-99';
  let max = '0000-00-00';
  for (let i = nl + 1; i < text.length; i++) {
    if (text[i] === '\n') rows++;
  }
  for (const line of text.split('\n')) {
    const c = line.split(',');
    const d = c[iDate];
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { rows: rows - 1, from: min, to: max, header: cols.join(',') };
}

const results = [];
let failures = 0;

for (const s of SOURCES) {
  const dest = path.join(RAW, s.file);
  let res = await getWithRetry(s.url);
  let keyed = false;
  if (res.status !== 200 && KEY) {
    keyed = true;
    res = await getWithRetry(`${s.url}?map_key=${KEY}`);
  }
  if (res.status !== 200) {
    failures++;
    console.log(`FAIL  ${s.file} — ${res.networkError ? `network: ${res.networkError}` : `HTTP ${res.status}${keyed ? ' (keyed)' : ''}`}; previous file kept`);
    continue;
  }
  const text = res.body.toString('utf8');
  const info = inspect(text);
  const expectedRows = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8').split('\n').length - 1 : 0;
  if (!info || info.rows < 1000 || !/^\d{4}-\d{2}-\d{2}$/.test(info.to)) {
    failures++;
    console.log(`FAIL  ${s.file} — does not parse (${info ? `${info.rows} rows` : 'bad header'}); previous file kept`);
    continue;
  }
  // A rolling 7-day feed that collapses to a fraction of the last pull means FIRMS served a partial
  // file; keep the older, wider one and let the operator look.
  if (expectedRows > 5000 && info.rows < expectedRows * 0.5) {
    failures++;
    console.log(`FAIL  ${s.file} — ${info.rows} rows is under half of the ${expectedRows} on disk; previous file kept`);
    continue;
  }
  const tmp = `${dest}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, dest);
  console.log(`PASS  ${s.file} — ${info.rows.toLocaleString()} detections ${info.from}..${info.to}${keyed ? ' via keyed route' : ''}`);
  results.push({ file: s.file, label: s.label, ...info });
}

console.log(`\nfetch-live: ${results.length}/${SOURCES.length} rolling feeds refreshed`);
if (results.length) {
  const from = results.map((r) => r.from).sort()[0];
  const to = results.map((r) => r.to).sort().pop();
  console.log(`window ${from} .. ${to} — run npm run data to rebuild the bundle from it`);
}
process.exit(failures ? 1 : 0);
