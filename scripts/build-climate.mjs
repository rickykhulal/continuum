#!/usr/bin/env node
/**
 * Builds the real meteorological driver series for Continuum.
 *
 * Input : NASA POWER daily point API (MERRA-2 reanalysis), keyless and official,
 *         https://power.larc.nasa.gov/api/temporal/daily/point
 *         cached under data_raw/power/ so a rebuild is offline and reproducible.
 * Output: public/data/climate_daily.json
 *
 * Every day since 2000-01-01, for every pilot region centre, four real variables
 * (daily maximum temperature, mean 2 m relative humidity, 10 m wind speed and the
 * trailing 90-day precipitation total) are expressed as an anomaly against their
 * own day-of-year climatology, pooled over a ±15-day band across all years. The
 * signed sum of those anomalies is the burn-weather index BW:
 *
 *   BW = 0.35 z(Tmax) - 0.25 z(RH) + 0.20 z(WS10M) - 0.20 z(AP90)
 *
 * The weights state the relative contribution of four observed quantities and are
 * not fitted to fire counts; BW is mean-zero by construction. src/lib/data.ts
 * drives the reconstruction's daily-weather and year-regime terms from BW, so both
 * signals come from reanalysis rather than from a random number generator.
 *
 * The same four variables also give the seasonal term. Averaging them by calendar
 * month over the whole 26-year span and expressing each month against the region's
 * own annual cycle produces SEASON, a 12-value burn-weather favourability index
 * normalised to mean 1. SEASON replaces the hand-typed peak months that used to sit
 * in src/data/regions.json, so the shape of a region's fire season is observed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'data');
const CACHE = path.join(ROOT, 'data_raw', 'power');

const START = '2000-01-01';
const PARAMS = ['T2M_MAX', 'RH2M', 'WS10M_MAX', 'WS10M_MIN', 'PRECTOTCORR'];
const SOURCE = 'https://power.larc.nasa.gov/api/temporal/daily/point';
const MISSING = -999;
const CLIM_WINDOW = 15;
const WEIGHTS = { tMax: 0.35, rh: -0.25, ws: 0.2, ap90: -0.2 };

const regions = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'regions.json'), 'utf8'));

function ymd(d) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function fetchPower(lat, lon, start, end) {
  fs.mkdirSync(CACHE, { recursive: true });
  const local = path.join(CACHE, `power_${lat}_${lon}_${start}_${end}.json`);
  if (process.env.POWER_REFRESH !== '1' && fs.existsSync(local)) {
    console.log(`  cached ${path.basename(local)}`);
    return JSON.parse(fs.readFileSync(local, 'utf8'));
  }
  const url =
    `${SOURCE}?parameters=${PARAMS.join(',')}&community=AG` +
    `&longitude=${lon}&latitude=${lat}&start=${start}&end=${end}&format=JSON`;
  const started = Date.now();
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`POWER ${lat},${lon}: HTTP ${res.status}`);
  const text = await res.text();
  if (!text.includes('"parameter"')) throw new Error(`POWER ${lat},${lon}: unexpected payload`);
  const json = JSON.parse(text);
  if (json?.header?.errors) throw new Error(`POWER ${lat},${lon}: ${JSON.stringify(json.header.errors)}`);
  fs.writeFileSync(local, text);
  console.log(`  POWER ${lat},${lon}: ${(text.length / 1e6).toFixed(2)} MB, ${Date.now() - started} ms`);
  return json;
}

function dayList(startIso, endIso) {
  const out = [];
  const d = new Date(`${startIso}T00:00:00Z`);
  const last = new Date(`${endIso}T00:00:00Z`);
  while (d <= last) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function dayOfYear(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1;
}

function fillForward(values) {
  const out = values.slice();
  let last = null;
  for (let i = 0; i < out.length; i++) {
    if (out[i] == null) out[i] = last;
    else last = out[i];
  }
  return out;
}

/** Day-of-year climatology, smoothed over a ±window band and pooled across years. */
function climatology(values, doy, window) {
  const byDay = new Map();
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) continue;
    const k = doy[i];
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(values[i]);
  }
  const maxDoy = Math.max(...doy);
  return (k) => {
    const pool = [];
    for (let d = k - window; d <= k + window; d++) {
      const wrapped = ((d - 1 + maxDoy) % maxDoy) + 1;
      const list = byDay.get(wrapped);
      if (list) pool.push(...list);
    }
    if (pool.length < 20) return null;
    const mean = pool.reduce((a, b) => a + b, 0) / pool.length;
    const varr = pool.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (pool.length - 1);
    const sd = Math.sqrt(varr);
    return sd > 1e-9 ? { mean, sd } : null;
  };
}

