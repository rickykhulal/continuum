import type { Lang } from './i18n';

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function nf(n: number, digits = 0, lang: Lang = 'en'): string {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat(lang === 'es' ? 'es-ES' : 'en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(n);
}

export function compact(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return nf(n, Math.abs(n) < 10 && n % 1 !== 0 ? 1 : 0);
}

export function pct(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : ''}${nf(n, digits)}%`;
}

export function signed(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : ''}${nf(n, digits)}`;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseISO(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

export function addDays(s: string, days: number): string {
  const d = parseISO(s);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

export function dayOfYear(s: string): number {
  const d = parseISO(s);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((d.getTime() - start) / 86400000) + 1;
}

export function dateFromDoy(year: number, doy: number): string {
  const d = new Date(Date.UTC(year, 0, 1));
  d.setUTCDate(doy);
  return isoDate(d);
}

export function doyLabel(doy: number): string {
  const d = new Date(Date.UTC(2021, 0, 1));
  d.setUTCDate(doy);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function longDate(s: string): string {
  const d = parseISO(s);
  return `${d.getUTCDate()} ${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function shortDate(s: string): string {
  const d = parseISO(s);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function timeUTC(t: number): string {
  const d = new Date(t * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}Z`;
}

/** Proper ordinal suffix: 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st… */
export function ordinal(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const i = Math.round(n);
  const mod100 = i % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${i}th`;
  switch (i % 10) {
    case 1: return `${i}st`;
    case 2: return `${i}nd`;
    case 3: return `${i}rd`;
    default: return `${i}th`;
  }
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000);
}

/** Color-blind-safe sequential ramp (cividis-like blue → yellow). */
export const RAMP = ['#0b1220', '#12305a', '#1f4b7a', '#3b6f8f', '#6d8f8d', '#a3a56d', '#d9c24f', '#f9e34b'];

export function rampColor(t: number): string {
  if (!Number.isFinite(t)) return '#131a26';
  const x = Math.max(0, Math.min(0.9999, t));
  const i = Math.floor(x * (RAMP.length - 1));
  return RAMP[i];
}

export function rampColorSmooth(t: number): string {
  if (!Number.isFinite(t)) return '#131a26';
  const x = Math.max(0, Math.min(1, t));
  const scaled = x * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(scaled));
  const f = scaled - i;
  return mixHex(RAMP[i], RAMP[i + 1], f);
}

export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 255;
  const ag = (pa >> 8) & 255;
  const ab = pa & 255;
  const br = (pb >> 16) & 255;
  const bg = (pb >> 8) & 255;
  const bb = pb & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`;
}

export const FIRE_RAMP = ['#2b1a12', '#5c2a17', '#9c3a1c', '#d9501f', '#ff7a2f', '#ffb347', '#ffe08a'];

export function fireColor(t: number): string {
  const x = Math.max(0, Math.min(0.999, t));
  return FIRE_RAMP[Math.floor(x * FIRE_RAMP.length)];
}

export function riskColor(band: string): string {
  switch (band) {
    case 'extreme': return '#ff4d4d';
    case 'high': return '#ff8a3d';
    case 'elevated': return '#ffc247';
    case 'normal': return '#56d6a0';
    default: return '#6f8fae';
  }
}
