#!/usr/bin/env node
/**
 * Backup/restore rehearsal (deployment PRD §7.5; runbook step for bundle recovery).
 *
 * Proves, against a real child process and real bytes, that a corrupted data bundle cannot pass
 * `/ready` and cannot pass the offline integrity gate, and that restoring the backup returns both
 * to green without a redeploy. The bundle is relocated with DATA_BUNDLE_PATH, so the check
 * demonstrably covers the directory being served rather than the repo default. `public/data` is
 * only ever read here — every mutation happens in a scratch copy under the OS temp directory.
 *
 * Exits 0 when every step passed, 1 otherwise. Writes docs/rehearsal-report.json.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'public', 'data');
const PORT = Number(process.env.REHEARSAL_PORT || 4198);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const STAMP = new Date().toISOString();
const SCRATCH = path.join(os.tmpdir(), `continuum-rehearsal-${STAMP.replace(/[:.]/g, '-')}`);
// Every file the manifest claims for the bundle, not a hand-written shortlist. The drill relocates the
// whole bundle with DATA_BUNDLE_PATH, and validate/`/ready` refuse a relocated bundle that is missing
// any manifest entry — a fixed list silently stops covering the files added after it was written.
const BUNDLE_FILES = JSON.parse(fs.readFileSync(path.join(SOURCE, 'bundle_manifest.json'), 'utf8'))
  .files.filter((f) => f.name.startsWith('data/'))
  .map((f) => f.name.slice('data/'.length));
// The manifest is the thing both gates read; the entry list above cannot include it, because a
// bundle's manifest does not hash itself.
const SCRATCH_FILES = [...BUNDLE_FILES, 'bundle_manifest.json'];

const steps = [];
let server = null;

function record(name, ok, detail) {
  steps.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  return Boolean(ok);
}

function request(method, p, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      `${ORIGIN}${p}`,
      {
        method,
        headers: payload
          ? { accept: 'application/json', 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
          : { accept: 'application/json' },
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(text);
          } catch {
            /* a non-JSON body is a finding to report, not a crash here */
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('request timed out')));
    if (payload) req.write(payload);
    req.end();
  });
}

const getJson = (p) => request('GET', p);
// The API's envelope puts its fields at the top level — there is no `data` wrapper.
const integrityOf = (body) => body?.integrity || {};

