import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import {
  circleRing,
  geometryToCircle,
  inspectGeometry,
  polygonAreaKm2,
  estimateDataVolume,
  simplifyRing,
  MAX_VERTICES,
  type LonLat,
  type RingGeo,
} from '../lib/geometry';
import { customRegion } from '../data/places';
import { bboxAreaKm2 } from '../lib/geo';
import { livePointsForRegion } from '../lib/data';
import { nf } from '../lib/format';
import { Badge } from './ui';

/**
 * FR-01 / FR-05: draw a rectangle, a circle or a free polygon and analyse it — by pointer or by
 * keyboard alone (FR-32). The editor is a planar lat/lon canvas — it is deliberately not painted on
 * the 3D globe — and the resolved area becomes an equal-area circle AOI, the same approximation the
 * read-only API uses.
 */
type Mode = 'rect' | 'circle' | 'polygon';
type Box = { w: number; s: number; e: number; n: number };
type Spot = { lat: number; lon: number };

const W = 420;
const H = 260;
// Canvas window in degrees, independent of the shape being drawn: a fixed window keeps keyboard step
// sizes constant and keeps any full-window shape inside the 250,000 km² ceiling.
const VIEW_HALF_LAT = 1.0;
const VIEW_HALF_LON = 1.4;
const KM_PER_DEG = 111.32;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const MODE_LABEL: Record<Mode, string> = { rect: 'rectangle', circle: 'circle', polygon: 'polygon' };

function viewFor(center: [number, number]): Box {
  const [lat, lon] = center;
  return { w: lon - VIEW_HALF_LON, s: lat - VIEW_HALF_LAT, e: lon + VIEW_HALF_LON, n: lat + VIEW_HALF_LAT };
}

