#!/usr/bin/env node
/**
 * Backfill the real FIRMS archive through the keyed Area API.
 *
 *   FIRMS_MAP_KEY=... node scripts/backfill-archive.mjs
 *   node scripts/backfill-archive.mjs --lanes=6 --max-windows=40   (dry run)
 *
 * Input : https://firms.modaps.eosdis.nasa.gov/api/area/csv/{KEY}/{SOURCE}/{bbox}/5/{DATE}
 *         — 5 days per request, the documented maximum window.
 * Output: public/data/archive_daily.json — per region, per day, per spacecraft:
 *         detection counts and FRP sums. Raw point rows are aggregated in memory and
 *         never written to disk, so the shipped artefact stays small and the repository
 *         never contains a detection file.
 *
 * The MAP KEY is read from the environment, or from ~/.continuum/firms_map_key when the
 * environment is empty. It is never written to the output, the log, or the repository.
 *
 * Resume: data_raw/firms_archive/state.json keeps one sequential cursor per
 * (source, region) lane plus the list of permanently failed windows.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data_raw', 'firms_archive');
/**
 * `--out=` writes observations somewhere other than the published bundle. A backfill that lands
 * in public/data keeps rewriting the file the build and the regression fixtures read, so the
 * bundle hash drifts mid-verification and no chain can be called green at a named bundle. Stage
 * with --out=data_raw/firms_archive/archive_staging.json, promote only once the lanes are done.
 */
const OUT = argOut() ? path.resolve(ROOT, argOut()) : path.join(ROOT, 'public', 'data', 'archive_daily.json');
function argOut() {
  const hit = process.argv.find((a) => a.startsWith('--out='));
  return hit ? hit.split('=')[1] : '';
}
// One cursor per output, so a staged rebuild never resumes against a published bundle's coverage.
const STATE = path.join(RAW, `state${OUT.includes(path.join('public', 'data')) ? '' : '-' + path.basename(OUT, '.json')}.json`);
const BASE = 'https://firms.modaps.eosdis.nasa.gov';
const DAY = 86400000;
const START = '2000-11-01';

function readKey() {
  const fromEnv = process.env.FIRMS_MAP_KEY || process.env.MAP_KEY || '';
  if (fromEnv.trim()) return fromEnv.trim();
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const file = path.join(home, '.continuum', 'firms_map_key');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  return '';
}

const KEY = readKey();
if (!KEY) {
  console.error('backfill: no FIRMS_MAP_KEY in the environment and no ~/.continuum/firms_map_key — aborting.');
  process.exit(2);
}

/**
 * One writer per output. aggregate() increments day cells that rehydrate() already loaded from
 * the file, so two processes on the same output both double-count what the other fetched and
 * lose what the other fetched after their own load — the cursor then claims windows whose rows
 * are gone, and a lost window silently becomes an observed zero. A stale lock from a dead
 * process is taken over.
 */
const LOCK = `${OUT}.lock`;
if (fs.existsSync(LOCK)) {
  const owner = Number(fs.readFileSync(LOCK, 'utf8'));
  let alive = false;
  if (owner && owner !== process.pid) {
    try { process.kill(owner, 0); alive = true; } catch { alive = false; }
  }
  if (alive) {
    console.error(`backfill: PID ${owner} already writes ${path.relative(ROOT, OUT)} — refusing to race it.`);
    process.exit(3);
  }
  console.log(`[lock] replacing stale lock from dead PID ${owner}`);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(LOCK, String(process.pid));
const releaseLock = () => { try { if (Number(fs.readFileSync(LOCK, 'utf8')) === process.pid) fs.unlinkSync(LOCK); } catch {} };
process.on('exit', releaseLock);

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : dflt;
};
const LANES = Math.max(1, Number(arg('lanes', '6')));
const MAX_WINDOWS = Number(arg('max-windows', '0'));
const FLUSH_EVERY = Math.max(10, Number(arg('flush', '60')));
// FIRMS disables a MAP key that is used at full speed: ~490 archive requests in three
// minutes was enough to trip it. The cap is deliberate, not cautious — the key is the
// only route to real historical counts, so it must survive the whole backfill.
const RATE_PER_MIN = Math.max(1, Number(arg('rate', '60')));
const HEAL = process.argv.includes('--heal');

