import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('a global feed larger than the argument limit reaches the live response intact', async () => {
  // Copy the exact provider into an isolated root: synthetic points must never
  // be persisted into the real data_raw cache or served by the application.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'continuum-live-volume-'));
  let provider;
  try {
    await fs.mkdir(path.join(root, 'server'));
    const moduleFile = path.join(root, 'server', 'live.mjs');
    await fs.copyFile(new URL('../server/live.mjs', import.meta.url), moduleFile);
    provider = await import(pathToFileURL(moduleFile).href);
    const count = 180000;
    const header = 'latitude,longitude,frp,confidence,acq_date,acq_time\n';
    const csv = header + '1,2,3,80,2024-01-02,1200\n'.repeat(count);
    let calls = 0;
    provider.inject({ transport: async () => ({ status: 200, body: calls++ === 0 ? csv : header }) });
    provider.start();
    let response;
    for (let i = 0; i < 100; i++) {
      response = provider.getResponse();
      if (response.status === 200) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(response.status, 200);
    assert.equal(response.body.count, count);
    assert.equal(response.body.perSatelliteCounts.modis, count);
    assert.equal(response.body.meta.windowStart, '2024-01-02');
    assert.equal(response.body.meta.windowEnd, '2024-01-02');
    assert.equal(response.body.fires.at(-1)[5], Date.parse('2024-01-02T12:00:00Z') / 1000);
  } finally {
    provider?.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});
