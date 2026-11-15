import type { Region } from '../lib/types';
import { bboxAreaKm2, normalizeLon } from '../lib/geo';

export interface Place {
  name: string;
  country: string;
  lat: number;
  lon: number;
  regionId?: string;
  radiusKm?: number;
  aliases: string[];
}

export const PLACES: Place[] = [
  { name: 'Chilecito', country: 'Argentina', lat: -29.16, lon: -67.5, regionId: 'chilecito', aliases: ['famatina', 'la rioja'] },
  { name: 'Córdoba', country: 'Argentina', lat: -31.42, lon: -64.18, aliases: ['cordoba'] },
  { name: 'Pantanal', country: 'Brazil', lat: -17.6, lon: -57.3, regionId: 'pantanal', aliases: ['cuiaba', 'corumba', 'matto grosso'] },
  { name: 'Manaus', country: 'Brazil', lat: -3.12, lon: -60.02, aliases: ['amazonas'] },
  { name: 'Belém', country: 'Brazil', lat: -1.46, lon: -48.5, aliases: ['belem', 'para'] },
  { name: 'California', country: 'United States', lat: 39.5, lon: -121.0, regionId: 'california', aliases: ['los angeles', 'san francisco', 'sacramento'] },
  { name: 'Greece', country: 'Greece', lat: 38.6, lon: 23.6, regionId: 'greece', aliases: ['athens', 'evia', 'rhodes'] },
  { name: 'Nepal', country: 'Nepal', lat: 28.2, lon: 84.0, regionId: 'nepal', aliases: ['kathmandu', 'terai'] },
  { name: 'Southeast Australia', country: 'Australia', lat: -35.5, lon: 148.5, regionId: 'southeast-australia', aliases: ['sydney', 'melbourne', 'canberra'] },
  { name: 'Cerrado', country: 'Brazil', lat: -13.0, lon: -47.5, aliases: ['brasilia', 'savanna'] },
  { name: 'Borneo', country: 'Indonesia', lat: 0.5, lon: 114.0, aliases: ['kalimantan', 'peat'] },
  { name: 'Siberia', country: 'Russia', lat: 63.0, lon: 105.0, aliases: ['yakutia', 'taiga'] },
  { name: 'Mediterranean Turkey', country: 'Türkiye', lat: 37.0, lon: 30.5, aliases: ['antalya', 'turkey'] },
  { name: 'Portugal', country: 'Portugal', lat: 39.7, lon: -8.0, aliases: ['lisbon', 'algarve'] },
  { name: 'Alberta', country: 'Canada', lat: 55.0, lon: -115.0, aliases: ['boreal', 'edmonton'] },
  { name: 'Congo Basin', country: 'DR Congo', lat: -1.5, lon: 22.0, aliases: ['kinshasa', 'rainforest'] },
  { name: 'South Africa', country: 'South Africa', lat: -27.5, lon: 25.0, aliases: ['freestate', 'cape'] },
  { name: 'Chile Central', country: 'Chile', lat: -34.5, lon: -71.0, aliases: ['santiago', 'valparaiso'] },
  // Territories Natural Earth 50m does not publish as separate admin-0 units. Without them these
  // names have no search result at all: a click on the globe still resolves them through the
  // nearest-land probe, but typing "Tuvalu" or "Réunion" found nothing. Each opens as a named custom
  // AOI at its own coordinates, which is what the app does for every non-pilot place.
  { name: 'Tuvalu', country: 'Tuvalu', lat: -8.52, lon: 179.2, aliases: ['funafuti', 'pacific atoll'] },
  { name: 'Tokelau', country: 'New Zealand', lat: -9.18, lon: -171.85, aliases: ['atafu', 'nusirok', 'faota'] },
  { name: 'Gibraltar', country: 'United Kingdom', lat: 36.14, lon: -5.35, aliases: ['rock of gibraltar', 'peninsula'] },
  { name: 'Wake Island', country: 'United States', lat: 19.28, lon: 166.64, aliases: ['wake', 'peacock'] },
  { name: 'Réunion', country: 'France', lat: -21.12, lon: 55.54, aliases: ['reunion', 'saint-denis', 'saint denis'] },
  { name: 'Mayotte', country: 'France', lat: -12.84, lon: 45.13, aliases: ['mamoudzou'] },
  { name: 'Canary Islands', country: 'Spain', lat: 28.3, lon: -15.4, aliases: ['canarias', 'tenerife', 'gran canaria', 'la palma'] },
  { name: 'Svalbard', country: 'Norway', lat: 78.22, lon: 15.65, aliases: ['longyearbyen', 'spitsbergen'] },
  { name: 'Christmas Island', country: 'Australia', lat: -10.44, lon: 105.63, aliases: ['flying fish cove'] },
  { name: 'Cocos (Keeling) Islands', country: 'Australia', lat: -12.16, lon: 96.83, aliases: ['cocos', 'keeling', 'west island'] },
  { name: 'Bonaire', country: 'Netherlands', lat: 12.16, lon: -68.27, aliases: ['kralendijk', 'bes islands'] },
  { name: 'Ceuta', country: 'Spain', lat: 35.89, lon: -5.32, aliases: ['seuta'] },
  { name: 'Melilla', country: 'Spain', lat: 35.29, lon: -2.94, aliases: ['malilla'] },
  { name: 'Hawaiʻi', country: 'United States', lat: 19.8, lon: -155.5, aliases: ['hawaii', 'big island', 'mauna loa', 'kilauea'] },
];