export function DrawArea() {
  const store = useStore();
  const [mode, setMode] = useState<Mode>('rect');
  const [view, setView] = useState<Box>(() => viewFor(store.region.center));
  const [bounds, setBounds] = useState<Box>({ w: 0, s: 0, e: 0, n: 0 });
  const [pen, setPen] = useState<Spot>({ lat: store.region.center[0], lon: store.region.center[1] });
  const [anchor, setAnchor] = useState<Spot | null>(null);
  const [radiusKm, setRadiusKm] = useState(140);
  const [points, setPoints] = useState<RingGeo>([]);
  const [closed, setClosed] = useState(false);
  const [status, setStatus] = useState('Keyboard: arrow keys move the pen, Shift plus arrow moves four steps, Enter or Space places, C closes a polygon, Backspace undoes, Escape clears, F fits and R resets the view.');
  const dragRef = useRef(false);
  // The anchor lives in a ref as well as in state: a drag reads it from a `mousemove` that can arrive
  // in the same tick as the `mousedown` that set it, before React has re-rendered, so a state-only read
  // would see the previous render's null and drop the first move.
  const anchorRef = useRef<Spot | null>(null);
  const setAnchored = (spot: Spot | null) => {
    anchorRef.current = spot;
    setAnchor(spot);
  };
  // Analysing a shape makes it the analysed region, which fires the effect below. Recording the resolved
  // centre lets the editor tell "the region moved because I drew it" (keep the shape) from "the user
  // picked another region" (discard a shape that no longer belongs to the view).
  const appliedRef = useRef<{ lat: number; lon: number } | null>(null);

  // Re-centre the window when the analysed region changes, so the canvas always shows somewhere real.
  const [centreLat, centreLon] = store.region.center;
  useEffect(() => {
    const next = viewFor([centreLat, centreLon]);
    setView(next);
    setPen({ lat: centreLat, lon: centreLon });
    const a = appliedRef.current;
    appliedRef.current = null;
    if (a && Math.abs(a.lat - centreLat) < 0.01 && Math.abs(a.lon - centreLon) < 0.01) return;
    setAnchored(null);
    setPoints([]);
    setClosed(false);
  }, [store.region.id, centreLat, centreLon]);

  const project = useMemo(() => {
    const lonSpan = Math.max(0.2, view.e - view.w);
    const latSpan = Math.max(0.2, view.n - view.s);
    const cLon = (view.w + view.e) / 2;
    const cLat = (view.s + view.n) / 2;
    return {
      toXY: (lat: number, lon: number): [number, number] => [W / 2 + ((lon - cLon) / lonSpan) * W, H / 2 - ((lat - cLat) / latSpan) * H],
      toLatLon: (x: number, y: number): LonLat => [cLat - ((y - H / 2) / H) * latSpan, cLon + ((x - W / 2) / W) * lonSpan],
      lonStep: lonSpan / 32,
      latStep: latSpan / 32,
    };
  }, [view]);

  const rings = useMemo<RingGeo[]>(() => {
    if (mode === 'polygon') return closed && points.length >= 4 ? [points] : [];
    // The canvas window is fixed, so `bounds` starts empty: no shape exists until a corner (rect/circle)
    // or a closing action (polygon) puts one there. Without this guard the circle mode would render a
    // default radius at 0,0 and offer it for analysis before the user has drawn anything.
    if (!anchor) return [];
    const cLat = (bounds.s + bounds.n) / 2;
    const cLon = (bounds.w + bounds.e) / 2;
    if (mode === 'circle') return [circleRing(cLat, cLon, radiusKm)];
    const dLat = (bounds.n - bounds.s) * KM_PER_DEG;
    const dLon = (bounds.e - bounds.w) * KM_PER_DEG * Math.cos((cLat * Math.PI) / 180);
    if (dLat <= 0 || dLon <= 0) return [];
    return [circleRing(cLat, cLon, clamp(Math.sqrt((dLat * dLon) / 4) / Math.sqrt(Math.PI), 20, 800))];
  }, [mode, points, closed, bounds, radiusKm, anchor]);

  const report = rings.length ? inspectGeometry({ type: 'Polygon', coordinates: rings }, 250000) : null;
  const areaKm2 = rings.length ? polygonAreaKm2(rings) : 0;
  const shape = rings.length ? geometryToCircle(rings) : null;
  const vertices = rings.reduce((s, r) => s + r.length, 0);

  // FR-05: what this area would cost in data, measured on the drawn area itself — not on whatever region
  // happened to be selected before. `shapeKey` is the geometry's identity: the memo must not re-run on
  // every pointer move, and must re-run whenever the drawn shape moves or resizes.
  const shapeKey = shape ? `${shape.lat.toFixed(4)}|${shape.lon.toFixed(4)}|${shape.radiusKm.toFixed(2)}` : '';
  const density = useMemo(() => {
    const region = shape ? customRegion(shape.lat, shape.lon, shape.radiusKm) : store.region;
    const fires = store.live?.fires ?? [];
    const meta = store.live?.meta;
    const area = bboxAreaKm2(region.bbox);
    if (!meta || !fires.length || area <= 0) return { region, perKm2Day: 0.02, measured: false, points: 0, days: 0 };
    const days = Math.max(
      1,
      Math.round((Date.parse(`${meta.windowEnd}T00:00:00Z`) - Date.parse(`${meta.windowStart}T00:00:00Z`)) / 86400000) + 1,
    );
    const pts = livePointsForRegion(region, fires).length;
    if (!pts) return { region, perKm2Day: 0.02, measured: false, points: pts, days };
    return { region, perKm2Day: pts / (area * days), measured: true, points: pts, days };
    // shapeKey, not shape: the geometry object is rebuilt on every render, the key is not.
  }, [store.live, store.region, shapeKey]);
  const volume = shape ? estimateDataVolume(density.region, 365, density.perKm2Day) : 0;

  /** Rectangle/circle geometry is always expressed as anchor → current point, for both input paths. */
  const extend = (from: Spot, to: Spot) => {
    setBounds({ w: Math.min(from.lon, to.lon), s: Math.min(from.lat, to.lat), e: Math.max(from.lon, to.lon), n: Math.max(from.lat, to.lat) });
    if (mode === 'circle') {
      const dLat = Math.abs(to.lat - from.lat) * KM_PER_DEG;
      const dLon = Math.abs(to.lon - from.lon) * KM_PER_DEG * Math.cos((((to.lat + from.lat) / 2) * Math.PI) / 180);
      setRadiusKm(clamp(Math.round(Math.hypot(dLat, dLon) / 2), 20, 800));
    }
  };

  const place = () => {
    if (mode === 'polygon') {
      const next = [...points, [pen.lon, pen.lat] as [number, number]];
      setPoints(next);
      setClosed(false);
      setStatus(next.length >= 4
        ? `${next.length} vertices placed. Press C to close the shape, Backspace to undo, Escape to clear.`
        : `${next.length} vertex${next.length === 1 ? '' : 'es'} placed. Four or more can be closed with C.`);
      return;
    }
    if (anchorRef.current) {
      setAnchored(null);
      setStatus(`Shape cleared — press Enter at a new corner to start again. Pen ${pen.lat.toFixed(2)}°, ${pen.lon.toFixed(2)}°.`);
      return;
    }
    setAnchored(pen);
    setBounds({ w: pen.lon, s: pen.lat, e: pen.lon, n: pen.lat });
    setRadiusKm(20);
    setStatus(mode === 'circle'
      ? `Centre set at ${pen.lat.toFixed(2)}°, ${pen.lon.toFixed(2)}°. Arrow keys drag the radius; it starts at 20 km.`
      : `First corner set at ${pen.lat.toFixed(2)}°, ${pen.lon.toFixed(2)}°. Arrow keys drag the opposite corner.`);
  };

  const onDown = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const [lat, lon] = project.toLatLon(((e.clientX - rect.left) / rect.width) * W, ((e.clientY - rect.top) / rect.height) * H);
    const spot = { lat, lon };
    setPen(spot);
    e.currentTarget.focus();
    if (mode === 'polygon') {
      const next = [...points, [lon, lat] as [number, number]];
      setPoints(next);
      setClosed(false);
      setStatus(next.length >= 4 ? `${next.length} vertices placed — close the shape to analyse it.` : `${next.length} vertices placed.`);
      return;
    }
    dragRef.current = true;
    setAnchored(spot);
    setBounds({ w: lon, s: lat, e: lon, n: lat });
    setRadiusKm(20);
  };

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const from = anchorRef.current;
    if (!dragRef.current || mode === 'polygon' || !from) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const [latRaw, lonRaw] = project.toLatLon(((e.clientX - rect.left) / rect.width) * W, ((e.clientY - rect.top) / rect.height) * H);
    const spot = { lat: clamp(latRaw, view.s, view.n), lon: clamp(lonRaw, view.w, view.e) };
    setPen(spot);
    extend(from, spot);
  };

  const onUp = () => {
    dragRef.current = false;
  };

  const closePolygon = () => {
    if (points.length < 4) {
      setStatus('A polygon needs at least four vertices before it can be closed.');
      return;
    }
    // Rings in this codebase are explicitly closed (first vertex repeated), which is what
    // inspectGeometry checks for. Appending the closing vertex here is what makes a free polygon
    // analysable at all — before it, every drawn polygon came back RING_NOT_CLOSED.
    const first = points[0];
    const last = points[points.length - 1];
    const ring = first[0] === last[0] && first[1] === last[1] ? points : [...points, [first[0], first[1]] as [number, number]];
    setPoints(ring);
    setClosed(true);
    setStatus(`Polygon closed with ${points.length} vertices — area and estimate are ready.`);
  };

  const fitView = () => {
    if (!rings.length) return;
    const ring = rings[0];
    const lats = ring.map((p) => p[1]);
    const lons = ring.map((p) => p[0]);
    const padLat = Math.max(0.05, (Math.max(...lats) - Math.min(...lats)) * 0.25);
    const padLon = Math.max(0.05, (Math.max(...lons) - Math.min(...lons)) * 0.25);
    setView({ w: Math.min(...lons) - padLon, s: Math.min(...lats) - padLat, e: Math.max(...lons) + padLon, n: Math.max(...lats) + padLat });
    setStatus('View fitted to the drawn shape.');
  };

  const onKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    const mult = e.shiftKey ? 4 : 1;
    let dLat = 0;
    let dLon = 0;
    if (e.key === 'ArrowLeft') dLon = -project.lonStep * mult;
    else if (e.key === 'ArrowRight') dLon = project.lonStep * mult;
    else if (e.key === 'ArrowUp') dLat = project.latStep * mult;
    else if (e.key === 'ArrowDown') dLat = -project.latStep * mult;
    else if (e.key === 'Enter' || e.key === 'Space' || e.key === ' ') { e.preventDefault(); place(); return; }
    else if (e.key === 'Backspace') {
      e.preventDefault();
      if (mode === 'polygon') {
        const next = points.slice(0, -1);
        setPoints(next);
        setClosed(false);
        setStatus(`${next.length} vertices remain.`);
      } else {
        setAnchored(null);
        setStatus(`Anchor cleared. Pen ${pen.lat.toFixed(2)}°, ${pen.lon.toFixed(2)}°.`);
      }
      return;
    } else if (e.key === 'Escape') {
      setPoints([]);
      setClosed(false);
      setAnchored(null);
      setStatus('Editor cleared. Arrow keys move the pen; Enter or Space places the shape.');
      return;
    } else if (e.key === 'c' || e.key === 'C') {
      if (mode !== 'polygon') {
        setStatus('Closing applies to polygon mode only.');
        return;
      }
      closePolygon();
      return;
    } else if (e.key === 'f' || e.key === 'F') {
      fitView();
      return;
    } else if (e.key === 'r' || e.key === 'R') {
      const next = viewFor([centreLat, centreLon]);
      setView(next);
      setPen({ lat: centreLat, lon: centreLon });
      setStatus('View reset to the analysed region. Pen at the centre.');
      return;
    } else return;

    e.preventDefault();
    const next = { lat: clamp(pen.lat + dLat, view.s, view.n), lon: clamp(pen.lon + dLon, view.w, view.e) };
    setPen(next);
    if (anchorRef.current && mode !== 'polygon') extend(anchorRef.current, next);
    else setStatus(`Pen ${next.lat.toFixed(2)}°, ${next.lon.toFixed(2)}° (${MODE_LABEL[mode]} mode). Press Enter${mode === 'polygon' ? ' to add a vertex' : ' to set the corner'}.`);
  };

  const apply = () => {
    if (!shape || !report?.valid) {
      store.toast(report?.reason ? `Shape rejected: ${report.reason.replace(/_/g, ' ').toLowerCase()}.` : 'Draw a shape before analysing.');
      return;
    }
    const simplified = rings[0].length > MAX_VERTICES ? simplifyRing(rings[0], 0.02) : rings[0];
    const resolved = geometryToCircle([simplified]);
    appliedRef.current = { lat: resolved.lat, lon: resolved.lon };
    store.selectCustom(resolved.lat, resolved.lon, resolved.radiusKm, `Drawn ${MODE_LABEL[mode]}`);
    store.toast(`Analysed the drawn ${MODE_LABEL[mode]}: ${nf(Math.round(areaKm2))} km² resolved to a ${Math.round(resolved.radiusKm)} km radius AOI.`);
    setStatus(`Analysed: ${nf(Math.round(areaKm2))} km² resolved to a ${Math.round(resolved.radiusKm)} km radius AOI.`);
  };

  const path = rings.length
    ? rings[0].map((p, i) => `${i === 0 ? 'M' : 'L'}${project.toXY(p[1], p[0]).map((v) => v.toFixed(1)).join(' ')}`).join(' ') + ' Z'
    : '';
  const draftPath = mode === 'polygon' && points.length ? points.map((p, i) => `${i === 0 ? 'M' : 'L'}${project.toXY(p[1], p[0]).map((v) => v.toFixed(1)).join(' ')}`).join(' ') : '';
  const [penX, penY] = project.toXY(pen.lat, pen.lon);

  return (
    <div className="draw-area" aria-label="Draw an analysis area">
      <div className="draw-modes" role="tablist">
        {(['rect', 'circle', 'polygon'] as Mode[]).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} className={`preset ${mode === m ? 'active' : ''}`} onClick={() => setMode(m)}>
            {m === 'rect' ? 'Rectangle' : m === 'circle' ? 'Circle' : 'Polygon'}
          </button>
        ))}
        {mode === 'polygon' && (
          <>
            <button type="button" className="btn btn-small btn-ghost" onClick={closePolygon} disabled={points.length < 4}>
              Close shape
            </button>
            <button type="button" className="btn btn-small btn-ghost" onClick={() => { setPoints([]); setClosed(false); setStatus('Polygon cleared.'); }}>Clear</button>
          </>
        )}
        <button type="button" className="btn btn-small btn-ghost" onClick={fitView} disabled={!rings.length}>Fit view</button>
      </div>

      <svg
        className="draw-canvas"
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="application"
        tabIndex={0}
        aria-label={`Area editor, ${MODE_LABEL[mode]} mode, ${nf(Math.round(areaKm2))} square kilometres. Arrow keys move the pen, Shift plus arrow moves four steps, Enter or Space places, C closes a polygon, Backspace undoes, Escape clears, F fits the view, R resets it.`}
        aria-describedby="draw-status"
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onUp}
        onKeyDown={onKeyDown}
      >
        <rect x="0" y="0" width={W} height={H} className="draw-bg" />
        {[-90, -45, 0, 45, 90].map((lat) => {
          const y = project.toXY(lat, 0)[1];
          return y >= 0 && y <= H ? <line key={lat} x1="0" y1={y} x2={W} y2={y} className="draw-grid" /> : null;
        })}
        {path && <path d={path} className="draw-shape" />}
        {draftPath && <path d={draftPath} className="draw-draft" />}
        {points.map((p, i) => {
          const [x, y] = project.toXY(p[1], p[0]);
          return <circle key={i} cx={x} cy={y} r="3" className="draw-point" />;
        })}
        {anchor && (() => { const [x, y] = project.toXY(anchor.lat, anchor.lon); return <circle key="a" cx={x} cy={y} r="4" className="draw-anchor" />; })()}
        <g className="draw-pen" aria-hidden="true">
          <line x1={penX - 7} y1={penY} x2={penX + 7} y2={penY} />
          <line x1={penX} y1={penY - 7} x2={penX} y2={penY + 7} />
          <circle cx={penX} cy={penY} r="9" />
        </g>
      </svg>

      <p className="draw-status" id="draw-status" aria-live="polite">{status}</p>

      <div className="draw-readout">
        <span className="mono">{nf(Math.round(areaKm2))} km²</span>
        <span className="mono">{vertices} vertices</span>
        <span className="mono">≈{nf(volume)} detections/year</span>
        {shape && <span className="mono">{shape.lat.toFixed(2)}°, {shape.lon.toFixed(2)}° r={Math.round(shape.radiusKm)} km</span>}
        {report && !report.valid && <Badge tone="warn">{report.reason?.replace(/_/g, ' ').toLowerCase()}</Badge>}
        {report?.valid && <Badge tone="good">valid</Badge>}
        <button type="button" className="btn btn-primary btn-small" onClick={apply} disabled={!report?.valid}>Analyze this shape</button>
      </div>
      <p className="draw-note">
        Drawn areas are resolved to the equal-area circle the record builder uses, so the numbers match the same code path as the coordinate form.
        Pointer and keyboard build the identical shape: the pen is the second corner (or the next vertex).
        {density.measured
          ? ` Density is ${density.perKm2Day.toFixed(4)} detections/km²/day, measured from ${density.points} live detections over ${density.days} days in this area.`
          : ` No live detections in this area's current window, so the estimate uses the assumed floor of ${density.perKm2Day.toFixed(4)} detections/km²/day — it is not a measurement.`}
      </p>
    </div>
  );
}
