import { useEffect, useRef, useState, useMemo } from 'react';
import { useLiveFirms } from '../lib/liveClient';
import { ALLOW_MOCK_LIVE } from '../lib/liveClient';
import * as maplibregl from 'maplibre-gl';
import type { MapGeoJSONFeature } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { DailyRecord, LiveFire, Region, SensorId } from '../lib/types';
import { SENSOR_COLORS, SENSOR_SHORT, SENSOR_NAMES } from '../lib/types';
import { livePointsForRegion } from '../lib/data';
import { nf, shortDate } from '../lib/format';

const CONFIDENCE_LABEL: Record<number, string> = {
  0: 'Low',
  1: 'Nominal',
  2: 'High',
};

interface LiveMapProps {
  region: Region;
  fires: LiveFire[];
  day?: string | null;
  dayRecord?: DailyRecord | null;
  onSelectDay?: (date: string | null) => void;
  maxHeight?: number;
  /** Dynamic live-window bounds shown in the map header (from/to state of the date picker). */
  windowStart?: string | null;
  windowEnd?: string | null;
}

export function LiveMap({
  region,
  fires,
  day,
  dayRecord,
  onSelectDay,
  maxHeight = 460,
  windowStart,
  windowEnd,
}: LiveMapProps) {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [selectedSensor, setSelectedSensor] = useState<number | 'all'>('all');
  const [displayMode, setDisplayMode] = useState<'detections' | 'pixels'>('detections');
  const [frpScaling, setFrpScaling] = useState<boolean>(false);
  const [pitch, setPitch] = useState<number>(0);
  const [bearing, setBearing] = useState<number>(0);
  const [popupInfo, setPopupInfo] = useState<{
    lngLat: [number, number];
    satellite: string;
    acqTime: string;
    confidence: string;
    frp: number;
  } | null>(null);
  const [isStale, setIsStale] = useState<boolean>(false);
  const [dayOffset, setDayOffset] = useState<number>(7); // 7 = all 7 days

  // Transport state of the live endpoint. Provenance and freshness stay on the
  // payload; this hook only reports how the request itself went.
  const live = useLiveFirms();

  const liveStatusLabel =
    live.status === 'loading'
      ? null
      : live.status === 'live'
        ? 'LIVE'
        : live.status === 'stale'
          ? 'LIVE STALE'
          : live.status === 'offline'
            ? 'Live data temporarily unavailable'
            : 'Live feed not configured';

  // Compute live window points for this region
  const regionPoints = useMemo(() => {
    return livePointsForRegion(region, fires);
  }, [region, fires]);

  // Timestamps span for slider
  const { minTime, maxTime } = useMemo(() => {
    if (!regionPoints.length) return { minTime: 0, maxTime: 0 };
    let min = Infinity;
    let max = -Infinity;
    for (const p of regionPoints) {
      const t = p[5];
      if (t < min) min = t;
      if (t > max) max = t;
    }
    return { minTime: min, maxTime: max };
  }, [regionPoints]);

  // Filter points based on sensor and day slider
  const filteredPoints = useMemo(() => {
    return regionPoints.filter((p) => {
      // Sensor filter
      if (selectedSensor !== 'all' && p[3] !== selectedSensor) return false;

      // Day slider filter (if minTime and maxTime are valid)
      if (minTime && maxTime && maxTime > minTime && dayOffset < 7) {
        const span = maxTime - minTime;
        const cutoff = minTime + (span * dayOffset) / 7;
        if (p[5] > cutoff) return false;
      }

      // Single day filter if selected from calendar
      if (day) {
        const dStr = new Date(p[5] * 1000).toISOString().slice(0, 10);
        if (dStr !== day) return false;
      }

      return true;
    });
  }, [regionPoints, selectedSensor, dayOffset, day, minTime, maxTime]);

  // Initialize MapLibre GL
  useEffect(() => {
    if (!mapContainer.current) return;

    // Use NASA GIBS EPSG:3857 Web Mercator WMTS as base layer. Blue Marble Next Generation
    // carries a fixed-date (2004-01-01) global mosaic that always has imagery, so the base
    // map never goes black even when the live FIRMS feed is down. GoogleMapsCompatible tile
    // grid (y from the top) matches MapLibre's default (tms: false).
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          'gibs-imagery': {
            type: 'raster',
            tiles: [
              'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/2004-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',
            ],
            tileSize: 256,
            minzoom: 1,
            maxzoom: 8,
            attribution: '© NASA Worldview / GIBS',
          },
        },
        layers: [
          {
            id: 'gibs-layer',
            type: 'raster',
            source: 'gibs-imagery',
            minzoom: 0,
            maxzoom: 8,
          },
        ],
      },
      center: [region.center[1], region.center[0]],
      zoom: 3,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    // Log tile/render errors so a black map is diagnosable from the browser console.
    map.on('error', (e: any) => {
      console.error('[LiveMap] MapLibre error:', e?.error ?? e?.message ?? e);
    });

    map.on('load', () => {
      // Add AOI outline
      const [w, s, e, n] = region.bbox;
      const aoiPolygon: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [w, s],
                  [e, s],
                  [e, n],
                  [w, n],
                  [w, s],
                ],
              ],
            },
            properties: {},
          },
        ],
      };

      map.addSource('aoi-source', {
        type: 'geojson',
        data: aoiPolygon,
      });

      map.addLayer({
        id: 'aoi-outline',
        type: 'line',
        source: 'aoi-source',
        paint: {
          'line-color': '#ff9a6a',
          'line-width': 1.5,
          'line-dasharray': [3, 2],
        },
      });

      // Add fire points source
      map.addSource('fires-source', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });

      // Add circle layer
      map.addLayer({
        id: 'fires-layer',
        type: 'circle',
        source: 'fires-source',
        paint: {
          'circle-radius': frpScaling
            ? ['interpolate', ['linear'], ['get', 'frp'], 0, 3, 30, 7, 100, 13, 300, 20]
            : displayMode === 'pixels' ? 3 : 4.5,
          'circle-color': [
            'match',
            ['get', 'sensor'],
            0, SENSOR_COLORS[0],
            1, SENSOR_COLORS[1],
            2, SENSOR_COLORS[2],
            3, SENSOR_COLORS[3],
            '#ff8a3d',
          ],
          'circle-blur': frpScaling ? 0.35 : 0,
          'circle-opacity': displayMode === 'pixels' ? 0.45 : 0.85,
          'circle-stroke-width': displayMode === 'pixels' ? 0 : 1,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-opacity': 0.6,
        },
      });

      // Click on fire point for popup
      map.on('click', 'fires-layer', (e: { features?: MapGeoJSONFeature[] }) => {
        if (!e.features || !e.features[0]) return;
        const f = e.features[0];
        const props = f.properties || {};
        const geom = f.geometry as GeoJSON.Point;

        setPopupInfo({
          lngLat: [geom.coordinates[0], geom.coordinates[1]],
          satellite: SENSOR_NAMES[props.sensor as SensorId] ?? 'Unknown',
          acqTime: new Date(props.time * 1000).toUTCString(),
          confidence: CONFIDENCE_LABEL[props.confidence] ?? 'Nominal',
          frp: props.frp,
        });
      });

      map.on('mouseenter', 'fires-layer', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'fires-layer', () => {
        map.getCanvas().style.cursor = '';
      });

      // Fit to AOI bounds with padding
      map.fitBounds(
        [
          [w, s],
          [e, n],
        ],
        { padding: 40, duration: 800 }
      );
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [region.id]);

  // Update bounds when region changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const [w, s, e, n] = region.bbox;
    map.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: 40, duration: 800 }
    );

    const aoiSource = map.getSource('aoi-source') as maplibregl.GeoJSONSource | undefined;
    if (aoiSource) {
      aoiSource.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [w, s],
                  [e, s],
                  [e, n],
                  [w, n],
                  [w, s],
                ],
              ],
            },
            properties: {},
          },
        ],
      });
    }
  }, [region]);

  // Update fire points GeoJSON when filtered points or mode changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const firesSource = map.getSource('fires-source') as maplibregl.GeoJSONSource | undefined;
    if (!firesSource) return;

    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: filteredPoints.map((p, idx) => ({
        type: 'Feature',
        id: idx,
        geometry: {
          type: 'Point',
          coordinates: [p[1], p[0]],
        },
        properties: {
          frp: p[2],
          sensor: p[3],
          confidence: p[4],
          time: p[5],
        },
      })),
    };

    firesSource.setData(geojson);

    // Update layer paint properties if mode changed
    if (map.getLayer('fires-layer')) {
      map.setPaintProperty('fires-layer', 'circle-radius', frpScaling
        ? ['interpolate', ['linear'], ['get', 'frp'], 0, 3, 30, 7, 100, 13, 300, 20]
        : (displayMode === 'pixels' ? 3 : 4.5));
      map.setPaintProperty('fires-layer', 'circle-blur', frpScaling ? 0.35 : 0);
      map.setPaintProperty('fires-layer', 'circle-opacity', displayMode === 'pixels' ? 0.45 : 0.85);
      map.setPaintProperty('fires-layer', 'circle-stroke-width', (displayMode === 'pixels' || frpScaling) ? 0 : 1);
    }
  }, [filteredPoints, displayMode, frpScaling]);

  // Checks if the bundled static snapshot is still reachable (staleness detection only; no live data fetch)
  useEffect(() => {
    const interval = setInterval(() => {
      // Refresh check against the bundled snapshot, not the live endpoint
      fetch(`${import.meta.env.BASE_URL || './'}data/live_fires.json`)
        .then((res) => {
          setIsStale(!res.ok);
        })
        .catch(() => {
          setIsStale(true);
        });
    }, 10 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  const counts = useMemo(() => {
    const c: Record<SensorId, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
    for (const p of regionPoints) {
      if (c[p[3]] !== undefined) c[p[3]]++;
    }
    return c;
  }, [regionPoints]);

  return (
    <div className="live-map-wrapper">
      <div className="live-map-header">
        <div className="live-map-meta">
          <span className="live-map-title">Interactive Live Footprint</span>
          <span className="live-map-subtitle">
            NASA GIBS Base · {windowStart && windowEnd ? `${shortDate(windowStart)} – ${shortDate(windowEnd)}` : 'FIRMS NRT 7-Day Window'}
          </span>
        </div>
        <div className="live-map-actions">
          <div className="live-map-mode-toggle" role="group" aria-label="Display mode">
            <button
              type="button"
              className={displayMode === 'detections' ? 'active' : ''}
              onClick={() => setDisplayMode('detections')}
            >
              Detections
            </button>
            <button
              type="button"
              className={displayMode === 'pixels' ? 'active' : ''}
              onClick={() => setDisplayMode('pixels')}
            >
              Pixels
            </button>
          </div>
          <div className="live-map-view-controls" role="group" aria-label="View controls">
            <button type="button" className={frpScaling ? 'active' : ''} onClick={() => setFrpScaling((s) => !s)}>FRP</button>
            <button type="button" className={pitch ? 'active' : ''} onClick={() => {
              const nextPitch = pitch ? 0 : 45;
              setPitch(nextPitch);
              mapRef.current?.easeTo({ pitch: nextPitch, duration: 500 });
            }}>Tilt</button>
            <button type="button" className={bearing ? 'active' : ''} onClick={() => {
              const nextBearing = bearing ? 0 : 45;
              setBearing(nextBearing);
              mapRef.current?.easeTo({ bearing: nextBearing, duration: 500 });
            }}>Rotate</button>
            <button type="button" onClick={() => {
              setPitch(0); setBearing(0);
              mapRef.current?.easeTo({ pitch: 0, bearing: 0, duration: 500 });
            }}>Reset</button>
          </div>
          {isStale && <span className="stale-badge">Telemetry Stale</span>}
          {ALLOW_MOCK_LIVE && <span className="demo-data-badge">DEMO DATA</span>}
          {!ALLOW_MOCK_LIVE && liveStatusLabel && (
            <span className="live-status-badge" data-status={live.status} title={live.error ?? undefined}>
              {liveStatusLabel}
            </span>
          )}
        </div>
      </div>

      <div
        ref={mapContainer}
        className="live-map-canvas"
        style={{ height: `${maxHeight}px`, width: '100%', position: 'relative' }}
      >
        {popupInfo && (
          <div
            className="map-popup-card"
            style={{
              position: 'absolute',
              top: '12px',
              left: '12px',
              zIndex: 10,
              background: 'rgba(15, 17, 21, 0.95)',
              border: '1px solid var(--line-bright, #ff9a6a)',
              borderRadius: '6px',
              padding: '10px 14px',
              color: '#fff',
              fontSize: '12px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
              maxWidth: '240px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <strong style={{ color: '#ff9a6a' }}>{popupInfo.satellite}</strong>
              <button
                type="button"
                onClick={() => setPopupInfo(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#888',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: '14px',
                }}
              >
                ✕
              </button>
            </div>
            <div>Time: {popupInfo.acqTime}</div>
            <div>Confidence: {popupInfo.confidence}</div>
            <div>FRP: {popupInfo.frp.toFixed(1)} MW</div>
            <div style={{ fontSize: '10px', color: '#888', marginTop: '4px' }}>
              Lat/Lon: {popupInfo.lngLat[1].toFixed(3)}°, {popupInfo.lngLat[0].toFixed(3)}°
            </div>
          </div>
        )}
      </div>

      <div className="live-map-controls">
        <div className="sensor-filters">
          <button
            type="button"
            className={selectedSensor === 'all' ? 'active' : ''}
            onClick={() => setSelectedSensor('all')}
          >
            All Sensors ({regionPoints.length})
          </button>
          {SENSOR_SHORT.map((name, idx) => (
            <button
              key={name}
              type="button"
              className={selectedSensor === idx ? 'active' : ''}
              style={{
                borderColor: selectedSensor === idx ? SENSOR_COLORS[idx] : undefined,
                color: selectedSensor === idx ? SENSOR_COLORS[idx] : undefined,
              }}
              onClick={() => setSelectedSensor(selectedSensor === idx ? 'all' : idx)}
            >
              <span
                className="sensor-dot"
                style={{
                  display: 'inline-block',
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  backgroundColor: SENSOR_COLORS[idx],
                  marginRight: '5px',
                }}
              />
              {name} ({counts[idx as SensorId] ?? 0})
            </button>
          ))}
        </div>

        <div className="live-map-slider-row">
          <label htmlFor="time-slider">7-Day Window Filter: Day {dayOffset} of 7</label>
          <input
            id="time-slider"
            type="range"
            min="1"
            max="7"
            step="1"
            value={dayOffset}
            onChange={(e) => setDayOffset(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="live-map-footer">
        <span>Showing {nf(filteredPoints.length)} live detections in AOI</span>
        <span className="live-map-refresh-hint">
          Bundled FIRMS NRT snapshot · Data loaded at page load · Reload page for latest
        </span>
      </div>
    </div>
  );
}
