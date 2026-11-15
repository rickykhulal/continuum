import assert from 'node:assert/strict';
import { test } from 'node:test';
import { windRequest, parseWind, windCompass, fetchWind, highFrpAlerts, verifiedCommunityAlerts } from '../dist-server/analytics.mjs';

const current = { current_weather: { windspeed: 18, winddirection: 270, time: '2026-11-15T12:00' } };
const historical = { properties: { parameter: { WS10M: { '20220101': 5 }, WD10M: { '20220101': 90 } } } };

test('wind current request keeps clicked coordinates and explicit km/h units', () => {
  const request = windRequest(-29.2, -67.5, null, '2026-11-15');
  const url = new URL(request.url);
  assert.equal(url.origin, 'https://api.open-meteo.com');
  assert.equal(url.searchParams.get('latitude'), '-29.2');
  assert.equal(url.searchParams.get('longitude'), '-67.5');
  assert.equal(url.searchParams.get('windspeed_unit'), 'kmh');
  assert.equal(request.historical, false);
});
test('wind historical request uses exact selected day at NASA POWER', () => {
  const request = windRequest(12, 34, '2022-01-01', '2026-11-15');
  const url = new URL(request.url);
  assert.equal(url.origin, 'https://power.larc.nasa.gov');
  assert.equal(url.searchParams.get('start'), '20220101');
  assert.equal(url.searchParams.get('end'), '20220101');
  assert.equal(url.searchParams.get('parameters'), 'WS10M,WD10M');
  assert.equal(request.historical, true);
});
test('wind selects current provider on today and refuses invalid inputs', () => {
  assert.equal(windRequest(0, 0, '2026-11-15', '2026-11-15').historical, false);
  for (const args of [[91, 0], [0, Infinity], [0, 0, '2022-02-30'], [0, 0, '2026-11-16', '2026-11-15']]) assert.throws(() => windRequest(...args));
});
test('Open-Meteo speed stays km/h and forecast provenance is explicit', () => {
  assert.deepEqual(parseWind(current, false), { source: 'Open-Meteo', speedKmh: 18, direction: 270, time: '2026-11-15T12:00', historical: false });
});
test('NASA POWER converts m/s to km/h and selects the requested day', () => {
  const wind = parseWind(historical, true, '2022-01-01');
  assert.equal(wind.speedKmh, 18);
  assert.equal(wind.direction, 90);
  assert.equal(wind.source, 'NASA POWER');
  assert.equal(wind.time, '2022-01-01');
});
test('wind rejects missing dates, fill values and nonnumeric provider data', () => {
  assert.throws(() => parseWind(historical, true, '2022-01-02'));
  for (const speed of [-999, null, '18', Infinity]) assert.throws(() => parseWind({ current_weather: { ...current.current_weather, windspeed: speed } }, false));
  assert.throws(() => parseWind({ current_weather: { ...current.current_weather, winddirection: -999 } }, false));
});
test('calm wind remains zero and 360 degrees normalizes to north', () => {
  const wind = parseWind({ current_weather: { ...current.current_weather, windspeed: 0, winddirection: 360 } }, false);
  assert.equal(wind.speedKmh, 0);
  assert.equal(wind.direction, 0);
  assert.equal(windCompass(wind.direction), 'N');
  assert.equal(windCompass(270), 'W');
});
test('wind provider HTTP errors do not fall back to invented readings', async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 503 });
  try { await assert.rejects(fetchWind(0, 0), /HTTP 503/); }
  finally { globalThis.fetch = saved; }
});
test('closing wind cancels its outstanding provider request', async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
    if (signal.aborted) reject(new DOMException('Aborted', 'AbortError'));
    else signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
  try {
    const controller = new AbortController();
    const request = fetchWind(0, 0, null, controller.signal);
    controller.abort();
    await assert.rejects(request, { name: 'AbortError' });
  } finally { globalThis.fetch = saved; }
});
const area = { id: 'test-wind-area', shortName: 'Test area', center: [0, 0], bbox: [-1, -1, 1, 1], areaKm2: 40000, selection: 'bounds' };
const fire = (frp, date, lat = 0) => [lat, 0, frp, 1, 1, Date.parse(date + 'T12:00:00Z') / 1000];
test('high FRP alerts count observed points with inclusive threshold, date and AOI', () => {
  const alerts = highFrpAlerts([fire(50, '2026-11-14'), fire(80, '2026-11-14'), fire(49, '2026-11-14'), fire(90, '2026-11-13'), fire(99, '2026-11-14', 5)], [area, area], '2026-11-14', '2026-11-14');
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].points, 2);
  assert.equal(alerts[0].peakFrp, 80);
  assert.equal(alerts[0].totalFrp, 130);
});
test('fire alerts order by latest observed date before FRP', () => {
  const alerts = highFrpAlerts([fire(300, '2026-11-13'), fire(50, '2026-11-14')], [area], '2026-11-13', '2026-11-14');
  assert.deepEqual(alerts.map(a => a.date), ['2026-11-14', '2026-11-13']);
  assert.deepEqual(highFrpAlerts([], [area], '2026-11-13', '2026-11-14'), []);
});
test('community alerts require explicit verification of an actual anomaly', () => {
  const post = { id: '1', type: 'anomaly', verified: true, author: 'Observer', content: 'Reported anomaly', createdAt: '2026-11-14T12:00:00Z' };
  const reports = verifiedCommunityAlerts({ posts: [post, { ...post, id: '2', verified: false }, { ...post, id: '3', type: 'text' }, { ...post, id: '4', createdAt: 'invalid' }] });
  assert.equal(reports.length, 1);
  assert.equal(reports[0].content, 'Reported anomaly');
  assert.throws(() => verifiedCommunityAlerts({ announcements: [] }));
  assert.deepEqual(verifiedCommunityAlerts({ posts: [] }), []);
});
