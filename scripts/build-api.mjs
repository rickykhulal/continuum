// Bundle the browser analytics for Node so the API uses the same code as the UI (PRD §19 Phase 12).
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'dist-server', 'analytics.mjs');

fs.mkdirSync(path.dirname(outfile), { recursive: true });

await build({
  entryPoints: [path.join(root, 'server', 'analytics.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  logLevel: 'warning',
  define: { 'import.meta.env.BASE_URL': "'./'" },
  loader: { '.json': 'json' },
});

console.log(`api analytics bundle -> ${path.relative(root, outfile)}`);
