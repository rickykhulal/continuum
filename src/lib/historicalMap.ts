import type { DailyRecord, SensorId, SensorKey } from './types';

const KEYS: SensorKey[] = ['modis', 'viirs', 'noaa20', 'noaa21'];

/** Regional values only: archive counts carry coverage, and model values retain provenance. */
export function historicalMapSummary(record: DailyRecord | null | undefined, date: string, sensor: SensorId | 'all') {
  if (!record || record.date !== date) return null;
  const reconstructed = record.source === 'model' || record.source === 'blend';
  const keys = sensor === 'all' ? KEYS : [KEYS[sensor]];
  const covered = keys.filter(key => reconstructed || record.observed?.[key] === true);
  return {
    label: reconstructed ? 'RECONSTRUCTION' : record.source === 'archive' ? 'ARCHIVE' : 'OBSERVED',
    reconstructed,
    detections: covered.length ? covered.reduce((sum, key) => sum + record[key], 0) : null,
    partial: covered.length < keys.length,
    harmonized: record.harmonized,
    provisional: record.provisional,
  };
}
