/**
 * The archive plan and its completeness rules.
 *
 * Every product/region lane is a sequence of 5-day request windows from a product's first to last
 * published day. The backfill advances one cursor per lane; this module turns the plan and the
 * checkpoint into the facts a gate can judge: which lanes exist, how many windows remain, which
 * windows failed, and whether the published coverage ranges still agree with the cursors.
 *
 * Promotion must never infer completeness from a row count. `inspectArchivePair` proves the
 * staging file and its checkpoint are the same batch, every planned lane reached its last window,
 * the aggregated cells sum to the cursor, and the coverage ranges match what the cursors imply —
 * because a stale coverage range manufactures an observed zero for a day nobody fetched.
 */
import { batchOf } from './archive-persistence.mjs';

export const DAY = 86400000;
export const START = '2000-11-01';
export const ARCHIVE_SCHEMA = 'continuum-archive-1';

/**
 * Priority order: the harmonised unit first, then the MODIS baseline, then the other
 * VIIRS spacecraft, then the near-real-time tail that closes the gap at the recent end.
 * The array is the single source of truth for the plan; the backfill imports it.
 */
export const SOURCES = [
  { id: 'VIIRS_SNPP_SP', sensor: 'v', min: '2012-01-20', max: '2026-07-31' },
  { id: 'MODIS_SP', sensor: 'm', min: '2000-11-01', max: '2026-08-31' },
  { id: 'VIIRS_NOAA20_SP', sensor: 'n', min: '2018-04-01', max: '2026-07-31' },
  { id: 'VIIRS_NOAA21_SP', sensor: 'n21', min: '2023-03-01', max: '2026-07-31' },
  { id: 'VIIRS_SNPP_NRT', sensor: 'v', min: '2026-08-01', max: '2026-11-02' },
  { id: 'MODIS_NRT', sensor: 'm', min: '2026-09-01', max: '2026-11-02' },
  { id: 'VIIRS_NOAA20_NRT', sensor: 'n', min: '2026-08-01', max: '2026-11-02' },
  { id: 'VIIRS_NOAA21_NRT', sensor: 'n21', min: '2026-08-01', max: '2026-11-02' },
];

export const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

