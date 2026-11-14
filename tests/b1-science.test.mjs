import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Current source, all data.ts exports and the Brief summary, in memory only. This does not
// replace the full application type-check or certify Qoder-owned export wiring.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = await build({
  stdin: {
    contents: [
      "export * from './src/lib/data.ts';",
      "export { archiveRatio, dayIndex } from './src/lib/archive.ts';",
      "export { briefAnalogSummary } from './src/pages/Brief.tsx';",
    ].join('\n'),
    resolveDir: ROOT, loader: 'ts',
  },
  absWorkingDir: ROOT, bundle: true, write: false, format: 'esm',
  platform: 'node', target: 'node20', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': "'./'" },
});
const A = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].contents).toString('base64'));
const region = { ...A.REGIONS[0], id: 'b1-test-only', name: 'TEST ONLY synthetic area', shortName: 'TEST ONLY' };
const units = 'VIIRS-equivalent detections/day';
const today = '2024-03-01';

afterEach(() => A.attachArchive(null));

function record(date, extra = {}) {
  return {
    date, year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), doy: 1,
    modis: 1, viirs: 2, noaa20: 0, noaa21: 0, raw: 2, harmonized: 2,
    lo: 0, hi: 4, frp: 10, trust: 'low', provisional: false, source: 'model', live: false,
    ...extra,
  };
}

function evidence(extra = {}) {
  return {
    kind: 'synthetic-check', regionId: region.id, metric: 'hotspots', mode: 'harmonized', units,
    period: { from: '2024-02-27', to: today },
    referenceSource: { id: 'TEST ONLY hand-worked reference', version: '1', description: 'Synthetic arithmetic fixture; never observation-based validation.', kind: 'synthetic-fixture' },
    predictionSource: { id: 'TEST ONLY fixed predictions', version: '1', description: 'Hand-worked predictions for an error-calculation unit test.' },
    methodology: { description: 'Exact UTC date pairing on a four-day synthetic fixture.', holdoutStatement: null, minimumSamples: 4, minimumCoverage: 1 },
    pairs: [
      { date: '2024-02-27', prediction: 12, reference: 10 },
      { date: '2024-02-28', prediction: 1, reference: 3 },
      { date: '2024-02-29', prediction: 0, reference: 0 },
      { date: '2024-03-01', prediction: 10, reference: 6 },
    ],
    ...extra,
  };
}

function report(input, records = []) {
  return A.generateValidationReport(records, region, today, null, 'hotspots', 'harmonized', input);
}

function archive(days, modisCount = 10) {
  const start = A.dayIndex('2022-01-01');
  const covered = Object.fromEntries(['m', 'v', 'n', 'n21'].map((s) => [s, [[start, start + days - 1, 0]]]));
  return {
    schema: 'continuum-archive-1', generated_at: 'TEST ONLY archive v1', start: '2000-11-01',
    method: 'TEST ONLY synthetic covered-day fixture; not downloaded observations.', requests: 0, rows: 0,
    regions: { [region.id]: { covered, days: {
      m: [[start, modisCount, 10]], v: [[start, 30, 30]], n: [[start, 20, 20]], n21: [[start, 10, 10]],
    } } },
  };
}

test('C-01: missing daily-cycle inputs give deferred status and no identity correction', () => {
  for (const obsolete of ['dailyCycleWeight', 'applyDailyCycleCorrection', 'archiveRatioWithDailyCycle']) {
    assert.ok(!(obsolete in A), 'Obsolete daily-cycle export must not be restored: ' + obsolete);
  }
  const out = report(undefined);
  assert.equal(out.dailyCycle.status, 'deferred');
  assert.equal(out.dailyCycle.correctedK, null);
  assert.match(out.dailyCycle.reason, /exposure-aware/);
  assert.equal(out.bridgeRatio.k, null);
  assert.equal(out.bridgeRatio.status, 'insufficient_data');
});

test('C-01: sufficient archive overlap preserves the uncorrected ratio and its provenance', () => {
  A.attachArchive(archive(365));
  assert.equal(A.archiveRatio(region).k, 6); // (30 + 20 + 10) / 10; 364 covered zero days remain eligible.
  const out = report(undefined);
  assert.equal(out.bridgeRatio.k, 6);
  assert.equal(out.bridgeRatio.days, 365);
  assert.equal(out.bridgeRatio.source, 'firms-archive');
  assert.equal(out.bridgeRatio.sourceVersion, 'TEST ONLY archive v1');
  assert.equal(out.bridgeRatio.kind, 'calibration');
  assert.equal(out.dailyCycle.correctedK, null);
  assert.equal(out.validation.status, 'not_performed');
});

test('C-01: insufficient overlap remains unavailable without lowering the 365-day gate', () => {
  A.attachArchive(archive(364));
  assert.equal(A.archiveRatio(region), null);
  assert.equal(report(undefined).bridgeRatio.k, null);
});

