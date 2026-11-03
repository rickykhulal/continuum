#!/usr/bin/env node
/**
 * Refreshes the bundled CelesTrak elements for the five spacecraft.
 *
 * CelesTrak rejects browser-originated requests and many cloud/datacenter IPs
 * (HTTP 403), so this is a maintainer-only step run from a normal network
 * before a release. The app itself never calls CelesTrak; it serves the
 * resulting TLE file statically. If the fetch fails, the existing file is left
 * untouched and the app keeps using it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'tle', 'satellites.txt');

const SATS = [
  { name: 'TERRA', norad: 25994 },
  { name: 'AQUA', norad: 27424 },
  { name: 'SUOMI NPP', norad: 37849 },
  { name: 'NOAA 20 (JPSS-1)', norad: 43013 },
  { name: 'NOAA 21 (JPSS-2)', norad: 54234 },
];

async function fetchOne(sat) {
  const url = `https://celestrak.org/NORAD/elements/gp.php?CATNR=${sat.norad}&FORMAT=tle`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Continuum-NASA-Space-Apps/1.0 (+build-time TLE refresh)' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${sat.norad}: HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const line1 = lines.find((l) => l.startsWith('1 '));
  const line2 = lines.find((l) => l.startsWith('2 '));
  if (!line1 || !line2) throw new Error(`${sat.norad}: malformed TLE`);
  return `${sat.name.padEnd(25)}\n${line1}\n${line2}\n`;
}

async function main() {
  try {
    const blocks = [];
    for (const sat of SATS) blocks.push(await fetchOne(sat));
    const text = blocks.join('\n');
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, text);
    const epoch = text.match(/^1 \d{5}U \d{5}A\s+(\d{5}\.\d+)/m)?.[1] ?? 'unknown';
    console.log(`wrote ${SATS.length} TLEs, epoch ${epoch}`);
  } catch (err) {
    console.warn(`[keep existing TLEs] ${err.message}`);
  }
}

main();