export const dayIndex = (date) =>
  Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${START}T00:00:00Z`)) / DAY);

/** Every 5-day window that starts on or before the product's last published day. */
export function windows(min, max) {
  const out = [];
  for (let t = Date.parse(`${min}T00:00:00Z`); t <= Date.parse(`${max}T00:00:00Z`); t += 5 * DAY) {
    out.push(iso(t));
    if (out.length > 4000) break;
  }
  return out;
}

export const laneKey = (sourceId, regionId) => `${sourceId}|${regionId}`;

/** Every lane the record owes, with its full window list. */
export function planLanes(regionIds, sources = SOURCES) {
  const lanes = [];
  for (const source of sources) {
    const wins = windows(source.min, source.max);
    for (const regionId of regionIds) {
      lanes.push({ key: laneKey(source.id, regionId), source, regionId, windows: wins });
    }
  }
  return lanes;
}

export function planStats(regionIds, sources = SOURCES) {
  const lanes = planLanes(regionIds, sources);
  return {
    sources: sources.length,
    regions: regionIds.length,
    lanes: lanes.length,
    windows: lanes.reduce((sum, lane) => sum + lane.windows.length, 0),
  };
}

function mergeRanges(spans) {
  const sorted = spans.filter((s) => s[0] >= 0).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1] + 1) {
      last[1] = Math.max(last[1], s[1]);
      last[2] = Math.min(last[2], s[2]);
    } else out.push([s[0], s[1], s[2]]);
  }
  return out;
}

/**
 * The coverage ranges a lane's cursor implies: one span per attempted, non-failed window,
 * clipped at the product's last day. kind 0 = standard processing, 1 = near real time.
 */
export function expectedCoverage(state, regionId, sensor, sources = SOURCES) {
  const spans = [];
  for (const source of sources) {
    if (source.sensor !== sensor) continue;
    const lane = state?.lanes?.[laneKey(source.id, regionId)];
    if (!lane) continue;
    const wins = windows(source.min, source.max);
    const failed = new Set(lane.failed || []);
    const done = Number.isInteger(lane.done) ? lane.done : 0;
    for (let i = 0; i < done && i < wins.length; i++) {
      const start = wins[i];
      if (failed.has(start)) continue;
      const end = iso(Math.min(Date.parse(`${start}T00:00:00Z`) + 4 * DAY, Date.parse(`${source.max}T00:00:00Z`)));
      spans.push([dayIndex(start), dayIndex(end), source.id.endsWith('_NRT') ? 1 : 0]);
    }
  }
  return mergeRanges(spans);
}

function sameSources(declared, expected) {
  if (!Array.isArray(declared) || declared.length !== expected.length) {
    return `archive declares ${Array.isArray(declared) ? declared.length : 'no'} sources, plan has ${expected.length}`;
  }
  for (const source of expected) {
    const row = declared.find((d) => d && d.id === source.id);
    if (!row) return `archive manifest is missing ${source.id}`;
    if (row.sensor !== source.sensor || row.min !== source.min || row.max !== source.max) {
      return `archive manifest disagrees with the plan for ${source.id}`;
    }
  }
  return '';
}

function sameRegions(declared, expected) {
  const have = new Set(Object.keys(declared || {}));
  const want = new Set(expected);
  const missing = [...want].filter((id) => !have.has(id));
  const extra = [...have].filter((id) => !want.has(id));
  if (missing.length) return `archive is missing regions: ${missing.join(', ')}`;
  if (extra.length) return `archive has regions outside the plan: ${extra.join(', ')}`;
  return '';
}

function inspectCells(stage, issues) {
  let cells = 0;
  let days = 0;
  for (const [regionId, block] of Object.entries(stage.regions || {})) {
    const daysBySensor = block?.days;
    if (!daysBySensor || typeof daysBySensor !== 'object') {
      issues.push({ code: 'REGION_SHAPE', message: `${regionId} has no days object` });
      continue;
    }
    for (const [sensor, rows] of Object.entries(daysBySensor)) {
      if (!Array.isArray(rows)) {
        issues.push({ code: 'REGION_SHAPE', message: `${regionId}/${sensor} days is not an array` });
        continue;
      }
      days += rows.length;
      const seen = new Set();
      let last = -1;
      for (const row of rows) {
        if (!Array.isArray(row) || row.length < 2 || !Number.isInteger(row[0]) || row[0] < 0 || !Number.isFinite(row[1])) {
          issues.push({ code: 'CELL_INVALID', message: `${regionId}/${sensor} has a malformed day cell` });
          continue;
        }
        if (seen.has(row[0])) {
          issues.push({ code: 'DUPLICATE_DAY', message: `${regionId}/${sensor} repeats day index ${row[0]}` });
        }
        seen.add(row[0]);
        if (row[0] < last) {
          issues.push({ code: 'DAYS_UNSORTED', message: `${regionId}/${sensor} day cells are not ascending` });
        }
        last = row[0];
        cells += Number(row[1]);
      }
    }
  }
  return { cells, days };
}

/**
 * Judge a staging/checkpoint pair. Returns every defect rather than the first, so an operator
 * sees the whole gap at once, and `ok` is true only when the pair may be published.
 */
export function inspectArchivePair({
  stage,
  state,
  regionIds,
  sources = SOURCES,
  acceptUnresolvedFailures = false,
  allowPartial = false,
} = {}) {
  const allowIncomplete = allowPartial || process.env.ALLOW_PARTIAL_ARCHIVE === '1' || process.argv.includes('--allow-partial');
  const issues = [];
  const push = (code, message, detail) => issues.push({ code, message, detail });

  if (!stage || typeof stage !== 'object') {
    return { ok: false, issues: [{ code: 'STAGE_UNREADABLE', message: 'staging archive is not an object' }], stats: {} };
  }
  if (!state || typeof state !== 'object' || !state.lanes || typeof state.lanes !== 'object') {
    return { ok: false, issues: [{ code: 'STATE_UNREADABLE', message: 'checkpoint has no lanes object' }], stats: {} };
  }
  if (stage.schema !== ARCHIVE_SCHEMA) push('SCHEMA', `schema is ${stage.schema}, expected ${ARCHIVE_SCHEMA}`);
  if (stage.start !== START) push('START', `archive start is ${stage.start}, expected ${START}`);
  if (!Array.isArray(regionIds) || !regionIds.length) {
    push('PLAN_UNKNOWN', 'no expected region list was supplied — cannot judge coverage');
    return { ok: false, issues, stats: {} };
  }

  const stageBatch = batchOf(stage);
  const stateBatch = batchOf(state);
  if (stageBatch !== stateBatch) {
    push('BATCH_MISMATCH', `staging is batch ${stageBatch} but the checkpoint is batch ${stateBatch}`);
  }
  const sourceProblem = sameSources(stage.sources, sources);
  if (sourceProblem) push('SOURCES_MISMATCH', sourceProblem);
  const regionProblem = sameRegions(stage.regions, regionIds);
  if (regionProblem) push('REGIONS_MISMATCH', regionProblem);

  if (typeof stage.requests !== 'number' || typeof state.requests !== 'number') {
    push('REQUESTS_MISMATCH', 'requests are not numeric on both sides');
  } else if (stage.requests !== state.requests) {
    push('REQUESTS_MISMATCH', `staging reports ${stage.requests} requests, checkpoint ${state.requests}`);
  }

  const { cells, days } = inspectCells(stage, issues);
  if (typeof stage.rows !== 'number') {
    push('ROWS_MISMATCH', 'staging has no numeric rows total');
  } else if (stage.rows !== cells) {
    push('ROWS_MISMATCH', `staging cells sum to ${cells} but the staging cursor reports ${stage.rows}`);
  }
  if (typeof state.rows !== 'number') {
    push('ROWS_MISMATCH', 'checkpoint has no numeric rows total');
  } else if (stage.rows !== state.rows) {
    push('ROWS_MISMATCH', `staging rows ${stage.rows} does not equal checkpoint rows ${state.rows}`);
  }

  const planned = planLanes(regionIds, sources);
  const plannedKeys = new Set(planned.map((lane) => lane.key));
  const actualKeys = new Set(Object.keys(state.lanes));
  for (const key of plannedKeys) {
    if (!actualKeys.has(key)) push('LANE_MISSING', `checkpoint has no cursor for ${key}`);
  }
  for (const key of actualKeys) {
    if (!plannedKeys.has(key)) push('LANE_EXTRA', `checkpoint has a cursor for unplanned lane ${key}`);
  }

  let lanesComplete = 0;
  let remainingWindows = 0;
  let failedWindows = 0;
  let failedLanes = 0;
  let doneSum = 0;

  for (const lane of planned) {
    const cursor = state.lanes[lane.key];
    if (!cursor) continue;
    const done = cursor.done;
    if (!Number.isInteger(done) || done < 0 || done > lane.windows.length) {
      push('LANE_CURSOR_INVALID', `${lane.key} cursor is ${done}, plan has ${lane.windows.length} windows`);
      continue;
    }
    doneSum += done;
    remainingWindows += lane.windows.length - done;
    const failed = cursor.failed;
    if (failed !== undefined && !Array.isArray(failed)) {
      push('FAILED_WINDOW_INVALID', `${lane.key} failed is not an array`);
    } else {
      const list = failed || [];
      const starts = new Set(lane.windows);
      const seen = new Set();
      for (const date of list) {
        if (!starts.has(date)) {
          push('FAILED_WINDOW_INVALID', `${lane.key} records failed window ${date} that is not in the plan`);
        }
        if (seen.has(date)) {
          push('FAILED_WINDOW_INVALID', `${lane.key} repeats failed window ${date}`);
        }
        seen.add(date);
      }
      if (list.length) {
        failedLanes++;
        failedWindows += list.length;
        if (!acceptUnresolvedFailures && !allowIncomplete) {
          push('FAILED_WINDOWS_UNRESOLVED', `${lane.key} still has ${list.length} failed window(s): ${list.join(', ')}`);
        }
      }
    }
    if (done === lane.windows.length) lanesComplete++;
    else if (!allowIncomplete) push('LANE_INCOMPLETE', `${lane.key} stopped at ${done}/${lane.windows.length} windows`);
  }

  if (remainingWindows > 0 && !allowIncomplete) {
    push('WINDOWS_REMAINING', `${remainingWindows} window(s) of the plan have not been attempted`);
  }
  if (typeof state.requests === 'number' && state.requests < doneSum) {
    push('REQUESTS_BELOW_CURSOR', `checkpoint reports ${state.requests} requests for ${doneSum} cursor advances`);
  }

  for (const regionId of regionIds) {
    const block = stage.regions?.[regionId];
    if (!block) continue;
    const covered = block.covered || {};
    for (const sensor of new Set(sources.map((s) => s.sensor))) {
      const want = expectedCoverage(state, regionId, sensor, sources);
      const have = covered[sensor] || [];
      if (JSON.stringify(want) !== JSON.stringify(have)) {
        push(
          'COVERAGE_MISMATCH',
          `${regionId}/${sensor} covered ranges do not match the cursors (plan ${want.length} spans, archive ${have.length})`,
        );
      }
      if (!want.length && have.length) {
        push('COVERAGE_UNEXPECTED', `${regionId}/${sensor} claims coverage with no attempted windows`);
      }
    }
    for (const sensor of Object.keys(covered)) {
      if (!sources.some((s) => s.sensor === sensor)) {
        push('COVERAGE_UNEXPECTED', `${regionId}/${sensor} covered a sensor outside the plan`);
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    stats: {
      batch: stageBatch,
      requests: stage.requests,
      rows: stage.rows,
      cells,
      days,
      sources: sources.length,
      regions: regionIds.length,
      lanesTotal: planned.length,
      lanesComplete,
      lanesIncomplete: planned.length - lanesComplete,
      remainingWindows,
      doneSum,
      failedWindows,
      failedLanes,
      generatedAt: stage.generated_at,
    },
  };
}