const gate = { stamps: [], cooledUntil: 0 };
async function acquire() {
  for (;;) {
    const now = Date.now();
    if (gate.cooledUntil > now) {
      await new Promise((r) => setTimeout(r, Math.min(10_000, gate.cooledUntil - now)));
      continue;
    }
    gate.stamps = gate.stamps.filter((t) => now - t < 60_000);
    if (gate.stamps.length < RATE_PER_MIN) {
      gate.stamps.push(now);
      return;
    }
    await new Promise((r) => setTimeout(r, gate.stamps[0] + 60_000 - now + 50));
  }
}

/** Close the door on every lane at once. FIRMS answers an over-queried key with
 *  "Invalid MAP_KEY", which is temporary — cooling the shared gate is what keeps a
 *  throttle from being mistaken for a disabled key. */
function coolDown(seconds) {
  gate.cooledUntil = Math.max(gate.cooledUntil, Date.now() + seconds * 1000);
}

/**
 * The Area API charges one transaction per day of a multi-day window, not per HTTP call, so a
 * 60-request/min loop of 5-day windows can consume the documented 5,000-per-10-minute budget.
 * Once that happens the CSV endpoint answers "Invalid MAP_KEY" — the same string it returns for a
 * revoked key — and the auth handler below would stop the run after eight tries. Ask the official
 * status endpoint first and wait for the window to roll instead of treating a spent budget as a
 * dead key. The counter is authoritative; nothing here guesses at a per-request cost.
 */