function zscore(values, doy, window) {
  const filled = fillForward(values);
  const clim = climatology(filled, doy, window);
  return filled.map((v, i) => {
    const c = clim(doy[i]);
    return v == null || !c ? null : (v - c.mean) / c.sd;
  });
}

/** Trailing `window`-day sum of real daily rainfall; null until the window fills. */
function antecedent(rain, window) {
  const out = new Array(rain.length).fill(null);
  const held = [];
  let acc = 0;
  for (let i = 0; i < rain.length; i++) {
    if (rain[i] != null) {
      held.push(rain[i]);
      acc += rain[i];
    }
    while (held.length > window) acc -= held.shift();
    if (held.length >= window) out[i] = acc;
  }
  return out;
}

/** Mean of the valid values for each calendar month, pooled over every year. */
function monthlyMeans(values, months) {
  const acc = Array.from({ length: 12 }, () => [0, 0]);
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) continue;
    acc[months[i]][0] += values[i];
    acc[months[i]][1] += 1;
  }
  return acc.map(([s, n]) => (n >= 12 ? s / n : null));
}

/**
 * Burn-weather favourability of each calendar month, from the region's own
 * observed annual cycle: each variable's monthly mean is standardised across the
 * 12 months with the same stated weights as BW, exponentiated and normalised so
 * the twelve values average 1. Months with no valid reanalysis stay null.
 */
function seasonalIndex(monthlyByVar) {
  const names = Object.keys(monthlyByVar);
  const stats = {};
  for (const name of names) {
    const m = monthlyByVar[name];
    const valid = m.filter((v) => v != null);
    if (valid.length < 12) return null;
    const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
    const sd = Math.sqrt(valid.reduce((a, b) => a + (b - mean) ** 2, 0) / (valid.length - 1));
    stats[name] = sd > 1e-9 ? { mean, sd } : null;
    if (!stats[name]) return null;
  }
  const raw = monthlyByVar[names[0]].map((_, i) =>
    names.reduce((s, name) => s + WEIGHTS[name] * ((monthlyByVar[name][i] - stats[name].mean) / stats[name].sd), 0),
  );
  const exp = raw.map((v) => Math.exp(v));
  const meanExp = exp.reduce((a, b) => a + b, 0) / 12;
  return exp.map((v) => v / meanExp);
}

