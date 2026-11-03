#!/usr/bin/env node
/** Cross-platform test runner: discovers tests/*.test.mjs and runs them in one node --test pass. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(ROOT, 'tests');
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort() : [];
if (!files.length) {
  console.error('test: no tests/*.test.mjs found');
  process.exit(2);
}
const args = ['--test', ...files.map((f) => path.join('tests', f))];
console.log(`test: running ${files.length} files`);
const run = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
process.exit(run.status ?? 2);
