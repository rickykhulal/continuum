import { forwardRef, useEffect, useId, useMemo, useState } from 'react';
import type { DailyRecord, LiveFire, Region } from '../lib/types';
import { SENSOR_COLORS, SENSOR_SHORT } from '../lib/types';
import { decodeLand, fittedMapBounds, type PolygonRings, type Topology } from '../lib/geo';
import { REGIONS, livePointsForRegion, sensorCount } from '../lib/data';
import { fireColor, longDate, nf, shortDate } from '../lib/format';
import { gibsBasemapUrl } from '../lib/basemap';

let landPromise: Promise<PolygonRings[]> | null = null;
function loadLand(): Promise<PolygonRings[]> {
  if (!landPromise) {
    landPromise = fetch(`${import.meta.env.BASE_URL || './'}data/countries-50m.json`)
      .then((r) => r.json())
      .then((t: Topology) => decodeLand(t, 'countries'))
      .catch(() => []);
  }
  return landPromise;
}

function dayOf(t: number): string {
  return new Date(t * 1000).toISOString().slice(0, 10);
}

const BASE = import.meta.env.BASE_URL || './';
const BASEMAP = `${BASE}textures/earth_day_8k.jpg`;
const PILOT_IDS = new Set(REGIONS.map((r) => r.id));
// Holds preloaders until they settle so a rapid AOI change cannot garbage-collect an in-flight crop.
const pendingBasemaps = new Map<string, HTMLImageElement>();