export function searchPlaces(query: string, limit = 6): Place[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { p: Place; s: number }[] = [];
  for (const p of PLACES) {
    const hay = [p.name, p.country, ...p.aliases].map((x) => x.toLowerCase());
    let s = -1;
    for (const h of hay) {
      if (h === q) s = Math.max(s, 100);
      else if (h.startsWith(q)) s = Math.max(s, 80 - (h.length - q.length));
      else if (h.includes(q)) s = Math.max(s, 55 - (h.length - q.length));
    }
    if (s > 0) scored.push({ p, s });
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.p);
}

function slug(lat: number, lon: number): string {
  const ns = `${lat < 0 ? 's' : 'n'}${Math.abs(lat).toFixed(2).replace('.', 'p')}`;
  const ew = `${lon < 0 ? 'w' : 'e'}${Math.abs(lon).toFixed(2).replace('.', 'p')}`;
  return `aoi-${ns}-${ew}`;
}

/** Build a Region-like AOI for any point on Earth, so every click is analysable. */
export function customRegion(lat: number, lon: number, radiusKm = 140, name?: string, countryId?: string): Region {
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.max(0.18, Math.cos((lat * Math.PI) / 180)));
  return {
    id: slug(lat, lon),
    countryId,
    name: name ? `${name} · ${radiusKm} km` : `Point ${lat.toFixed(1)}°, ${lon.toFixed(1)}°`,
    shortName: name ?? `${lat.toFixed(1)}°, ${lon.toFixed(1)}°`,
    country: countryId ? name || countryId : 'Selected point',
    admin: `Custom area · radius ${radiusKm} km`,
    center: [lat, lon],
    bbox: [lon - dLon, lat - dLat, lon + dLon, lat + dLat],
    areaKm2: Math.round(Math.PI * radiusKm * radiusKm),
    biome: Math.abs(lat) > 60 ? 'Boreal / polar' : Math.abs(lat) < 23.5 ? 'Tropical' : 'Temperate',
    language: lon < -30 ? (lat < 15 ? 'pt' : 'es') : 'en',
    timezone: 'UTC',
    description: `A custom ${radiusKm} km radius of interest${countryId ? ` inside the ${name} border` : ''}. Its level, bridge ratio and seasonal driver are measured from the live FIRMS window and NASA POWER reanalysis for this point; this is an exploratory AOI, not a curated pilot region.`,
    aliases: [],
  };
}

/** Preserve a drawn geographic rectangle rather than substituting a radius. */
export function customBounds(bbox: Region['bbox'], name = 'Globe area'): Region {
  const [w, s, e, n] = bbox;
  if (!bbox.every(Number.isFinite) || s < -90 || n > 90 || s >= n || w >= e || e - w > 180 || w < -360 || e > 360) {
    throw new Error('Invalid geographic bounds');
  }
  const lat = (s + n) / 2;
  const lon = normalizeLon((w + e) / 2);
  return {
    ...customRegion(lat, lon, 140, name),
    id: `bounds-${bbox.join('_')}`,
    selection: 'bounds',
    name,
    shortName: name,
    country: 'Drawn area',
    admin: 'Custom geographic rectangle',
    bbox: [...bbox],
    areaKm2: bboxAreaKm2(bbox),
    description: 'A rectangle drawn on the globe. Point counts use these exact bounds. Historical activity is a calibrated reconstruction unless archive observations cover this area; global snapshot points outside pilot coverage are sampled.',
  };
}
