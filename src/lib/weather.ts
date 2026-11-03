import type { DailyRecord } from './types';
import { addDays, isoDate, parseISO } from './format';
import { mean } from './random';

export interface WeatherDay {
  date: string;
  t2m: number | null;
  precip: number | null;
  rh: number | null;
  tAnom: number;
  dry30: number;
  stress: number;
}

export interface WeatherContext {
  source: 'NASA POWER' | 'offline estimate';
  fetchedAt: string;
  lat: number;
  lon: number;
  days: WeatherDay[];
  fit: { r2: number; slope: number; n: number; period: string };
  observed: number[];
  expected: number[];
  residual: number[];
  dates: string[];
}

const cache = new Map<string, Promise<WeatherContext>>();

function ymd(date: string): string {
  return date.replace(/-/g, '');
}

function safe(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= -900) return null;
  return v;
}

/** Real NASA POWER daily weather (MERRA-2), CORS-enabled, no key. */
export async function loadWeather(regionCenter: [number, number], records: DailyRecord[], today: string): Promise<WeatherContext> {
  const lat = Math.round(regionCenter[0] * 100) / 100;
  const lon = Math.round(regionCenter[1] * 100) / 100;
  const key = `${lat},${lon},${today}`;
  if (cache.has(key)) return cache.get(key)!;
  const promise = fetchWeather(lat, lon, records, today).catch(() => offlineWeather(lat, lon, records, today));
  cache.set(key, promise);
  return promise;
}

