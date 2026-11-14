import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Focused contract test for the live-lane transport classifier. It bundles the
// real src/lib/liveClient.ts in memory and asserts the transport rules against
// the exact envelopes server/live.mjs emits. It does not exercise React state,
// the network, or any NASA observation.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = await build({
  stdin: { contents: "export * from './src/lib/liveClient.ts';", resolveDir: ROOT, loader: 'ts' },
  absWorkingDir: ROOT,
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  logLevel: 'silent',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const A = await import(
  'data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].contents).toString('base64')
);

const fires = [
  [-12.0, -77.0, 12.5, 1, 1, 1700000000],
  [-11.8, -77.2, 8.3, 2, 2, 1700000100],
];
const meta = { windowStart: '2026-11-01', windowEnd: '2026-11-07', sensors: ['MODIS', 'VIIRS S-NPP'] };
const good = { data: fires, meta, provenance: 'live', fetchedAt: 1700000000000 };

const successBody = (extra = {}) => ({
  fires,
  data: fires,
  count: fires.length,
  fetchedAt: 1700000000000,
  perSatelliteCounts: { modis: 0, viirs: 1, noaa20: 1, noaa21: 0 },
  stale: false,
  meta,
  ...extra,
});

describe('classifyLiveResponse: success envelopes', () => {
  test('fresh 200 is live and carries the payload', () => {
    const r = A.classifyLiveResponse(200, successBody(), null);
    assert.equal(r.status, 'live');
    assert.equal(r.provenance, 'live');
    assert.equal(r.data.length, 2);
    assert.deepEqual(r.meta, meta);
    assert.equal(r.fetchedAt, 1700000000000);
    assert.equal(r.error, null);
  });

  test('server stale flag is freshness only — provenance stays live', () => {
    const r = A.classifyLiveResponse(200, successBody({ stale: true }), null);
    assert.equal(r.status, 'stale');
    assert.equal(r.provenance, 'live');
    assert.equal(r.data.length, 2);
  });

  test('fires-only payload without data is accepted', () => {
    const body = successBody();
    delete body.data;
    const r = A.classifyLiveResponse(200, body, null);
    assert.equal(r.status, 'live');
    assert.equal(r.data.length, 2);
  });

  test('empty fires array is still a valid live payload', () => {
    const r = A.classifyLiveResponse(200, successBody({ fires: [], data: [], count: 0 }), null);
    assert.equal(r.status, 'live');
    assert.equal(r.data.length, 0);
  });
});

describe('classifyLiveResponse: not configured and offline', () => {
  test('503 not_configured is its own transport state with no payload', () => {
    const r = A.classifyLiveResponse(
      503,
      { error: 'not_configured', message: 'live data not configured', stale: false },
      good,
    );
    assert.equal(r.status, 'not_configured');
    assert.deepEqual(r.data, []);
    assert.equal(r.meta, null);
    assert.equal(r.provenance, null);
    assert.equal(r.error, 'live data not configured');
  });

  test('503 offline with no last-known-good is offline', () => {
    const r = A.classifyLiveResponse(503, { error: 'offline', message: 'live FIRMS data offline' }, null);
    assert.equal(r.status, 'offline');
    assert.deepEqual(r.data, []);
    assert.equal(r.error, 'live FIRMS data offline');
  });

  test('503 offline after a good payload is stale and keeps that payload', () => {
    const r = A.classifyLiveResponse(503, { error: 'offline', message: 'live FIRMS data offline' }, good);
    assert.equal(r.status, 'stale');
    assert.equal(r.data, fires);
    assert.equal(r.meta, meta);
    assert.equal(r.provenance, 'live');
    assert.equal(r.fetchedAt, 1700000000000);
    assert.equal(r.error, 'live FIRMS data offline');
  });
});

describe('classifyLiveResponse: failures and malformed bodies', () => {
  test('500 after a good payload is stale, not a fake success', () => {
    const r = A.classifyLiveResponse(500, { message: 'boom' }, good);
    assert.equal(r.status, 'stale');
    assert.equal(r.data, fires);
    assert.equal(r.error, 'boom');
  });

  test('500 with no last-known-good is offline', () => {
    const r = A.classifyLiveResponse(500, null, null);
    assert.equal(r.status, 'offline');
    assert.equal(r.error, 'HTTP 500 from live-firms');
  });

  test('200 without a usable meta is malformed — offline without history', () => {
    const r = A.classifyLiveResponse(200, { fires, data: fires }, null);
    assert.equal(r.status, 'offline');
    assert.equal(r.error, 'malformed live-firms response');
  });

  test('malformed 200 after a good payload is stale with the earlier data', () => {
    const r = A.classifyLiveResponse(200, { meta: { windowStart: 'x' } }, good);
    assert.equal(r.status, 'stale');
    assert.equal(r.data, fires);
    assert.equal(r.error, 'malformed live-firms response');
  });

  test('non-JSON body (parse failure) is never treated as live', () => {
    const r = A.classifyLiveResponse(200, null, null);
    assert.equal(r.status, 'offline');
    assert.deepEqual(r.data, []);
  });
});

describe('mock lane', () => {
  test('ALLOW_MOCK_LIVE is false without VITE_ALLOW_MOCK_LIVE', () => {
    assert.equal(A.ALLOW_MOCK_LIVE, false);
  });
});
