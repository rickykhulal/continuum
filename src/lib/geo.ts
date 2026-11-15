export type Ring = [number, number][];
export type PolygonRings = Ring[];

export interface Topology {
  transform?: { scale: [number, number]; translate: [number, number] };
  arcs: number[][][];
  objects: Record<string, any>;
}

function decodeArc(arc: number[][], transform?: Topology['transform']): Ring {
  let x = 0;
  let y = 0;
  const out: Ring = [];
  for (const [dx, dy] of arc) {
    x += dx;
    y += dy;
    if (transform) {
      out.push([x * transform.scale[0] + transform.translate[0], y * transform.scale[1] + transform.translate[1]]);
    } else {
      out.push([x, y]);
    }
  }
  return out;
}

function stitchRing(indices: number[], arcs: Ring[]): Ring {
  const ring: Ring = [];
  for (const idx of indices) {
    const reverse = idx < 0;
    const arc = arcs[reverse ? ~idx : idx];
    const seq = reverse ? [...arc].reverse() : arc;
    for (let i = 0; i < seq.length; i++) {
      if (ring.length && i === 0) continue;
      ring.push(seq[i]);
    }
  }
  if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
    ring.push(ring[0]);
  }
  return ring;
}

export function decodeLand(topology: Topology, object = 'land'): PolygonRings[] {
  const arcs = topology.arcs.map((a) => decodeArc(a, topology.transform));
  const land = topology.objects[object];
  const polygons: PolygonRings[] = [];

  const addGeometry = (geom: any) => {
    if (!geom) return;
    if (geom.type === 'GeometryCollection') {
      for (const g of geom.geometries) addGeometry(g);
      return;
    }
    if (geom.type === 'Polygon') {
      polygons.push(geom.arcs.map((ring: number[]) => stitchRing(ring, arcs)));
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.arcs) {
        polygons.push(poly.map((ring: number[]) => stitchRing(ring, arcs)));
      }
    }
  };
  addGeometry(land);
  return polygons.filter((p) => p.length > 0 && p[0].length > 2);
}

/** Viewport window for a regional map at a fixed map-box aspect. Padding and the cosine
 *  longitude correction live here so the map, the globe detail overlay and the baked
 *  NASA GIBS basemaps all resolve to the same rectangle. Keep scripts/build-basemaps.mjs
 *  in step with this function. */
export function fittedMapBounds(
  bbox: [number, number, number, number],
  aspect: number,
): { w: number; s: number; e: number; n: number } {
  const [w, s, e, n] = bbox;
  const midLat = (s + n) / 2;
  const cos = Math.max(0.02, Math.cos((midLat * Math.PI) / 180));
  const latPad = Math.max(0.45, (n - s) * 0.12);
  const lonPad = Math.max(0.45, (e - w) * 0.12);
  let spanLat = n - s + 2 * latPad;
  let spanLon = e - w + 2 * lonPad;
  const cx = (w + e) / 2;
  const cy = (s + n) / 2;
  const projected = (spanLon * cos) / spanLat;
  if (projected < aspect) spanLon = (spanLat * aspect) / cos;
  else spanLat = (spanLon * cos) / aspect;
  let s2 = cy - spanLat / 2;
  let n2 = cy + spanLat / 2;
  if (n2 > 89.5) { s2 -= n2 - 89.5; n2 = 89.5; }
  if (s2 < -89.5) { n2 += -89.5 - s2; s2 = -89.5; }
  return { w: cx - spanLon / 2, s: s2, e: cx + spanLon / 2, n: n2 };
}

export const R_EARTH_KM = 6371.0088;
export const DEG = Math.PI / 180;

export function haversineKm(a: [number, number], b: [number, number]): number {
  const dLat = (b[0] - a[0]) * DEG;
  const dLon = (b[1] - a[1]) * DEG;
  const lat1 = a[0] * DEG;
  const lat2 = b[0] * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDeg(a: [number, number], b: [number, number]): number {
  const lat1 = a[0] * DEG;
  const lat2 = b[0] * DEG;
  const dLon = (b[1] - a[1]) * DEG;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

export function bboxAreaKm2(bbox: [number, number, number, number]): number {
  const [w, s, e, n] = bbox;
  const dLon = Math.abs(e - w) * DEG;
  return R_EARTH_KM ** 2 * dLon * Math.abs(Math.sin(n * DEG) - Math.sin(s * DEG));
}

export function pointInBbox(lat: number, lon: number, bbox: [number, number, number, number]): boolean {
  // Drawn bounds may cross the date line, represented with an unwrapped east edge.
  const x = bbox[0] + ((lon - bbox[0]) % 360 + 360) % 360;
  return x <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

/** Geographic rectangle between two globe picks, taking the shorter longitude arc. */
export function boundsBetween(a: [number, number], b: [number, number]): [number, number, number, number] {
  const start = normalizeLon(a[1]);
  const end = start + normalizeLon(b[1] - start);
  return [Math.min(start, end), Math.min(a[0], b[0]), Math.max(start, end), Math.max(a[0], b[0])];
}

export function normalizeLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

export function latLonToVec3(lat: number, lon: number, radius = 1): [number, number, number] {
  const phi = (90 - lat) * DEG;
  const theta = (lon + 180) * DEG;
  return [-radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta)];
}

export function vec3ToLatLon(x: number, y: number, z: number): [number, number] {
  const r = Math.sqrt(x * x + y * y + z * z);
  const lat = Math.asin(y / r) / DEG;
  const lon = (Math.atan2(z, -x) / DEG) - 180;
  return [lat, normalizeLon(lon)];
}

/** Solar subpoint for a given date; accurate to ~0.2 degrees (NOAA approximation). */
export function subsolarPoint(date: Date): [number, number] {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = (date.getTime() - start) / 86400000 + 1;
  const decl = -23.44 * Math.cos(DEG * (360 / 365) * (dayOfYear + 10));
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const lon = normalizeLon(180 - utcHours * 15);
  return [decl, lon];
}

export function greatCircleDistanceSq(a: [number, number], b: [number, number]): number {
  const dLat = a[0] - b[0];
  let dLon = Math.abs(a[1] - b[1]);
  if (dLon > 180) dLon = 360 - dLon;
  return dLat * dLat + (dLon * Math.cos(((a[0] + b[0]) / 2) * DEG)) ** 2;
}