async function build() {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const dates = dayList(START, end.toISOString().slice(0, 10));
  const doy = dates.map(dayOfYear);
  const years = dates.map((iso) => Number(iso.slice(0, 4)));
  const months = dates.map((iso) => Number(iso.slice(5, 7)) - 1);

  const out = {
    meta: {
      schema: 'continuum-climate-3',
      generatedAt: new Date().toISOString(),
      source: 'NASA POWER daily (MERRA-2 reanalysis), keyless point API',
      endpoint: SOURCE,
      parameters: PARAMS,
      index: {
        name: 'BW (burn-weather anomaly)',
        formula: 'BW = 0.35*z(T2M_MAX) - 0.25*z(RH2M) + 0.20*z(WS10M) - 0.20*z(AP90)',
        ap90: 'trailing 90-day PRECTOTCORR total, mm',
        wind: '(WS10M_MAX + WS10M_MIN) / 2',
        climatology: `same day of year within +/-${CLIM_WINDOW} days, pooled over every year of the record`,
        note: 'mean-zero by construction; the weights state the contribution of each observed term and are not fitted to fire counts',
      },
      season: {
        name: 'SEASON (monthly burn-weather favourability)',
        formula: 'SEASON_m = exp(same weighted sum with each variable standardised across the 12 monthly means) / mean over m',
        normalisation: 'the twelve values average exactly 1, so it redistributes activity within a year and never changes the annual total',
        replaces: 'the hand-typed peakMonths/seasonLabel that used to live in src/data/regions.json',
      },
      start: START,
      end: end.toISOString().slice(0, 10),
      missingValuePolicy: 'POWER -999 becomes null; trailing gaps persist the last valid day',
      regions: {},
    },
    dates: { start: dates[0], count: dates.length },
    regions: {},
  };

  for (const region of regions) {
    const lat = Number(((region.bbox[1] + region.bbox[3]) / 2).toFixed(3));
    const lon = Number(((region.bbox[0] + region.bbox[2]) / 2).toFixed(3));
    console.log(`${region.id}: POWER point ${lat},${lon}`);
    const json = await fetchPower(lat, lon, ymd(new Date(`${START}T00:00:00Z`)), ymd(end));
    const p = json.properties.parameter;

    const seriesFor = (name) =>
      dates.map((iso) => {
        const v = p[name]?.[iso.replace(/-/g, '')];
        return typeof v === 'number' && v !== MISSING && Number.isFinite(v) ? v : null;
      });
    const wsMax = seriesFor('WS10M_MAX');
    const wsMin = seriesFor('WS10M_MIN');
    const ws = wsMax.map((v, i) => (v == null || wsMin[i] == null ? null : (v + wsMin[i]) / 2));
    const ap90 = antecedent(seriesFor('PRECTOTCORR'), 90);

    const z = {
      tMax: zscore(seriesFor('T2M_MAX'), doy, CLIM_WINDOW),
      rh: zscore(seriesFor('RH2M'), doy, CLIM_WINDOW),
      ws: zscore(ws, doy, CLIM_WINDOW),
      ap90: zscore(ap90, doy, CLIM_WINDOW),
    };
    const bw = dates.map((_, i) => {
      const parts = [z.tMax[i], z.rh[i], z.ws[i], z.ap90[i]];
      if (parts.some((v) => v == null)) return null;
      return WEIGHTS.tMax * parts[0] + WEIGHTS.rh * parts[1] + WEIGHTS.ws * parts[2] + WEIGHTS.ap90 * parts[3];
    });

    const sums = {};
    for (let i = 0; i < bw.length; i++) {
      if (bw[i] == null) continue;
      const y = years[i];
      if (!sums[y]) sums[y] = [0, 0];
      sums[y][0] += bw[i];
      sums[y][1] += 1;
    }
    const annual = {};
    for (const [y, [s, n]] of Object.entries(sums)) if (n >= 200) annual[y] = Number((s / n).toFixed(3));

    const vals = bw.filter((v) => v != null);
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) * (b - m), 0) / (vals.length - 1));
    const yr = Object.values(annual);
    const season = seasonalIndex({
      tMax: monthlyMeans(fillForward(seriesFor('T2M_MAX')), months),
      rh: monthlyMeans(fillForward(seriesFor('RH2M')), months),
      ws: monthlyMeans(fillForward(ws), months),
      ap90: monthlyMeans(fillForward(ap90), months),
    });
    out.regions[region.id] = {
      center: [lat, lon],
      bw: bw.map((v) => (v == null ? null : Number(v.toFixed(3)))),
      annual,
      season: season ? season.map((v) => Number(v.toFixed(4))) : null,
    };
    out.meta.regions[region.id] = {
      days: dates.length,
      validDays: vals.length,
      bwMean: Number(m.toFixed(4)),
      bwSd: Number(sd.toFixed(4)),
      bwMin: Number(Math.min(...vals).toFixed(3)),
      bwMax: Number(Math.max(...vals).toFixed(3)),
      annualYears: yr.length,
      annualMin: Number(Math.min(...yr).toFixed(3)),
      annualMax: Number(Math.max(...yr).toFixed(3)),
      driestYear: Object.entries(annual).sort((a, b) => a[1] - b[1])[0][0],
      wettestYear: Object.entries(annual).sort((a, b) => b[1] - a[1])[0][0],
      season: season
        ? {
            min: Number(Math.min(...season).toFixed(3)),
            max: Number(Math.max(...season).toFixed(3)),
            peakMonth: season.indexOf(Math.max(...season)) + 1,
            aboveMean: season.map((v, i) => (v >= 1 ? i + 1 : 0)).filter(Boolean),
          }
        : null,
    };
    console.log(
      `  BW mean ${m.toFixed(3)} sd ${sd.toFixed(3)} range ${Math.min(...vals).toFixed(2)}..${Math.max(...vals).toFixed(2)}; ` +
        `annual ${Math.min(...yr).toFixed(2)}..${Math.max(...yr).toFixed(2)} (driest ${out.meta.regions[region.id].driestYear})`,
    );
    if (season) {
      console.log(
        `  SEASON ${season.map((v) => v.toFixed(2)).join(' ')} | peak month ${out.meta.regions[region.id].season.peakMonth}` +
          ` | above-mean months ${out.meta.regions[region.id].season.aboveMean.join(',')}`,
      );
    } else console.log('  SEASON unavailable (a month has no valid reanalysis)');
  }

  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, 'climate_daily.json');
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(`wrote ${path.relative(ROOT, file)} (${(fs.statSync(file).size / 1e6).toFixed(2)} MB, ${dates.length} days x ${regions.length} regions)`);
}

build().catch((err) => {
  console.error('climate build failed:', err.message);
  process.exitCode = 1;
});