const STATUS_URL = `${BASE}/mapserver/mapkey_status/?MAP_KEY=${KEY}`;
async function transactionStatus() {
  try {
    const res = await fetch(STATUS_URL, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const j = await res.json();
    const used = Number(j.current_transactions);
    const limit = Number(j.transaction_limit);
    if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return null;
    return { used, limit };
  } catch {
    return null;
  }
}
/** Block until the rolling window has room. A status call that fails returns null and leaves the
 *  decision to the data request, so a status outage never wedges the backfill. */
async function waitForBudget() {
  for (let i = 0; i < 30 && !stopped; i++) {
    const st = await transactionStatus();
    if (!st || st.used < st.limit * 0.85) return st;
    console.log(`[budget] ${st.used}/${st.limit} transactions used in the current 10-minute window — waiting 60s`);
    await new Promise((r) => setTimeout(r, 60000));
  }
}

/** Priority order: the harmonised unit first, then the MODIS baseline, then the other
 *  VIIRS spacecraft, then the near-real-time tail that closes the gap between the
 *  standard-processing products (which lag ~5 months) and the live 7-day window. */
const SOURCES = [
  { id: 'VIIRS_SNPP_SP', sensor: 'v', min: '2012-01-20', max: '2026-07-31' },
  { id: 'MODIS_SP', sensor: 'm', min: '2000-11-01', max: '2026-08-31' },
  { id: 'VIIRS_NOAA20_SP', sensor: 'n', min: '2018-04-01', max: '2026-07-31' },
  { id: 'VIIRS_NOAA21_SP', sensor: 'n21', min: '2023-03-01', max: '2026-07-31' },
  { id: 'VIIRS_SNPP_NRT', sensor: 'v', min: '2026-08-01', max: '2026-11-02' },
  { id: 'MODIS_NRT', sensor: 'm', min: '2026-09-01', max: '2026-11-02' },
  { id: 'VIIRS_NOAA20_NRT', sensor: 'n', min: '2026-08-01', max: '2026-11-02' },
  { id: 'VIIRS_NOAA21_NRT', sensor: 'n21', min: '2026-08-01', max: '2026-11-02' },
];

const regions = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'regions.json'), 'utf8'));

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayIndex = (date) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${START}T00:00:00Z`)) / DAY);

/** Every 5-day window that touches [min, max], as request dates. */
function windows(min, max) {
  const out = [];
  for (let t = Date.parse(`${min}T00:00:00Z`); t <= Date.parse(`${max}T00:00:00Z`); t += 5 * DAY) {
    out.push(iso(t));
    if (out.length > 4000) break;
  }
  return out;
}

/** FIRMS writes the same column name with different vocabularies per product line.
 *  NRT and SP both report confidence, but SP VIIRS uses the short codes. */
function keepRow(kind, confidence) {
  if (kind === 'm') {
    const v = Number(confidence);
    if (!Number.isFinite(v)) return false;
    return v >= 30;
  }
  const c = String(confidence || '').toLowerCase();
  return c === 'h' || c === 'high' || c === 'n' || c === 'nominal';
}

function aggregate(text, kind, bbox, acc) {
  const lines = text.split('\n');
  if (lines.length < 2) return 0;
  const headers = lines[0].replace(/\r/g, '').split(',');
  const at = Object.create(null);
  headers.forEach((h, i) => (at[h] = i));
  const iLat = at.latitude, iLon = at.longitude, iDate = at.acq_date, iFrp = at.frp, iConf = at.confidence;
  if (iDate === undefined || iLat === undefined) return 0;
  let used = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line === '\r') continue;
    const c = line.split(',');
    if (c.length <= iDate) continue;
    const lat = Number(c[iLat]);
    const lon = Number(c[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lon < bbox[0] || lon > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
    if (iConf !== undefined && !keepRow(kind, c[iConf])) continue;
    const day = dayIndex(c[iDate].replace(/\r/g, ''));
    if (!Number.isFinite(day) || day < 0) continue;
    let cell = acc.get(day);
    if (!cell) { cell = { n: 0, frp: 0 }; acc.set(day, cell); }
    cell.n++;
    const frp = iFrp === undefined ? NaN : Number(c[iFrp]);
    if (Number.isFinite(frp) && frp > 0) cell.frp += frp;
    used++;
  }
  return used;
}

const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { lanes: {}, rows: 0, requests: 0 };
/** observations[regionId][sensor] = Map<dayIndex, {n, frp}> */
const observations = new Map(regions.map((r) => [r.id, new Map(SOURCES.map((s) => [s.sensor, new Map()]))]));

function mergeRanges(spans) {
  const sp = spans.filter((s) => s[0] >= 0).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const s of sp) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1] + 1) {
      last[1] = Math.max(last[1], s[1]);
      last[2] = Math.min(last[2], s[2]);
    } else out.push([s[0], s[1], s[2]]);
  }
  return out;
}

/** Coverage is derived from the lane cursors, never from the rows: a day the product has
 *  not published yet and an observed zero must stay distinguishable in the record.
 *  kind 0 = standard processing, 1 = near real time. */
function coverageFor(regionId, sensor) {
  const spans = [];
  for (const s of SOURCES) {
    if (s.sensor !== sensor) continue;
    const lane = state.lanes[`${s.id}|${regionId}`];
    if (!lane) continue;
    const kind = s.id.endsWith('_NRT') ? 1 : 0;
    const wins = windows(s.min, s.max);
    const failed = new Set(lane.failed || []);
    for (let i = 0; i < lane.done && i < wins.length; i++) {
      const start = wins[i];
      if (failed.has(start)) continue;
      const end = iso(Math.min(Date.parse(`${start}T00:00:00Z`) + 4 * DAY, Date.parse(`${s.max}T00:00:00Z`)));
      spans.push([dayIndex(start), dayIndex(end), kind]);
    }
  }
  return mergeRanges(spans);
}

function rehydrate(regionId, sensor, rows) {
  const cell = observations.get(regionId).get(sensor);
  for (const [day, n, frp] of rows || []) cell.set(day, { n, frp });
}

if (fs.existsSync(OUT)) {
  try {
    const prior = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    for (const [rid, block] of Object.entries(prior.regions || {})) {
      for (const [sensor, rows] of Object.entries(block.days || {})) rehydrate(rid, sensor, rows);
    }
  } catch {
    console.warn('[warn] existing archive_daily.json did not parse — starting observations fresh');
  }
}

function serialize() {
  const out = {
    schema: 'continuum-archive-1',
    generated_at: new Date().toISOString(),
    start: START,
    method: 'NASA FIRMS Area API (keyed), 5-day windows, Standard Processing + near-real-time tail',
    sources: SOURCES.map((s) => ({ id: s.id, sensor: s.sensor, min: s.min, max: s.max })),
    requests: state.requests,
    rows: state.rows,
    regions: {},
  };
  for (const r of regions) {
    const perSensor = {};
    const covered = {};
    for (const [sensor, cell] of observations.get(r.id)) {
      const ranges = coverageFor(r.id, sensor);
      if (ranges.length) covered[sensor] = ranges;
      if (!cell.size) continue;
      const days = [...cell.keys()].sort((a, b) => a - b);
      perSensor[sensor] = days.map((d) => [d, cell.get(d).n, Math.round(cell.get(d).frp * 10) / 10]);
    }
    out.regions[r.id] = { days: perSensor, covered };
  }
  return out;
}

let flushCount = 0;
function flush(force = false) {
  flushCount++;
  if (!force && flushCount < FLUSH_EVERY) return;
  flushCount = 0;
  fs.mkdirSync(RAW, { recursive: true });
  const tmp = `${OUT}.tmp`;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(serialize()));
  fs.renameSync(tmp, OUT);
  fs.writeFileSync(STATE, JSON.stringify(state));
}

/**
 * Lane order decides what the product gets first. A source-major queue put seven VIIRS-SNPP lanes
 * (over 7,000 windows) in front of every MODIS lane, so the record could not measure the 2012
 * instrument break on real data or derive k from real overlap days until hours later. Round-robin
 * across sensors advances every platform together, and the Standard Processing lanes go first:
 * the historical series reads SP, and the NRT tail already arrives through the rolling 7-day CSVs.
 */
const lanesBySource = [];
for (const s of SOURCES) {
  const list = [];
  for (const r of regions) {
    const key = `${s.id}|${r.id}`;
    const wins = windows(s.min, s.max);
    const lane = state.lanes[key] || (state.lanes[key] = { done: 0, failed: [], rows: 0 });
    if (process.argv.includes('--reset-failed')) lane.failed = [];
    if (lane.done >= wins.length) continue;
    list.push({ source: s, region: r, wins, lane, key });
  }
  if (list.length) lanesBySource.push(list);
}

const queue = [];
for (const group of [lanesBySource.filter((l) => l[0].source.id.endsWith('_NRT')), lanesBySource.filter((l) => !l[0].source.id.endsWith('_NRT'))]) {
  // Least-covered lane first. The previous region-order round-robin kept handing windows to the
  // three busy areas for hours before a fourth area got one, so Amazon, Nepal and Southeast
  // Australia sat at zero archive days while Chilecito and Pantanal were already finished.
  // Completion fraction puts an area's first lane on the wire when the queue reaches it, and every
  // sensor still advances because all of a new area's SP lanes start near zero.
  //
  // The near-real-time tail now runs first. Standard processing ends 2026-07-31 (VIIRS) and
  // 2026-08-31 (MODIS), and the rolling 7-day CSVs only cover the last week, so ~87 days at the
  // recent end of every area stayed modelled — the block a reader looks at first when asking
  // whether the record is current. The NRT tail is 89 windows per area against thousands for a
  // fresh SP lane, so it closes that gap in minutes; SP depth resumes once it is done.
  const items = group.flat();
  items.sort((a, b) =>
    a.lane.done / a.wins.length - b.lane.done / b.wins.length ||
    SOURCES.indexOf(a.source) - SOURCES.indexOf(b.source) ||
    regions.indexOf(a.region) - regions.indexOf(b.region));
  queue.push(...items);
}

let launched = 0;
let stopped = false;

/** A detached Windows process can't be signalled from bash, so the writer watches this file
 *  between windows. Stopping here — never mid-request — keeps the cursor and the aggregated
 *  cells flushed by the same write, which is the invariant `archive:promote` checks. */
const STOP_FILE = path.join(RAW, 'STOP');

/** Consecutive key rejections across every lane. FIRMS answers an over-queried key with
 *  "Invalid MAP_KEY" and releases it again within minutes, so one rejection cools the
 *  shared gate and retries the same window instead of ending the run. Only a streak ends
 *  it, and never with the cursor advanced — a throttle must not become a data gap. */
let authStreak = 0;
const AUTH_GIVE_UP = 8;
const THROTTLE_GIVE_UP = 6;
// A saturated budget is not a revocation, but it must not loop forever either: after this many
// consecutive budget waits the pass stops cleanly and stays resumable, cursor untouched.
let budgetWaits = 0;
const BUDGET_GIVE_UP = 20;
let sinceBudgetCheck = 0;
// FIRMS answers an over-queried key with HTTP 400 "Exceeding allowed transaction limit".
// That is a rate answer, not an observation: recording it as a failed window would freeze a
// hole into the coverage ranges and later print it as "no fires". Wait and retry instead.
const THROTTLE_RE = /exceeding allowed transaction limit|too many requests|rate.?limit/i;
let throttleStreak = 0;

async function fetchWindow(source, region, date) {
  const url = `${BASE}/api/area/csv/${KEY}/${source.id}/${region.bbox.join(',')}/5/${date}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    if (++sinceBudgetCheck >= 100) {
      sinceBudgetCheck = 0;
      await waitForBudget();
      if (stopped) return { stop: true };
    }
    await acquire();
    if (stopped) return { stop: true };
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
      const body = await res.text();
      if (res.ok) {
        authStreak = 0;
        throttleStreak = 0;
        budgetWaits = 0;
        // A key that closes and then answers again was throttled, not revoked. Count the
        // survived pauses so the record states the outage happened and cost no coverage.
        if (state.auth) {
          state.authWaits = (state.authWaits || 0) + 1;
          state.authClearedAt = new Date().toISOString();
          state.auth = null;
        }
        return { body };
      }
      const why = body.slice(0, 60).replace(/\s+/g, ' ');
      if (res.status === 401 || /invalid map_key/i.test(body)) {
        // A spent 10-minute budget answers "Invalid MAP_KEY" exactly like a revoked key.
        // The status endpoint is the only thing that can tell them apart.
        const st = await transactionStatus();
        if (st && st.used >= st.limit * 0.85) {
          authStreak = 0;
          budgetWaits++;
          if (budgetWaits > BUDGET_GIVE_UP) {
            console.log(`\nBUDGET — still at ${st.used}/${st.limit} after ${BUDGET_GIVE_UP} waits; stopping without recording failures.`);
            return { auth: true };
          }
          console.log(`[budget] ${st.used}/${st.limit} transactions used — waiting 60s, retrying the same window (${budgetWaits}/${BUDGET_GIVE_UP}, cursor unchanged).`);
          await new Promise((r) => setTimeout(r, 60000));
          attempt--;
          continue;
        }
        authStreak++;
        if (authStreak <= AUTH_GIVE_UP) {
          const wait = 30 * authStreak;
          console.log(`[auth] FIRMS closed the key (${why}) — cooling every lane ${wait}s, retrying the same window (${authStreak}/${AUTH_GIVE_UP}, cursor unchanged).`);
          coolDown(wait);
          continue;
        }
        console.log(`\nAUTH — FIRMS rejected the MAP KEY ${authStreak} times in a row (${why}). Stopping without recording failures.`);
        console.log('AUTH — the backfill is resumable: re-run the same command when the key works again.');
        return { auth: true };
      }
      if (res.status === 429 || res.status >= 500 || (res.status === 400 && THROTTLE_RE.test(body))) {
        throttleStreak++;
        if (throttleStreak <= THROTTLE_GIVE_UP) {
          const wait = 60 * throttleStreak;
          console.log(`[throttle] FIRMS rate-limited (${why}) — cooling every lane ${wait}s, retrying the same window (${throttleStreak}/${THROTTLE_GIVE_UP}, cursor unchanged).`);
          coolDown(wait);
          attempt--;
          continue;
        }
        return { error: `HTTP ${res.status} ${why} (rate-limited ${throttleStreak} times)` };
      }
      if (attempt < 5) await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      else return { error: `HTTP ${res.status} ${why}` };
    } catch (err) {
      if (attempt < 5) await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      else return { error: err.message };
    }
  }
  return { error: 'unreachable' };
}

