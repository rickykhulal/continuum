#!/usr/bin/env node
/**
 * Bakes the regional map basemaps from NASA GIBS at 4096 px and the matching night
 * mosaic used by the globe's close-zoom detail overlay. The window is computed with the
 * same padded, cosine-corrected fit as `fittedMapBounds` in src/lib/geo.ts, so the
 * imagery, the vector outlines and the fire pixels share one plate-carrée rectangle.
 *
 * GIBS is public and needs no key. This is an offline build step: the browser never
 * calls GIBS at runtime.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'data', 'basemaps');
const REGIONS = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'regions.json'), 'utf8'));
const W = 760;
const PAD = 12;
const MAX_HEIGHT = 420;
const INNER_W = W - PAD * 2;
const INNER_H = MAX_HEIGHT - PAD * 2;
const ASPECT = INNER_W / INNER_H;
const LONG_SIDE = 4096;

// Keep identical to fittedMapBounds() in src/lib/geo.ts.
function fittedMapBounds(bbox) {
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
  if (projected < ASPECT) spanLon = (spanLat * ASPECT) / cos;
  else spanLat = (spanLon * cos) / ASPECT;
  let s2 = cy - spanLat / 2;
  let n2 = cy + spanLat / 2;
  if (n2 > 89.5) { s2 -= n2 - 89.5; n2 = 89.5; }
  if (s2 < -89.5) { n2 += -89.5 - s2; s2 = -89.5; }
  return { w: cx - spanLon / 2, s: s2, e: cx + spanLon / 2, n: n2 };
}

const LAYERS = {
  day: 'BlueMarble_ShadedRelief_Bathymetry',
  night: 'VIIRS_CityLights_2012',
};

function wmsUrl(layer, box, width, height) {
  const qs = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: '1.1.1',
    LAYERS: layer,
    STYLES: '',
    FORMAT: 'image/jpeg',
    SRS: 'EPSG:4326',
    BBOX: [box.w, box.s, box.e, box.n].map((v) => v.toFixed(4)).join(','),
    WIDTH: String(width),
    HEIGHT: String(height),
  });
  return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${qs}`;
}

function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

async function fetchImage(url, width, height, label) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const dim = jpegSize(buf);
      if (!dim || dim.width !== width || dim.height !== height) {
        throw new Error(`unexpected image ${dim ? `${dim.width}x${dim.height}` : 'not JPEG'}`);
      }
      return buf;
    } catch (err) {
      if (attempt === 4) throw new Error(`${label}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

const jobs = [];
for (const region of REGIONS) {
  const box = fittedMapBounds(region.bbox);
  const height = Math.round(LONG_SIDE / ASPECT);
  jobs.push({ region, box, width: LONG_SIDE, height });
}

fs.mkdirSync(OUT, { recursive: true });
let done = 0;
const queue = jobs.flatMap((job) => [
  { ...job, kind: 'day', file: `${job.region.id}.jpg` },
  { ...job, kind: 'night', file: `${job.region.id}_night.jpg` },
]);

async function worker() {
  while (queue.length) {
    const job = queue.shift();
    if (!job) return;
    const url = wmsUrl(LAYERS[job.kind], job.box, job.width, job.height);
    const buf = await fetchImage(url, job.width, job.height, `${job.region.id} ${job.kind}`);
    fs.writeFileSync(path.join(OUT, job.file), buf);
    done++;
    const dims = `${job.width}x${job.height}`;
    console.log(`[${done}/${jobs.length * 2}] ${job.file} ${dims} ${(buf.length / 1024).toFixed(0)} KB`);
  }
}

await Promise.all([worker(), worker(), worker()]);
const bounds = Object.fromEntries(jobs.map((j) => [j.region.id, j.box]));
fs.writeFileSync(path.join(OUT, 'bounds.json'), JSON.stringify(bounds, null, 2) + '\n');
console.log(`basemaps: ${done} NASA GIBS crops written to ${path.relative(ROOT, OUT)}`);