export const RegionMap = forwardRef<SVGSVGElement, {
  region: Region;
  fires: LiveFire[];
  day?: string | null;
  dayRecord?: DailyRecord | null;
  onSelectDay?: (date: string | null) => void;
  maxHeight?: number;
}>(function RegionMap({ region, fires, day, dayRecord, onSelectDay, maxHeight = 420 }, ref) {
  const [land, setLand] = useState<PolygonRings[]>([]);
  const [mode, setMode] = useState<'points' | 'pixels'>('points');
  const [sharpFailed, setSharpFailed] = useState(false);
  const clipId = `mapClip${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  useEffect(() => {
    let alive = true;
    loadLand().then((p) => {
      if (alive) setLand(p);
    });
    return () => {
      alive = false;
    };
  }, []);

  const W = 760;
  const pad = 12;
  const innerW = W - pad * 2;
  const H = Math.max(260, Math.round(maxHeight));
  const innerH = H - pad * 2;
  const [w, s, e, n] = region.bbox;
  // One degree of longitude is cos(lat) of a degree of latitude; expanding the padded
  // bbox to the map-box aspect keeps the imagery undistorted instead of stretching it.
  const bounds = useMemo(() => fittedMapBounds(region.bbox, innerW / innerH), [region.bbox, innerW, innerH]);
  const midLat = (bounds.s + bounds.n) / 2;
  const spanLon = Math.max(1e-6, bounds.e - bounds.w);
  const spanLat = Math.max(1e-6, bounds.n - bounds.s);

  const project = (lon: number, lat: number): [number, number] => [
    pad + ((lon - bounds.w) / spanLon) * innerW,
    pad + ((bounds.n - lat) / spanLat) * innerH,
  ];

  const windowPoints = useMemo(() => livePointsForRegion(region, fires), [region, fires]);
  const points = useMemo(() => (day ? livePointsForRegion(region, fires, day) : windowPoints), [region, fires, day, windowPoints]);
  const latestLiveDay = useMemo(() => {
    let last = '';
    for (const f of windowPoints) {
      const d = dayOf(f[5]);
      if (d > last) last = d;
    }
    return last || null;
  }, [windowPoints]);
  const kmPerPx = (111.32 * Math.cos((midLat * Math.PI) / 180) * spanLon) / Math.max(1, innerW);

  const sharpBasemap = useMemo(() => {
    if (PILOT_IDS.has(region.id)) return `${BASE}data/basemaps/${region.id}.jpg`;
    return gibsBasemapUrl(bounds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region.id, bounds.w, bounds.s, bounds.e, bounds.n]);

  // Swapping the <image> href while the previous crop is still in flight makes the browser abort
  // it, so hold the old crop until the new one has decoded.
  const [shownBasemap, setShownBasemap] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSharpFailed(false);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      pendingBasemaps.delete(sharpBasemap);
      if (alive) setShownBasemap(sharpBasemap);
    };
    img.onerror = () => {
      pendingBasemaps.delete(sharpBasemap);
      if (alive) setSharpFailed(true);
    };
    pendingBasemaps.set(sharpBasemap, img);
    img.src = sharpBasemap;
    return () => {
      alive = false;
    };
  }, [sharpBasemap]);

  const landPath = useMemo(() => {
    const out: string[] = [];
    for (const poly of land) {
      for (const ring of poly) {
        let inside = 0;
        let d = '';
        for (let i = 0; i < ring.length; i++) {
          const [lon, lat] = ring[i];
          const inView = lon >= bounds.w - 2 && lon <= bounds.e + 2 && lat >= bounds.s - 2 && lat <= bounds.n + 2;
          if (inView) inside++;
          const [x, y] = project(lon, lat);
          d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
        }
        if (inside > 1) out.push(`${d}Z`);
      }
    }
    return out.join(' ');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [land, bounds.w, bounds.e, bounds.s, bounds.n, H]);

  const marks = useMemo(() => {
    const stride = points.length > 2600 ? Math.ceil(points.length / 2600) : 1;
    const out: { x: number; y: number; r: number; size: number; c: string; label: string; sensor: number }[] = [];
    for (let i = 0; i < points.length; i += stride) {
      const f = points[i];
      const [x, y] = project(f[1], f[0]);
      const sensor = f[3];
      const pixelKm = sensor === 0 ? 1 : 0.375;
      const trueSize = pixelKm / Math.max(1e-4, kmPerPx);
      const size = Math.max(sensor === 0 ? 4.5 : 2.8, Math.min(16, trueSize));
      out.push({
        x,
        y,
        r: Math.max(1.4, Math.min(7.5, 1.2 + Math.sqrt(Math.max(0.1, f[2])) * 0.42)),
        size,
        c: SENSOR_COLORS[sensor] ?? '#ff8a3d',
        label: `${SENSOR_SHORT[sensor]} · ${nf(f[2], 1)} MW · ${longDate(dayOf(f[5]))}`,
        sensor,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, H, kmPerPx]);

  const counts = useMemo(() => {
    const c = [0, 0, 0, 0];
    for (const f of points) c[f[3]]++;
    return c;
  }, [points]);

  const [cx1, cy1] = project(w, n);
  const [cx2, cy2] = project(e, s);
  const gridLon = Math.max(0.5, Math.round(spanLon / 6));
  const gridLat = Math.max(0.5, Math.round(spanLat / 5));
  const lonTicks: number[] = [];
  for (let lon = Math.ceil(bounds.w / gridLon) * gridLon; lon < bounds.e; lon += gridLon) lonTicks.push(Math.round(lon * 100) / 100);
  const latTicks: number[] = [];
  for (let lat = Math.ceil(bounds.s / gridLat) * gridLat; lat < bounds.n; lat += gridLat) latTicks.push(Math.round(lat * 100) / 100);

  // The 8K equirectangular mosaic is drawn in plate carrée, exactly matching
  // this projection, then cropped to the viewport. No tile server, no blur.
  const worldW = (360 / spanLon) * innerW;
  const worldH = (180 / spanLat) * innerH;
  const imgX = pad + ((-180 - bounds.w) / spanLon) * innerW;
  const imgY = pad + ((bounds.n - 90) / spanLat) * innerH;

  const archiveDay = !!day && points.length === 0;
  const emptyWindow = !day && points.length === 0;

  return (
    <div className="region-map">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="region-map-svg"
        role="img"
        aria-label={`Map of ${region.name}. ${nf(points.length)} ${day ? `live fire detections on ${day}` : 'live fire detections in the rolling window'}. NASA Blue Marble basemap.`}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={pad} y={pad} width={innerW} height={innerH} rx={6} />
          </clipPath>
          <filter id="fireGlow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="2.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="mapEdge" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#04080e" stopOpacity="0.55" />
            <stop offset="18%" stopColor="#04080e" stopOpacity="0" />
            <stop offset="82%" stopColor="#04080e" stopOpacity="0" />
            <stop offset="100%" stopColor="#04080e" stopOpacity="0.6" />
          </linearGradient>
        </defs>
        <rect width={W} height={H} fill="#050b12" />
        <g clipPath={`url(#${clipId})`}>
          <image
            href={BASEMAP}
            x={imgX}
            y={imgY}
            width={worldW}
            height={worldH}
            preserveAspectRatio="none"
            className="map-basemap"
          />
          {!sharpFailed && shownBasemap === sharpBasemap && (
            <image
              href={shownBasemap}
              x={pad}
              y={pad}
              width={innerW}
              height={innerH}
              preserveAspectRatio="none"
              className="map-basemap map-basemap-sharp"
            />
          )}
          <rect x={pad} y={pad} width={innerW} height={innerH} className="map-shade" />
          {lonTicks.map((lon) => {
            const [x] = project(lon, 0);
            return <line key={`lon${lon}`} x1={x} x2={x} y1={pad} y2={H - pad} className="map-grid" />;
          })}
          {latTicks.map((lat) => {
            const [, y] = project(0, lat);
            return <line key={`lat${lat}`} x1={pad} x2={W - pad} y1={y} y2={y} className="map-grid" />;
          })}
          <path d={landPath} fill="none" stroke="rgba(232,244,255,.4)" strokeWidth={0.55} strokeLinejoin="round" />
          <rect
            x={cx1} y={cy1} width={Math.max(2, cx2 - cx1)} height={Math.max(2, cy2 - cy1)}
            fill="rgba(255,170,110,.035)" stroke="#ffab73" strokeWidth={1.1} strokeDasharray="5 4"
          />
          {mode === 'pixels' && marks.map((p, i) => (
            <rect
              key={`p${i}`}
              x={p.x - p.size / 2}
              y={p.y - p.size / 2}
              width={p.size}
              height={p.size}
              rx={0.8}
              fill={p.c}
              fillOpacity={0.32}
              stroke={p.c}
              strokeOpacity={0.75}
              strokeWidth={0.5}
            >
              <title>{p.label}</title>
            </rect>
          ))}
          {marks.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={mode === 'pixels' ? Math.max(0.9, p.r * 0.42) : p.r} fill={p.c} fillOpacity={0.88} filter="url(#fireGlow)">
              <title>{p.label}</title>
            </circle>
          ))}
          <rect x={pad} y={pad} width={innerW} height={innerH} fill="url(#mapEdge)" pointerEvents="none" />
          {lonTicks.map((lon) => {
            const [x] = project(lon, 0);
            return <text key={`lonT${lon}`} x={x + 3} y={H - pad - 4} className="map-tick">{Math.abs(lon)}°{lon < 0 ? 'W' : lon > 0 ? 'E' : ''}</text>;
          })}
          {latTicks.map((lat) => {
            const [, y] = project(0, lat);
            if (y < pad + 46) return null;
            return <text key={`latT${lat}`} x={pad + 4} y={y - 3} className="map-tick">{Math.abs(lat)}°{lat < 0 ? 'S' : 'N'}</text>;
          })}
        </g>
        <rect x={pad} y={pad} width={innerW} height={innerH} rx={6} fill="none" stroke="rgba(160,190,220,.18)" />
        <g className="map-corner">
          <text x={pad + 8} y={pad + 16}>{region.shortName.toUpperCase()}</text>
          <text x={pad + 8} y={pad + 30} className="map-coord">
            {region.center[0].toFixed(2)}°, {region.center[1].toFixed(2)}° · {nf(region.areaKm2)} km²
          </text>
        </g>
        <g className="map-scale" transform={`translate(${W - 132},${H - 24})`}>
          <line x1={0} x2={76} y1={0} y2={0} />
          <line x1={0} x2={0} y1={-4} y2={4} />
          <line x1={76} x2={76} y1={-4} y2={4} />
          <text x={80} y={3}>{Math.round((76 / innerW) * spanLon * 111 * Math.cos((midLat * Math.PI) / 180))} km</text>
        </g>
      </svg>

      <div className="region-map-foot">
        <span>
          {day ? longDate(day) : 'Live FIRMS window'} · {nf(points.length)} {day ? 'detections on this day' : 'detections'}
        </span>
        <div className="map-modes" role="group" aria-label="Footprint display">
          <button type="button" className={mode === 'points' ? 'active' : ''} aria-pressed={mode === 'points'} onClick={() => setMode('points')}>Detections</button>
          <button type="button" className={mode === 'pixels' ? 'active' : ''} aria-pressed={mode === 'pixels'} onClick={() => setMode('pixels')}>Pixels</button>
        </div>
        <span className="map-legend">
          {SENSOR_SHORT.map((sname, i) =>
            counts[i] ? (
              <span key={sname}><i style={{ background: SENSOR_COLORS[i] }} />{sname} {nf(counts[i])}</span>
            ) : null,
          )}
        </span>
      </div>

      {archiveDay && (
        <div className="map-notice">
          <span className="eyebrow">Archive day · counts only</span>
          <strong>{longDate(day!)} is inside the reconstructed record</strong>
          <p>
            {dayRecord
              ? `${nf(dayRecord.harmonized, 1)} VIIRS-equivalent detections from ${sensorCount(dayRecord, 'modis')} MODIS + ${sensorCount(dayRecord, 'viirs') + sensorCount(dayRecord, 'noaa20') + sensorCount(dayRecord, 'noaa21')} VIIRS detections. The long record stores daily counts and uncertainty, not point geometry.`
              : 'The long record stores daily counts and uncertainty, not point geometry.'}
          </p>
          {onSelectDay && latestLiveDay && (
            <button type="button" className="btn btn-small btn-ghost" onClick={() => onSelectDay(latestLiveDay)}>
              Open the latest live day · {shortDate(latestLiveDay)} →
            </button>
          )}
        </div>
      )}

      {emptyWindow && (
        <div className="map-notice">
          <span className="eyebrow">No live detections in view</span>
          <strong>Absence of a detection is not absence of fire</strong>
          <p>The rolling FIRMS window has no kept hotspots inside this AOI. The long record and its uncertainty interval remain available in the calendar and CSV.</p>
        </div>
      )}
    </div>
  );
});

export function FireLegend() {
  return (
    <div className="fire-legend">
      {SENSOR_SHORT.map((s, i) => (
        <span key={s}><i style={{ background: SENSOR_COLORS[i] }} />{s}</span>
      ))}
    </div>
  );
}

export function fireColorFor(frp: number): string {
  return fireColor(Math.min(0.99, Math.sqrt(Math.max(0, frp)) / 12));
}
