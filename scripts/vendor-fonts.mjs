#!/usr/bin/env node
/**
 * Vendors the two UI fonts (Space Grotesk, IBM Plex Mono — both SIL Open Font License)
 * into src/fonts so the app makes no third-party request at runtime.
 *
 * Reads the latin subset only, rewrites every src: to the local file, and writes src/fonts.css.
 * Re-run after changing a weight:  npm run fonts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONT_DIR = path.join(ROOT, 'src', 'fonts');
const CSS_URL =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Space+Grotesk:wght@400;500;600;700&display=swap';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const res = await fetch(CSS_URL, { headers: { 'User-Agent': UA } });
if (!res.ok) throw new Error(`fonts css: HTTP ${res.status}`);
const css = await res.text();

// The css2 response is a sequence of `/* subset *\/` comments each followed by one @font-face block.
const blocks = [...css.matchAll(/\/\* ([a-z-]+) \*\/\s*(@font-face\s*\{[^}]*\})/g)];
const latin = blocks.filter(([, subset]) => subset === 'latin');
if (!latin.length) throw new Error('no latin blocks found — the upstream response changed');

fs.mkdirSync(FONT_DIR, { recursive: true });

// Google serves a variable family as one file reused across the requested weights. Writing four
// @font-face rules for the same bytes makes the browser pick one instance, so identical URLs are
// grouped into a single face with a weight range instead.
const byFamily = new Map();
for (const [, , block] of latin) {
  const family = /font-family:\s*'([^']+)'/.exec(block)?.[1];
  const weight = Number(/font-weight:\s*(\d+)/.exec(block)?.[1]);
  const style = /font-style:\s*(\w+)/.exec(block)?.[1] ?? 'normal';
  const url = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/.exec(block)?.[1];
  if (!family || !Number.isFinite(weight) || !url) throw new Error(`unparsable block: ${block.slice(0, 80)}`);
  const faces = byFamily.get(family) ?? new Map();
  const entry = faces.get(url) ?? { weights: [], style };
  entry.weights.push(weight);
  faces.set(url, entry);
  byFamily.set(family, faces);
}

const out = ['/* Space Grotesk + IBM Plex Mono (latin) — SIL OFL 1.1, vendored by scripts/vendor-fonts.mjs */'];
for (const [family, faces] of byFamily) {
  for (const [url, entry] of faces) {
    const slug = `${family.toLowerCase().replace(/\s+/g, '-')}-${entry.weights.sort((a, b) => a - b).join('_')}.woff2`;
    const file = path.join(FONT_DIR, slug);
    if (!fs.existsSync(file)) {
      const dl = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!dl.ok) throw new Error(`${slug}: HTTP ${dl.status}`);
      fs.writeFileSync(file, Buffer.from(await dl.arrayBuffer()));
    }
    const weight = entry.weights.length > 1 ? `${entry.weights[0]} ${entry.weights.at(-1)}` : String(entry.weights[0]);
    out.push(
      `@font-face { font-family: '${family}'; font-style: ${entry.style}; font-weight: ${weight}; font-display: swap; src: url('./fonts/${slug}') format('woff2'); }`,
    );
    console.log(`vendored ${slug} (weights ${weight})`);
  }
}

fs.writeFileSync(path.join(ROOT, 'src', 'fonts.css'), out.join('\n') + '\n');
console.log(`src/fonts.css — ${out.length - 1} faces from ${latin.length} upstream blocks`);
