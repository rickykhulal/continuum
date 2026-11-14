import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCANNER = path.join(ROOT, 'scripts', 'secret-scan.mjs');

// Synthetic values are assembled at runtime so this test file never contains a secret-shaped
// literal of its own — the repo-wide scan runs over it too.
const mk = (...parts) => parts.join('');
const S_MD = mk('a1b2c3d4', 'e5f60718', '293a4b5c', '6d7e8f90');
const S_NASA = mk('nasaF1RMS', 'key0123456789', 'abcdefXYZ');
const S_TOKEN = mk('tok_live_', '51H8xQ2eZvK', 'Ylo2C9dEfGhIjK');
const S_JSON = mk('jsonFirms', 'Key0123456789', 'abcdef0123');
const S_BIG = mk('bigFile', 'Token0123456789', 'abcdef0123');
const S_DATA = mk('dataRaw', 'Key0123456789', 'abcdef0123');
const S_DIST = mk('distData', 'Key0123456789', 'abcdef0123');
const S_NOTES = mk('markdown', 'Key0123456789', 'abcdef0123');
const SECRETS = [S_MD, S_NASA, S_TOKEN, S_JSON, S_BIG, S_DATA, S_DIST, S_NOTES];

function runScan(root) {
  return spawnSync(process.execPath, [SCANNER], {
    encoding: 'utf8',
    env: { ...process.env, SECRET_SCAN_ROOT: root },
    timeout: 120_000,
  });
}

function makeRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('detects credential shapes across formats, large files and the data/dist trees', () => {
  const root = makeRoot('continuum-scan-pos-');
  try {
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    fs.mkdirSync(path.join(root, 'data_raw'), { recursive: true });
    fs.mkdirSync(path.join(root, 'dist', 'data'), { recursive: true });
    fs.mkdirSync(path.join(root, 'big'), { recursive: true });

    fs.writeFileSync(path.join(root, 'docs', 'report.md'), `# run\n\nFIRMS_MAP_KEY=${S_MD}\n`);
    fs.writeFileSync(path.join(root, 'config', 'app.json'), `{"NASA_FIRMS_API_KEY": "${S_NASA}"}\n`);
    fs.writeFileSync(path.join(root, 'config', 'token.json'), `{"api_token": "${S_TOKEN}"}\n`);
    fs.writeFileSync(path.join(root, 'data_raw', 'cache.json'), `{"token": "${S_DATA}"}\n`);
    fs.writeFileSync(path.join(root, 'dist', 'data', 'bundle.json'), `{"FIRMS_MAP_KEY": "${S_DIST}"}\n`);
    fs.writeFileSync(path.join(root, 'docs', 'notes.md'), `export FIRMS_MAP_KEY=${S_NOTES}\n`);
    fs.writeFileSync(
      path.join(root, 'docs', 'url.md'),
      `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${S_MD}/VIIRS_SNPP_NRT/world/7\n`,
    );

    const padLine = 'padding line with no pattern here\n';
    const pad = padLine.repeat(Math.ceil(6_500_000 / padLine.length));
    const bigLine = pad.split('\n').length;
    fs.writeFileSync(path.join(root, 'big', 'payload.log'), `${pad}FIRMS_MAP_KEY=${S_BIG}\n`);

    const run = runScan(root);
    const out = `${run.stdout}${run.stderr}`;
    assert.equal(run.status, 1, `expected findings exit, got ${run.status}: ${out}`);
    for (const expected of [
      'docs/report.md:3',
      'config/app.json:1',
      'config/token.json:1',
      'data_raw/cache.json:1',
      'dist/data/bundle.json:1',
      'docs/notes.md:1',
      'docs/url.md:1',
      `big/payload.log:${bigLine}`,
    ]) {
      assert.ok(out.includes(expected), `missing finding ${expected} in:\n${out}`);
    }
    assert.ok(out.includes('[redacted]'), 'findings must carry the redacted marker');
    assert.ok(!out.includes('padding line'), 'findings must not echo file content');
    for (const secret of SECRETS) {
      assert.ok(!out.includes(secret), 'scanner output must never contain a secret value');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stays clean on bundle ids, checksums, env references and documentation mentions', () => {
  const root = makeRoot('continuum-scan-neg-');
  try {
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'package.json'),
      `${JSON.stringify({ version: 'continuum-2026-11-02-920de0617606' }, null, 2)}\n`,
    );
    fs.writeFileSync(path.join(root, 'docs', 'checks.md'), `sha256: ${'a'.repeat(64)}\n`);
    fs.writeFileSync(
      path.join(root, 'docs', 'env.md'),
      [
        'FIRMS_MAP_KEY=$FIRMS_MAP_KEY',
        'FIRMS_MAP_KEY=[REDACTED]',
        'FIRMS_MAP_KEY=',
        'The FIRMS_MAP_KEY variable must be set in the environment before running fetch-live.',
        'Bundle continuum-2026-11-02-920de0617606',
        '',
      ].join('\n'),
    );

    const run = runScan(root);
    const out = `${run.stdout}${run.stderr}`;
    assert.equal(run.status, 0, `expected clean exit, got ${run.status}: ${out}`);
    assert.ok(out.includes('clean'), 'expected the clean banner');
    assert.ok(!out.includes('FINDING'), 'no findings expected');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
