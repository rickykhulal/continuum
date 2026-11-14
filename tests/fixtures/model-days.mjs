/**
 * Synthetic model-day records for the two science invariants that the promoted
 * FIRMS archive no longer exercises. See docs/ARCHIVE_PROMOTION_INVARIANT_NOTE.md.
 *
 * The unloosened checks count days (`rescaled > 1000`, `pooled.length > 100`),
 * so the dense series is 1,100 MODIS-only days plus 120 NOAA days. A ~200-row
 * series cannot meet both thresholds. Every count is a pure function of the
 * index. Nothing here is random, and nothing is labelled live or archive.
 *
 * Bridge used by the fixtures: H = 10 × MODIS on a MODIS-only day, and
 * H = Suomi-NPP + NOAA-20 + NOAA-21 whenever any VIIRS spacecraft is present.
 * MODIS is never added on top of that sum.
 */

export const MODEL_BRIDGE_K = 10;

function iso(dayIndex) {
  const t = Date.UTC(2001, 0, 1) + dayIndex * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

function dayOfYear(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000) + 1;
}

function record(dayIndex, counts) {
  const date = iso(dayIndex);
  const [year, month] = date.split('-').map(Number);
  const viirsTotal = counts.viirs + counts.noaa20 + counts.noaa21;
  return {
    date,
    year,
    month,
    doy: dayOfYear(date),
    modis: counts.modis,
    viirs: counts.viirs,
    noaa20: counts.noaa20,
    noaa21: counts.noaa21,
    raw: viirsTotal > 0 ? viirsTotal : counts.modis,
    harmonized: counts.harmonized,
    lo: 0,
    hi: counts.harmonized,
    frp: 0,
    trust: 'high',
    provisional: false,
    source: 'model',
    live: false,
  };
}

const modisOnlyDense = Array.from({ length: 1100 }, (_, i) => {
  const modis = 101 + (i % 5);
  return record(i, {
    modis,
    viirs: 0,
    noaa20: 0,
    noaa21: 0,
    harmonized: modis * MODEL_BRIDGE_K,
  });
});

const noaaDense = Array.from({ length: 120 }, (_, i) => {
  const viirs = 40 + (i % 3);
  const noaa20 = i % 2 === 0 ? 40 : 0;
  const noaa21 = i % 2 === 1 ? 40 : 35;
  return record(1100 + i, {
    modis: 25,
    viirs,
    noaa20,
    noaa21,
    harmonized: viirs + noaa20 + noaa21,
  });
});

/** 1,220 model days. Every MODIS-only harmonized value is > 1000. NOAA days: 120. */
export const modelDaysDense = [...modisOnlyDense, ...noaaDense];

const modisOnlySparse = Array.from({ length: 30 }, (_, i) => {
  const modis = 10 + (i % 4);
  return record(i, {
    modis,
    viirs: 0,
    noaa20: 0,
    noaa21: 0,
    // Missing the bridge: the invariant must reject an unscaled MODIS day.
    harmonized: modis,
  });
});

const noaaSparse = Array.from({ length: 20 }, (_, i) => {
  const viirs = 5 + (i % 2);
  const noaa20 = 4;
  const noaa21 = 3;
  const modis = 8;
  return record(30 + i, {
    modis,
    viirs,
    noaa20,
    noaa21,
    // MODIS stacked on the VIIRS platforms: the double-count the invariant forbids.
    harmonized: modis + viirs + noaa20 + noaa21,
  });
});

/** 50 model days that miss both day-count thresholds and break both formulas. */
export const modelDaysSparse = [...modisOnlySparse, ...noaaSparse];
