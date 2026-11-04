import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9223;
const ORIGIN = process.env.E2E_ORIGIN || 'http://localhost:4174';
const PROFILE = path.join(os.tmpdir(), `continuum-e2e-${Date.now()}`);
const DOWNLOADS = path.join(os.tmpdir(), 'continuum-downloads');
fs.rmSync(DOWNLOADS, { recursive: true, force: true });
fs.mkdirSync(DOWNLOADS, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--window-size=1440,900', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(url) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error(`cannot reach ${url}`);
}

const version = await json(`http://127.0.0.1:${PORT}/json/version`);
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let seq = 0;
const pending = new Map();
const events = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  } else if (msg.method) events.push(msg);
};
function send(method, params = {}, sessionId) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

const { targetInfos } = await send('Target.getTargets');
const page = targetInfos.find((t) => t.type === 'page');
const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
const S = sessionId;

await send('Page.enable', {}, S);
await send('Runtime.enable', {}, S);
await send('Network.enable', {}, S);
await send('Log.enable', {}, S);
await send('Emulation.setFocusEmulationEnabled', { enabled: true }, S).catch(() => {});
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS }).catch(() => {});
await send('Browser.grantPermissions', {
  origin: ORIGIN,
  permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
}).catch(() => {});

async function ev(body, timeout = 20000) {
  const r = await send('Runtime.evaluate', {
    expression: `(async () => { ${body} })()`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  }, S);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  if (timeout) { /* CDP has no per-call timeout; server roundtrip bounded */ }
  return r.result.value;
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) });
}

async function waitFor(selector, ms = 15000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const ok = await ev(`return !!document.querySelector(${JSON.stringify(selector)});`);
    if (ok) return true;
    await sleep(250);
  }
  return false;
}

async function waitText(text, ms = 15000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const ok = await ev(`return (document.body.textContent || '').includes(${JSON.stringify(text)});`);
    if (ok) return true;
    await sleep(400);
  }
  return false;
}

async function nav(label) {
  return ev(`
    const b = [...document.querySelectorAll('nav.nav button')].find(x => x.querySelector('.nav-full')?.textContent?.trim() === ${JSON.stringify(label)} || x.textContent?.includes(${JSON.stringify(label)}));
    if (!b) return false;
    b.click();
    await new Promise(r => setTimeout(r, 450));
    return true;`);
}

async function clickText(text, scope = 'button') {
  return ev(`
    const el = [...document.querySelectorAll(${JSON.stringify(scope)})].find(x => x.textContent?.replace(/\\s+/g, ' ').trim().includes(${JSON.stringify(text)}));
    if (!el) return false;
    el.click();
    await new Promise(r => setTimeout(r, 350));
    return true;`);
}

async function setRange(selector, value, index = 0) {
  return ev(`
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})][${index}];
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(String(value))});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    return true;`);
}

async function setSelect(selector, value) {
  return ev(`
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(String(value))});
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    return true;`);
}

// Real key events through CDP, so default actions (button activation, <summary> toggle, focus
// traversal) run the way a keyboard user's would — dispatchEvent from the page is not trusted.
async function press(key, vk, char, mods = 0) {
  const code = key === ' ' ? 'Space' : key;
  const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mods };
  // `text` on keyDown is what makes Chrome run the default action (native click on a button,
  // toggle on a <summary>); a bare keyDown/keyUp is delivered to JS handlers only.
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(char ? { text: char } : {}) }, S);
  if (char) await send('Input.dispatchKeyEvent', { type: 'keyPress', text: char, ...base }, S).catch(() => {});
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, S);
  await sleep(160);
}

async function waitFile(pattern, ms = 12000) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
  const start = Date.now();
  while (Date.now() - start < ms) {
    const hit = fs.readdirSync(DOWNLOADS).find((f) => re.test(f) && !f.endsWith('.crdownload'));
    if (hit) {
      const p = path.join(DOWNLOADS, hit);
      const size = fs.statSync(p).size;
      if (size > 0) { await sleep(400); return { file: hit, size, path: p }; }
    }
    await sleep(300);
  }
  return null;
}

