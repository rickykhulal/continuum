import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'continuum-community-audit-'));
const base = 'http://127.0.0.1:4196/api/v1';
let server;
before(async () => {
  server = spawn(process.execPath, ['server/api.mjs'], {
    env: { ...process.env, PORT: '4196', APP_DATA_PATH: runtime, API_CORS_ORIGINS: 'https://audit.example' }, stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/health`)).ok) return; } catch { /* startup */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Isolated community API did not start');
});

test('configured browser clients may send their API key through CORS preflight', async () => {
  const res = await fetch(`${base}/community/feed`, { method: 'OPTIONS', headers: {
    origin: 'https://audit.example', 'access-control-request-method': 'GET', 'access-control-request-headers': 'x-api-key',
  } });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://audit.example');
  assert.match(res.headers.get('access-control-allow-headers'), /x-api-key/i);
});
after(async () => {
  if (server && server.exitCode === null) {
    await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
  }
  fs.rmSync(runtime, { recursive: true, force: true });
});

test('key issuance stays public while data endpoints continue enforcing registered keys', async () => {
  const issue = () => fetch(`${base}/auth/generate-key`, { method: 'POST' });
  const first = await issue();
  assert.equal(first.status, 200);
  const firstKey = (await first.json()).api_key;
  assert.equal(typeof firstKey, 'string');
  assert.equal((await fetch(`${base}/community/feed`)).status, 401);
  assert.equal((await fetch(`${base}/community/feed`, { headers: { 'x-api-key': 'not-a-key' } })).status, 401);
  const second = await issue();
  assert.equal(second.status, 200);
  const secondKey = (await second.json()).api_key;
  assert.ok(secondKey !== firstKey);
  for (const key of [firstKey, secondKey]) {
    assert.equal((await fetch(`${base}/community/feed`, { headers: { 'x-api-key': key } })).status, 200);
  }
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/openapi.json`)).status, 200);
});

test('a checkbox-reported anomaly can be verified and announced exactly once', async () => {
  const key = (await (await fetch(`${base}/auth/generate-key`, { method: 'POST' })).json()).api_key;
  const post = (route, body) => fetch(`${base}${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key }, body: JSON.stringify(body),
  });
  const created = await post('/community/posts', { author: 'TEST ONLY', type: 'text', isAnomaly: true, content: 'Synthetic local regression report.' });
  assert.equal(created.status, 200);
  const report = (await created.json()).post;
  assert.equal(report.type, 'anomaly');
  for (let i = 0; i < 2; i++) {
    const verified = await post('/community/verify', { postId: report.id, verified: true });
    assert.equal(verified.status, 200);
    assert.equal((await verified.json()).post.verified, true);
  }
  const feed = await (await fetch(`${base}/community/feed`, { headers: { 'x-api-key': key } })).json();
  assert.equal(feed.announcements.filter(a => a.sourcePostId === report.id).length, 1);
});
