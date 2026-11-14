// Recaptured 2026-11-14: fresh live bundle continuum-2026-11-14-58d98f95f252 (MODIS + NOAA-20/21,
// 2026-11-07..2026-11-14; Suomi-NPP feed empty and excluded). Recalibrated bridge ratio measured on
// the live window (k: chilecito 6.99 pilot-regions, pantanal 5.64 area, california 14.66 area,
// greece 14.18 area, amazon 6.22 area, nepal 18.78 area, SE Australia 10.04 area). The previous
// fixture was captured at continuum-2026-11-02; the data changed what the Fire Twin card reports.
// Analog-index regression — the window sums in twinAnalogs() go through a prefix-sum index (ADR-18).
// The numbers below were captured at bundle continuum-2026-11-02-50570444baa4 with climate schema
// continuum-climate-3, weeks=8, end = last record date (2026-11-02 — the live FIRMS window pulled from
// the NASA rolling archives at 2026-11-02 12:58 UTC by `npm run live`). The keyed archive is now 30,529
// observed sensor-days (21,863 distinct area-days) / 4,066,557 real detections over 9,822 keyed
// Area-API requests. The near-real-time tail (VIIRS 2026-08-01→, MODIS 2026-09-01→) closed the 87-day
// gap that standard processing leaves at the recent end, so every area's last 90 days are observations.
// Chilecito and Pantanal are 100% observed (9,498 of 9,498 days, zero modelled); the other five climbed
// to California 41.2%, Greece 33.0%, Amazon 11.4%, Nepal 9.4%, Southeast Australia 15.9%. Chilecito
// keeps `firms-archive` (k 12.77 on 5,401 shared days, break 136.0% -> -44.7%) and Pantanal its own
// measured bridge (k 10.63 on 2,441, 186.1% -> -20.8%). The other five still fall back to the
// live-window calibration (California 14.70x area, Greece/Nepal 10.31x pilot, Amazon 9.95x area,
// SE Australia 19.62x area): their MODIS and VIIRS archive lanes do not yet share a full annual cycle,
// and MIN_BRIDGE_DAYS = 365 is the bar archiveRatio() enforces — a peak-season ratio must not rescale
// twenty-five years of MODIS-only days.
// The fixture moves because real data replaced estimates; that is the product working, not the test
// drifting. Recapture with `node scripts/capture-analogs.mjs --write` and record the reason here. The
// previous fixtures (continuum-2026-11-02-1788b2d315d5, 28,930 observed sensor-days / 3,873,971
// detections / 9,456 requests; before it …-ee72e729cceb, 24,024 / 2,503,739 / 8,200; before it
// …-c26b349d3f33, 17,464 / 1,671,595 / 6,400; before it …-7a18b6059c30, 13,303 / 1,026,298 / 4,960;
// before it …-4ebb7b7f7935 and …-84cea7615e37) are superseded here. Two code decisions
// still show through in these numbers: burnWeatherAnomaly() subtracts the month climatology AND the year
// deviation from the raw burn-weather index, so the interannual signal is spent once, by the regime term,
// instead of entering twice. And biasXray() sums the bridge only over days BOTH lanes published, because a
// lane that has not been pulled is unknown, not zero — counting Chilecito's post-2015 MODIS silence
// inflated the printed ratio to 79.7x beside the bridge the record applies. It also now reports
// `observedEraDays`, so the Method line says whether the ratio was measured on days the archive saw both
// instruments or is the weighting the reconstruction was built with. The backtest hit rate is the noisy
// statistic it has always been: 20 trials per area, and the seven areas span 55-80% across windows
// (Chilecito 65, Pantanal 60, California 55, Greece 70, Amazon 65, Nepal 80, SE Australia 60 at this
// bundle; Amazon jumped from 10 as MODIS depth nearly doubled its observed seasons, and SE Australia
// eased 65 -> 60 — the prefix-sum index is unchanged, the seasons it scores are not). At n=20
// none of these is distinguishable from a coin flip, so the Fire Twin card is a comparison of seasons and
// the UI says so. Selection still separates years (similarity sd 4.9-9.8 across candidates, see
// scripts/probe-analog-spread.mjs), so the card is not reading noise. The fixture
// still proves the prefix-sum index is exact: re-running the same bundle reproduces these numbers to
// the last decimal (verified 2026-11-02: two builds of the same record give identical JSON). If this
// test fails now, the optimization or the data changed what a pilot's Fire Twin card says, and the
// change has to be argued for, not absorbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const A = await import(pathToFileURL(path.join(ROOT, 'dist-server', 'analytics.mjs')).href);
const live = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'live_fires.json'), 'utf8'));
const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'snapshot.json'), 'utf8'));

