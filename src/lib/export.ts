import type { DailyRecord, LiveFire, Mode, Region } from './types';
import { SENSOR_SHORT } from './types';
import { dailyValue, provenanceMix, recordsInRange } from './data';

function download(content: string | Blob, filename: string, type = 'text/plain;charset=utf-8'): void {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function exportCSV(region: Region, records: DailyRecord[], from: string, to: string, mode: Mode): { rows: number; filename: string } {
  const recs = recordsInRange(records, from, to);
  const lines: string[] = [];
  lines.push(`# Continuum v1.0 — harmonized burning record`);
  lines.push(`# area_id,${region.id}`);
  lines.push(`# area_name,"${region.name.replace(/"/g, "'")}"`);
  lines.push(`# bbox_west_south_east_north,${region.bbox.join(',')}`);
  lines.push(`# area_km2,${region.areaKm2}`);
  lines.push(`# from,${from}`);
  lines.push(`# to,${to}`);
  const mix = provenanceMix(recs);
  lines.push(`# method_version,0.1.0`);
  lines.push(
    `# reference_record,${mix.archived} rows observed from the NASA FIRMS archive (keyed Area API) and ${mix.live} from the live window; the remaining ${mix.model} rows are a deterministic reconstruction calibrated to the live FIRMS window and are NOT the official NASA archive`,
  );
  lines.push(`# archive_span,${mix.first && mix.last ? `${mix.first} to ${mix.last}` : 'not attached'}`);
  lines.push(`# units_hotspots,VIIRS-equivalent hotspot count per day; confidence interval is 90%`);
  lines.push('');
  lines.push('date,year,month,day_of_year,modis_detections,viirs_snpp_detections,noaa20_detections,noaa21_detections,raw_sensor_count,harmonized_viirs_equiv,ci_low_90,ci_high_90,frp_mw,trust,provisional,source,live_observation,instruments_published');
  for (const r of recs) {
    const obs = r.observed;
    lines.push([
      r.date, r.year, r.month, r.doy, r.modis, r.viirs, r.noaa20, r.noaa21, r.raw,
      dailyValue(r, 'hotspots', mode), r.lo.toFixed(2), r.hi.toFixed(2), r.frp.toFixed(2),
      r.trust, r.provisional ? 'yes' : 'no', r.source, r.live ? 'yes' : 'no',
      obs ? (['modis', 'viirs', 'noaa20', 'noaa21'] as const).filter((k) => obs[k]).join('+') || 'none' : 'reconstructed',
    ].join(','));
  }
  const filename = `continuum_${region.id}_${from}_${to}.csv`;
  download('\ufeff' + lines.join('\n'), filename, 'text/csv;charset=utf-8');
  return { rows: recs.length, filename };
}

/** The detections whose point geometry is real, clipped to the searched area and window. */
function hotspotsInWindow(region: Region, fires: LiveFire[], from: string, to: string): LiveFire[] {
  const [w, s, e, n] = region.bbox;
  return fires.filter((f) => {
    if (f[0] < s || f[0] > n || f[1] < w || f[1] > e) return false;
    const d = new Date(f[5] * 1000).toISOString().slice(0, 10);
    return d >= from && d <= to;
  });
}

/** The challenge's "downloadable CSV file of hot spots": one row per detected point, not per day. */
export function exportHotspotCSV(region: Region, fires: LiveFire[], from: string, to: string): { rows: number; filename: string } {
  const inWindow = hotspotsInWindow(region, fires, from, to);
  const lines: string[] = [];
  lines.push('# Continuum v1.0 — hotspot detections for one search');
  lines.push(`# area_id,${region.id}`);
  lines.push(`# area_name,"${region.name.replace(/"/g, "'")}"`);
  lines.push(`# bbox_west_south_east_north,${region.bbox.join(',')}`);
  lines.push(`# window_from,${from}`);
  lines.push(`# window_to,${to}`);
  lines.push('# source,NASA FIRMS near-real-time public CSV (real satellite detections, unrounded instrument values)');
  lines.push('# coverage,Geometry exists only for the live FIRMS window. Earlier points are not downloaded by this build; the long record is the daily CSV.');
  lines.push('');
  lines.push('time_utc,date,latitude_east,longitude_east,sensor,frp_mw,confidence');
  for (const f of inWindow) {
    const iso = new Date(f[5] * 1000).toISOString();
    lines.push([iso, iso.slice(0, 10), f[0], f[1], SENSOR_SHORT[f[3]], f[2], ['low', 'nominal', 'high'][f[4]].toUpperCase()].join(','));
  }
  const filename = `continuum_${region.id}_hotspots_${from}_${to}.csv`;
  download('\ufeff' + lines.join('\n'), filename, 'text/csv;charset=utf-8');
  return { rows: inWindow.length, filename };
}

export function exportGeoJSON(region: Region, fires: LiveFire[], from: string, to: string): { rows: number; filename: string } {
  const [w, s, e, n] = region.bbox;
  const inWindow = hotspotsInWindow(region, fires, from, to);
  const features = [
    {
      type: 'Feature' as const,
      properties: { kind: 'area_of_interest', id: region.id, name: region.name, area_km2: region.areaKm2 },
      geometry: { type: 'Polygon' as const, coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
    },
    ...inWindow.map((f) => ({
      type: 'Feature' as const,
      properties: {
        kind: 'hotspot',
        sensor: SENSOR_SHORT[f[3]],
        frp_mw: f[2],
        confidence: ['low', 'nominal', 'high'][f[4]],
        time_utc: new Date(f[5] * 1000).toISOString(),
      },
      geometry: { type: 'Point' as const, coordinates: [f[1], f[0]] },
    })),
  ];
  const collection = {
    type: 'FeatureCollection' as const,
    name: `Continuum ${region.name}`,
    metadata: {
      method_version: '0.1.0',
      generated: new Date().toISOString(),
      source: 'NASA FIRMS rolling public CSV archive (real detections)',
      window: { from, to },
      note: 'Geometry is available for the live FIRMS window only. The long reference record is tabular.',
    },
    features,
  };
  const filename = `continuum_${region.id}_${from}_${to}.geojson`;
  download(JSON.stringify(collection, null, 2), filename, 'application/geo+json');
  return { rows: inWindow.length, filename };
}

export function exportSVGAsPNG(svg: SVGSVGElement | null, filename: string): Promise<boolean> {
  if (!svg) return Promise.resolve(false);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const rect = svg.getBoundingClientRect();
  const width = Math.max(640, Math.round(rect.width));
  const height = Math.round(rect.height || width * 0.5);
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  const data = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([data], { type: 'image/svg+xml;charset=utf-8' }));
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width * 2;
      canvas.height = height * 2;
      const g = canvas.getContext('2d');
      if (!g) {
        resolve(false);
        return;
      }
      g.fillStyle = '#060b12';
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) download(blob, filename, 'image/png');
        URL.revokeObjectURL(url);
        resolve(Boolean(blob));
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(false);
    };
    img.src = url;
  });
}