async function runLane(laneRef) {
  const { source, region, wins, lane, key } = laneRef;
  while (lane.done < wins.length && !stopped) {
    if (MAX_WINDOWS && launched >= MAX_WINDOWS) break;
    if (fs.existsSync(STOP_FILE)) {
      stopped = true;
      flush(true);
      console.log(`stop file ${path.relative(ROOT, STOP_FILE)} seen — checkpoint written, cursor left at ${lane.done}/${wins.length} for ${key}.`);
      return;
    }
    launched++;
    const date = wins[lane.done];
    const outcome = await fetchWindow(source, region, date);
    state.requests++;
    if (outcome.stop || outcome.auth) {
      if (outcome.auth) state.auth = { at: new Date().toISOString(), window: `${key} ${date}` };
      stopped = true;
      flush(true);
      return;
    }
    if (outcome.error) {
      console.log(`[fail] ${key} ${date} — ${outcome.error}`);
      lane.failed.push(date);
      lane.done++;
      if (lane.failed.length % 25 === 0) flush();
      continue;
    }
    const used = aggregate(outcome.body, source.sensor, region.bbox, observations.get(region.id).get(source.sensor));
    lane.rows += used;
    state.rows += used;
    lane.done++;
    flush();
    if (lane.done % 200 === 0) {
      const pct = ((lane.done / wins.length) * 100).toFixed(1);
      console.log(`progress ${key} ${lane.done}/${wins.length} (${pct}%) rows=${lane.rows} total=${state.rows}`);
    }
  }
}