const GOLDEN = [
  {"region":"chilecito","hitRate":65,"sampleYears":20,"analogs":[{"year":2020,"similarity":59.745282772956706,"correlation":0.5724619817163668,"next4":350},{"year":2019,"similarity":59.02537816893072,"correlation":0.13385426583235163,"next4":57.75850379905273},{"year":2025,"similarity":47.11491179949411,"correlation":-0.20966353287006892,"next4":299.009900990099}]},
  {"region":"pantanal","hitRate":70,"sampleYears":20,"analogs":[{"year":2015,"similarity":46.34156054369928,"correlation":0.6113227652302713,"next4":-15.518447845817903},{"year":2013,"similarity":44.53919426422077,"correlation":0.4200995809804146,"next4":76.40790719261904},{"year":2012,"similarity":34.40786582570151,"correlation":0.3487897709392636,"next4":-46.63465702746398}]},
  {"region":"california","hitRate":80,"sampleYears":20,"analogs":[{"year":2016,"similarity":81.42076183005828,"correlation":0.5916412706970607,"next4":23.91312115082689},{"year":2002,"similarity":71.26062443662988,"correlation":0.4806146027239355,"next4":447.20496894409905},{"year":2012,"similarity":70.4943270620898,"correlation":0.0465266373065969,"next4":-51.88245561528597}]},
  {"region":"greece","hitRate":50,"sampleYears":20,"analogs":[{"year":2011,"similarity":59.45444033292374,"correlation":0.6672768210997267,"next4":373.9726027396946},{"year":2012,"similarity":59.414146489684306,"correlation":0.6666254237117865,"next4":10.43877344378085},{"year":2004,"similarity":56.71220563670476,"correlation":0.6329650126164628,"next4":-22.89156626505472}]},
  {"region":"amazon","hitRate":55.00000000000001,"sampleYears":20,"analogs":[{"year":2014,"similarity":71.01259843355577,"correlation":0.6176051560329882,"next4":15.67957886880618},{"year":2020,"similarity":70.68767106849735,"correlation":0.6539038155489827,"next4":-14.410546335072617},{"year":2018,"similarity":70.22665190530788,"correlation":0.6169317464104782,"next4":-37.1970444918628}]},
  {"region":"nepal","hitRate":85,"sampleYears":20,"analogs":[{"year":2003,"similarity":73.63024465583857,"correlation":0.844018653397923,"next4":200.00000000000918},{"year":2024,"similarity":72.80456338864222,"correlation":0.8348831943212653,"next4":92.36768802228413},{"year":2019,"similarity":70.91898200746857,"correlation":0.8222357477436563,"next4":-26.945218198700093}]},
  {"region":"southeast-australia","hitRate":45,"sampleYears":20,"analogs":[{"year":2003,"similarity":74.11734668532361,"correlation":0.8283874709942741,"next4":60.62052505968244},{"year":2017,"similarity":68.7093999514288,"correlation":0.830730752480265,"next4":-16.72360198537008},{"year":2021,"similarity":63.26656064753933,"correlation":0.7867426065024098,"next4":-66.13336447506714}]},
];

// Reassociation of float additions is expected here: the index sums a window as prefix[hi] - prefix[lo]
// instead of left-to-right over the rows. 1e-6 relative is nine orders of magnitude above the largest
// difference measured between the two implementations (2.1e-12, on amazon's top analog correlation).
const TOL = 1e-6;
const same = (actual, expected, label) => {
  assert.ok(Math.abs(actual - expected) <= TOL * Math.max(1, Math.abs(expected)), `${label}: ${actual} vs ${expected}`);
};

for (const g of GOLDEN) {
  test(`twinAnalogs still reproduces the pre-index result for ${g.region}`, () => {
    const region = A.getRegion(g.region);
    const records = A.regionRecord(region, live);
    const today = records[records.length - 1].date;
    assert.equal(today, snapshot.windowEnd, 'the fixture was taken at the bundle window end');
    const out = A.twinAnalogs(records, today, 8);
    assert.equal(out.analogs.length, g.analogs.length);
    assert.equal(out.sampleYears, g.sampleYears);
    same(out.backtestHitRate, g.hitRate, `${g.region} hit rate`);
    out.analogs.forEach((a, i) => {
      assert.equal(a.year, g.analogs[i].year, `${g.region} analog ${i} selection order`);
      same(a.similarity, g.analogs[i].similarity, `${g.region}/${a.year} similarity`);
      same(a.correlation, g.analogs[i].correlation, `${g.region}/${a.year} correlation`);
      same(a.next4WeeksAnomalyPct, g.analogs[i].next4, `${g.region}/${a.year} next-4-week anomaly`);
    });
  });
}

test('the analog ensemble is ordered by similarity and never repeats a season', () => {
  const records = A.regionRecord(A.getRegion('pantanal'), live);
  const out = A.twinAnalogs(records, records[records.length - 1].date, 8);
  const sims = out.analogs.map((a) => a.similarity);
  assert.deepEqual([...sims].sort((x, y) => y - x), sims, 'descending similarity');
  assert.equal(new Set(out.analogs.map((a) => a.year)).size, out.analogs.length, 'distinct seasons');
});

test('the cached index is not stale across regions or record arrays', () => {
  // Two regions share no DailyRecord array, so the WeakMap cache cannot leak one pilot's sums into
  // another's analogs. Backtest hit rates CAN coincide — 20 trials, and chilecto and greece both
  // score 12/20 at this bundle — so that is not the leak signal. The signal is that after the other
  // area has run, each area still reproduces its own fixture and their selections stay distinct.
  const [a, b] = ['chilecito', 'greece'].map((id) => {
    const records = A.regionRecord(A.getRegion(id), live);
    return { records, out: A.twinAnalogs(records, records[records.length - 1].date, 8) };
  });
  const fixture = (id) => GOLDEN.find((x) => x.region === id);
  for (const [x, id] of [[a, 'chilecito'], [b, 'greece']]) {
    assert.equal(x.out.analogs[0].year, fixture(id).analogs[0].year, `${id}: top season changed after the other area ran`);
    same(x.out.analogs[0].similarity, fixture(id).analogs[0].similarity, `${id}: top similarity after the other area ran`);
    same(x.out.backtestHitRate, fixture(id).hitRate, `${id}: hit rate after the other area ran`);
  }
  assert.notEqual(a.out.analogs[0].similarity, b.out.analogs[0].similarity, 'identical similarity across two records is a cache leak');
  assert.notEqual(a.out.analogs[0].year, b.out.analogs[0].year);
  const again = A.twinAnalogs(a.records, a.records[a.records.length - 1].date, 8);
  assert.equal(again.backtestHitRate, a.out.backtestHitRate, 'second call on the same array is stable');
  assert.deepEqual(again.analogs.map((x) => x.year), a.out.analogs.map((x) => x.year));
});
