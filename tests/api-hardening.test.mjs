import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'continuum-api-hardening-'));
const base = 'http://127.0.0.1:4205/api/v1';
let server;
before(async () => {
  server = spawn(process.execPath, ['server/api.mjs'], {
    env: { ...process.env, PORT: '4205', APP_DATA_PATH: runtime, API_RATE_LIMITS: 'classA:200/min;classB:200/min;classC:200/min' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/health`)).ok) return; } catch { /* startup */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Isolated hardening API did not start');
});
after(async () => {
  if (server && server.exitCode === null) {
    await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
  }
  assert.ok(path.resolve(runtime).startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(runtime, { recursive: true, force: true });
});

test('invalid query areas and impossible dates return 422 JSON', async () => {
  const queries = ['', '?region_id=unknown', '?lat=&lon=1', '?lat=1&lon=', '?lat=NaN&lon=1', '?lat=91&lon=1', '?lat=0&lon=181', '?lat=0',
    ...['', 'nope', 'Infinity', '0', '19', '801'].map(radius => `?lat=0&lon=1&radius_km=${radius}`),
    '?region_id=chilecito&start=2022-02-30', '?region_id=chilecito&end=2022-13-01', '?region_id=chilecito&start=2022-09-01&end=2022-08-01'];
  for (const query of queries) {
    const response = await fetch(`${base}/atlas${query}`);
    assert.equal(response.status, 422, query);
    assert.equal(typeof (await response.json()).error.code, 'string');
  }
  const leap = await fetch(`${base}/atlas?region_id=chilecito&start=2024-02-29&end=2024-02-29`);
  assert.equal(leap.status, 200);
  const day = await leap.json();
  assert.equal(day.start, '2024-02-29');
  assert.equal(day.end, '2024-02-29');
  assert.equal(day.values.length, 1);
  assert.equal(day.values[0].date, '2024-02-29');
  assert.equal((await fetch(`${base}/%ZZ`)).status, 422);
});

test('POST ranges and radii use the same 422 validation', async () => {
  for (const body of [{ region_id: 'chilecito', start: '2022-02-30' }, { lat: 0, lon: 1, radius_km: 'oops' }, { lat: 0, lon: 1, radius_km: false }, { lat: 0, lon: 1, radius_km: 801 }]) {
    const response = await fetch(`${base}/area/summary`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 422);
  }
});

test('unexpected storage failure returns clean 500 JSON and the process recovers', async () => {
  const keyFile = path.join(runtime, 'api_keys.json');
  fs.unlinkSync(keyFile);
  fs.mkdirSync(keyFile);
  try {
    const response = await fetch(`${base}/auth/generate-key`, { method: 'POST' });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Internal Server Error' });
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal(server.exitCode, null);
  } finally {
    fs.rmdirSync(keyFile);
    fs.writeFileSync(keyFile, '{"keys":[]}\n');
  }
});

test('concurrent API key issuance generates distinct UUID v4 credentials', async () => {
  const responses = await Promise.all(Array.from({ length: 8 }, () => fetch(`${base}/auth/generate-key`, { method: 'POST' })));
  const keys = [];
  for (const response of responses) {
    assert.equal(response.status, 200);
    const key = (await response.json()).api_key;
    assert.ok(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(key), 'UUID v4 format');
    keys.push(key);
  }
  assert.equal(new Set(keys).size, keys.length, 'unique credentials');
});