try {
  await send('Page.navigate', { url: `${ORIGIN}/?e2e=${Date.now()}#/watch` }, S);
  await waitFor('main');
  await sleep(2500);

  // ---------- Watch ----------
  const watch = await ev(`return {
    hero: document.querySelector('.watch-hero h1')?.textContent?.replace(/\\s+/g,' ').trim(),
    live: document.querySelector('.hero-meta')?.textContent?.replace(/\\s+/g,' ').trim(),
    sats: [...document.querySelectorAll('.sat-list button')].length,
    region: document.querySelector('.region-name')?.textContent?.trim(),
    clock: document.querySelector('.clock')?.textContent?.trim(),
    badges: document.querySelector('.watch-badges')?.textContent?.replace(/\\s+/g,' ').trim(),
  };`);
  check('Watch renders hero + live window', /fire record/i.test(watch.hero || '') && /real detections/.test(watch.live || ''), watch);
  check('Five spacecraft listed', watch.sats === 5, watch.sats);
  check('Real SGP4 badge present', /REAL SGP4/.test(watch.badges || ''), watch.badges);

  const satDetail = await ev(`
    const buttons = [...document.querySelectorAll('.sat-list button')];
    const n21 = buttons.find(b => b.textContent.includes('NOAA-21'));
    n21?.click();
    await new Promise(r => setTimeout(r, 400));
    return {
      detail: document.querySelector('.sat-detail')?.textContent?.replace(/\\s+/g,' ').trim(),
      pressed: [...document.querySelectorAll('.sat-list button')].map(b => b.getAttribute('aria-pressed')),
    };`);
  check('NOAA-21 selection updates detail', /NOAA-21/.test(satDetail.detail || '') && /375 m/.test(satDetail.detail || ''), satDetail.detail?.slice(0, 140));

  // Playback advances the clock
  await ev(`const p = document.querySelector('.play-btn'); if (p?.getAttribute('aria-label')?.startsWith('Play')) p.click(); return true;`);
  const clock1 = await ev(`return document.querySelector('.clock')?.textContent?.trim();`);
  await sleep(1800);
  const clock2 = await ev(`return document.querySelector('.clock')?.textContent?.trim();`);
  check('Simulation clock advances (rAF live)', clock1 !== clock2, { clock1, clock2 });

  const speed = await ev(`
    const b = [...document.querySelectorAll('.speeds button')].find(x => x.textContent.includes('600'));
    b?.click(); await new Promise(r => setTimeout(r, 300));
    return { sim: document.querySelector('.watch-sim')?.textContent?.trim(), active: [...document.querySelectorAll('.speeds button')].map(x => ({ t: x.textContent.trim(), on: x.classList.contains('active') })) };`);
  check('Speed selector switches to 600x', /600×/.test(speed.sim || ''), speed);

  const offset = await ev(`
    const play = document.querySelector('.play-btn');
    if (play?.getAttribute('aria-label')?.startsWith('Pause')) play.click();
    await new Promise(r => setTimeout(r, 300));
    const slider = document.querySelector('input[type=range]');
    const before = document.querySelector('.clock')?.textContent?.trim();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(slider, '-24'); slider.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 500));
    const after = document.querySelector('.clock')?.textContent?.trim();
    const sliderAt = slider.value;
    setter.call(slider, '0'); slider.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const yd = new Date(Date.now() - 86400000);
    const expected = [yd.getUTCDate(), months[yd.getUTCMonth()], yd.getUTCFullYear()].join(' ');
    return { before, after, sliderAt, reset: document.querySelector('.clock')?.textContent?.trim(), value: slider.value, expected };`);
  check('Time offset slider seeks the globe back a day', offset.after !== offset.before && (offset.after || '').includes(offset.expected) && offset.sliderAt === '-24', offset);

  // Region chip
  const chip = await ev(`
    const b = [...document.querySelectorAll('.region-chip')].find(x => /pantanal/i.test(x.textContent));
    b?.click(); await new Promise(r => setTimeout(r, 600));
    return { region: document.querySelector('.region-name')?.textContent?.trim(), hash: location.hash };`);
  check('Region chip switches AOI to Pantanal', /Pantanal/i.test(chip.region || '') && /pantanal/i.test(chip.hash || ''), chip);

  // Alert drawer
  const drawer = await ev(`
    document.querySelector('.nav-alert')?.click();
    await new Promise(r => setTimeout(r, 500));
    const items = [...document.querySelectorAll('.alert-item')];
    const msg = document.querySelector('.phone-bubble pre')?.textContent || '';
    return { open: !!document.querySelector('.drawer'), count: items.length, msg: msg.slice(0, 220), dispatchButtons: [...document.querySelectorAll('.dispatch-actions button')].map(b => b.textContent.trim()) };`);
  check('Alert center opens with 7 ranked regions', drawer.open && drawer.count === 7, drawer);
  check('Dispatch preview carries live + calibration content', /CONTINUUM WATCH/.test(drawer.msg) && /Sensor calibration/.test(drawer.msg), drawer.msg);

  const dispatchCopy = await ev(`
    const b = [...document.querySelectorAll('.dispatch-actions button')].find(x => x.textContent.includes('Copy message'));
    b?.click(); await new Promise(r => setTimeout(r, 500));
    return { toast: document.querySelector('.toast')?.textContent?.trim() || '', clip: await navigator.clipboard.readText().then(t => t.slice(0, 90)).catch(() => 'blocked') };`);
  check('Dispatch message copies to clipboard', /CONTINUUM WATCH/.test(dispatchCopy.clip || '') || /copied/i.test(dispatchCopy.toast || ''), dispatchCopy);

  await ev(`[...document.querySelectorAll('.dispatch-actions button')].find(x => x.textContent.includes('Download'))?.click(); return true;`);
  const dispatchFile = await waitFile(/\.txt$/i);
  check('Dispatch message downloads as .txt', !!dispatchFile, dispatchFile);

  await ev(`document.querySelector('.drawer-head .icon-btn')?.click(); await new Promise(r => setTimeout(r, 300)); return true;`);


  // ---------- Atlas ----------
  await nav('Atlas');
  await waitFor('.calendar-panel', 8000);
  const atlas0 = await ev(`return {
    cells: document.querySelectorAll('.cal-cell').length,
    metricBtns: [...document.querySelectorAll('[aria-label="Metric"] button')].map(b => ({ t: b.textContent.trim(), on: b.getAttribute('aria-pressed') })),
    modeBtns: [...document.querySelectorAll('[aria-label="Sensor mode"] button')].map(b => ({ t: b.textContent.trim(), on: b.getAttribute('aria-pressed') })),
    month: document.querySelector('select[aria-label="Month"]')?.value,
  };`);
  check('Calendar renders every day of the record', atlas0.cells > 9000, atlas0.cells);
  check('Metric + mode controls expose 3 metrics and 2 modes', atlas0.metricBtns?.length === 3 && atlas0.modeBtns?.length === 2, atlas0);

  const atlasMetric = await ev(`
    const b = [...document.querySelectorAll('[aria-label="Metric"] button')].find(x => /Fire-days/i.test(x.textContent));
    b?.click(); await new Promise(r => setTimeout(r, 350));
    const raw = [...document.querySelectorAll('[aria-label="Sensor mode"] button')].find(x => /Raw/i.test(x.textContent));
    raw?.click(); await new Promise(r => setTimeout(r, 350));
    return {
      metricOn: [...document.querySelectorAll('[aria-label="Metric"] button')].filter(x => x.getAttribute('aria-pressed') === 'true').map(x => x.textContent.trim()),
      modeOn: [...document.querySelectorAll('[aria-label="Sensor mode"] button')].filter(x => x.getAttribute('aria-pressed') === 'true').map(x => x.textContent.trim()),
    };`);
  check('Metric/mode toggles switch to Fire-days + Raw', /Fire-days/.test(atlasMetric.metricOn?.[0] || '') && /Raw/.test(atlasMetric.modeOn?.[0] || ''), atlasMetric);

  const split = await ev(`
    const b = [...document.querySelectorAll('.panel-controls button')].find(x => /Compare|Split on/i.test(x.textContent));
    b?.click(); await new Promise(r => setTimeout(r, 400));
    const splitEl = document.querySelector('.split-calendar');
    const out = { label: b?.textContent?.trim(), split: !!splitEl };
    b?.click(); await new Promise(r => setTimeout(r, 400));
    return out;`);
  check('Compare mode renders raw/harmonized split', split.split === true, split);

  await setSelect('select[aria-label="Month"]', 8);
  const monthStats = await ev(`return { month: document.querySelector('select[aria-label="Month"]')?.value, stats: document.querySelector('.mini-stats')?.textContent?.replace(/\\s+/g,' ').trim().slice(0,160) };`);
  check('Month selector recomputes the comparison', monthStats.month === '8' && !!monthStats.stats, monthStats);
  await setSelect('select[aria-label="Month"]', 10);

  const frame = await ev(`
    const btns = [...document.querySelectorAll('[aria-label="Calendar resolution"] button')];
    const res = btns.map(b => b.textContent.trim());
    const fields = [...document.querySelectorAll('.calendar-frame .frame-field')].map(f => f.querySelector('span')?.textContent?.trim());
    const cellsDay = document.querySelectorAll('.cal-cell').length;
    btns.find(b => /Years/.test(b.textContent))?.click(); await new Promise(r => setTimeout(r, 500));
    const cellsYear = document.querySelectorAll('.cal-cell').length;
    const pressed = btns.filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent.trim());
    btns.find(b => /Days/.test(b.textContent))?.click(); await new Promise(r => setTimeout(r, 500));
    const restored = document.querySelectorAll('.cal-cell').length;
    return { res, fields, cellsDay, cellsYear, pressed, restored };`);
  check('Calendar frame reads the record by day, week, month, quarter and year', frame.res?.join(',') === 'Days,Weeks,Months,3 mo,Years', frame.res);
  check('Calendar frame exposes span, focus year and comparison gap', ['Span', 'Focus year', 'Compare'].every((f) => frame.fields?.includes(f)), frame.fields);
  check('Frame resolution re-reads the same record', frame.pressed?.join(',') === 'Years' && frame.cellsYear < frame.cellsDay / 5 && frame.restored === frame.cellsDay, `${frame.cellsDay} day cells → ${frame.cellsYear} year cells → ${frame.restored} restored`);

  const frameLink = await ev(`
    const btns = [...document.querySelectorAll('[aria-label="Calendar resolution"] button')];
    const selects = [...document.querySelectorAll('.calendar-frame .frame-field select')];
    const [spanSel, fySel, gapSel] = selects;
    void spanSel;
    btns.find(b => /Years/.test(b.textContent))?.click();
    await new Promise(r => setTimeout(r, 400));
    const yearVal = fySel?.options[Math.min(3, fySel.options.length - 1)]?.value;
    if (fySel && yearVal) { fySel.value = yearVal; fySel.dispatchEvent(new Event('change', { bubbles: true })); }
    await new Promise(r => setTimeout(r, 400));
    const gapVal = gapSel ? [...gapSel.options].map(o => o.value).filter(v => v !== '0' && v !== '1').pop() : null;
    if (gapSel && gapVal) { gapSel.value = gapVal; gapSel.dispatchEvent(new Event('change', { bubbles: true })); }
    await new Promise(r => setTimeout(r, 500));
    const hash = location.hash;
    const q = new URLSearchParams(hash.split('?')[1]);
    const linked = { res: q.get('res'), span: q.get('span'), fy: q.get('fy'), gap: q.get('gap') };
    location.hash = hash;
    await new Promise(r => setTimeout(r, 900));
    const selectsNow = [...document.querySelectorAll('.calendar-frame .frame-field select')];
    const applied = {
      pressed: [...document.querySelectorAll('[aria-label="Calendar resolution"] button')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent.trim()).join(','),
      fy: selectsNow[1]?.value,
      gap: selectsNow[2]?.value,
    };
    const btnsNow = [...document.querySelectorAll('[aria-label="Calendar resolution"] button')];
    const selsNow = [...document.querySelectorAll('.calendar-frame .frame-field select')];
    btnsNow.find(b => /Days/.test(b.textContent))?.click();
    if (selsNow[1]) { selsNow[1].value = selsNow[1].options[0].value; selsNow[1].dispatchEvent(new Event('change', { bubbles: true })); }
    if (selsNow[2]) { selsNow[2].value = '1'; selsNow[2].dispatchEvent(new Event('change', { bubbles: true })); }
    await new Promise(r => setTimeout(r, 500));
    return { hash, linked, applied, yearVal, gapVal, restored: location.hash };`);
  check('Calendar frame settings ride in the shareable URL', frameLink.linked?.res === 'year' && frameLink.linked?.fy === frameLink.yearVal && frameLink.linked?.gap === frameLink.gapVal, frameLink.linked);
  check('Pasting the frame link restores the same reading frame', frameLink.applied?.pressed === 'Years' && frameLink.applied?.fy === frameLink.yearVal && frameLink.applied?.gap === frameLink.gapVal, frameLink.applied);
  check('Default frame settings drop out of the URL again', !/[?&](res|fy|gap)=/.test(frameLink.restored || ''), frameLink.restored);

  const day = await ev(`
    const cells = [...document.querySelectorAll('.cal-cell')];
    cells[cells.length - 1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 500));
    const table = document.querySelector('.sensor-table');
    return { detail: !!document.querySelector('.day-detail'), rows: table ? [...table.querySelectorAll('tbody tr')].map(r => r.textContent.replace(/\\s+/g,' ').trim()) : [], badges: document.querySelector('.day-detail .chip-row')?.textContent?.replace(/\\s+/g,' ').trim() };`);
  check('Day inspector opens with four sensor rows', day.detail && day.rows?.length === 4, day.rows);
  check('Latest day is a live observation', /LIVE OBSERVATION/.test(day.badges || ''), day.badges);

  // React derives onMouseEnter from bubbling mouseover, so dispatch mouseover — a bare mouseenter
  // event never reaches the handler.
  const hover = await ev(`
    const metricBtns = [...document.querySelectorAll('[aria-label="Metric"] button')];
    metricBtns[0]?.click();
    [...document.querySelectorAll('[aria-label="Sensor mode"] button')][0]?.click();
    await new Promise(r => setTimeout(r, 400));
    const cells = [...document.querySelectorAll('.cal-cell')];
    const c = cells[cells.length - 60] || cells[cells.length - 1];
    c?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    const harmonizedRead = document.querySelector('.calendar-readout')?.textContent?.replace(/\\s+/g, ' ').trim();
    metricBtns[1]?.click();
    await new Promise(r => setTimeout(r, 400));
    c?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    c?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    const firedaysRead = document.querySelector('.calendar-readout')?.textContent?.replace(/\\s+/g, ' ').trim();
    c?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    return { harmonizedRead: (harmonizedRead || '').slice(0, 300), firedaysRead: (firedaysRead || '').slice(0, 300), found: !!c };`);
  check('Hover readout carries value, 90% interval, per-sensor mix and trust label',
    !!hover.found && /VIIRS-eq/.test(hover.harmonizedRead) && /90% CI/.test(hover.harmonizedRead) && /trust/.test(hover.harmonizedRead)
      && /MODIS/.test(hover.harmonizedRead) && /S-NPP VIIRS/.test(hover.harmonizedRead) && /NOAA-20/.test(hover.harmonizedRead) && /NOAA-21/.test(hover.harmonizedRead),
    hover);
  check('Interval is not shown in units it does not describe', /fire-day/.test(hover.firedaysRead) && !/90% CI/.test(hover.firedaysRead), hover);

  const csvClick = await clickText('Daily record', '.export-btn');
  const csvFile = await waitFile(/\.csv$/i);
  check('CSV export downloads the daily record', csvClick && !!csvFile && csvFile.size > 20000, { csvClick, csvFile });
  const geoClick = await clickText('Live hotspots', '.export-btn');
  const geoFile = await waitFile(/\.geojson$/i);
  check('GeoJSON export downloads live hotspots', geoClick && !!geoFile && geoFile.size > 50000, { geoClick, geoFile });

  // The challenge asks for a downloadable CSV *of hotspots*, not only of the daily series. Same window
  // as the GeoJSON, so the row count has to agree with the geometry count.
  const hotClick = await clickText('Hotspot table', '.export-btn');
  const hotFile = await waitFile(/_hotspots_.*\.csv$/i);
  const hotBody = hotFile ? fs.readFileSync(hotFile.path, 'utf8') : '';
  const geoFeatures = geoFile ? JSON.parse(fs.readFileSync(geoFile.path, 'utf8')).features.filter((f) => f.properties.kind === 'hotspot').length : -1;
  const rowRe = /^\S+,2026-\d{2}-\d{2},-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?,(?:MODIS|VIIRS|NOAA-20|NOAA-21),\d+(?:\.\d+)?,(?:LOW|NOMINAL|HIGH)$/;
  const hotRows = hotBody.split('\n').filter((l) => rowRe.test(l.trim()));
  const headerOk = /^time_utc,date,latitude_east,longitude_east,sensor,frp_mw,confidence$/m.test(hotBody);
  const honestSource = /# source,NASA FIRMS/.test(hotBody) && /# coverage,Geometry exists only for the live FIRMS window/.test(hotBody);
  check('Hotspot CSV downloads one row per detected point, named instrument and all',
    !!hotClick && !!hotFile && headerOk && honestSource && hotRows.length > 0, { file: hotFile?.file, size: hotFile?.size, rows: hotRows.length });
  check('The hotspot CSV and the hotspot GeoJSON carry the same detections', geoFeatures === hotRows.length && geoFeatures > 0, { geoFeatures, csvRows: hotRows.length });
  await clickText('Calendar image', '.export-btn');
  const pngFile = await waitFile(/\.png$/i, 15000);
  check('PNG calendar export downloads', !!pngFile, pngFile);

  const share = await ev(`
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Share view');
    b?.click(); await new Promise(r => setTimeout(r, 700));
    return document.querySelector('.toast')?.textContent?.trim() || '';`);
  check('Share view produces a deep link', /View link (copied|ready)/.test(share) && /#/.test(share), share);

  // ---------- Draw an area (FR-01 / FR-05) ----------
  const draw = await ev(`
    const toggle = [...document.querySelectorAll('button')].find(x => /Draw an area/i.test(x.textContent));
    toggle?.click(); await new Promise(r => setTimeout(r, 400));
    const svg = document.querySelector('.draw-canvas');
    if (!svg) return { opened: false };
    const box = svg.getBoundingClientRect();
    const at = (px, py) => ({ bubbles: true, clientX: box.left + px, clientY: box.top + py });
    svg.dispatchEvent(new MouseEvent('mousedown', at(70, 45)));
    svg.dispatchEvent(new MouseEvent('mousemove', at(250, 180)));
    svg.dispatchEvent(new MouseEvent('mouseup', at(250, 180)));
    await new Promise(res => setTimeout(res, 300));
    const readout = document.querySelector('.draw-readout')?.textContent?.replace(/\\s+/g, ' ').trim();
    const note = document.querySelector('.draw-note')?.textContent?.replace(/\\s+/g, ' ').trim();
    const analyze = [...document.querySelectorAll('.draw-readout button')].find(b => /Analyze this shape/i.test(b.textContent));
    const disabled = analyze?.disabled;
    analyze?.click(); await new Promise(res => setTimeout(res, 900));
    return {
      opened: true, readout, note, disabled,
      toast: document.querySelector('.toast')?.textContent?.trim(),
      aoi: document.querySelector('.area-fact')?.textContent?.replace(/\\s+/g, ' ').trim(),
      custom: !![...document.querySelectorAll('.area-actions *')].find(x => /custom AOI/.test(x.textContent || '')),
    };`);
  check('Draw-area editor validates and resolves a rectangle (FR-01)', draw.opened && !draw.disabled && /km²/.test(draw.readout || '') && /vertices/.test(draw.readout || ''), draw.readout);
  check('Draw-area reports a data-volume estimate with its basis (FR-05)', /detections\/km²\/day/.test(draw.note || '') && /detections\/year/.test(draw.readout || ''), draw.note);
  check('Drawn shape becomes the analysed AOI', /Analysed the drawn/.test(draw.toast || '') && draw.custom === true, { toast: draw.toast, aoi: draw.aoi });

  await ev(`const b = document.querySelector('.area-presets .preset'); b?.click(); await new Promise(r => setTimeout(r, 700)); return !!b;`);

  // ---------- Table alternatives (FR-33) ----------
  const tables = await ev(`
    const t = [...document.querySelectorAll('.table-alt')];
    if (t[0]) t[0].open = true;
    await new Promise(r => setTimeout(r, 250));
    const rows = t[0] ? [...t[0].querySelectorAll('tbody tr')].length : 0;
    const cells = t[0] ? [...t[0].querySelectorAll('tbody tr')].slice(0, 2).map(x => x.textContent.replace(/\\s+/g,' ').trim().slice(0, 60)) : [];
    const charts = [...document.querySelectorAll('svg.chart')];
    const covered = charts.filter(c => c.parentElement?.querySelector(':scope > .table-alt')).length;
    return { count: t.length, rows, cells, charts: charts.length, covered };`);
  check('Charts expose table alternatives (FR-33)', tables.count >= 4 && tables.rows > 1, tables);
  check('Every plotted chart on the page has a sibling data table (FR-33)', tables.charts > 0 && tables.covered === tables.charts, tables);

  // ---------- Diagnosis ----------
  await nav('Diagnosis');
  await waitFor('.sandbox', 8000);
  const diag0 = await ev(`return { k: document.querySelector('.method-facts')?.textContent?.replace(/\\s+/g,' ').trim().slice(0,220), result: document.querySelector('.sandbox-results')?.textContent?.replace(/\\s+/g,' ').trim() };`);
  await setRange('.sandbox-controls input[type=range]', 10, 0);
  await setRange('.sandbox-controls input[type=range]', 1500, 1);
  const diag1 = await ev(`return document.querySelector('.sandbox-results')?.textContent?.replace(/\\s+/g,' ').trim();`);
  check('Sandbox responds to overpass/pixel changes', diag0.result !== diag1, { before: diag0.result, after: diag1 });
  const diagReset = await ev(`
    const b = [...document.querySelectorAll('.sandbox-actions button')].find(x => /Resample/i.test(x.textContent));
    const before = document.querySelector('.sandbox-results')?.textContent;
    b?.click(); await new Promise(r => setTimeout(r, 400));
    return { before, after: document.querySelector('.sandbox-results')?.textContent };`);
  check('Sandbox resample changes the residual', diagReset.before !== diagReset.after, diagReset.after?.slice(0, 100));

  // ---------- Outlook ----------
  await nav('Outlook');
  await waitFor('.analog-list', 8000);
  {
    const start = Date.now();
    while (Date.now() - start < 20000) {
      const ok = await ev(`return [...document.querySelectorAll('.outlook-page .badge')].some(b => b.textContent.trim() === 'NASA POWER');`);
      if (ok) break;
      await sleep(500);
    }
  }
  await sleep(500);
  // The weather badge is the result of a live NASA POWER round trip, so poll for it the way the
  // download checks poll, instead of betting on one fixed sleep.
  for (let i = 0; i < 24; i++) {
    const settled = await ev(`return [...document.querySelectorAll('.outlook-page .badge')].some(b => /NASA POWER|offline/i.test(b.textContent));`);
    if (settled) break;
    await sleep(500);
  }
  const outlook = await ev(`return {
    analogs: document.querySelectorAll('.analog-row').length,
    clock: document.querySelector('.clock-layout')?.textContent?.replace(/\\s+/g,' ').trim().slice(0, 160),
    charts: document.querySelectorAll('svg.chart').length,
    weatherBadges: [...document.querySelectorAll('.outlook-page .badge')].map(b => b.textContent.trim()).filter(t => /POWER|offline/i.test(t)),
  };`);
  check('Outlook lists analog seasons and charts', outlook.analogs >= 3 && outlook.charts >= 1, outlook);
  check('Outlook uses live NASA POWER weather', outlook.weatherBadges?.includes('NASA POWER'), outlook.weatherBadges);

  // ---------- Brief ----------
  await nav('Brief');
  await waitFor('.brief-sensor-row', 8000);
  const brief = await ev(`return {
    sensors: document.querySelector('.brief-sensor-row')?.textContent?.replace(/\\s+/g,' ').trim(),
    advisory: document.querySelector('.advisory, pre')?.textContent?.slice(0, 0) || '',
    downloadBtns: [...document.querySelectorAll('button')].filter(b => /advisory|Download|Copy/i.test(b.textContent)).map(b => b.textContent.trim()),
  };`);
  check('Brief shows four sensor rows', /MODIS/.test(brief.sensors || '') && /N21|NOAA-21/.test(brief.sensors || ''), brief.sensors);

  const briefCopy = await ev(`
    const b = [...document.querySelectorAll('button')].find(x => /Copy advisory/i.test(x.textContent));
    b?.click(); await new Promise(r => setTimeout(r, 500));
    return { toast: document.querySelector('.toast')?.textContent?.trim() || '', clip: await navigator.clipboard.readText().then(t => t.slice(0, 4000)).catch(() => 'blocked') };`);
  check('Advisory copies with real calibration text', /CONTINUUM/.test(briefCopy.clip || '') && /Sensor calibration/.test(briefCopy.clip || ''), briefCopy);

  await ev(`
    const b = [...document.querySelectorAll('.page-head-actions button')].find(x => /Download \\.txt/i.test(x.textContent));
    b?.click(); return true;`);
  const briefFile = await waitFile(/advisory.*\.txt$/i, 14000);
  const advisoryBody = briefFile ? fs.readFileSync(briefFile.path, 'utf8') : '';
  check('Advisory downloads as .txt', !!briefFile && briefFile.size > 1000, briefFile);
  check('Advisory file carries live sensors + calibration', /VIIRS/.test(advisoryBody) && /Sensor calibration/.test(advisoryBody) && /NASA/.test(advisoryBody), advisoryBody.slice(0, 160));

  const pdfClick = await clickText('Download PDF');
  const pdfFile = await waitFile(/advisory.*\.pdf$/i, 14000);
  const pdfHead = pdfFile ? fs.readFileSync(pdfFile.path).subarray(0, 9).toString('latin1') : '';
  const pdfTail = pdfFile ? fs.readFileSync(pdfFile.path).subarray(-80).toString('latin1').includes('%%EOF') : false;
  check('FR-27 PDF brief downloads as a valid one-page PDF', pdfClick && !!pdfFile && pdfHead.startsWith('%PDF-1.4') && pdfTail && pdfFile.size > 900, { pdfClick, size: pdfFile?.size, pdfHead });

  // ---------- Method ----------
  await nav('Method');
  await waitFor('.prov-card', 8000);
  const method = await ev(`return {
    tle: [...document.querySelectorAll('.prov-card')].find(c => /CelesTrak/i.test(c.textContent))?.textContent?.replace(/\\s+/g,' ').trim(),
    firms: [...document.querySelectorAll('.prov-card')].find(c => /FIRMS/i.test(c.textContent))?.textContent?.replace(/\\s+/g,' ').trim().slice(0, 340),
    loadsClaim: (document.body.textContent || '').includes('at load time'),
    officialCaveat: (document.body.textContent || '').includes('not the official NASA archive'),
  };`);
  check('Method states bundled TLE epoch honestly', /2026-303/.test(method.tle || '') && /Bundled elements shipped with the build/.test(method.tle || ''), method.tle);
  check('Method no longer claims runtime CelesTrak refresh', method.loadsClaim === false, method.loadsClaim);
  check('Method names all four FIRMS sensors', /MODIS/.test(method.firms || '') && /NOAA-20/.test(method.firms || '') && /NOAA-21/.test(method.firms || ''), method.firms);
  check('Method discloses reconstruction boundary', method.officialCaveat === true, method.officialCaveat);

  // ---------- Tour ----------
  const tour = await ev(`
    document.querySelector('.nav-tour')?.click();
    await new Promise(r => setTimeout(r, 500));
    const steps = [];
    for (let i = 0; i < 12; i++) {
      const eb = document.querySelector('.tour .eyebrow')?.textContent?.trim();
      steps.push(eb);
      const next = [...document.querySelectorAll('.tour-actions button')].find(b => /Next|Finish/i.test(b.textContent));
      if (!next) break;
      next.click();
      await new Promise(r => setTimeout(r, 550));
      const eb2 = document.querySelector('.tour .eyebrow')?.textContent?.trim();
      if (eb2 === eb) break;
    }
    const final = document.querySelector('.tour .eyebrow')?.textContent?.trim();
    [...document.querySelectorAll('.tour button')].find(b => /Finish|Close/i.test(b.textContent))?.click();
    return { steps, final };`);
  check('Judge tour advances through every step', tour.steps?.includes('Judge tour · 9 / 9'), tour);

  // ---------- Share round-trip ----------
  const link = (share.match(/(http\S+)/) || [])[1] || '';
  if (link) {
    await send('Page.navigate', { url: link }, S);
    await sleep(2600);
    const restored = await ev(`return { hash: location.hash, region: document.querySelector('.region-name')?.textContent?.trim(), heading: document.querySelector('h1')?.textContent?.trim() };`);
    check('Share link restores region + view', /r=pantanal/.test(restored.hash || '') && /Pantanal/i.test(restored.heading + restored.region || ''), restored);
  } else {
    check('Share link restores region + view', false, share);
  }

  // ---------- Keyboard operability (FR-32) ----------
  // Real trusted key events, not synthetic dispatchEvent: button activation, <summary> toggling and
  // focus traversal only happen for events the browser itself considers user-generated.
  await nav('Atlas');
  await waitFor('.calendar-scroll', 8000);
  const kbClear = await ev(`
    [...document.querySelectorAll('.panel-head .link-btn')].find(b => /clear day/i.test(b.textContent))?.click();
    await new Promise(r => setTimeout(r, 450));
    const panel = [...document.querySelectorAll('.panel')].find(p => /Live footprint|Day inspector/.test(p.textContent));
    return { title: panel?.querySelector('.panel-head h2')?.textContent?.trim(), hash: location.hash };`);
  check('Keyboard block starts from a cleared day selection on the shared region', kbClear.title === 'Live footprint' && /r=pantanal/.test(kbClear.hash || ''), kbClear);

  const kbFocus = await ev(`
    const el = document.querySelector('.calendar-scroll');
    el?.focus();
    await new Promise(r => setTimeout(r, 250));
    return {
      focused: document.activeElement === el,
      role: el?.getAttribute('role'),
      label: el?.getAttribute('aria-label'),
      date: document.querySelector('.calendar-readout strong')?.textContent?.trim(),
    };`);
  check('Calendar grid is focusable and announces the keyboard contract', kbFocus.focused === true && kbFocus.role === 'application' && /Arrow keys move the cursor/.test(kbFocus.label || '') && !!kbFocus.date, kbFocus);

  // The cursor clamps at today by design, so a fresh focus starts on the newest day: prove the clamp,
  // then step back into the record and forward again.
  await press('ArrowRight', 39);
  const kbClamp = await ev(`return { date: document.querySelector('.calendar-readout strong')?.textContent?.trim() };`);
  check('Calendar cursor cannot walk into future days', kbClamp.date === kbFocus.date, { today: kbFocus.date, after: kbClamp.date });

  await press('ArrowLeft', 37);
  await press('ArrowLeft', 37);
  const kbBack = await ev(`return { date: document.querySelector('.calendar-readout strong')?.textContent?.trim() };`);
  await press('ArrowRight', 39);
  const kbMove = await ev(`return { date: document.querySelector('.calendar-readout strong')?.textContent?.trim(), value: document.querySelector('.calendar-readout .mono')?.textContent?.trim() };`);
  check('Arrow keys move the calendar cursor between days', !!kbBack.date && kbBack.date !== kbFocus.date && !!kbMove.date && kbMove.date !== kbBack.date && !!kbMove.value,
    { today: kbFocus.date, back: kbBack.date, forward: kbMove.date });

  await press('Enter', 13);
  const kbOpen = await ev(`
    const panel = [...document.querySelectorAll('.panel')].find(p => /Day inspector|Live footprint/.test(p.textContent));
    return { title: panel?.querySelector('.panel-head h2')?.textContent?.trim(), rows: panel ? [...panel.querySelectorAll('.sensor-table tbody tr')].length : 0 };`);
  check('Enter opens the day under the cursor', kbOpen.rows === 4 && kbOpen.title === kbMove.date, kbOpen);

  const kbToggle = await ev(`
    const b = [...document.querySelectorAll('[aria-label="Sensor mode"] button')].find(x => x.getAttribute('aria-pressed') !== 'true');
    b?.focus();
    return { focused: document.activeElement === b, label: b?.textContent?.trim() };`);
  await press(' ', 32, ' ');
  const kbToggled = await ev(`return { on: [...document.querySelectorAll('[aria-label="Sensor mode"] button[aria-pressed="true"]')].map(x => x.textContent.trim()) };`);
  check('Space activates a focused toggle', kbToggle.focused === true && kbToggled.on.length === 1 && kbToggled.on[0] === kbToggle.label, { kbToggle, kbToggled });
  await ev(`
    const b = [...document.querySelectorAll('[aria-label="Sensor mode"] button')].find(x => /Harmonized/i.test(x.textContent));
    b?.click(); await new Promise(r => setTimeout(r, 350));
    return b?.textContent?.trim();`);

  const kbTable = await ev(`
    const s = document.querySelector('.table-alt summary');
    s?.focus();
    await new Promise(r => setTimeout(r, 120));
    return { focused: document.activeElement === s, label: s?.textContent?.trim(), wasOpen: !!s?.closest('details')?.open };`);
  await press('Enter', 13, '\r');
  const kbTableAfter = await ev(`
    const d = document.activeElement?.closest ? document.activeElement.closest('details') : null;
    return { open: !!d?.open, rows: d ? d.querySelectorAll('tbody tr').length : 0, focus: document.activeElement?.tagName };`);
  check('Enter expands a table alternative from the focused summary', kbTable.focused === true && kbTable.wasOpen === false && kbTableAfter.open === true && kbTableAfter.rows > 0, { kbTable, kbTableAfter });

  const kbSkip = await ev(`
    const a = document.querySelector('.skip-link');
    a?.focus();
    return { focused: document.activeElement === a, href: a?.getAttribute('href'), target: !!document.getElementById('main'), tabIndex: document.getElementById('main')?.getAttribute('tabindex') };`);
  await press('Enter', 13);
  const kbSkipAfter = await ev(`
    return {
      hash: location.hash,
      focusedMain: document.activeElement?.id === 'main',
      metric: document.querySelector('.panel-head h2')?.textContent?.trim(),
    };`);
  check('Skip link moves focus to main without resetting the hash-routed view',
    kbSkip.focused === true && kbSkip.href === '#main' && kbSkip.target === true && kbSkip.tabIndex === '-1'
      && kbSkipAfter.focusedMain === true && /r=pantanal/.test(kbSkipAfter.hash || '') && /[?&]m=/.test(kbSkipAfter.hash || ''),
    { kbSkip, kbSkipAfter });

  // ---------- Keyboard-only drawing (FR-01 / FR-05 / FR-32) ----------
  const kdOpen = await ev(`
    const toggleOf = () => [...document.querySelectorAll('button')].find(x => /Draw an area|Close drawing/i.test(x.textContent));
    if (document.querySelector('.draw-canvas')) {
      toggleOf()?.click();
      await new Promise(r => setTimeout(r, 300));
    }
    toggleOf()?.click();
    await new Promise(r => setTimeout(r, 450));
    const svg = document.querySelector('.draw-canvas');
    svg?.focus();
    await new Promise(r => setTimeout(r, 250));
    return {
      focused: document.activeElement === svg,
      role: svg?.getAttribute('role'),
      label: svg?.getAttribute('aria-label'),
      described: svg?.getAttribute('aria-describedby'),
      status: document.querySelector('.draw-status')?.textContent?.trim(),
      readout: document.querySelector('.draw-readout')?.textContent?.replace(/\\s+/g, ' ').trim(),
    };`);
  check('Area canvas is focusable and states its keyboard contract',
    kdOpen.focused === true && kdOpen.role === 'application' && /Arrow keys move the pen/.test(kdOpen.label || '')
      && kdOpen.described === 'draw-status' && /arrow keys move the pen/i.test(kdOpen.status || '') && /C closes/i.test(kdOpen.status || ''), kdOpen);
  check('No shape exists before the first keystroke', /^0 km²\b/.test(kdOpen.readout || '') && /\b0 vertices\b/.test(kdOpen.readout || ''), kdOpen.readout);

  await press('Enter', 13, '\r');
  const kdAnchor = await ev(`
    return {
      status: document.querySelector('.draw-status')?.textContent?.trim(),
      readout: document.querySelector('.draw-readout')?.textContent?.replace(/\\s+/g, ' ').trim(),
    };`);
  check('Enter sets the first corner and announces it', /First corner set/.test(kdAnchor.status || '') && /^0 km²/.test(kdAnchor.readout || ''), kdAnchor);

  for (let i = 0; i < 4; i++) await press('ArrowRight', 39, undefined, 8);
  for (let i = 0; i < 4; i++) await press('ArrowDown', 40, undefined, 8);
  const kdRect = await ev(`
    const readout = document.querySelector('.draw-readout')?.textContent?.replace(/\\s+/g, ' ').trim();
    const analyze = [...document.querySelectorAll('.draw-readout button')].find(b => /Analyze this shape/i.test(b.textContent));
    return { readout, status: document.querySelector('.draw-status')?.textContent?.trim(), disabled: !!analyze?.disabled };`);
  const kdRectArea = parseFloat((kdRect.readout.match(/([\d,.]+) km²/) || [])[1] || '0');
  check('Shift plus arrows drag the opposite corner into a valid area', kdRect.disabled === false && kdRectArea > 0 && /km²/.test(kdRect.readout || '') && /valid/.test(kdRect.readout || ''), { area: kdRectArea, kdRect });

  const kdFocusAnalyze = await ev(`
    const b = [...document.querySelectorAll('.draw-readout button')].find(x => /Analyze this shape/i.test(x.textContent));
    b?.focus();
    return { focused: document.activeElement === b, disabled: !!b?.disabled };`);
  await press('Enter', 13, '\r');
  await sleep(900);
  const kdRectApplied = await ev(`
    return {
      toast: document.querySelector('.toast')?.textContent?.trim(),
      readout: document.querySelector('.draw-readout')?.textContent?.replace(/\\s+/g, ' ').trim(),
      custom: !![...document.querySelectorAll('.area-actions *')].find(x => /custom AOI/.test(x.textContent || '')),
    };`);
  const kdRectKept = parseFloat((kdRectApplied.readout.match(/([\d,.]+) km²/) || [])[1] || '0');
  check('Enter activates Analyze on the focused button', kdFocusAnalyze.focused === true && /Analysed the drawn rectangle/.test(kdRectApplied.toast || ''), { kdFocusAnalyze, toast: kdRectApplied.toast });
  check('The drawn shape survives the region change it causes', kdRectKept > 0 && kdRectApplied.custom === true, { kept: kdRectKept, readout: kdRectApplied.readout });
  const kdVolBefore = parseFloat(((kdRect.readout.match(/≈([\d,.]+) detections\/year/) || [])[1] || '0').replace(/,/g, ''));
  const kdVolAfter = parseFloat(((kdRectApplied.readout.match(/≈([\d,.]+) detections\/year/) || [])[1] || '0').replace(/,/g, ''));
  check('Data-volume estimate is measured on the drawn area and is unchanged by Analyze', kdVolBefore > 0 && kdVolAfter === kdVolBefore, { before: kdVolBefore, after: kdVolAfter });

  const kdPolyOpen = await ev(`
    [...document.querySelectorAll('.draw-modes button')].find(b => /Polygon/i.test(b.textContent))?.click();
    await new Promise(r => setTimeout(r, 300));
    document.querySelector('.draw-canvas')?.focus();
    await new Promise(r => setTimeout(r, 250));
    return { mode: document.querySelector('.draw-canvas')?.getAttribute('aria-label'), status: document.querySelector('.draw-status')?.textContent?.trim() };`);
  check('Polygon mode is announced through the canvas label', /polygon mode/.test(kdPolyOpen.mode || ''), kdPolyOpen);

  await press('Escape', 27);
  await press('Enter', 13, '\r');
  await press('ArrowRight', 39, undefined, 8);
  await press('Enter', 13, '\r');
  await press('ArrowDown', 40, undefined, 8);
  await press('ArrowDown', 40, undefined, 8);
  await press('Enter', 13, '\r');
  await press('ArrowLeft', 37, undefined, 8);
  await press('ArrowUp', 38, undefined, 8);
  await press('Enter', 13, '\r');
  const kdVerts = await ev(`
    return {
      status: document.querySelector('.draw-status')?.textContent?.trim(),
      dots: document.querySelectorAll('.draw-point').length,
      draft: !!document.querySelector('.draw-draft'),
    };`);
  check('Enter places polygon vertices at the pen', /4 vertices placed\. Press C/.test(kdVerts.status || '') && kdVerts.dots === 4 && kdVerts.draft === true, kdVerts);

  await press('Backspace', 8);
  const kdUndo = await ev(`return { status: document.querySelector('.draw-status')?.textContent?.trim(), dots: document.querySelectorAll('.draw-point').length };`);
  check('Backspace undoes the last vertex', /3 vertices remain/.test(kdUndo.status || '') && kdUndo.dots === 3, kdUndo);

  await press('Enter', 13, '\r');
  await press('c', 67);
  const kdClosed = await ev(`
    const readout = document.querySelector('.draw-readout')?.textContent?.replace(/\\s+/g, ' ').trim();
    const analyze = [...document.querySelectorAll('.draw-readout button')].find(b => /Analyze this shape/i.test(b.textContent));
    return { status: document.querySelector('.draw-status')?.textContent?.trim(), readout, disabled: !!analyze?.disabled };`);
  const kdPolyArea = parseFloat((kdClosed.readout.match(/([\d,.]+) km²/) || [])[1] || '0');
  check('C closes the polygon so it becomes analysable', kdClosed.disabled === false && kdPolyArea > 0 && /Polygon closed with 4 vertices/.test(kdClosed.status || ''), { area: kdPolyArea, kdClosed });

  await ev(`
    const b = [...document.querySelectorAll('.draw-readout button')].find(x => /Analyze this shape/i.test(x.textContent));
    b?.focus();
    return true;`);
  await press('Enter', 13, '\r');
  await sleep(900);
  const kdPolyApplied = await ev(`
    return { toast: document.querySelector('.toast')?.textContent?.trim(), hash: location.hash, status: document.querySelector('.draw-status')?.textContent?.trim() };`);
  check('Keyboard-drawn polygon resolves to an AOI like a pointer shape', /Analysed the drawn polygon/.test(kdPolyApplied.toast || '') && /Analysed:/.test(kdPolyApplied.status || ''), kdPolyApplied);

  await ev(`const b = document.querySelector('.area-presets .preset'); b?.click(); await new Promise(r => setTimeout(r, 700)); return !!b;`);

  // ---------- Structural accessibility sweep (FR-32/FR-33 adjacent, no external engine) ----------
  // axe-core cannot be installed in this offline workspace, so the sweep asserts the structural rules
  // that a dependency-free pass can prove: accessible names, labelled controls, tab-order hygiene,
  // heading order, image naming, landmarks and the declared language — on all six views.
  const a11yBody = `
    const norm = (el) => {
      const al = el.getAttribute('aria-label');
      if (al && al.trim()) return al.trim();
      const lb = el.getAttribute('aria-labelledby');
      if (lb) {
        const t = lb.split(/\\s+/).map((id) => { const r = document.getElementById(id); return r ? r.textContent : ''; }).join(' ').replace(/\\s+/g, ' ').trim();
        if (t) return t;
      }
      const ti = el.getAttribute('title');
      if (ti && ti.trim()) return ti.trim();
      const alt = el.getAttribute ? el.getAttribute('alt') : null;
      if (alt && alt.trim()) return alt.trim();
      const txt = (el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (txt) return txt;
      if (el.type === 'submit' || el.type === 'button') { const v = el.value; if (v && v.trim()) return v.trim(); }
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
        const id = el.id;
        if (id) { const l = document.querySelector('label[for="' + id + '"]'); if (l && l.textContent.trim()) return l.textContent.trim(); }
        const wrap = el.closest('label');
        if (wrap && wrap.textContent.trim()) return wrap.textContent.trim();
        const ph = el.getAttribute('placeholder');
        if (ph && ph.trim()) return ph.trim();
      }
      return '';
    };
    const clip = (el) => (el.outerHTML || '').replace(/\\s+/g, ' ').slice(0, 90);
    const focusable = 'a[href], button, input, select, textarea, summary, [role="button"], [role="tab"], [role="application"]';
    const out = {
      unnamed: [],
      unlabelled: [],
      positiveTabindex: [],
      headingSkips: [],
      imgNoAlt: [],
      svgNoName: [],
      landmarks: { main: document.querySelectorAll('main').length, nav: document.querySelectorAll('nav').length },
      lang: document.documentElement.getAttribute('lang'),
      live: document.querySelectorAll('[aria-live]').length,
      tabbable: document.querySelectorAll(focusable).length,
    };
    for (const el of document.querySelectorAll(focusable)) {
      if (el.getAttribute('aria-hidden') === 'true' || el.closest('[hidden]')) continue;
      if (!norm(el)) out.unnamed.push(clip(el));
    }
    for (const el of document.querySelectorAll('input, select, textarea')) {
      if (el.type === 'hidden') continue;
      if (!norm(el)) out.unlabelled.push(clip(el));
    }
    for (const el of document.querySelectorAll('[tabindex]')) {
      if (Number(el.getAttribute('tabindex')) > 0) out.positiveTabindex.push(clip(el));
    }
    let prev = 0;
    for (const h of document.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      const lvl = Number(h.tagName.slice(1));
      if (prev && lvl > prev + 1) out.headingSkips.push(prev + '->' + lvl + ' ' + clip(h));
      prev = lvl;
    }
    for (const el of document.querySelectorAll('img')) {
      if (!el.hasAttribute('alt')) out.imgNoAlt.push(clip(el));
    }
    for (const el of document.querySelectorAll('svg[role="img"]')) {
      if (!norm(el)) out.svgNoName.push(clip(el));
    }
    return out;`;
  const a11y = {};
  for (const view of ['watch', 'atlas', 'diagnosis', 'outlook', 'brief', 'method']) {
    await ev(`location.hash = '#/${view}?r=pantanal&m=hotspots&mode=harmonized'; return true;`);
    await sleep(1400);
    a11y[view] = await ev(a11yBody);
  }
  const agg = (key) => Object.values(a11y).reduce((s, v) => s + v[key].length, 0);
  const firstBad = (key) => Object.entries(a11y).find(([, v]) => v[key].length) || null;
  check('Every focusable control has an accessible name on all six views', agg('unnamed') === 0, { count: agg('unnamed'), first: firstBad('unnamed') });
  check('Every form control is labelled', agg('unlabelled') === 0, { count: agg('unlabelled'), first: firstBad('unlabelled') });
  check('No positive tabindex anywhere', agg('positiveTabindex') === 0, { count: agg('positiveTabindex'), first: firstBad('positiveTabindex') });
  check('Heading levels never skip a rank', agg('headingSkips') === 0, { count: agg('headingSkips'), first: firstBad('headingSkips') });
  check('Images name themselves or are marked decorative', agg('imgNoAlt') === 0, { count: agg('imgNoAlt'), first: firstBad('imgNoAlt') });
  check('Every role=img graphic carries an accessible name', agg('svgNoName') === 0, { count: agg('svgNoName'), first: firstBad('svgNoName') });
  check('Landmarks: exactly one main and a nav per view', Object.values(a11y).every((v) => v.landmarks.main === 1 && v.landmarks.nav >= 1), Object.entries(a11y).map(([k, v]) => [k, v.landmarks]));
  check('Document declares a language on all six views', Object.values(a11y).every((v) => /^[a-z]/i.test(v.lang || '')), Object.entries(a11y).map(([k, v]) => [k, v.lang]));
  // A live region is only meaningful where content changes without the user asking; the static
  // document views (diagnosis, brief body, method) deliberately do not carry one.
  const asyncViews = ['watch', 'atlas', 'outlook'];
  check('Views that update asynchronously expose a polite live region', asyncViews.every((v) => a11y[v].live >= 1), asyncViews.map((v) => [v, a11y[v].live]));

  // ---------- Mobile ergonomics (390×844, the viewport the responsive audit found tight) ----------
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, S);
  await ev(`location.hash = '#/watch?r=chilecito&m=hotspots&mode=harmonized'; return true;`);
  await sleep(1800);
  const mobileWatch = await ev(`
    const doc = document.documentElement;
    const box = (el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
    const targets = [...document.querySelectorAll('.topnav .brand, .topnav .nav button, .topnav .nav-alert, .topnav .icon-btn, .topnav .lang-btn')]
      .filter(el => el.offsetParent !== null)
      .map(el => ({ label: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 18), icon: el.matches('.brand, .nav-alert, .icon-btn'), ...box(el) }));
    const speeds = [...document.querySelectorAll('.speeds button')].filter(el => el.offsetParent !== null).map(box);
    return { overflow: doc.scrollWidth - doc.clientWidth, targets, speeds, hero: document.querySelector('.watch-hero p')?.getBoundingClientRect().height || 0 };`);
  check('Mobile: the document does not scroll sideways', mobileWatch.overflow <= 0, mobileWatch.overflow);
  check('Mobile: every top-nav target is at least 44 px tall', mobileWatch.targets.length >= 7 && mobileWatch.targets.every((t) => t.h >= 44), mobileWatch.targets);
  check('Mobile: icon-only nav targets are also 44 px wide', mobileWatch.targets.filter((t) => t.icon).every((t) => t.w >= 44), mobileWatch.targets.filter((t) => t.icon));
  check('Mobile: simulation speed chips are tappable', mobileWatch.speeds.length >= 4 && mobileWatch.speeds.every((s) => s.h >= 36 && s.w >= 36), mobileWatch.speeds);
  check('Mobile: hero copy is present, not collapsed', mobileWatch.hero > 20, mobileWatch.hero);

  await ev(`location.hash = '#/atlas?r=pantanal&m=hotspots&mode=harmonized'; return true;`);
  await sleep(1800);
  const mobileAtlas = await ev(`
    const doc = document.documentElement;
    const frame = document.querySelector('.calendar-frame');
    const btns = [...document.querySelectorAll('[aria-label="Calendar resolution"] button')];
    const box = frame?.getBoundingClientRect();
    return { overflow: doc.scrollWidth - doc.clientWidth, frame: !!frame, inFrame: btns.length === 5 && box ? btns.every(b => { const r = b.getBoundingClientRect(); return r.right <= box.right + 1 && r.left >= box.left - 1; }) : false };`);
  check('Mobile: Atlas fits the viewport without sideways scroll', mobileAtlas.overflow <= 0 && mobileAtlas.frame, mobileAtlas);
  check('Mobile: the calendar frame controls stay inside their panel', mobileAtlas.inFrame, mobileAtlas.inFrame);

  await send('Emulation.clearDeviceMetricsOverride', {}, S);
  await sleep(600);

  // ---------- Endpoint / console audit ----------
  const badResponses = events
    .filter((e) => e.method === 'Network.responseReceived')
    .map((e) => e.params.response)
    .filter((r) => r.status >= 400)
    .map((r) => `${r.status} ${r.url}`);
  const requestUrls = new Map(
    events
      .filter((e) => e.method === 'Network.requestWillBeSent')
      .map((e) => [e.params.requestId, e.params.request.url]),
  );
  const failed = events
    .filter((e) => e.method === 'Network.loadingFailed')
    .map((e) => `${e.params.errorText} ${e.params.type} ${requestUrls.get(e.params.requestId) || '(url unknown)'}`);
  const consoleErrors = events
    .filter((e) => (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') || e.method === 'Runtime.exceptionThrown' || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'))
    .map((e) => e.method === 'Log.entryAdded' ? `${e.params.entry.text} ${e.params.entry.url || ''}` : JSON.stringify(e.params).slice(0, 200));
  const celestrak = events.filter((e) => e.method === 'Network.requestWillBeSent' && /celestrak/i.test(e.params.request.url)).length;
  const power = events.filter((e) => e.method === 'Network.responseReceived' && /power\.larc\.nasa\.gov/.test(e.params.response.url)).map((e) => e.params.response.status);

  check('No HTTP 4xx/5xx responses', badResponses.length === 0, badResponses);
  check('No failed network loads', failed.length === 0, failed);
  check('No runtime console errors', consoleErrors.length === 0, consoleErrors);
  check('No runtime CelesTrak requests', celestrak === 0, celestrak);
  check('NASA POWER live request succeeds', power.includes(200), power);

  // ---------- World layer: every country, and any point on Earth (runs last: it leaves a country selected) ----------
  await send('Page.navigate', { url: `${ORIGIN}/?e2e=${Date.now()}#/watch` }, S);
  await waitFor('main');
  await sleep(2600);
  const worldType = await ev(`
    const input = document.querySelector('.world-search-input');
    if (!input) return { ok: false };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    input.focus();
    setter.call(input, 'Antarctica');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 600));
    return { ok: true, rows: [...document.querySelectorAll('.world-results button')].map(b => b.textContent.replace(/\\s+/g,' ').trim().slice(0, 90)) };`);
  check('World search reaches a country with no pilot region', worldType.ok && /Antarctica/i.test((worldType.rows || []).join(' ')), worldType);

  const worldPick = await ev(`
    document.querySelector('.world-results button')?.click();
    await new Promise(r => setTimeout(r, 1200));
    return {
      region: document.querySelector('.region-name')?.textContent?.trim(),
      hash: location.hash,
      live: document.querySelector('.hero-meta')?.textContent?.replace(/\\s+/g,' ').trim(),
      toast: document.querySelector('.toast')?.textContent?.trim(),
    };`);
  check('Selecting a country makes it the analysed area', /Antarctica/i.test(worldPick.region || '') && /country-antarctica/.test(worldPick.hash || ''), worldPick);
  check('The country label states measured detections, not a model', /detections measured|no detection/.test(worldPick.toast || ''), worldPick.toast);

  const centre = await ev(`const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: centre.x, y: centre.y, button: 'left', clickCount: 1 }, S);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: centre.x, y: centre.y, button: 'left', clickCount: 1 }, S);
  await sleep(1500);
  const poleClick = await ev(`return { toast: document.querySelector('.toast')?.textContent?.trim() || '', region: document.querySelector('.region-name')?.textContent?.trim() };`);
  check('A click on the pole names the continent, not open ocean', /Antarctica/.test(poleClick.toast || ''), { centre, ...poleClick });

  await send('Page.navigate', { url: `${ORIGIN}/?e2e=${Date.now()}#/atlas?c=kenya` }, S);
  await waitFor('main');
  await sleep(2600);
  const deep = await ev(`
    const stat = [...document.querySelectorAll('.stat')].find(s => s.querySelector('.stat-label')?.textContent?.trim() === 'Live window');
    return {
      heading: document.querySelector('main h1')?.textContent?.trim(),
      hash: location.hash,
      live: stat ? stat.querySelector('.stat-value')?.textContent?.trim() : null,
      liveSub: stat ? stat.querySelector('.stat-sub')?.textContent?.replace(/\\s+/g, ' ').trim() : null,
    };`);
  check('A #country deep link restores that country as the area', /Kenya/.test(deep.heading || '') && /c=kenya/.test(deep.hash || ''), deep);
  check('A country outside a pilot bbox still reports a measured window', /country-kenya/.test(deep.hash || '') && /^[0-9][0-9,.]*$/.test(deep.live || '') && /VIIRS-equivalent · [0-9]+ active days/.test(deep.liveSub || ''), deep);

  // The number must be the border's own measurement, not the stride sample's and not a model.
  const windowTable = JSON.parse(fs.readFileSync('public/data/country_fires.json', 'utf8'));
  const measuredViirs = (id) => {
    const c = windowTable.countries.find((x) => x.id === id);
    return c ? (c.sensors['VIIRS-SNPP'] || 0) + (c.sensors['NOAA-20'] || 0) + (c.sensors['NOAA-21'] || 0) : 0;
  };
  const liveStat = async (id) => {
    await send('Page.navigate', { url: `${ORIGIN}/?e2e=${Date.now()}#/atlas?c=${id}` }, S);
    await waitFor('main');
    await sleep(2600);
    return ev(`
      const stat = [...document.querySelectorAll('.stat')].find(s => s.querySelector('.stat-label')?.textContent?.trim() === 'Live window');
      return {
        heading: document.querySelector('main h1')?.textContent?.trim(),
        value: stat?.querySelector('.stat-value')?.textContent?.trim() ?? null,
        sub: stat?.querySelector('.stat-sub')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
      };`);
  };
  const kenyaLive = await liveStat('kenya');
  check("Kenya's live figure is its measured border count, not the bundle's stride sample", kenyaLive.value === String(measuredViirs('kenya')), { expected: measuredViirs('kenya'), ...kenyaLive });
  const antarcticaLive = await liveStat('antarctica');
  check('A country with no detections prints its measured zero, not a pilot average', antarcticaLive.value === '0' && /Antarctica/.test(antarcticaLive.heading || ''), antarcticaLive);

  // Territories Natural Earth 50m has no admin-0 polygon for are still reachable by name, and a point
  // the probe cannot reach is reported as open ocean rather than attributed to a distant country.
  await send('Page.navigate', { url: `${ORIGIN}/?e2e=${Date.now()}#/watch` }, S);
  await waitFor('main');
  await sleep(2400);
  // Every name is typed, not sampled: one result row per query is the claim being verified, and a
  // silent gap in this list is exactly the bug the user reported ("only a few places are selectable").
  // The queries mirror the territory entries in src/data/places.ts.
  const missingNames = [
    ['Tuvalu', 'Tuvalu'], ['Tokelau', 'Tokelau'], ['Gibraltar', 'Gibraltar'], ['Wake Island', 'Wake'],
    ['Réunion', 'reunion'], ['Mayotte', 'Mayotte'], ['Canary Islands', 'canary'], ['Svalbard', 'Svalbard'],
    ['Christmas Island', 'christmas'], ['Cocos (Keeling)', 'cocos'], ['Bonaire', 'bonaire'], ['Ceuta', 'Ceuta'],
    ['Melilla', 'melilla'], ['Hawaiʻi', 'hawaii'],
  ];
  const typed = await ev(`
    const input = document.querySelector('.world-search-input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const squash = (s) => s.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const out = {};
    for (const [label, q] of ${JSON.stringify(missingNames)}) {
      input.focus();
      setter.call(input, q);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 450));
      out[label] = [...document.querySelectorAll('.world-results button')]
        .map(b => squash(b.textContent)).some(t => t.includes(squash(q)));
    }
    return out;`);
  const unreachable = missingNames.map(([l]) => l).filter((l) => !typed[l]);
  check('Every territory with no 50m border is reachable from search by name', unreachable.length === 0 && Object.keys(typed).length === missingNames.length, { typed, unreachable });

  const missingType = await ev(`
    const input = document.querySelector('.world-search-input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    input.focus();
    setter.call(input, 'Tuvalu');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 600));
    const rows = [...document.querySelectorAll('.world-results button')].map(b => b.textContent.replace(/\\s+/g,' ').trim().slice(0, 90));
    document.querySelector('.world-results button')?.click();
    await new Promise(r => setTimeout(r, 1600));
    return { rows, region: document.querySelector('.region-name')?.textContent?.trim(), hash: location.hash, toast: document.querySelector('.toast')?.textContent?.trim() };`);
  check('A territory with no 50m border is still reachable from search', /Tuvalu/i.test((missingType.rows || []).join(' ')), { rows: missingType.rows });
  check('Selecting it opens a named custom AOI, not an empty area', /Tuvalu/.test(missingType.region || '') && /aoi-/.test(missingType.hash || '') && /custom/i.test(missingType.toast || ''), missingType);

  const oceanCentre = await ev(`const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: oceanCentre.x, y: oceanCentre.y, button: 'left', clickCount: 1 }, S);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: oceanCentre.x, y: oceanCentre.y, button: 'left', clickCount: 1 }, S);
  await sleep(1500);
  const oceanClick = await ev(`return { toast: document.querySelector('.toast')?.textContent?.trim() || '', region: document.querySelector('.region-name')?.textContent?.trim(), hash: location.hash };`);
  check('Water outside the probe radius says open ocean and still becomes an area', /Open ocean/.test(oceanClick.toast || '') && /179/.test(oceanClick.toast || '') && /aoi-/.test(oceanClick.hash || ''), { centre: oceanCentre, ...oceanClick });

  // A sovereign whose name Natural Earth shortens: typing the common name has to reach the border.
  // It runs after the water click on purpose — selecting the Marshalls parks the camera on the
  // centroid of its own polygon, where a centre click is land by definition.
  const marshall = await ev(`
    const input = document.querySelector('.world-search-input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    input.focus();
    setter.call(input, 'Marshall Islands');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 700));
    const rows = [...document.querySelectorAll('.world-results button')].map(b => b.textContent.replace(/\\s+/g,' ').trim().slice(0, 90));
    document.querySelector('.world-results button')?.click();
    await new Promise(r => setTimeout(r, 1700));
    return { rows, region: document.querySelector('.region-name')?.textContent?.trim(), hash: location.hash, toast: document.querySelector('.toast')?.textContent?.trim() };`);
  check('The name a user types wins over the abbreviation the gazetteer publishes', /Marshall/i.test((marshall.rows || []).join(' ')) && /Marshall/i.test(marshall.region || '') && /country-marshall-is/.test(marshall.hash || ''), { rows: marshall.rows, region: marshall.region, hash: marshall.hash });

  // The same centre click, but on a globe looking at a country's own centroid. The point is inside that
  // polygon, so the whole border is the area the user meant; a 150 km circle around the centroid was not.
  await ev(`
    const input = document.querySelector('.world-search-input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    input.focus();
    setter.call(input, 'Australia');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 700));
    document.querySelector('.world-results button')?.click();
    await new Promise(r => setTimeout(r, 2600));
    return true;`);
  const landCentre = await ev(`const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: landCentre.x, y: landCentre.y, button: 'left', clickCount: 1 }, S);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: landCentre.x, y: landCentre.y, button: 'left', clickCount: 1 }, S);
  await sleep(1600);
  const landClick = await ev(`return { toast: document.querySelector('.toast')?.textContent?.trim() || '', region: document.querySelector('.region-name')?.textContent?.trim(), hash: location.hash };`);
  check('A click inside a country border selects that whole border, not a circle around the point',
    /country-wide/.test(landClick.toast || '') && /country-australia/.test(landClick.hash || '') && !/aoi-/.test(landClick.hash || '') && /Australia/.test(landClick.region || ''),
    { centre: landCentre, ...landClick });
  check('That click states the detections measured inside the border it just selected',
    /(detections measured inside its border|no detection inside its border)/.test(landClick.toast || ''), landClick.toast);

  // A country id is not in the pilot list, so the in-page hashchange path used to drop it and the URL
  // writer snapped a pasted link back to the default area. Reloading with the link worked; pasting it
  // into the tab someone is already reading did not.
  const deepLink = await ev(`
    location.hash = '#/atlas?r=country-japan&m=hotspots&mode=harmonized&from=2000-11-01&to=2026-11-02';
    await new Promise(r => setTimeout(r, 2800));
    const t = document.querySelector('main')?.innerText || '';
    return { hash: location.hash, namesJapan: /Japan/.test(t), cells: document.querySelectorAll('[class*=cell]').length };`);
  check('A border named in a link pasted into an open tab stays the analysed area', /country-japan/.test(deepLink.hash) && deepLink.namesJapan && deepLink.cells > 9000, deepLink);

  // The statement's considerations ask for "an option to enter latitude and longitude". Until this check
  // the only evidence was that the two inputs are labelled, which is not the same as them working.
  const coordArea = await ev(`
    const set = (el, v) => {
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      s.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const inputs = [...document.querySelectorAll('.area-coords input')];
    set(inputs[0], '-10.50'); set(inputs[1], '-55.20'); set(inputs[2], '180');
    document.querySelector('.area-coords button').click();
    await new Promise(r => setTimeout(r, 2200));
    const t = document.querySelector('.toast')?.textContent?.trim() || '';
    return { toast: t, hash: location.hash, cells: document.querySelectorAll('[class*=cell]').length,
             named: t.includes('Custom 180 km area opened at') && t.includes('-10.50') && t.includes('-55.20') };`);
  check('Typed latitude and longitude open the area they name, with the radius typed', coordArea.named && /aoi-/.test(coordArea.hash) && coordArea.cells > 9000, coordArea);

  const coordReject = await ev(`
    const set = (el, v) => {
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      s.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const before = location.hash;
    const inputs = [...document.querySelectorAll('.area-coords input')];
    set(inputs[0], '123');
    document.querySelector('.area-coords button').click();
    await new Promise(r => setTimeout(r, 900));
    return { toast: document.querySelector('.toast')?.textContent?.trim() || '', moved: location.hash !== before };`);
  check('An out-of-range latitude is refused with the range stated, and the area does not move',
    /latitude between/.test(coordReject.toast) && !coordReject.moved, coordReject);

  await send('Page.navigate', { url: `${ORIGIN}/?e2e=${Date.now()}#/watch` }, S);
  await waitFor('main');
  await sleep(2000);

  const report = { pass: results.filter((r) => r.pass).length, total: results.length, failed: results.filter((r) => !r.pass), results };
  fs.mkdirSync('docs', { recursive: true });
  fs.writeFileSync('docs/e2e-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass: report.pass, total: report.total, failed: report.failed }, null, 2));
} catch (err) {
  fs.mkdirSync('docs', { recursive: true });
  fs.writeFileSync('docs/e2e-report.json', JSON.stringify({ fatal: err.message, results }, null, 2));
  console.log(JSON.stringify({ fatal: err.message, passedSoFar: results.filter((r) => r.pass).length, failed: results.filter((r) => !r.pass) }, null, 2));
} finally {
  try { ws.close(); } catch { /* ignore */ }
  chrome.kill();
  await sleep(800);
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* chrome may still hold the profile */ }
}