function startServer(bundleDir) {
  server = spawn(process.execPath, [path.join(ROOT, 'server', 'api.mjs')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DATA_BUNDLE_PATH: bundleDir, API_CORS_ORIGINS: ORIGIN },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const deadline = Date.now() + 30000;
  const poll = async () => {
    for (;;) {
      try {
        if ((await getJson('/health')).status === 200) return;
      } catch {
        /* not listening yet */
      }
      if (Date.now() > deadline) throw new Error('the API did not come up within 30s');
      await new Promise((r) => setTimeout(r, 250));
    }
  };
  return poll();
}

async function stopServer() {
  if (!server) return;
  const exited = new Promise((r) => server.once('exit', r));
  if (server.exitCode === null) server.kill('SIGTERM');
  await Promise.race([exited, new Promise((r) => setTimeout(r, 4000))]);
  if (server.exitCode === null) server.kill('SIGKILL');
  server = null;
}

async function runGate(bundleDir) {
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'validate.mjs')], {
    cwd: ROOT,
    env: bundleDir ? { ...process.env, DATA_BUNDLE_PATH: bundleDir } : process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (c) => (out += c));
  child.stderr.on('data', (c) => (out += c));
  const code = await new Promise((r) => child.once('exit', r));
  return { code, out, failures: out.split('\n').filter((l) => l.startsWith('FAIL')).join(' | ').trim() };
}

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function main() {
  // 1 ---------------------------------------------------------------- the backup
  fs.mkdirSync(SCRATCH, { recursive: true });
  for (const f of SCRATCH_FILES) fs.copyFileSync(path.join(SOURCE, f), path.join(SCRATCH, f));
  const pristine = Object.fromEntries(SCRATCH_FILES.map((f) => [f, sha(path.join(SOURCE, f))]));
  record(
    'backup: bundle copied to a scratch directory',
    SCRATCH_FILES.every((f) => sha(path.join(SCRATCH, f)) === pristine[f]),
    `${SCRATCH} — ${SCRATCH_FILES.length} files, checksums identical to public/data`,
  );

  // 2 ---------------------------------------------------------------- serve the relocated bundle
  await startServer(SCRATCH);
  const initial = await getJson('/ready');
  record(
    'baseline: /ready on the relocated bundle → 200',
    initial.status === 200 && initial.body?.status === 'ready' && integrityOf(initial.body).ok === true,
    `${initial.status}, bundle ${initial.body?.bundle_version}, integrity ok=${integrityOf(initial.body).ok}`,
  );
  const probe = await request('POST', '/api/v1/area/summary', { region_id: 'chilecito', metric: 'hotspots', mode: 'harmonized' });
  record(
    'the relocated bundle answers a real request',
    probe.status === 200 && probe.body?.counts?.days > 0,
    `POST /api/v1/area/summary (chilecito) → ${probe.status}, ${probe.body?.counts?.days ?? 0} days, total ${probe.body?.counts?.total ?? 0}`,
  );

  // 3 ---------------------------------------------------------------- corrupt one file in place
  // One trailing byte: still valid JSON, so this is the silent single-bit class of corruption that
  // only a checksum can catch — a parse error would let a content check look sufficient.
  const victim = path.join(SCRATCH, 'snapshot.json');
  fs.appendFileSync(victim, ' ');
  const corrupted = await getJson('/ready');
  const corruptedBad = (integrityOf(corrupted.body).bad || []).join('; ');
  record(
    'corruption: /ready → 503 and names the file',
    corrupted.status === 503 && /data\/snapshot\.json: (checksum|size) mismatch/.test(corruptedBad),
    `${corrupted.status} — ${corruptedBad || 'no integrity detail'}`,
  );
  const gateDirty = await runGate(SCRATCH);
  record(
    'corruption: npm run validate fails on the same bundle',
    gateDirty.code === 1 && /checksum mismatch/.test(gateDirty.failures),
    `exit ${gateDirty.code} — ${gateDirty.failures.slice(0, 220) || 'no FAIL line'}`,
  );

  // 4 ---------------------------------------------------------------- delete a file
  // Snapshot is put back first so the only outstanding defect is the missing file; otherwise the
  // checksum failure above still dominates the list and the assertion would prove nothing.
  fs.copyFileSync(path.join(SOURCE, 'snapshot.json'), path.join(SCRATCH, 'snapshot.json'));
  const backToCorruptOnly = await getJson('/ready');
  record(
    'in-place swap: /ready returns to 200 once the corrupted file is replaced',
    backToCorruptOnly.status === 200 && integrityOf(backToCorruptOnly.body).ok === true,
    `${backToCorruptOnly.status} — ${JSON.stringify(integrityOf(backToCorruptOnly.body).bad || integrityOf(backToCorruptOnly.body).reason || 'clean')}`,
  );
  fs.rmSync(path.join(SCRATCH, 'land-110m.json'));
  const missing = await getJson('/ready');
  const missingBad = (integrityOf(missing.body).bad || []).join('; ');
  record(
    'deletion: /ready → 503 with a missing-file reason',
    missing.status === 503 && /data\/land-110m\.json: missing/.test(missingBad),
    `${missing.status} — ${missingBad}`,
  );

  // 5 ---------------------------------------------------------------- restore from the backup
  for (const f of SCRATCH_FILES) fs.copyFileSync(path.join(SOURCE, f), path.join(SCRATCH, f));
  const restoredMatches = SCRATCH_FILES.every((f) => sha(path.join(SCRATCH, f)) === pristine[f]);
  const restored = await getJson('/ready');
  record(
    'restore: /ready → 200 again, same process, no redeploy',
    restoredMatches && restored.status === 200 && restored.body?.status === 'ready' && integrityOf(restored.body).ok === true,
    `${restored.status}, integrity ok=${integrityOf(restored.body).ok}, ${SCRATCH_FILES.length} files match the backup`,
  );
  const reProbe = await request('POST', '/api/v1/area/summary', { region_id: 'chilecito', metric: 'hotspots', mode: 'harmonized' });
  record(
    'after restore the API serves the recovered bundle',
    reProbe.status === 200 && JSON.stringify(reProbe.body) === JSON.stringify(probe.body),
    `summary response identical to the pre-corruption one (${reProbe.status}, ${reProbe.body?.counts?.days ?? 0} days)`,
  );
  await stopServer();

  // 6 ---------------------------------------------------------------- offline gate on the recovered bundle
  const gateClean = await runGate(SCRATCH);
  record(
    'npm run validate passes the recovered bundle',
    gateClean.code === 0,
    `exit ${gateClean.code} — ${(gateClean.out.match(/validate: \d+\/\d+ checks passed/) || ['no summary line'])[0]}`,
  );

  // 7 ---------------------------------------------------------------- the repo bundle is untouched
  const untouched = SCRATCH_FILES.every((f) => sha(path.join(SOURCE, f)) === pristine[f]);
  record('public/data never modified', untouched, `${SCRATCH_FILES.length} source files match the backup taken at step 1`);

  // 8 ---------------------------------------------------------------- canonical report
  // The gate runs above write docs/validation-report.json against the scratch bundle; the shipped
  // artefact has to describe the repo bundle, so the default run goes last.
  const gateRepo = await runGate(null);
  record(
    'npm run validate on public/data (canonical report restored)',
    gateRepo.code === 0,
    `exit ${gateRepo.code} — ${(gateRepo.out.match(/validate: \d+\/\d+ checks passed/) || ['no summary line'])[0]}`,
  );
}

try {
  await main();
} finally {
  await stopServer();
  if (fs.existsSync(SCRATCH)) fs.rmSync(SCRATCH, { recursive: true, force: true });
  const failed = steps.filter((s) => !s.ok).length;
  const report = {
    schema_version: 1,
    ran_at: STAMP,
    node: process.version,
    platform: `${process.platform} ${os.release()} ${process.arch}`,
    bundle_source: 'public/data',
    scratch_dir: SCRATCH,
    relocated_with: 'DATA_BUNDLE_PATH',
    steps,
    passed: steps.length - failed,
    failed,
    verdict: failed === 0 ? 'REHEARSAL PASS' : 'REHEARSAL FAIL',
  };
  fs.writeFileSync(path.join(ROOT, 'docs', 'rehearsal-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`\nrehearsal: ${report.passed}/${steps.length} steps passed → docs/rehearsal-report.json`);
  process.exit(failed ? 1 : 0);
}
