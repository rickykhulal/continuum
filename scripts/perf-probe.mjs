#!/usr/bin/env node
/**
 * Local performance probe — measures the two things the deployment PRD puts numbers on: API latency
 * objectives (§2 objective table) and web-vitals/budget targets (§2 + §9.2), plus the 48-hour data
 * freshness objective.
 *
 * WHAT THIS IS: one client, sequential requests, loopback, against the shipped same-origin topology
 * (node server/api.mjs serving dist/ and /api/v1), with rate limits raised so the limiter does not
 * distort the timings it is measured around.
 * WHAT THIS IS NOT: a load test, a concurrency test, a cold-network test, a Lighthouse run, or a p75
 * over real users. Each browser figure comes from a handful of navigations on this machine.
 *
 * Exits 1 if the probe itself could not run, or if a measured value breaches a PRD objective or
 * budget with no margin; exits 0 with the report written otherwise. Nothing is asserted as "passed"
 * that was not measured here.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const API_PORT = Number(process.env.PERF_PORT || 4182);
const ORIGIN = `http://127.0.0.1:${API_PORT}`;
const DEBUG_PORT = Number(process.env.PERF_CHROME_PORT || 9225);
const PROFILE = path.join(os.tmpdir(), `continuum-perf-${Date.now()}`);
const SAMPLES = Number(process.env.PERF_SAMPLES || 15);
const SLOW_SAMPLES = Number(process.env.PERF_SLOW_SAMPLES || 6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// PRD §2 objective table, copied verbatim from docs/full prd.pdf (page 4). null = no authored target;
// the number is still measured and reported.
const OBJECTIVES = { availability_monthly: 99, summary_status_p95_ms: 2000, calendar_p95_ms: 3000, exports_p95_ms: 10000, server_error_rate_pct: 1, data_freshness_lag_hours: 48, lcp_p75_ms: 2500, inp_p75_ms: 200, cls_p75: 0.1, initial_js_gzip_kb: 250 };

const ENDPOINTS = [
  { name: 'health', method: 'GET', path: '/api/v1/health', objective: null },
  { name: 'meta', method: 'GET', path: '/api/v1/meta', objective: null },
  { name: 'ready', method: 'GET', path: '/api/v1/ready', note: 're-hashes every bundled file per call', objective: null },
  { name: 'summary', method: 'POST', path: '/api/v1/area/summary', body: { region_id: 'chilecito', metric: 'hotspots', mode: 'harmonized' }, objective: OBJECTIVES.summary_status_p95_ms },
  { name: 'status', method: 'POST', path: '/api/v1/area/status', body: { region_id: 'chilecito' }, objective: OBJECTIVES.summary_status_p95_ms },
  { name: 'day', method: 'POST', path: '/api/v1/area/day', body: { region_id: 'chilecito', date: '2026-10-29' }, objective: null, note: 'no objective named for this route in PRD §2' },
  { name: 'bias', method: 'POST', path: '/api/v1/area/bias', body: { region_id: 'chilecito' }, objective: null, note: 'no objective named for this route in PRD §2' },
  { name: 'calendar', method: 'POST', path: '/api/v1/area/calendar', body: { region_id: 'chilecito', start: '2026-01-01', end: '2026-10-31' }, objective: OBJECTIVES.calendar_p95_ms },
  { name: 'month-compare', method: 'POST', path: '/api/v1/area/month-compare', body: { region_id: 'chilecito', month: 9 }, objective: OBJECTIVES.calendar_p95_ms },
  { name: 'drawn-polygon-summary', method: 'POST', path: '/api/v1/area/summary', body: { geometry: { type: 'Polygon', coordinates: [[[-65.2, -30.4], [-64.3, -30.4], [-64.3, -29.4], [-65.2, -29.4], [-65.2, -30.4]]] } }, objective: OBJECTIVES.summary_status_p95_ms, note: 'the summary route, resolving a drawn AOI' },
  { name: 'country-summary', method: 'POST', path: '/api/v1/area/summary', body: { region_id: 'country-kenya', start: '2026-10-26', end: '2026-11-02' }, objective: OBJECTIVES.summary_status_p95_ms, note: 'the world layer: a border answered from its own measured window' },
  { name: 'country-calendar', method: 'POST', path: '/api/v1/area/calendar', body: { region_id: 'country-russia', start: '2000-01-01', end: '2026-11-02' }, objective: OBJECTIVES.calendar_p95_ms, note: 'worst case in the gazetteer: the largest border, the full 2000→today series' },
  { name: 'twin', method: 'POST', path: '/api/v1/area/twin', body: { region_id: 'chilecito', weeks: 8 }, slow: true, objective: null, note: 'no objective named for this route in PRD §2' },
  { name: 'sandbox', method: 'POST', path: '/api/v1/sandbox/run', body: { region_id: 'chilecito', pixel_m: 750, min_frp: 15, overpass_hour: 20, correction: true, seed: 7 }, slow: true, objective: null, note: 'no objective named for this route in PRD §2' },
  { name: 'export-csv', method: 'POST', path: '/api/v1/export/csv', body: { region_id: 'chilecito', start: '2026-01-01', end: '2026-10-31' }, slow: true, objective: OBJECTIVES.exports_p95_ms },
  { name: 'export-geojson', method: 'POST', path: '/api/v1/export/geojson', body: { region_id: 'chilecito', start: '2026-10-24', end: '2026-10-31' }, slow: true, objective: OBJECTIVES.exports_p95_ms, note: 'grouped under "exports" by inference; PRD names CSV and PDF' },
  { name: 'brief-text', method: 'POST', path: '/api/v1/brief', body: { region_id: 'chilecito', start: '2026-10-01', end: '2026-10-31' }, slow: true, objective: OBJECTIVES.exports_p95_ms, note: 'grouped under "exports" by inference; PRD names CSV and PDF' },
  { name: 'brief-pdf', method: 'POST', path: '/api/v1/brief', body: { region_id: 'chilecito', format: 'pdf' }, slow: true, objective: OBJECTIVES.exports_p95_ms },
];

const api = spawn(process.execPath, [path.join(ROOT, 'server', 'api.mjs')], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(API_PORT), LOG_FORMAT: '', METRICS_TOKEN: '', API_RATE_LIMITS: 'classA:100000/min;classB:100000/min;classC:100000/min' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let apiErr = '';
api.stderr.on('data', (d) => (apiErr += d.toString()));

const probeErrors = [];
function fail(stage, detail) {
  probeErrors.push(`${stage}: ${detail}`);
  console.log(`PROBE-ERROR  ${stage} — ${detail}`);
}

async function waitHealthy(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${ORIGIN}/api/v1/health`)).ok) return true;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  return false;
}

function pct(sorted, q) {
  if (!sorted.length) return null;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((q / 100) * sorted.length) - 1));
  return Number(sorted[rank].toFixed(3));
}

async function measureEndpoints() {
  const rows = [];
  let requests = 0;
  let serverErrors = 0;
  for (const spec of ENDPOINTS) {
    const n = spec.slow ? SLOW_SAMPLES : SAMPLES;
    const sendOnce = () => fetch(`${ORIGIN}${spec.path}`, {
      method: spec.method,
      headers: spec.body ? { 'content-type': 'application/json' } : undefined,
      body: spec.body ? JSON.stringify(spec.body) : undefined,
    });
    for (let i = 0; i < 3; i++) { const r = await sendOnce(); await r.arrayBuffer(); } // warm the page cache of the process
    const ms = [];
    let bytes = 0;
    for (let i = 0; i < n; i++) {
      const t0 = process.hrtime.bigint();
      const res = await sendOnce();
      const buf = await res.arrayBuffer();
      ms.push(Number(process.hrtime.bigint() - t0) / 1e6);
      bytes += buf.byteLength;
      requests++;
      if (res.status >= 500) serverErrors++;
    }
    const sorted = [...ms].sort((a, b) => a - b);
    const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
    const p95 = pct(sorted, 95);
    rows.push({
      endpoint: spec.name,
      route: `${spec.method} ${spec.path}`,
      samples: n,
      mean_ms: Number(mean.toFixed(3)),
      min_ms: Number(sorted[0].toFixed(3)),
      p50_ms: pct(sorted, 50),
      p95_ms: p95,
      p99_ms: pct(sorted, 99),
      max_ms: Number(sorted[sorted.length - 1].toFixed(3)),
      mean_response_bytes: Math.round(bytes / n),
      objective_p95_ms: spec.objective,
      meets_objective: spec.objective == null ? null : p95 <= spec.objective,
      note: spec.note || null,
    });
    console.log(`${spec.objective == null ? 'measured' : p95 <= spec.objective ? 'under target' : 'OVER TARGET'}  ${spec.name.padEnd(22)} p50 ${pct(sorted, 50)}ms  p95 ${p95}ms  max ${sorted[sorted.length - 1].toFixed(1)}ms${spec.objective ? `  (objective p95 ${spec.objective}ms)` : ''}`);
  }
  return { rows, requests, serverErrors, errorRatePct: Number(((serverErrors / requests) * 100).toFixed(3)) };
}

const VITALS_BOOTSTRAP = `
window.__perf = { lcp: 0, lcpBeforeInput: null, cls: 0, tbt: 0, longestTask: 0, inpProcessing: 0, events: 0, firstInputSeen: false, firstInputAt: null, fcp: 0, eventLog: [], longTasks: [] };
const P = window.__perf;
new PerformanceObserver((l) => { const e = l.getEntries().pop(); if (e) { P.lcp = Math.round(e.startTime); if (!P.firstInputSeen) P.lcpBeforeInput = P.lcp; } }).observe({ type: 'largest-contentful-paint', buffered: true });
new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (!e.hadRecentInput) P.cls += e.value; } }).observe({ type: 'layout-shift', buffered: true });
new PerformanceObserver((l) => { for (const e of l.getEntries()) { P.tbt += Math.max(0, e.duration - 50); P.longestTask = Math.max(P.longestTask, Math.round(e.duration)); if (P.longTasks.length < 300) P.longTasks.push({ at: Math.round(e.startTime), dur: Math.round(e.duration) }); } }).observe({ type: 'longtask', buffered: true });
new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (e.processingStart && e.processingEnd) { const proc = Math.round(e.processingEnd - e.processingStart); P.events++; P.inpProcessing = Math.max(P.inpProcessing, proc); if (proc >= 50 && P.eventLog.length < 60) { const t = e.target || {}; const cls = typeof t.className === 'string' ? t.className.split(/\\s+/)[0] : ''; P.eventLog.push({ type: e.name, at: Math.round(e.startTime), proc: proc, dur: Math.round(e.duration), target: [t.tagName, cls, t.textContent].filter(Boolean).join('.').slice(0, 48) }); } } } }).observe({ type: 'event', durationThreshold: 0, buffered: true });
new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') P.fcp = Math.round(e.startTime); }).observe({ type: 'paint', buffered: true });
document.addEventListener('first-input', (e) => { P.firstInputSeen = true; P.firstInputAt = Math.round(e.startTime); }, true);
`;

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--window-size=1440,900', '--hide-scrollbars',
  `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${PROFILE}`, 'about:blank',
], { stdio: 'ignore' });

async function cdpJson(url) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error(`cannot reach ${url}`);
}

async function measureBrowser() {
  const version = await cdpJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  // Defined after the page session exists: a Runtime.evaluate sent without a sessionId goes to the
  // root session, which answers no page methods, so the expression never reaches the document.
  let evLastError = '';
  const ev = async (body, useSession = true) => {
    const r = await send('Runtime.evaluate', {
      expression: `(async () => { ${body} })()`,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }, useSession ? S : undefined);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  const { targetInfos } = await send('Target.getTargets');
  const page = targetInfos.find((t) => t.type === 'page');
  const { sessionId: S } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  await send('Page.enable', {}, S);
  await send('Runtime.enable', {}, S);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, S).catch(() => {});
  await send('Page.addScriptToEvaluateOnNewDocument', { source: VITALS_BOOTSTRAP }, S);

  const views = [
    { name: 'start-watch', url: `${ORIGIN}/` },
    { name: 'atlas', url: `${ORIGIN}/#/atlas?r=pantanal&m=hotspots&mode=harmonized` },
    // Control: the Method page renders static prose with no canvas and no animation loop. If the
    // recurring ~260 ms long tasks belong to software-WebGL frames, they should largely disappear here.
    { name: 'method-static', url: `${ORIGIN}/#/method` },
  ];
  const out = [];
  for (const view of views) {
    // about:blank between views forces a real document navigation. A same-origin hash change would
    // reuse the first document, so its observers, LCP and navigation timing would not restart.
    await send('Page.navigate', { url: 'about:blank' }, S);
    await sleep(400);
    await send('Page.navigate', { url: view.url }, S);
    // wait for the app to render its main region, then let lazy chunks and the clock settle
    const deadline = Date.now() + 30000;
    let ready = false;
    evLastError = '';
    while (Date.now() < deadline && !ready) {
      try {
        ready = Boolean(await ev(`return Boolean(document.querySelector('#main')) && document.body.textContent.length > 400;`));
      } catch (err) {
        evLastError = String(err?.message || err);
        await sleep(300);
      }
    }
    if (!ready) {
      const state = await ev(`return { url: location.href, ready: document.readyState, main: Boolean(document.querySelector('#main')), text: document.body.textContent.length };`)
        .then((s) => JSON.stringify(s)).catch((e) => `no final state (${String(e?.message || e)})`);
      fail('browser', `${view.name}: the app did not render on the API origin — last error: ${evLastError || 'poll returned false'} — ${state}`);
      continue;
    }
    await sleep(2500);
    const lcpBeforeInput = await ev(`return window.__perf.lcpBeforeInput ?? window.__perf.lcp;`);
    // Real input through the browser's input pipeline, not element.click(), so Event Timing sees it.
    const spots = await ev(`
      const picks = ['nav.nav button', '.chip', 'button.btn'];
      const found = [];
      for (const sel of picks) {
        for (const el of document.querySelectorAll(sel)) {
          const r = el.getBoundingClientRect();
          if (r.width > 30 && r.height > 16 && r.top > 0 && r.bottom < innerHeight) found.push({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), tag: (el.tagName + ' ' + (el.getAttribute('class') || '')).trim() });
          if (found.length >= 4) break;
        }
        if (found.length >= 4) break;
      }
      return found;`);
    const clickRows = [];
    for (const spot of spots.slice(0, 4)) {
      const before = await ev(`return { proc: window.__perf.inpProcessing, events: window.__perf.events, appClass: (document.querySelector('.app') || {}).className || '' };`);
      // One in-page observer instead of a polling loop: Runtime.evaluate every 50 ms was itself main-thread
      // work and made React's transition render slower than the thing being measured.
      const armedAt = await ev(`
        window.__perf.swapWait = new Promise((resolve) => {
          const app = document.querySelector('.app');
          if (!app) return resolve(null);
          const from = app.className;
          const t0 = performance.now();
          const mo = new MutationObserver(() => {
            if (app.className !== from) { mo.disconnect(); resolve(Math.round(performance.now() - t0)); }
          });
          mo.observe(app, { attributes: true, attributeFilter: ['class'] });
          // 2.5 s cap, not 8 s: a click that legitimately changes nothing (the nav button already for
          // the current view) otherwise holds the await open, and the page keeps burning animation
          // frames while the probe waits — an observed-window and TBT inflation caused by the probe.
          setTimeout(() => { mo.disconnect(); resolve(null); }, 2500);
        });
        return Math.round(performance.now());`);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: spot.x, y: spot.y, button: 'left', clickCount: 1, buttons: 1 }, S);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: spot.x, y: spot.y, button: 'left', clickCount: 1, buttons: 0 }, S);
      await sleep(900);
      const after = await ev(`return { proc: window.__perf.inpProcessing, events: window.__perf.events, log: window.__perf.eventLog.slice(-1)[0] || null, swap: await window.__perf.swapWait };`);
      clickRows.push({
        target: spot.tag,
        // Taken a few ms before the CDP dispatch, in the page's own time origin: the earliest of these
        // is the split point for TBT attribution, since Chrome never fires `first-input` for
        // DevTools-injected input and the event-timing startTime is only recorded for slow handlers.
        armed_at_ms: armedAt,
        proc_max_before_ms: before.proc,
        proc_max_after_ms: after.proc,
        set_new_max: after.proc > before.proc,
        event_count_delta: after.events - before.events,
        view_swap_ms: after.swap ?? null,
        worst_event_logged: after.log || null,
      });
    }
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, S);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, S);
    await sleep(900);

    const vitals = await ev(`
      const nav = performance.getEntriesByType('navigation')[0] || {};
      const res = performance.getEntriesByType('resource');
      const scripts = res.filter(r => r.initiatorType === 'script' || /\\.js(\\?|$)/.test(r.name));
      const entry = (document.querySelector('script[type="module"]') || {}).src || '';
      return {
        fcp: window.__perf.fcp,
        lcp_before_input: window.__perf.lcpBeforeInput ?? window.__perf.lcp,
        lcp_final: window.__perf.lcp,
        cls: Number(window.__perf.cls.toFixed(4)),
        tbt_ms: Math.round(window.__perf.tbt),
        longest_task_ms: window.__perf.longestTask,
        inp_processing_max_ms: window.__perf.inpProcessing,
        interaction_events_observed: window.__perf.events,
        domContentLoaded_ms: Math.round(nav.domContentLoadedEventEnd || 0),
        load_ms: Math.round(nav.loadEventEnd || 0),
        server_timing_ttfb_ms: Math.round(nav.responseStart || 0),
        resource_count: res.length,
        page_bytes_encoded: Math.round(res.reduce((n, r) => n + (r.encodedBodySize || 0), 0)),
        scripts: scripts.map(s => ({ name: s.name.split('/').pop(), encoded_bytes: Math.round(s.encodedBodySize), transfer_bytes: Math.round(s.transferSize), after_load_ms: Math.round(s.startTime) })),
        entry_script: entry.split('/').pop(),
        first_input_at_ms: window.__perf.firstInputAt,
        observed_window_ms: Math.round(performance.now()),
        worst_events: window.__perf.eventLog.slice().sort((a, b) => b.proc - a.proc).slice(0, 8),
        long_tasks: window.__perf.longTasks.slice().sort((a, b) => b.dur - a.dur).slice(0, 8),
        // Full list (capped at 40 by the bootstrap) so attribution can count every task, not only the
        // eight worst that get reported.
        long_tasks_all: window.__perf.longTasks.slice(),
      };`);
    const armed = clickRows.map((c) => c.armed_at_ms).filter((t) => typeof t === 'number');
    const firstClickAt = armed.length ? Math.min(...armed) : null;
    const allLongTasks = vitals.long_tasks_all || [];
    out.push({
      view: view.name,
      url: view.url,
      rendered: true,
      lcp_before_input_ms: lcpBeforeInput,
      ...vitals,
      // TBT is only comparable between views if it is normalised to how long each page was observed,
      // and only diagnosable if it is split at the first dispatched interaction: tasks before it are
      // boot and animation, tasks after it are the click's own cost.
      tbt_attribution: {
        first_click_armed_at_ms: firstClickAt,
        observed_window_ms: vitals.observed_window_ms,
        tbt_per_observed_second_ms: vitals.observed_window_ms
          ? Number(((vitals.tbt_ms / vitals.observed_window_ms) * 1000).toFixed(1))
          : null,
        long_tasks_before_first_click: allLongTasks.filter((t) => firstClickAt == null || t.at < firstClickAt).length,
        long_task_ms_before_first_click: allLongTasks.filter((t) => firstClickAt == null || t.at < firstClickAt).reduce((n, t) => n + t.dur, 0),
        long_tasks_after_first_click: allLongTasks.filter((t) => firstClickAt != null && t.at >= firstClickAt).length,
        long_task_ms_after_first_click: allLongTasks.filter((t) => firstClickAt != null && t.at >= firstClickAt).reduce((n, t) => n + t.dur, 0),
        note: 'Chrome does not fire first-input for DevTools-dispatched input, so the split uses the probe\'s own dispatch clock (armed_at_ms), not first_input_at_ms.',
      },
      interactions: clickRows,
    });
    console.log(`view ${view.name.padEnd(12)} FCP ${vitals.fcp}ms  LCP ${lcpBeforeInput}ms  CLS ${vitals.cls}  TBT ${vitals.tbt_ms}ms (${Math.round(vitals.observed_window_ms / 1000)}s window)  INP(processing) ${vitals.inp_processing_max_ms}ms  scripts ${vitals.scripts.length}  page ${Math.round(vitals.page_bytes_encoded / 1024)}kB`);
    console.log(`  long tasks: ${vitals.long_tasks.length} worst in window, ${allLongTasks.length} recorded — ${out[out.length - 1].tbt_attribution.long_task_ms_before_first_click}ms before first click, ${out[out.length - 1].tbt_attribution.long_task_ms_after_first_click}ms after`);
    const worst = (vitals.worst_events || [])[0];
    if (worst) console.log(`  worst interaction handler: ${worst.type} on ${worst.target} — processing ${worst.proc}ms at ${worst.at}ms${vitals.first_input_at_ms != null ? ` (first input at ${vitals.first_input_at_ms}ms)` : ''}`);
    for (const c of clickRows) console.log(`  click ${String(c.target).padEnd(28)} procMax ${c.proc_max_after_ms}ms${c.set_new_max ? '  <-- set new max' : ''}  view swap ${c.view_swap_ms == null ? 'n/a' : `${c.view_swap_ms}ms`}  events+${c.event_count_delta}`);
  }
  ws.close();
  return out;
}

let report;
try {
  if (!(await waitHealthy())) throw new Error(`API did not become healthy on ${ORIGIN}: ${apiErr.slice(0, 400)}`);
  const meta = await (await fetch(`${ORIGIN}/api/v1/meta`)).json();
  const lagHours = meta.live_window ? Number((((Date.now() - Date.parse(`${meta.live_window.end}T23:59:59Z`)) / 3600000)).toFixed(1)) : null;
  const latency = await measureEndpoints();
  let browser = [];
  try {
    browser = await measureBrowser();
  } catch (err) {
    fail('browser', String(err?.message || err).slice(0, 300));
  }

  // The origin does not compress, so Resource Timing raw bytes cannot answer the "250 KB gzipped
  // initial JS" budget. Gzip the emitted file itself — the same number `vite build` prints, measured
  // here rather than transcribed.
  const gzipBytes = (name) => {
    const file = path.join(ROOT, 'dist', 'assets', name || '');
    return fs.existsSync(file) ? zlib.gzipSync(fs.readFileSync(file)).length : null;
  };
  const initialJs = browser.map((b) => {
    const entry = (b.scripts || []).find((s) => s.name === b.entry_script);
    const entryGzip = gzipBytes(b.entry_script);
    // Two different quantities live here and the §9.2 budget is about the first one only:
    // - the initial payload: everything requested before the probe's own first dispatched interaction,
    //   i.e. the bytes a visitor must wait for before the landing view is usable;
    // - the session total: every chunk fetched during the sweep, including the lazily loaded Watch route
    //   that a nav click pulls in seconds later (ADR-21).
    // Before the split the two were the same set, because all chunks were preloaded with the entry.
    // Reporting only the session total would hide the split, and reporting only the payload would hide
    // what a browsing session actually downloads, so both are in the record and the budget is judged on
    // the payload. The session total is surfaced as a near-miss whenever it is the larger number.
    const cutMs = b.tbt_attribution?.first_click_armed_at_ms ?? null;
    const perScript = (b.scripts || []).map((s) => ({
      name: s.name,
      raw_bytes: s.encoded_bytes,
      gzip_bytes: gzipBytes(s.name),
      requested_at_ms: s.after_load_ms,
      in_initial_payload: cutMs == null ? true : s.after_load_ms < cutMs,
    }));
    const allKnown = (list) => list.length > 0 && list.every((s) => s.gzip_bytes != null);
    const sum = (list) => list.reduce((n, s) => n + s.gzip_bytes, 0);
    const payload = perScript.filter((s) => s.in_initial_payload);
    const payloadGzip = allKnown(payload) ? sum(payload) : null;
    const totalGzip = allKnown(perScript) ? sum(perScript) : null;
    const kib = (bytes) => Number((bytes / 1024).toFixed(2));
    const dec = (bytes) => Number((bytes / 1000).toFixed(2));
    return {
      view: b.view,
      entry_script: b.entry_script || null,
      entry_raw_bytes_from_probe: entry?.encoded_bytes ?? null,
      entry_gzip_bytes: entryGzip,
      first_interaction_cut_ms: cutMs,
      initial_payload_scripts: payload.map((s) => s.name),
      initial_payload_gzip_bytes: payloadGzip,
      initial_payload_gzip_kb: payloadGzip == null ? null : kib(payloadGzip),
      initial_payload_gzip_kb_decimal: payloadGzip == null ? null : dec(payloadGzip),
      within_payload_budget_kib: payloadGzip == null ? null : payloadGzip / 1024 <= OBJECTIVES.initial_js_gzip_kb,
      within_payload_budget_decimal_kb: payloadGzip == null ? null : payloadGzip / 1000 <= OBJECTIVES.initial_js_gzip_kb,
      session_total_scripts: perScript.map((s) => s.name),
      session_total_gzip_bytes: totalGzip,
      session_total_gzip_kb: totalGzip == null ? null : kib(totalGzip),
      session_total_gzip_kb_decimal: totalGzip == null ? null : dec(totalGzip),
      // Kept for continuity with the earlier reports: the same figure as session_total_gzip_kb.
      scripts_requested_as_initial: perScript.map((s) => s.name),
      total_initial_gzip_bytes: totalGzip,
      total_initial_gzip_kb: totalGzip == null ? null : kib(totalGzip),
      // The PRD writes "250 kB". Vite 5 prints its gzip figures divided by 1000 (measured: it labels the
      // 105,042-byte entry chunk "105.04 kB"), so the tool that states the budget in these documents uses
      // decimal kB, while a 1024-based reading is more lenient. Both are reported and neither is dropped.
      total_initial_gzip_kb_decimal: totalGzip == null ? null : dec(totalGzip),
      within_budget_kib: payloadGzip == null ? null : payloadGzip / 1024 <= OBJECTIVES.initial_js_gzip_kb,
      within_budget_decimal_kb: payloadGzip == null ? null : payloadGzip / 1000 <= OBJECTIVES.initial_js_gzip_kb,
      initial_js_budget_kb: OBJECTIVES.initial_js_gzip_kb,
      within_budget: payloadGzip == null ? null : payloadGzip / 1024 <= OBJECTIVES.initial_js_gzip_kb,
      budget_basis: 'initial payload = chunks requested before the first dispatched interaction',
      scripts: perScript,
    };
  });

  const breaches = [];
  for (const row of latency.rows) if (row.meets_objective === false) breaches.push(`${row.endpoint} p95 ${row.p95_ms}ms over objective ${row.objective_p95_ms}ms`);
  if (latency.errorRatePct >= OBJECTIVES.server_error_rate_pct) breaches.push(`server error rate ${latency.errorRatePct}% >= ${OBJECTIVES.server_error_rate_pct}%`);
  if (lagHours != null && lagHours > OBJECTIVES.data_freshness_lag_hours) breaches.push(`data lag ${lagHours}h > ${OBJECTIVES.data_freshness_lag_hours}h objective`);
  for (const b of browser) {
    if (b.lcp_before_input_ms > OBJECTIVES.lcp_p75_ms) breaches.push(`${b.view} LCP ${b.lcp_before_input_ms}ms > ${OBJECTIVES.lcp_p75_ms}ms`);
    if (b.cls > OBJECTIVES.cls_p75) breaches.push(`${b.view} CLS ${b.cls} > ${OBJECTIVES.cls_p75}`);
    if (b.inp_processing_max_ms > OBJECTIVES.inp_p75_ms) {
      const worst = (b.worst_events || [])[0];
      breaches.push(`${b.view} INP processing ${b.inp_processing_max_ms}ms > ${OBJECTIVES.inp_p75_ms}ms${worst ? ` (worst handler: ${worst.type} on ${worst.target} at ${worst.at}ms)` : ''}`);
    }
  }
  for (const j of initialJs) if (j.initial_payload_gzip_kb != null && j.initial_payload_gzip_kb > OBJECTIVES.initial_js_gzip_kb) breaches.push(`${j.view} initial JS payload ${j.initial_payload_gzip_kb} kB gzipped across ${j.initial_payload_scripts.length} chunks > ${OBJECTIVES.initial_js_gzip_kb} kB budget`);

  // Objectives met with less than 10% headroom are reported separately: on a slower device or a real
  // network they are the ones that flip, and a bare "met" would hide that.
  const nearMiss = [];
  for (const b of browser) {
    if (b.cls <= OBJECTIVES.cls_p75 && b.cls > OBJECTIVES.cls_p75 * 0.9) nearMiss.push(`${b.view} CLS ${b.cls} meets ${OBJECTIVES.cls_p75} with under 10% headroom`);
    if (b.lcp_before_input_ms <= OBJECTIVES.lcp_p75_ms && b.lcp_before_input_ms > OBJECTIVES.lcp_p75_ms * 0.9) nearMiss.push(`${b.view} LCP ${b.lcp_before_input_ms}ms meets ${OBJECTIVES.lcp_p75_ms}ms with under 10% headroom`);
  }
  for (const j of initialJs) {
    if (j.initial_payload_gzip_kb != null && j.initial_payload_gzip_kb <= OBJECTIVES.initial_js_gzip_kb && j.initial_payload_gzip_kb > OBJECTIVES.initial_js_gzip_kb * 0.9) {
      nearMiss.push(`${j.view} initial JS payload ${j.initial_payload_gzip_kb} kB (KiB) meets the ${OBJECTIVES.initial_js_gzip_kb} kB budget with under 10% headroom${j.within_payload_budget_decimal_kb === false ? ` — and is ${j.initial_payload_gzip_kb_decimal} kB on the strict decimal reading, i.e. over it by ${(j.initial_payload_gzip_kb_decimal - OBJECTIVES.initial_js_gzip_kb).toFixed(2)} kB` : ''}`);
    }
    // The lazy Watch route is fetched during the session even on views that do not open with it. That is
    // not initial JS, but it is bytes a browsing session pays, so the larger figure stays visible here.
    if (j.session_total_gzip_bytes != null && j.initial_payload_gzip_bytes != null && j.session_total_gzip_bytes > j.initial_payload_gzip_bytes) {
      nearMiss.push(`${j.view} downloads ${j.session_total_gzip_kb} kB (KiB; ${j.session_total_gzip_kb_decimal} kB decimal) of JS across the whole probed session, after the ${j.initial_payload_gzip_kb} kB initial payload, because the nav clicks in the sweep pull in the lazily loaded Watch route and three.js`);
    }
  }
  for (const row of latency.rows) if (row.objective_p95_ms && row.p95_ms > row.objective_p95_ms * 0.9) nearMiss.push(`${row.endpoint} p95 ${row.p95_ms}ms meets ${row.objective_p95_ms}ms with under 10% headroom`);

  report = {
    generated_at: new Date().toISOString(),
    kind: 'local single-origin probe',
    environment: {
      origin: ORIGIN,
      topology: 'node server/api.mjs serving dist/ and /api/v1 on one loopback port',
      node: process.version,
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      cpus: os.cpus().length,
      cpu_model: os.cpus()[0]?.model || 'unknown',
      chrome_debug_port: DEBUG_PORT,
      viewport: '1440x900, headless=new, no network throttling',
      rate_limits_raised_for_probe: true,
      api_rate_limits_used: 'classA/B/C:100000/min (the limiter itself is asserted by npm run smoke)',
      samples_default: SAMPLES,
      samples_slow_endpoints: SLOW_SAMPLES,
    },
    prd_objectives: { ...OBJECTIVES, source: 'docs/full prd.pdf §2 objective table (p4) and §9.2 budgets (p17)' },
    api_latency: latency,
    data_freshness: { live_window_end: meta.live_window?.end || null, lag_hours: lagHours, objective_hours: OBJECTIVES.data_freshness_lag_hours, meets_objective: lagHours == null ? null : lagHours <= OBJECTIVES.data_freshness_lag_hours },
    web_vitals: browser,
    js_budget: initialJs,
    verdict: { breaches, near_miss: nearMiss, objectives_met: breaches.length === 0 && probeErrors.length === 0 },
    caveats: [
      'One client, sequential requests, loopback, no concurrency: these are service-time numbers on this machine, not capacity or p95 under load. A load test needs k6 or Locust against a deployed target (docs/production-readiness.md §6).',
      'The PRD states the 2 s objective for cached summary/status responses. This API has no response cache, so every sample is an uncached server-side computation — the numbers are stricter than the objective assumes.',
      'Server timing excludes TLS and any CDN edge; the client and the server share one CPU.',
      'INP is reported as its processing component only (processingEnd - processingStart), because presentation delay needs the web-vitals library or Lighthouse, and neither can be installed offline here. Treat it as a lower bound on true INP. The value is a maximum over observed events, which is stricter than the PRD\'s p75, and the observer runs with durationThreshold 0 so it also catches browser-synthesised pointer pairs and the Tab keypress; web_vitals[].interactions attributes one row per dispatched click.',
      'Each web-vital comes from one navigation per view, not a p75 over real users; field data requires a collector that does not exist yet.',
      'Bytes from Resource Timing are raw, because this origin does not compress. The §9.2 initial-JS budget is judged on gzip measured directly from the emitted dist files, summed over the chunks requested before the probe\'s first dispatched interaction — the payload the landing view actually waits for. Since ADR-21 the Watch route and three.js are fetched lazily, so the same session downloads more than that when a nav click opens Watch; both figures are in js_budget[] (initial_payload_* and session_total_*) and the larger one is called out as a near-miss whenever it exceeds the budget. The unit is ambiguous in the PRD and material here: Vite 5 prints these gzip numbers divided by 1000 (it labels the 105,042-byte entry chunk "105.04 kB"), so the strict reading of "250 kB" is 250,000 bytes, while a 1024-based reading is 250 KiB and more lenient. Both are reported for every view and neither is presented alone. Page weight is reported raw — a compressing edge would send less than the probe shows.',
      'Availability of 99% monthly is not measurable by a probe of a single local process.',
      'Rate limits were raised for this run so the limiter did not answer 429 inside the timing samples.',
      'Nav view switches are deferred one macrotask out of the click handler (src/lib/store.tsx setView). That keeps the handler short, which is what INP measures, but the new page still has to render: interactions[].view_swap_ms is the wall time from click to the committed view — read together with INP, because a short INP with a long swap is a trade-off, not a free win. PRD §2 sets no objective for swap time, so it is reported, not judged. useTransition was measured first and rejected: it sliced the mount across animation frames and the swap went to 1.6-2.8 s with TBT doubling.',
      'TBT here is dominated by recurring ~250 ms frame tasks on canvas views, from software WebGL under --disable-gpu (SwiftShader). The method-static control separates that from app work: on the static page, long tasks before the first click are boot only, and the ~250-600 ms tasks appear after its clicks navigate to a canvas view. Real device TBT will differ. Attribution uses the probe\'s dispatch clock because Chrome does not fire first-input for CDP-injected input, and the long-task list is capped at 300 entries per view.',
    ],
    probe_errors: probeErrors,
  };
} catch (err) {
  fail('probe', String(err?.stack || err).slice(0, 600));
  report = { generated_at: new Date().toISOString(), kind: 'local single-origin probe', failed: true, error: String(err?.message || err), probe_errors: probeErrors };
} finally {
  api.kill();
  chrome.kill();
  // Chrome keeps the profile open for a moment after SIGTERM; on Windows an rmSync inside that
  // window fails with EPERM and would take the report down with it. Wait for exit, retry, and
  // never let cleanup failure mask a written report.
  await new Promise((res) => { chrome.once('exit', res); setTimeout(res, 4000); });
  try {
    fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 8, retryDelay: 400 });
  } catch (err) {
    console.log(`PROBE-NOTE  could not remove temp profile ${PROFILE}: ${String(err?.message || err).slice(0, 120)}`);
  }
}

fs.writeFileSync(path.join(ROOT, 'docs', 'perf-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`\nprobe: ${report.verdict?.objectives_met ? 'every measurable objective met' : 'READ THE BREACH LIST'} — docs/perf-report.json written`);
if (report.verdict?.breaches?.length) console.log(report.verdict.breaches.map((b) => `  BREACH  ${b}`).join('\n'));
if (report.verdict?.near_miss?.length) console.log(report.verdict.near_miss.map((n) => `  THIN    ${n}`).join('\n'));
if (probeErrors.length) console.log(probeErrors.map((e) => `  ERROR   ${e}`).join('\n'));
process.exit(probeErrors.length || report.failed || report.verdict?.objectives_met === false ? 1 : 0);