/** Re-request exactly the windows a previous pass gave up on, and clear them from the
 *  failure list when they answer. Coverage ranges derive from the failure list, so a
 *  healed window becomes an observed day only here. */
async function healPass() {
  let repaired = 0;
  let remaining = 0;
  for (const s of SOURCES) {
    for (const r of regions) {
      const key = `${s.id}|${r.id}`;
      const lane = state.lanes[key];
      if (!lane?.failed?.length) continue;
      const still = [];
      for (const date of lane.failed) {
        if (stopped || fs.existsSync(STOP_FILE)) {
          stopped = true;
          break;
        }
        const outcome = await fetchWindow(s, r, date);
        state.requests++;
        if (outcome.stop || outcome.auth) {
          if (outcome.auth) state.auth = { at: new Date().toISOString(), window: `${key} ${date}` };
          stopped = true;
          break;
        }
        if (outcome.error) {
          still.push(date);
          continue;
        }
        const used = aggregate(outcome.body, s.sensor, r.bbox, observations.get(r.id).get(s.sensor));
        lane.rows += used;
        state.rows += used;
        repaired++;
      }
      lane.failed = still;
      remaining += still.length;
      flush(true);
    }
    if (stopped) break;
  }
  console.log(`heal: ${repaired} windows recovered, ${remaining} still failing`);
}

async function pool(items) {
  let next = 0;
  const workers = Array.from({ length: Math.min(LANES, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await runLane(item);
    }
  });
  await Promise.all(workers);
}

process.on('SIGINT', () => { console.log('\ninterrupted — checkpoint written'); stopped = true; flush(true); process.exit(130); });

const t0 = Date.now();
console.log(`backfill start — ${queue.length} lanes, ${LANES} concurrent, ${RATE_PER_MIN} requests/min cap, ${state.requests} requests already made, ${state.rows} rows already aggregated`);
if (HEAL) await healPass();
else await pool(queue);
flush(true);
const secs = (Date.now() - t0) / 1000;
console.log(`backfill pass done in ${secs.toFixed(0)} s — ${launched} requests this pass, ${state.rows} total rows`);
console.log(`output ${OUT} (${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB), state ${STATE}`);
for (const item of queue) {
  const done = item.lane.done;
  if (done < item.wins.length) console.log(`incomplete ${item.key} ${done}/${item.wins.length}${item.lane.failed.length ? ` failed=${item.lane.failed.length}` : ''}`);
}