test('C-01: zero, negative and non-finite overlap denominators do not become reported calibration', () => {
  for (const denominator of [0, -10, NaN, Infinity]) {
    A.attachArchive(archive(365, denominator));
    const out = report(undefined);
    assert.equal(out.bridgeRatio.k, null);
    assert.equal(out.bridgeRatio.ratioLo, null);
    assert.equal(out.bridgeRatio.ratioHi, null);
  }
});

test('C-02: validation is not performed merely because historical records exist', () => {
  const out = report(undefined, [record('2024-02-29'), record(today, { source: 'archive' })]);
  assert.equal(out.validation.status, 'not_performed');
  assert.equal(out.validation.performed, false);
  assert.equal(out.validation.sampleSize, 0);
  assert.equal(out.validation.metrics, null);
  assert.equal(out.validation.errors, null);
  assert.equal(out.validation.referenceDataSource, null);
  assert.equal(out.validation.period, null);
  assert.equal(out.validation.coverage.fraction, null);
  assert.equal(out.validation.independence, 'unassessed');
});

test('C-02: explicit evaluation with no pairs is insufficient data, not zero-error success', () => {
  const out = report(evidence({ pairs: [] })).validation;
  assert.equal(out.status, 'insufficient_data');
  assert.equal(out.performed, false);
  assert.equal(out.metrics, null);
  assert.equal(out.errors, null);
  assert.equal(out.coverage.expectedDays, 4);
  assert.equal(out.coverage.fraction, 0);
});

test('C-02: measurable synthetic evaluation uses exact error calculations and remains synthetic', () => {
  const out = report(evidence()).validation;
  assert.equal(out.status, 'completed');
  assert.equal(out.performed, true);
  assert.equal(out.sampleSize, 4);
  assert.deepEqual(out.coverage, { expectedDays: 4, pairedDays: 4, fraction: 1 });
  assert.deepEqual(out.period, { from: '2024-02-27', to: '2024-03-01' });
  assert.equal(out.metrics.meanError, 1);
  assert.equal(out.metrics.meanAbsoluteError, 2);
  assert.ok(Math.abs(out.metrics.rootMeanSquaredError - Math.sqrt(6)) < 1e-12);
  assert.deepEqual(out.errors.map((r) => r.error), [2, -2, 0, 4]);
  assert.equal(out.units, units);
  assert.equal(out.referenceDataSource.kind, 'synthetic-fixture');
  assert.equal(out.independence, 'not_independent');
  assert.equal(out.scientificAcceptance, 'not_assessed');
  assert.match(out.limitations.join(' '), /TEST ONLY/);
});

test('C-02: performed evaluation below calendar coverage retains measurable errors and names the gap', () => {
  const fixture = evidence();
  fixture.pairs = fixture.pairs.slice(0, 2);
  fixture.methodology.minimumSamples = 2;
  const out = report(fixture).validation;
  assert.equal(out.status, 'insufficient_coverage');
  assert.equal(out.performed, true);
  assert.equal(out.sampleSize, 2);
  assert.equal(out.coverage.fraction, 0.5);
  assert.equal(out.metrics.meanError, 0);
  assert.equal(out.metrics.meanAbsoluteError, 2);
  assert.equal(out.metrics.rootMeanSquaredError, 2);
});

test('C-02: sample minimum is checked separately from calendar coverage', () => {
  const fixture = evidence();
  fixture.methodology.minimumSamples = 5;
  const out = report(fixture).validation;
  assert.equal(out.coverage.fraction, 1);
  assert.equal(out.status, 'insufficient_coverage');
});

test('C-02: no outcome invents confidence intervals or predictive-interval coverage', () => {
  for (const fixture of [undefined, evidence({ pairs: [] }), evidence(), evidence({ pairs: evidence().pairs.slice(0, 1) })]) {
    const out = report(fixture);
    assert.equal(out.bridgeRatio.ratioLo, null);
    assert.equal(out.bridgeRatio.ratioHi, null);
    assert.equal(out.validation.confidenceInterval, null);
    assert.equal(out.validation.intervalCoverage, null);
    assert.ok(!('sandbox' in out));
    assert.ok(!('monthlyStatus' in out));
    assert.ok(!('sensitivity' in out));
  }
});

test('C-02: synthetic references cannot be relabelled as independent validation', () => {
  const out = report(evidence({ kind: 'independent-validation' })).validation;
  assert.equal(out.status, 'insufficient_data');
  assert.equal(out.metrics, null);
  assert.match(out.limitations.join(' '), /Synthetic reference/);
});

