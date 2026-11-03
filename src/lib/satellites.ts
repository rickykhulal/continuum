export interface OrbitSatellite {
  id: string;
  name: string;
  short: string;
  norad: number;
  agency: string;
  sensor: 'MODIS' | 'VIIRS';
  altitude: number;
  inclination: number;
  swathKm: number;
  pixelM: number;
  overpass: string;
  color: string;
  era: string;
  eraStart: string;
  eraEnd: string | null;
  role: string;
  tleName: string;
  line1: string;
  line2: string;
}

export interface SatPosition {
  lat: number;
  lon: number;
  altKm: number;
  x: number;
  y: number;
  z: number;
}

const SPECS: Omit<OrbitSatellite, 'line1' | 'line2'>[] = [
  {
    id: 'terra', name: 'Terra', short: 'TERRA', norad: 25994, agency: 'NASA',
    sensor: 'MODIS', altitude: 705, inclination: 98.2, swathKm: 2330, pixelM: 1000,
    overpass: '10:30 descending', color: '#ffb020', era: '2000 – present', eraStart: '2000-02-24', eraEnd: null,
    role: 'The original fire record. Coarse 1 km pixels, twice-daily overpass; its long archive is the backbone of the 2000–2012 history.',
    tleName: 'TERRA',
  },
  {
    id: 'aqua', name: 'Aqua', short: 'AQUA', norad: 27424, agency: 'NASA',
    sensor: 'MODIS', altitude: 705, inclination: 98.2, swathKm: 2330, pixelM: 1000,
    overpass: '13:30 ascending', color: '#ff7a45', era: '2002 – present', eraStart: '2002-05-04', eraEnd: null,
    role: 'Afternoon MODIS. Its 13:30 overpass overlaps VIIRS almost exactly — the calibration bridge between the two sensor families.',
    tleName: 'AQUA',
  },
  {
    id: 'snpp', name: 'Suomi NPP', short: 'S-NPP', norad: 37849, agency: 'NASA / NOAA',
    sensor: 'VIIRS', altitude: 833, inclination: 98.8, swathKm: 3060, pixelM: 375,
    overpass: '13:30 ascending', color: '#4aa8ff', era: '2012 – present', eraStart: '2012-01-20', eraEnd: null,
    role: 'First VIIRS. 375 m pixels reveal fires MODIS never resolves; the 2012 transition that created the phantom trend.',
    tleName: 'SUOMI NPP',
  },
  {
    id: 'noaa20', name: 'NOAA-20', short: 'N20', norad: 43013, agency: 'NOAA',
    sensor: 'VIIRS', altitude: 824, inclination: 98.7, swathKm: 3060, pixelM: 375,
    overpass: '13:30 ascending', color: '#7dd3fc', era: '2018 – present', eraStart: '2018-04-01', eraEnd: null,
    role: 'JPSS-1. Adds a second daily VIIRS sample, cutting the data gap left when an individual spacecraft drifts.',
    tleName: 'NOAA 20',
  },
  {
    id: 'noaa21', name: 'NOAA-21', short: 'N21', norad: 54234, agency: 'NOAA',
    sensor: 'VIIRS', altitude: 824, inclination: 98.7, swathKm: 3060, pixelM: 375,
    overpass: '13:30 ascending', color: '#a78bfa', era: '2022 – present', eraStart: '2022-11-10', eraEnd: null,
    role: 'JPSS-2. The continuity spacecraft: when Terra and Aqua retire, the VIIRS constellation carries the record forward.',
    tleName: 'NOAA 21',
  },
];

const TLE_KEYS: Record<string, string> = {
  TERRA: 'terra', AQUA: 'aqua', 'SUOMI NPP': 'snpp', 'NOAA 20': 'noaa20', 'NOAA 21': 'noaa21',
};

let satellites: OrbitSatellite[] | null = null;
let tleEpoch: string | null = null;
let tleSource: 'bundled' | 'none' = 'none';

function epochFromLine1(line1: string): string | null {
  if (!line1.startsWith('1 ') || line1.length < 32) return null;
  const yy = Number(line1.slice(18, 20));
  const doy = Number(line1.slice(20, 32));
  if (!Number.isFinite(yy) || !Number.isFinite(doy) || doy <= 0) return null;
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  return `${year}-${String(Math.floor(doy)).padStart(3, '0')}`;
}

function parseInto(text: string, source: 'bundled' | 'none'): OrbitSatellite[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const byNorad = new Map<number, { line1: string; line2: string }>();
  const byName = new Map<string, { line1: string; line2: string }>();
  for (let i = 0; i < lines.length; i++) {
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    if (!line1?.startsWith('1 ') || !line2?.startsWith('2 ')) continue;
    const tle = { line1, line2 };
    const norad = Number(line1.slice(2, 7));
    if (Number.isFinite(norad)) byNorad.set(norad, tle);
    const key = TLE_KEYS[lines[i].toUpperCase()];
    if (key) byName.set(key, tle);
  }
  satellites = SPECS.map((s) => {
    const tle = byNorad.get(s.norad) ?? byName.get(s.id);
    return { ...s, line1: tle?.line1 ?? '', line2: tle?.line2 ?? '' };
  });
  const epochs = satellites.map((s) => epochFromLine1(s.line1)).filter((e): e is string => !!e).sort();
  tleEpoch = epochs[epochs.length - 1] ?? null;
  tleSource = satellites.some((s) => s.line1) ? source : 'none';
  return satellites;
}

export function tleStatus(): { epoch: string | null; source: 'bundled' | 'none' } {
  return { epoch: tleEpoch, source: tleSource };
}

export function parseTle(text: string): OrbitSatellite[] {
  if (satellites) return satellites;
  return parseInto(text, 'bundled');
}

export async function loadSatellites(): Promise<OrbitSatellite[]> {
  if (satellites) return satellites;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL || './'}tle/satellites.txt`);
    if (!res.ok) throw new Error(String(res.status));
    parseInto(await res.text(), 'bundled');
  } catch {
    parseInto('', 'none');
  }
  return satellites!;
}

export { SPECS as SATELLITE_SPECS };
