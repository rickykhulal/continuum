import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { REGIONS, livePointsForRegion } from '../dist-server/analytics.mjs';
const origin = process.env.E2E_ORIGIN || 'http://localhost:8787';
const port = 9224;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'continuum-polish-'));
const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--window-size=1440,900', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [];
let ws;
let mode = 'success';
const requests = [];
async function poll(fn, timeout = 20000) { const start = Date.now(); while (Date.now() - start < timeout) { const value = await fn(); if (value) return value; await sleep(200); } throw new Error('Browser condition timed out'); }
const check = (name, condition, detail) => { results.push({ name, pass: !!condition, detail }); assert.ok(condition, name); };
try {
  const version = await poll(async () => { try { return await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { return false; } });
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0;
  const pending = new Map();
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const promise = pending.get(message.id); pending.delete(message.id);
      if (message.error) promise.reject(new Error(message.error.message)); else promise.resolve(message.result);
    } else if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params;
      const url = new URL(request.url);
      const kind = url.hostname === 'api.open-meteo.com' ? 'current' : url.hostname === 'power.larc.nasa.gov' ? 'historical' : 'community';
      requests.push({ kind, latitude: url.searchParams.get('latitude'), longitude: url.searchParams.get('longitude'), start: url.searchParams.get('start') });
      const body = kind === 'community' ? { posts: [
        { id: 'fixture-verified', author: 'Browser fixture', content: 'Verified anomaly fixture', type: 'anomaly', verified: true, createdAt: '2026-11-14T12:00:00Z' },
        { id: 'fixture-unverified', author: 'Browser fixture', content: 'Unverified anomaly fixture', type: 'anomaly', verified: false, createdAt: '2026-11-14T13:00:00Z' },
      ], announcements: [] } : kind === 'current' ? { current_weather: { windspeed: 18, winddirection: 270, time: '2026-11-15T12:00' } } : { properties: { parameter: { WS10M: { '20220101': 5 }, WD10M: { '20220101': 90 } } } };
      setTimeout(() => send('Fetch.fulfillRequest', { requestId, responseCode: mode === 'error' && kind !== 'community' ? 503 : 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from(JSON.stringify(body)).toString('base64') }, message.sessionId).catch(() => {}), 700);
    }
  };
  const { targetInfos } = await send('Target.getTargets');
  const { sessionId: session } = await send('Target.attachToTarget', { targetId: targetInfos.find(t => t.type === 'page').targetId, flatten: true });
  const ev = async expression => {
    const value = await send('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true, userGesture: true }, session);
    if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
    return value.result.value;
  };
  await send('Page.enable', {}, session);
  await send('Runtime.enable', {}, session);
  await send('Fetch.enable', { patterns: [{ urlPattern: '*api.open-meteo.com/v1/forecast*' }, { urlPattern: '*power.larc.nasa.gov/api/temporal/daily/point*' }, { urlPattern: '*/api/v1/community/feed' }] }, session);
  await send('Page.navigate', { url: `${origin}/#/atlas?r=chilecito&res=day&span=8` }, session);
  await poll(() => ev("return document.querySelector('.pet-drag-handle canvas') && document.querySelectorAll('.cal-cell').length > 0;"));
  await sleep(2000);
  const clean = await ev("return { text: document.querySelector('.pet-companion').textContent, cursor: getComputedStyle(document.querySelector('.pet-drag-handle')).cursor }; ");
  check('Laika shows only model and bubble with grab cursor', !/beagleknight|Chat with Laika/.test(clean.text) && clean.cursor === 'grab', clean);
  const before = await ev("const box=document.querySelector('.pet-drag-handle').getBoundingClientRect();return {x:box.x,y:box.y,w:box.width,h:box.height,path:document.querySelector('.pet-oxygen-pipe path').getAttribute('d')};");
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: before.x + before.w / 2, y: before.y + before.h / 2, button: 'left', clickCount: 1 }, session);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: before.x + before.w / 2 - 180, y: before.y + before.h / 2 - 120, button: 'left', buttons: 1 }, session);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: before.x + before.w / 2 - 180, y: before.y + before.h / 2 - 120, button: 'left', clickCount: 1 }, session);
  await sleep(300);
  const after = await ev("const box=document.querySelector('.pet-drag-handle').getBoundingClientRect();return {x:box.x,y:box.y,path:document.querySelector('.pet-oxygen-pipe path').getAttribute('d'),bubble:!!document.querySelector('.pet-companion [role=status]')};");
  check('Pointer dragging moves Laika and tether without opening a bubble', Math.abs(after.x - before.x + 180) < 2 && Math.abs(after.y - before.y + 120) < 2 && after.path !== before.path && !after.bubble, { before, after });
  await ev("document.querySelector('.pet-drag-handle').focus();return true;");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, session);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, session);
  check('Keyboard opens Laika speech bubble', await ev("return !!document.querySelector('.pet-companion [role=status]');"));
  await ev("document.querySelector('.nav-alert').click(); return true;");
  await poll(() => ev("return !!document.querySelector('.community-alert') && !!document.querySelector('.fire-alert');"));
  const alerts = await ev("return {text:document.querySelector('.drawer').textContent,fire:document.querySelector('.fire-alert').textContent,report:document.querySelector('.alert-report pre').textContent};");
  check('Alert Center displays verified reports and measured FRP without simulation messages', /Verified anomaly fixture/.test(alerts.text) && !/Unverified anomaly fixture|simulation|dispatch preview|SIMULATED/i.test(alerts.text) && /High FRP detected/.test(alerts.fire) && /detections with FRP/.test(alerts.report), alerts);
  await ev("document.querySelector('.drawer-head .icon-btn').click();document.querySelector('.live-map-canvas').scrollIntoView({block:'center'});return true;");
  await sleep(1200);
  const region = REGIONS.find(r => r.id === 'chilecito');
  const bundle = JSON.parse(fs.readFileSync('public/data/live_fires.json', 'utf8'));
  const fires = livePointsForRegion(region, bundle.fires);
  const merc = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  const [west,south,east,north] = region.bbox;
  const bounds = await ev("const r=document.querySelector('.live-map-canvas').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};");
  const mx=(west+east)/2, my=(merc(north)+merc(south))/2;
  const scale=Math.min((bounds.w-80)/((east-west)*Math.PI/180),(bounds.h-80)/(merc(north)-merc(south)));
  const point = fires.sort((a,b) => Math.abs(a[0]-region.center[0])+Math.abs(a[1]-region.center[1])-Math.abs(b[0]-region.center[0])-Math.abs(b[1]-region.center[1]))[0];
  const x=bounds.x+bounds.w/2+(point[1]-mx)*Math.PI/180*scale;
  const y=bounds.y+bounds.h/2-(merc(point[0])-my)*scale;
  await send('Input.dispatchMouseEvent', { type:'mousePressed', x,y,button:'left',clickCount:1 },session);
  await send('Input.dispatchMouseEvent', { type:'mouseReleased', x,y,button:'left',clickCount:1 },session);
  await poll(() => ev("return !!document.querySelector('.wind-panel');"));
  check('Clicked fire opens wind loading state', await ev("return document.querySelector('.wind-panel').textContent.includes('Fetching wind data...');"));
  await poll(() => ev("return document.querySelector('.wind-panel').textContent.includes('Open-Meteo');"));
  const wind = await ev("return document.querySelector('.wind-panel').textContent;");
  check('Current wind displays provider speed and direction', /18.0 km\/h/.test(wind) && /W \(270°\)/.test(wind) && /current forecast/.test(wind), wind);
  await ev("[...document.querySelectorAll('.wind-panel button')].find(b=>b.textContent==='Close').click();const year=[...document.querySelectorAll('.cal-year')].find(x=>x.textContent==='2022');year.parentElement.querySelector('.cal-cell').dispatchEvent(new MouseEvent('click',{bubbles:true}));return true;");
  await poll(() => ev("return !!document.querySelector('.historical-map-summary');"));
  await ev("[...document.querySelectorAll('.historical-map-summary button')].find(b=>b.textContent.includes('historical wind')).click();return true;");
  await poll(() => ev("return document.querySelector('.wind-panel').textContent.includes('NASA POWER');"));
  const past = await ev("return document.querySelector('.wind-panel').textContent;");
  check('Historical selection uses exact date and converted POWER wind', /2022-01-01/.test(past) && /18.0 km\/h/.test(past) && /E \(90°\)/.test(past) && /area center/.test(past) && requests.some(r=>r.kind==='historical' && r.start==='20220101'), past);
  mode='error';
  await ev("[...document.querySelectorAll('.wind-panel button')].find(b=>b.textContent==='Close').click();return true;");
  await sleep(300);
  await ev("[...document.querySelectorAll('.historical-map-summary button')].find(b=>b.textContent.includes('historical wind')).click();return true;");
  await poll(() => ev("return document.querySelector('.wind-panel').textContent.includes('HTTP 503');"));
  check('Provider failure shows error and retry without invented wind', await ev("const t=document.querySelector('.wind-panel').textContent;return t.includes('Retry wind data')&&!t.includes('18.0 km/h');"));
  mode='success';
  await ev("[...document.querySelectorAll('.wind-panel button')].find(b=>b.textContent.includes('Retry')).click();return true;");
  await poll(() => ev("return document.querySelector('.wind-panel').textContent.includes('NASA POWER');"));
  check('Retry recovers provider wind', await ev("return document.querySelector('.wind-panel').textContent.includes('18.0 km/h');"));
  const response=await fetch(origin);
  check('Production CSP allows both wind providers', response.headers.get('content-security-policy')?.includes('https://api.open-meteo.com') && response.headers.get('content-security-policy')?.includes('https://power.larc.nasa.gov'));
} catch(error) {
  results.push({name:'Browser sweep completion',pass:false,detail:error.message});
  process.exitCode=1;
} finally {
  const report={scope:'Real UI and bundled detection geometry; wind/community responses intercepted with isolated browser fixtures. No server reports written.',pass:results.filter(r=>r.pass).length,total:results.length,results};
  fs.writeFileSync('docs/final-polish-e2e-report.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  ws?.close(); chrome.kill(); await sleep(1000); try {fs.rmSync(profile,{recursive:true,force:true});} catch {}
}