test('C-02: model fit, calibration and backtesting remain distinct from independent validation', () => {
  for (const kind of ['model-fit', 'calibration', 'backtest']) {
    // TEST ONLY schema exercise. This label declaration is not proof of observed data.
    const fixture = evidence({ kind });
    fixture.referenceSource.kind = 'observations';
    const out = report(fixture).validation;
    assert.equal(out.kind, kind);
    assert.equal(out.independence, 'not_independent');
    assert.equal(out.scientificAcceptance, 'not_assessed');
  }
});

test('C-02: a declared observational holdout needs methodology and never certifies its own independence', () => {
  const fixture = evidence({ kind: 'independent-validation' });
  fixture.referenceSource.kind = 'observations'; // TEST ONLY input-contract exercise, not real observations.
  assert.equal(report(fixture).validation.status, 'insufficient_data');
  fixture.methodology.holdoutStatement = 'TEST ONLY declaration: independent review has not occurred.';
  const out = report(fixture).validation;
  assert.equal(out.independence, 'declared_by_caller');
  assert.equal(out.scientificAcceptance, 'not_assessed');
  assert.match(out.limitations.join(' '), /external review/);
});

test('C-02: source identity, units, target and declared criteria are mandatory', () => {
  const fixtures = [
    evidence({ units: 'wrong units' }), evidence({ regionId: 'wrong region' }),
    evidence({ metric: 'frp' }), evidence({ mode: 'raw' }),
    evidence({ referenceSource: { ...evidence().referenceSource, version: '' } }),
    evidence({ predictionSource: { ...evidence().predictionSource, description: '' } }),
    evidence({ methodology: { ...evidence().methodology, minimumSamples: 0 } }),
    evidence({ methodology: { ...evidence().methodology, minimumCoverage: 1.1 } }),
  ];
  for (const fixture of fixtures) {
    const out = report(fixture).validation;
    assert.equal(out.status, 'insufficient_data');
    assert.equal(out.metrics, null);
  }
});

test('C-02: invalid, reversed and future periods are rejected without date rollover', () => {
  for (const period of [
    { from: '2024-02-30', to: today }, { from: today, to: '2024-02-27' },
    { from: today, to: '2024-03-02' }, { from: '2023-02-29', to: today },
    { from: '2024-02-27T00:00:00Z', to: today },
  ]) {
    const out = report(evidence({ period })).validation;
    assert.equal(out.status, 'insufficient_data');
    assert.equal(out.metrics, null);
    assert.equal(out.period, null);
  }
  const out = A.generateValidationReport([], region, 'not-a-date', null, 'hotspots', 'harmonized', evidence());
  assert.equal(out.validation.status, 'insufficient_data');
});

test('C-02: December-January and leap-day periods count inclusive UTC calendar days', () => {
  const fixture = evidence({
    period: { from: '2023-12-31', to: '2024-01-01' },
    pairs: [
      { date: '2024-01-01', prediction: 0, reference: 0 },
      { date: '2023-12-31', prediction: 1, reference: 0 },
    ],
  });
  fixture.methodology.minimumSamples = 2;
  const out = report(fixture).validation;
  assert.equal(out.coverage.expectedDays, 2);
  assert.equal(out.coverage.fraction, 1);
  assert.deepEqual(out.errors.map((r) => r.date), ['2023-12-31', '2024-01-01']);
  assert.equal(report(evidence()).validation.coverage.expectedDays, 4); // includes Feb 29.
});

test('C-02: duplicated, null, invalid and out-of-period pairs cannot inflate coverage', () => {
  const fixture = evidence();
  fixture.pairs = [
    ...fixture.pairs,
    { date: '2024-02-27', prediction: 100, reference: 10 }, // Reject both rows for this date.
    { date: '2024-02-30', prediction: 2, reference: 2 },
    { date: '2024-02-26', prediction: 2, reference: 2 },
    { date: '2024-03-02', prediction: null, reference: 2 },
    { date: '2024-03-03', prediction: Infinity, reference: 2 },
  ];
  const out = report(fixture).validation;
  assert.equal(out.sampleSize, 3);
  assert.equal(out.rejectedRows, 6);
  assert.equal(out.coverage.fraction, 0.75);
  assert.equal(out.status, 'insufficient_coverage');
});

test('C-02: covered zero references remain eligible; undefined values do not become zeros', () => {
  const fixture = evidence({ pairs: [
    { date: '2024-02-27', prediction: null, reference: 0 },
    { date: '2024-02-28', prediction: NaN, reference: 0 },
    { date: '2024-02-29', prediction: -1, reference: 0 },
    { date: today, prediction: 0, reference: 0 },
  ] });
  const out = report(fixture).validation;
  assert.equal(out.sampleSize, 1);
  assert.equal(out.rejectedRows, 3);
  assert.deepEqual(out.metrics, { meanError: 0, meanAbsoluteError: 0, rootMeanSquaredError: 0 });
  assert.equal(out.status, 'insufficient_coverage');
});