async function fetchWeather(lat: number, lon: number, records: DailyRecord[], today: string): Promise<WeatherContext> {
  const start = '2016-01-01';
  const url =
    'https://power.larc.nasa.gov/api/temporal/daily/point' +
    `?parameters=T2M,PRECTOTCORR,RH2M&community=AG&longitude=${lon}&latitude=${lat}` +
    `&start=${ymd(start)}&end=${ymd(today)}&format=JSON`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  const res = await fetch(url, { signal: controller.signal });
  clearTimeout(timer);
  if (!res.ok) throw new Error(`POWER ${res.status}`);
  const json = await res.json();
  const params = json?.properties?.parameter;
  if (!params?.T2M) throw new Error('POWER schema');
  const t2m = params.T2M as Record<string, number>;
  const precip = params.PRECTOTCORR as Record<string, number>;
  const rh = params.RH2M as Record<string, number>;

  const all: { date: string; t: number | null; p: number | null; r: number | null }[] = [];
  const rainByDate = new Map<string, number>();
  for (const key of Object.keys(t2m)) {
    const raw = safe(t2m[key]);
    // POWER returns T2M in Kelvin for the AG community; guard against already-Celsius values.
    const t = raw != null && raw > 150 ? raw - 273.15 : raw;
    const date = `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
    const p = safe(precip?.[key]);
    all.push({ date, t, p, r: safe(rh?.[key]) });
    rainByDate.set(date, p ?? 0);
  }
  all.sort((a, b) => a.date.localeCompare(b.date));
  if (!all.length) throw new Error('POWER empty');

  // Per-day-of-year climatology (10-year window) for temperature and 30-day rainfall.
  const byDoy = new Map<number, number[]>();
  for (const d of all) {
    if (d.t == null) continue;
    const doy = doyOf(d.date);
    const arr = byDoy.get(doy) ?? [];
    arr.push(d.t);
    byDoy.set(doy, arr);
  }
  const tClim = new Map<number, number>();
  for (const [doy, arr] of byDoy) tClim.set(doy, mean(arr));

  const days: WeatherDay[] = [];
  for (let i = 0; i < all.length; i++) {
    const d = all[i];
    if (d.t == null) continue;
    const doy = doyOf(d.date);
    let base = 0;
    let n = 0;
    for (let k = -7; k <= 7; k++) {
      const v = tClim.get(((doy + k - 1 + 365) % 365) + 1);
      if (v != null) {
        base += v;
        n++;
      }
    }
    base = n ? base / n : d.t;
    const tAnom = d.t - base;
    let p30 = 0;
    for (let k = 0; k < 30; k++) {
      const dd = all[i - k];
      if (!dd) break;
      p30 += dd.p ?? 0;
    }
    // Rain climatology: 10-year mean 30-day total ending on this date.
    const rainClim = rainClimatology(rainByDate, d.date);
    const dry = rainClim > 0 ? clamp01((rainClim - p30) / Math.max(4, rainClim)) : 0;
    const heat = clamp01(tAnom / 4);
    const dryAir = d.r != null ? clamp01((55 - d.r) / 40) : 0.3;
    const stress = Math.round(clamp01(0.46 * heat + 0.38 * dry + 0.16 * dryAir) * 100);
    days.push({ date: d.date, t2m: d.t, precip: d.p, rh: d.r, tAnom, dry30: p30, stress });
  }

  // Align with the record and fit log activity ~ fire-weather stress.
  const recs = records.filter((r) => r.date >= '2016-01-01' && r.date <= today);
  const stressByDate = new Map(days.map((d) => [d.date, d.stress]));
  const dates: string[] = [];
  const observed: number[] = [];
  const stress: number[] = [];
  for (const r of recs) {
    const s = stressByDate.get(r.date);
    if (s == null) continue;
    dates.push(r.date);
    observed.push(r.harmonized);
    stress.push(s);
  }
  const fit = logFit(stress, observed);
  const expected = stress.map((s) => Math.max(0, Math.exp(fit.a + fit.b * s) - 1));
  const residual = observed.map((v, i) => v - expected[i]);

  return {
    source: 'NASA POWER',
    fetchedAt: new Date().toISOString(),
    lat,
    lon,
    days,
    fit: { r2: fit.r2, slope: fit.b, n: dates.length, period: `${dates[0] ?? '—'} – ${dates[dates.length - 1] ?? '—'}` },
    observed,
    expected,
    residual,
    dates,
  };
}

function rainClimatology(rainByDate: Map<string, number>, date: string): number {
  const year = Number(date.slice(0, 4));
  const doy = doyOf(date);
  let sum = 0;
  let n = 0;
  for (let y = year - 10; y < year; y++) {
    let tot = 0;
    let count = 0;
    for (let k = 0; k < 30; k++) {
      const dt = new Date(Date.UTC(y, 0, 1));
      dt.setUTCDate(doy - k);
      const v = rainByDate.get(isoDate(dt));
      if (v != null) {
        tot += v;
        count++;
      }
    }
    if (count >= 25) {
      sum += tot;
      n++;
    }
  }
  return n ? sum / n : 0;
}

export function stressBand(s: number): { label: string; color: string } {
  if (s >= 75) return { label: 'extreme', color: '#ff4d4d' };
  if (s >= 55) return { label: 'high', color: '#ff8a3d' };
  if (s >= 35) return { label: 'elevated', color: '#ffc247' };
  return { label: 'low', color: '#56d6a0' };
}

function logFit(x: number[], y: number[]): { a: number; b: number; r2: number } {
  const ly = y.map((v) => Math.log(1 + Math.max(0, v)));
  const mx = mean(x);
  const my = mean(ly);
  let num = 0;
  let den = 0;
  for (let i = 0; i < x.length; i++) {
    num += (x[i] - mx) * (ly[i] - my);
    den += (x[i] - mx) ** 2;
  }
  const b = den ? num / den : 0;
  const a = my - b * mx;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < x.length; i++) {
    const pred = a + b * x[i];
    ssRes += (ly[i] - pred) ** 2;
    ssTot += (ly[i] - my) ** 2;
  }
  return { a, b, r2: ssTot ? 1 - ssRes / ssTot : 0 };
}

function doyOf(date: string): number {
  const d = parseISO(date);
  return Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function offlineWeather(lat: number, lon: number, records: DailyRecord[], today: string): WeatherContext {
  const days: WeatherDay[] = [];
  const start = '2016-01-01';
  let i = 0;
  for (let d = start; d <= today; d = addDays(d, 1)) {
    i++;
    const tAnom = Math.sin(i / 37 + lon) * 2.4;
    const dry = 0.5 + 0.5 * Math.sin(i / 53 + lat);
    days.push({ date: d, t2m: null, precip: null, rh: null, tAnom, dry30: 0, stress: Math.round(clamp01(0.5 + 0.3 * Math.sin(i / 61)) * 100) });
  }
  const byDate = new Map(days.map((d) => [d.date, d]));
  const recs = records.filter((r) => r.date >= start && r.date <= today);
  const dates = recs.map((r) => r.date);
  const observed = recs.map((r) => r.harmonized);
  const stress = dates.map((d) => byDate.get(d)?.stress ?? 0);
  const fit = logFit(stress, observed);
  const expected = stress.map((s) => Math.max(0, Math.exp(fit.a + fit.b * s) - 1));
  return {
    source: 'offline estimate',
    fetchedAt: new Date().toISOString(),
    lat,
    lon,
    days: days.filter((d) => d.date >= `${today.slice(0, 4)}-01-01`),
    fit: { r2: fit.r2, slope: fit.b, n: dates.length, period: `${dates[0] ?? '—'} – ${dates[dates.length - 1] ?? '—'}` },
    observed,
    expected,
    residual: observed.map((v, idx) => v - expected[idx]),
    dates,
  };
}