test('C-02: empty and incomplete historical records do not imply complete observation coverage', () => {
  const empty = report(undefined).recordCoverage;
  assert.equal(empty.availableDays, 0);
  assert.equal(empty.expectedDays, null);
  assert.equal(empty.calendarCoverage, null);
  assert.equal(empty.period, null);
  const sparse = report(undefined, [
    record('2024-02-29', { source: 'archive', harmonized: 0 }),
    record('2024-02-27'),
    record('2024-03-02'),
  ]).recordCoverage;
  assert.deepEqual(sparse.period, { from: '2024-02-27', to: today });
  assert.equal(sparse.availableDays, 2);
  assert.equal(sparse.expectedDays, 4);
  assert.equal(sparse.missingDays, 2);
  assert.equal(sparse.calendarCoverage, 0.5);
  assert.equal(sparse.observationSourceDays, 1);
  assert.equal(sparse.modelOrBlendDays, 1);
  assert.equal(sparse.excludedRows, 1);
});

test('C-02: duplicate/invalid historical dates are excluded and all report numbers serialize faithfully', () => {
  const out = report(undefined, [record(today), record(today), record('2024-02-30'), record('2024-02-29', { harmonized: NaN })]);
  assert.equal(out.recordCoverage.availableDays, 0);
  assert.equal(out.recordCoverage.excludedRows, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
});

test('C-08: skewed analogs use median headline and separately calculated mean', () => {
  const twin = { analogs: [90, 10, 20].map((next4WeeksAnomalyPct) => ({ next4WeeksAnomalyPct })) };
  assert.deepEqual(A.analogDepartureSummary(twin), { median: 20, mean: 40, sampleSize: 3, excludedCount: 0 });
  assert.equal(A.analogDeparture(twin), 20);
  const brief = A.briefAnalogSummary(twin);
  assert.equal(brief.medianText, '+20%');
  assert.equal(brief.meanText, '+40%');
  assert.equal(brief.headline, 'Median next-four-week departure +20%.');
  assert.match(brief.supplementary, /^Supplementary mean next-four-week departure \+40% across 3 /);
  assert.deepEqual(twin.analogs.map((a) => a.next4WeeksAnomalyPct), [90, 10, 20]);
});

test('C-08: empty and partially missing analogs have honest sample sizes and unavailable values', () => {
  const empty = A.briefAnalogSummary({ analogs: [] });
  assert.equal(empty.median, null);
  assert.equal(empty.mean, null);
  assert.equal(empty.sampleSize, 0);
  assert.match(empty.headline, /unavailable/);
  assert.match(empty.supplementary, /unavailable/);
  const sparse = A.analogDepartureSummary({ analogs: [NaN, Infinity, -10, 30].map((next4WeeksAnomalyPct) => ({ next4WeeksAnomalyPct })) });
  assert.deepEqual(sparse, { median: 10, mean: 10, sampleSize: 2, excludedCount: 2 });
});

test('C-02: invalid fire-day counts do not become zero observations and indicators retain their units', () => {
  const fixture = evidence({ metric: 'firedays', units: 'fire-day indicator (0 or 1)', pairs: [
    { date: '2024-02-27', prediction: 0, reference: 0 },
    { date: '2024-02-28', prediction: 1, reference: 0 },
    { date: '2024-02-29', prediction: 0.5, reference: 1 },
    { date: today, prediction: 1, reference: 2 },
  ] });
  const out = A.generateValidationReport([record(today, { harmonized: NaN })], region, today, null, 'firedays', 'harmonized', fixture);
  assert.equal(out.recordCoverage.availableDays, 0);
  assert.equal(out.recordCoverage.excludedRows, 1);
  assert.equal(out.validation.units, 'fire-day indicator (0 or 1)');
  assert.equal(out.validation.sampleSize, 2);
  assert.equal(out.validation.rejectedRows, 2);
  assert.equal(out.validation.metrics.meanAbsoluteError, 0.5);
});

test('C-02: invalid policy remains serializable and accepted provenance is a stable snapshot', () => {
  const invalid = evidence();
  invalid.methodology.minimumCoverage = NaN;
  const rejected = report(invalid);
  assert.equal(rejected.validation.status, 'insufficient_data');
  assert.equal(rejected.validation.methodology, null);
  assert.deepEqual(JSON.parse(JSON.stringify(rejected)), rejected);
  const fixture = evidence();
  const accepted = report(fixture).validation;
  fixture.referenceSource.version = 'changed later';
  fixture.predictionSource.description = 'changed later';
  fixture.methodology.minimumSamples = 99;
  assert.equal(accepted.referenceDataSource.version, '1');
  assert.notEqual(accepted.predictionDataSource.description, 'changed later');
  assert.equal(accepted.methodology.minimumSamples, 4);
});

