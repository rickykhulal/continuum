import { memo, useMemo, useState } from 'react';
import type { DailyRecord, Metric, Mode, MonthComparison, BiasResult, SeasonClock, TwinResult, SandboxResult } from '../lib/types';
import { dailyValue, annualSeries, recordsInRange, sensorCount } from '../lib/data';
import { fireColor, rampColorSmooth, MONTHS, nf, longDate, ordinal } from '../lib/format';
import { quantile } from '../lib/random';
import { riskColor } from '../lib/format';
import { ChartTable, TableAlt } from './ui';

const CELL_W = 3.7;
const CELL_H = 15.5;

export type CalendarResolution = 'day' | 'week' | 'month' | 'quarter' | 'year';
export type CalendarSpan = 'all' | 20 | 10 | 8 | 5 | 2 | 1;

const RESOLUTIONS: { key: CalendarResolution; label: string; aria: string }[] = [
  { key: 'day', label: 'Days', aria: 'One cell per day' },
  { key: 'week', label: 'Weeks', aria: 'One cell per week' },
  { key: 'month', label: 'Months', aria: 'One cell per month' },
  { key: 'quarter', label: '3 mo', aria: 'One cell per three months' },
  { key: 'year', label: 'Years', aria: 'One bar per year' },
];

const WEEK_LABELS = Array.from({ length: 52 }, (_, i) => `W${String(i + 1).padStart(2, '0')}`);

/** Column index of a day inside its year for the chosen resolution. */
function periodIndexParts(year: number, doy: number, month: number, res: CalendarResolution): number {
  if (res === 'month') return month - 1;
  if (res === 'quarter') return Math.floor((month - 1) / 3);
  if (res === 'year') return 0;
  const lead = (new Date(Date.UTC(year, 0, 1)).getUTCDay() + 6) % 7;
  return Math.min(51, Math.floor((doy - 1 + lead) / 7));
}

function periodIndex(r: DailyRecord, res: CalendarResolution): number {
  return periodIndexParts(r.year, r.doy, r.month, res);
}

function periodLabel(res: CalendarResolution, col: number): string {
  if (res === 'month') return MONTHS[col];
  if (res === 'quarter') return `Q${col + 1}`;
  if (res === 'week') return WEEK_LABELS[col] ?? 'W52';
  return 'Year';
}

type CalendarBin = {
  year: number;
  col: number;
  total: number;
  days: number;
  peak: DailyRecord | null;
  peakValue: number;
};

function spanStart(span: CalendarSpan, currentYear: number): number {
  if (span === 'all') return 2000;
  return Math.max(2000, currentYear - span + 1);
}

function doyOf(date: string): number {
  const d = new Date(`${date}T00:00:00Z`);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((d.getTime() - start) / 86400000) + 1;
}

function sumThrough(byDoy: Float64Array | undefined, upto: number): number {
  if (!byDoy) return 0;
  let sum = 0;
  for (let i = 1; i <= upto; i++) sum += byDoy[i];
  return sum;
}

function CalendarHeatmapBase({
  records, metric, mode, today, selected, onSelect, yearsBack, resolution = 'day', span = 'all',
}: {
  records: DailyRecord[];
  metric: Metric;
  mode: Mode;
  today: string;
  selected: string | null;
  onSelect: (date: string) => void;
  yearsBack?: number;
  resolution?: CalendarResolution;
  span?: CalendarSpan;
}) {
  const [hover, setHover] = useState<DailyRecord | null>(null);
  const [hoverBin, setHoverBin] = useState<CalendarBin | null>(null);
  const [cursor, setCursor] = useState<string>(selected ?? today);
  const [lensOpen, setLensOpen] = useState(false);
  const [lensYear, setLensYear] = useState(() => Number(today.slice(0, 4)));

  const { byKey, years, max, currentYear } = useMemo(() => {
    const map = new Map<string, DailyRecord>();
    let cap = 1;
    const vals: number[] = [];
    for (const r of records) {
      map.set(`${r.year}-${r.doy}`, r);
      const v = dailyValue(r, metric, mode);
      if (v > 0) vals.push(v);
    }
    vals.sort((a, b) => a - b);
    cap = Math.max(1, quantile(vals, 0.985));
    const cy = Number(today.slice(0, 4));
    const ys: number[] = [];
    const first = yearsBack ? Math.max(2000, cy - yearsBack) : spanStart(span, cy);
    for (let y = first; y <= cy; y++) ys.push(y);
    return { byKey: map, years: ys, max: cap, currentYear: cy };
  }, [records, metric, mode, today, yearsBack, span]);

  const width = 366 * CELL_W + 40;
  const height = years.length * CELL_H + 26;

  const { bins, coverage, yearDaily } = useMemo(() => {
    const map = new Map<string, CalendarBin>();
    const covered = new Map<number, number>();
    const daily = new Map<number, { byDoy: Float64Array; total: number }>();
    for (const r of records) {
      if (r.year < years[0]) continue;
      const v = dailyValue(r, metric, mode);
      covered.set(r.year, (covered.get(r.year) ?? 0) + 1);
      let yd = daily.get(r.year);
      if (!yd) {
        yd = { byDoy: new Float64Array(367), total: 0 };
        daily.set(r.year, yd);
      }
      yd.byDoy[r.doy] += v;
      yd.total += v;
      const col = periodIndex(r, resolution);
      const key = `${r.year}:${col}`;
      let b = map.get(key);
      if (!b) {
        b = { year: r.year, col, total: 0, days: 0, peak: null, peakValue: -1 };
        map.set(key, b);
      }
      b.total += v;
      if (v > 0) b.days++;
      if (v > b.peakValue) { b.peakValue = v; b.peak = r; }
    }
    return { bins: map, coverage: covered, yearDaily: daily };
  }, [records, metric, mode, resolution, years]);

  const binCap = useMemo(() => {
    if (resolution === 'day') return max;
    const vals = [...bins.values()].map((b) => b.total).filter((v) => v > 0).sort((a, b) => a - b);
    return Math.max(1, quantile(vals, 0.985));
  }, [bins, resolution, max]);

  const aggCols = resolution === 'week' ? 52 : resolution === 'month' ? 12 : resolution === 'quarter' ? 4 : 1;
  const aggColW = resolution === 'week' ? 22 : resolution === 'month' ? 58 : 132;
  const aggRowH = 30;
  const aggLeft = 48;
  const aggW = aggLeft + aggCols * aggColW + 14;
  const aggH = 30 + years.length * aggRowH;
  const yearMax = Math.max(1, ...years.map((y) => bins.get(`${y}:0`)?.total ?? 0));
  const selYear = selected ? Number(selected.slice(0, 4)) : -1;
  const selCol = selected ? periodIndexParts(selYear, doyOf(selected), Number(selected.slice(5, 7)), resolution) : -1;
  const unit = metric === 'frp' ? 'MW' : metric === 'firedays' ? 'fire-days' : 'VIIRS-eq';

  const monthTotals = useMemo(() => {
    const byYear = new Map<number, number[]>();
    for (const r of records) {
      let arr = byYear.get(r.year);
      if (!arr) {
        arr = Array.from({ length: 12 }, () => 0);
        byYear.set(r.year, arr);
      }
      arr[r.month - 1] += dailyValue(r, metric, mode);
    }
    return byYear;
  }, [records, metric, mode]);

  const lens = useMemo(() => {
    const months: {
      month: number;
      lead: number;
      cells: { day: number; date: string; rec: DailyRecord | null; disabled: boolean }[];
      total: number;
      activeDays: number;
    }[] = [];
    let total = 0;
    let activeDays = 0;
    let peak: DailyRecord | null = null;
    let peakValue = -1;
    for (let m = 0; m < 12; m++) {
      const first = new Date(Date.UTC(lensYear, m, 1));
      const daysInMonth = new Date(Date.UTC(lensYear, m + 1, 0)).getUTCDate();
      const lead = (first.getUTCDay() + 6) % 7;
      const cells: { day: number; date: string; rec: DailyRecord | null; disabled: boolean }[] = [];
      let monthTotal = 0;
      let monthActive = 0;
      let monthPeak: DailyRecord | null = null;
      let monthPeakValue = -1;
      for (let d = 1; d <= daysInMonth; d++) {
        const date = `${lensYear}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const rec = byKey.get(`${lensYear}-${doyOf(date)}`) ?? null;
        const v = rec ? dailyValue(rec, metric, mode) : 0;
        if (v > 0) {
          monthTotal += v;
          monthActive++;
          if (v > monthPeakValue) { monthPeakValue = v; monthPeak = rec; }
        }
        cells.push({ day: d, date, rec, disabled: date > today });
      }
      total += monthTotal;
      activeDays += monthActive;
      if (monthPeak && monthPeakValue > peakValue) { peakValue = monthPeakValue; peak = monthPeak; }
      months.push({ month: m, lead, cells, total: monthTotal, activeDays: monthActive });
    }
    return { months, total, activeDays, peak, peakValue };
  }, [lensYear, byKey, metric, mode, today]);

  const cursorRec = byKey.get(`${Number(cursor.slice(0, 4))}-${doyOf(cursor)}`);
  const shown = hover ?? cursorRec ?? (records.length ? records[records.length - 1] : null);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const d = new Date(`${cursor}T00:00:00Z`);
    let delta = 0;
    if (e.key === 'ArrowRight') delta = 1;
    else if (e.key === 'ArrowLeft') delta = -1;
    else if (e.key === 'ArrowDown') delta = 7;
    else if (e.key === 'ArrowUp') delta = -7;
    else if (e.key === 'PageDown') delta = 30;
    else if (e.key === 'PageUp') delta = -30;
    else if (e.key === 'Enter') {
      onSelect(cursor);
      e.preventDefault();
      return;
    } else return;
    e.preventDefault();
    d.setUTCDate(d.getUTCDate() + delta);
    const next = d.toISOString().slice(0, 10);
    if (next <= today) setCursor(next);
  };

  const tone = (rec: DailyRecord | null) => {
    if (!rec) return 0;
    const v = dailyValue(rec, metric, mode);
    return v <= 0 ? 0 : Math.pow(Math.min(1, v / max), 0.55);
  };

  return (
    <div className="calendar-wrap">
      <div className="calendar-readout" aria-live="polite">
        {hoverBin ? (
          <>
            <strong>{hoverBin.year} · {periodLabel(resolution, hoverBin.col)}</strong>
            <span className="mono">{nf(hoverBin.total, metric === 'frp' ? 0 : 1)}</span>
            <span className="muted">{metric === 'frp' ? 'MW' : metric === 'firedays' ? 'fire-days' : 'VIIRS-eq'}</span>
            <span className="muted">· {hoverBin.days} active {hoverBin.days === 1 ? 'day' : 'days'} of the period</span>
            {hoverBin.peak && <span className="muted">· peak {longDate(hoverBin.peak.date)}</span>}
            <span className="muted">· click to open that peak day</span>
          </>
        ) : shown ? (
          <>
            <strong>{longDate(shown.date)}</strong>
            <span className="mono">{nf(dailyValue(shown, metric, mode), metric === 'frp' ? 0 : 1)}</span>
            <span className="muted">{metric === 'frp' ? 'MW' : metric === 'firedays' ? 'fire-day' : 'VIIRS-eq'}</span>
            {metric === 'hotspots' && mode === 'harmonized' && (
              <span className="muted">· 90% CI {nf(shown.lo, 1)}–{nf(shown.hi, 1)} VIIRS-eq</span>
            )}
            <span className="muted">· MODIS {sensorCount(shown, 'modis')} · S-NPP VIIRS {sensorCount(shown, 'viirs')} · NOAA-20 {sensorCount(shown, 'noaa20')} · NOAA-21 {sensorCount(shown, 'noaa21')}</span>
            <span className={`trust trust-${shown.trust}`}>{shown.trust} trust</span>
            {shown.live && <span className="badge badge-live">LIVE</span>}
            {shown.provisional && <span className="badge badge-warn">PROVISIONAL</span>}
          </>
        ) : (
          <span className="muted">Focus the grid and use arrow keys. Press Enter to open a day.</span>
        )}
      </div>

      <div className="calendar-toolbar">
        <span className="calendar-span">
          {years[0]}–{currentYear} · {resolution === 'day' ? 'every recorded day' : resolution === 'year' ? `${currentYear} bar is to date` : `one cell per ${resolution === 'quarter' ? 'three months' : resolution}`}
        </span>
        <button
          type="button"
          className="calendar-lens-toggle"
          aria-expanded={lensOpen}
          aria-controls="year-lens"
          onClick={() => setLensOpen((v) => !v)}
        >
          <span className={`lens-chevron ${lensOpen ? 'open' : ''}`} aria-hidden>⌄</span>
          {lensOpen ? 'Collapse year lens' : `Open ${currentYear} year lens`}
        </button>
      </div>

      <div
        className="calendar-scroll"
        role="application"
        aria-label={`Burning calendar, ${years[0]} to ${currentYear}. Arrow keys move the cursor, Enter opens a day.`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => setCursor(selected ?? today)}
        onMouseLeave={() => setHoverBin(null)}
      >
        {resolution === 'day' ? (
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="calendar-svg">
            {MONTHS.map((m, i) => {
              const doy = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335][i];
              return (
                <g key={m}>
                  <line x1={40 + (doy - 1) * CELL_W} x2={40 + (doy - 1) * CELL_W} y1={16} y2={height - 8} className="cal-month-rule" />
                  <text x={40 + doy * CELL_W} y={9} className="cal-month">{m}</text>
                </g>
              );
            })}
            {years.map((yr, row) => {
              const y = 22 + row * CELL_H;
              return (
                <g key={yr}>
                  <text x={2} y={y + 11} className="cal-year" fontWeight="600">{yr}</text>
                  {Array.from({ length: 366 }, (_, i) => {
                    const doy = i + 1;
                    const rec = byKey.get(`${yr}-${doy}`);
                    const x = 40 + i * CELL_W;
                    if (!rec) {
                      return <rect key={doy} x={x} y={y} width={CELL_W - 0.8} height={CELL_H - 1.6} className="cal-nodata" rx={0.6} />;
                    }
                    const v = dailyValue(rec, metric, mode);
                    const t = v <= 0 ? 0 : Math.pow(Math.min(1, v / max), 0.55);
                    const isSel = rec.date === selected;
                    const isCur = rec.date === cursor;
                    return (
                      <rect
                        key={doy}
                        x={x} y={y} width={CELL_W - 0.8} height={CELL_H - 1.6} rx={0.6}
                        fill={v <= 0 ? 'rgba(90,120,150,.10)' : metric === 'frp' ? fireColor(t) : rampColorSmooth(t)}
                        stroke={isSel ? '#f5f5f7' : isCur ? 'rgba(255,255,255,.55)' : 'transparent'}
                        strokeWidth={isSel ? 1.3 : 0.6}
                        className="cal-cell"
                        tabIndex={-1}
                        onMouseEnter={() => setHover(rec)}
                        onMouseLeave={() => setHover(null)}
                        onClick={() => {
                          setCursor(rec.date);
                          onSelect(rec.date);
                        }}
                      />
                    );
                  })}
                </g>
              );
            })}
            <line x1={40} y1={height - 4} x2={width} y2={height - 4} stroke="rgba(140,180,220,.16)" />
          </svg>
        ) : resolution === 'year' ? (
          <svg width={1080} height={years.length * 26 + 26} viewBox={`0 0 1080 ${years.length * 26 + 26}`} preserveAspectRatio="xMinYMin meet" className="calendar-svg calendar-years" role="img" aria-label={`One bar per year, ${years[0]} to ${currentYear}. ${currentYear} is to date; its change is matched to the same day of the previous year.`}>
            {years.map((yr, row) => {
              const bin = bins.get(`${yr}:0`);
              const total = yearDaily.get(yr)?.total ?? 0;
              const prevD = yearDaily.get(yr - 1);
              const curCover = coverage.get(yr) ?? 0;
              const prevCover = coverage.get(yr - 1) ?? 0;
              const y = 18 + row * 26;
              const w = (total / yearMax) * 760;
              let delta: number | null = null;
              if (yr === currentYear) {
                const cut = doyOf(today);
                const a = sumThrough(yearDaily.get(yr)?.byDoy, cut);
                const b = sumThrough(prevD?.byDoy, cut);
                delta = prevCover >= 300 && b > 0 ? ((a - b) / b) * 100 : null;
              } else if (curCover >= 300 && prevCover >= 300) {
                const prevTotal = prevD?.total ?? 0;
                delta = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null;
              }
              const isCur = yr === currentYear;
              const isSel = yr === selYear;
              return (
                <g
                  key={yr}
                  className="cal-year-row"
                  role="button"
                  tabIndex={-1}
                  aria-label={`${yr}${isCur ? ' to date' : ''}: ${nf(total)} ${unit}${delta === null ? '' : `, ${delta >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(delta))} percent on ${isCur ? 'the same window of ' : ''}${yr - 1}`}`}
                  onMouseEnter={() => setHoverBin(bin ?? null)}
                  onMouseLeave={() => setHoverBin(null)}
                  onClick={() => {
                    if (!bin?.peak) return;
                    setCursor(bin.peak.date);
                    onSelect(bin.peak.date);
                  }}
                >
                  <text x={2} y={y + 12} className={`cal-year ${isCur ? 'now' : ''}`}>{yr}{isCur ? ' ·' : ''}</text>
                  <rect x={64} y={y + 2} width={760} height={15} rx={3.5} className="cal-year-track" />
                  {total > 0 && (
                    <rect
                      x={64} y={y + 2} width={Math.max(2, w)} height={15} rx={3.5}
                      fill={isCur ? '#ffb020' : rampColorSmooth(Math.pow(total / yearMax, 0.6))}
                      opacity={isSel ? 1 : 0.88}
                      stroke={isSel ? '#f5f5f7' : 'transparent'}
                      strokeWidth={1}
                    />
                  )}
                  <text x={846} y={y + 13} className="cal-year-total">{nf(total)}</text>
                  {isCur && <text x={912} y={y + 13} className="cal-year-todate">to date</text>}
                  {delta !== null && (
                    <text x={998} y={y + 13} className={`cal-year-delta ${delta >= 0 ? 'up' : 'down'}`}>
                      {delta >= 0 ? '+' : ''}{Math.round(delta)}%
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        ) : (
          <svg width={aggW} height={aggH} viewBox={`0 0 ${aggW} ${aggH}`} preserveAspectRatio="xMinYMin meet" className="calendar-svg calendar-aggregate" role="img" aria-label={`${resolution} totals by year, ${years[0]} to ${currentYear}`}>
            {Array.from({ length: aggCols }, (_, c) => {
              const x = aggLeft + c * aggColW;
              const show = resolution !== 'week' || c % 6 === 0;
              return show ? (
                <text key={c} x={x + aggColW / 2} y={13} className="cal-month" textAnchor="middle">
                  {periodLabel(resolution, c)}
                </text>
              ) : null;
            })}
            {years.map((yr, row) => {
              const y = 26 + row * aggRowH;
              return (
                <g key={yr}>
                  <text x={2} y={y + aggRowH / 2 + 4} className="cal-year">{yr}</text>
                  {Array.from({ length: aggCols }, (_, c) => {
                    const bin = bins.get(`${yr}:${c}`);
                    const total = bin?.total ?? 0;
                    const x = aggLeft + c * aggColW;
                    const t = total <= 0 ? 0 : Math.pow(Math.min(1, total / binCap), 0.55);
                    const isSel = yr === selYear && c === selCol;
                    return (
                      <g
                        key={c}
                        className="cal-cell"
                        onMouseEnter={() => setHoverBin(bin ?? null)}
                        onMouseLeave={() => setHoverBin(null)}
                        onClick={() => {
                          if (!bin?.peak) return;
                          setCursor(bin.peak.date);
                          onSelect(bin.peak.date);
                        }}
                      >
                        <rect
                          x={x} y={y} width={aggColW - 3} height={aggRowH - 4} rx={4}
                          fill={!bin ? 'transparent' : total <= 0 ? 'rgba(90,120,150,.10)' : metric === 'frp' ? fireColor(t) : rampColorSmooth(t)}
                          stroke={isSel ? '#f5f5f7' : 'transparent'}
                          strokeWidth={1.2}
                          className={!bin ? 'cal-nodata' : ''}
                        />
                        {aggColW >= 50 && total > 0 && (
                          <text x={x + (aggColW - 3) / 2} y={y + aggRowH / 2 + 3} textAnchor="middle" className="cal-bin-value" style={{ fill: t > 0.5 ? '#07131e' : undefined }}>
                            {nf(total, 0)}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <div className="calendar-legend">
        <span className="muted">low</span>
        {Array.from({ length: 16 }, (_, i) => (
          <i key={i} style={{ background: metric === 'frp' ? fireColor(i / 16) : rampColorSmooth(i / 16) }} />
        ))}
        <span className="muted">high</span>
        <span className="cal-nodata-key"><i />no data</span>
      </div>

      {lensOpen && (
        <section className="calendar-lens" id="year-lens" aria-label={`${lensYear} year lens`}>
          <header className="lens-head">
            <div className="lens-title">
              <span className="eyebrow">Year lens</span>
              <strong>{lensYear}</strong>
              <span className="muted">12 months · daily cells</span>
            </div>
            <div className="lens-nav" role="group" aria-label="Year lens navigation">
              <button type="button" className="icon-btn" aria-label="Previous year" disabled={lensYear <= years[0]} onClick={() => setLensYear((y) => Math.max(years[0], y - 1))}>←</button>
              <select
                className="select select-small"
                value={lensYear}
                aria-label="Year lens year"
                onChange={(e) => setLensYear(Number(e.target.value))}
              >
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <button type="button" className="icon-btn" aria-label="Next year" disabled={lensYear >= currentYear} onClick={() => setLensYear((y) => Math.min(currentYear, y + 1))}>→</button>
            </div>
          </header>
          <div className="lens-kpis">
            <div><span>Year total</span><b>{nf(lens.total)}</b></div>
            <div><span>Active days</span><b>{nf(lens.activeDays)}</b></div>
            <div><span>Peak day</span><b>{lens.peak ? longDate(lens.peak.date).replace(/,.*$/, '') : '—'}</b></div>
            <div><span>Peak value</span><b>{lens.peak ? nf(lens.peakValue, metric === 'frp' ? 0 : 1) : '—'} <small>{metric === 'frp' ? 'MW' : metric === 'firedays' ? 'fire-days' : 'VIIRS-eq'}</small></b></div>
          </div>
          <div className="lens-months">
            {lens.months.map((m) => (
              <div key={m.month} className="lens-month">
                <div className="lens-month-head">
                  <strong>{MONTHS[m.month]}</strong>
                  <span>{nf(m.total)}</span>
                </div>
                <div className="lens-weekdays" aria-hidden>
                  {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i}>{d}</span>)}
                </div>
                <div className="lens-grid">
                  {Array.from({ length: m.lead }, (_, i) => <span key={`lead${i}`} className="lens-blank" />)}
                  {m.cells.map((c) => {
                    const t = tone(c.rec);
                    const v = c.rec ? dailyValue(c.rec, metric, mode) : 0;
                    const isSel = c.rec?.date === selected;
                    const isCur = c.rec?.date === cursor;
                    const fill = v <= 0 ? 'rgba(120,140,160,.12)' : metric === 'frp' ? fireColor(t) : rampColorSmooth(t);
                    return (
                      <button
                        key={c.day}
                        type="button"
                        className={`lens-day ${isSel ? 'selected' : ''} ${isCur ? 'cursor' : ''}`}
                        style={{ background: fill, color: t > 0.52 ? '#07131e' : undefined }}
                        disabled={c.disabled || !c.rec}
                        aria-label={`${longDate(c.date)} — ${c.rec ? `${nf(v, metric === 'frp' ? 0 : 1)} ${metric === 'frp' ? 'megawatts' : metric === 'firedays' ? 'fire-days' : 'VIIRS-equivalent detections'}` : 'no record'}`}
                        onMouseEnter={() => c.rec && setHover(c.rec)}
                        onMouseLeave={() => setHover(null)}
                        onFocus={() => c.rec && setHover(c.rec)}
                        onBlur={() => setHover(null)}
                        onClick={() => {
                          if (!c.rec) return;
                          setCursor(c.rec.date);
                          onSelect(c.rec.date);
                        }}
                      >
                        {c.day}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <p className="panel-note">
            The year lens is the same record at reading scale: each tile is one day, weekends sit in the last two
            columns, and empty tiles are days the record does not cover. Select any day here to open it in the inspector.
          </p>
        </section>
      )}

      <TableAlt
        columns={['Year', ...MONTHS, 'Year total']}
        rows={years.map((yr) => {
          const arr = monthTotals.get(yr) ?? Array.from({ length: 12 }, () => 0);
          const total = arr.reduce((s, v) => s + v, 0);
          return [yr, ...arr.map((v) => nf(v)), nf(total)];
        })}
        note={`Monthly sums of the ${metric} series in ${mode} mode, ${years[0]}–${currentYear}. The grid colours are daily values; the table reports the monthly totals behind them.`}
      />
    </div>
  );
}

export const CalendarHeatmap = memo(CalendarHeatmapBase);

/**
 * The reading frame: how the record is binned, how far back it runs, and which year it is
 * compared against. Every total here is summed from the same daily rows the grid draws, and
 * the comparison is cut at the same day of year on both sides so a partial year cannot
 * masquerade as a decline.
 */
export function CalendarFrame({
  years, resolution, onResolution, span, onSpan, focusYear, onFocusYear, gap, onGap, records, metric, mode, today,
}: {
  years: number[];
  resolution: CalendarResolution;
  onResolution: (r: CalendarResolution) => void;
  span: CalendarSpan;
  onSpan: (s: CalendarSpan) => void;
  focusYear: number;
  onFocusYear: (y: number) => void;
  gap: number;
  onGap: (g: 0 | 1 | 5 | 10) => void;
  records: DailyRecord[];
  metric: Metric;
  mode: Mode;
  today: string;
}) {
  const currentYear = Number(today.slice(0, 4));
  const cutoffDoy = focusYear === currentYear ? doyOf(today) : 366;
  const cmp = useMemo(() => {
    const focus = Array.from({ length: 12 }, () => 0);
    const ref = Array.from({ length: 12 }, () => 0);
    const refYear = focusYear - gap;
    let fTotal = 0;
    let rTotal = 0;
    for (const r of records) {
      if (r.doy > cutoffDoy) continue;
      const v = dailyValue(r, metric, mode);
      if (r.year === focusYear) {
        focus[r.month - 1] += v;
        fTotal += v;
      } else if (gap > 0 && r.year === refYear) {
        ref[r.month - 1] += v;
        rTotal += v;
      }
    }
    const peak = Math.max(1, ...focus, ...ref);
    return { focus, ref, refYear, fTotal, rTotal, peak };
  }, [records, metric, mode, focusYear, gap, cutoffDoy]);

  const delta = cmp.rTotal > 0 ? ((cmp.fTotal - cmp.rTotal) / cmp.rTotal) * 100 : null;
  const cutoffLabel = focusYear === currentYear
    ? `1 Jan – ${Number(today.slice(8, 10))} ${MONTHS[Number(today.slice(5, 7)) - 1]}`
    : 'the full year';
  const gapOptions = [1, 5, 10].filter((g) => focusYear - g >= (years[0] ?? 2000));

  return (
    <div className="calendar-frame">
      <div className="frame-row">
        <div className="frame-group">
          <span className="frame-label">Read as</span>
          <div className="segmented segmented-compact" role="group" aria-label="Calendar resolution">
            {RESOLUTIONS.map((r) => (
              <button
                key={r.key}
                type="button"
                className={resolution === r.key ? 'active' : ''}
                aria-pressed={resolution === r.key}
                title={r.aria}
                onClick={() => onResolution(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <label className="frame-field">
          <span>Span</span>
          <select className="select select-small" value={span} onChange={(e) => onSpan(e.target.value === 'all' ? 'all' : Number(e.target.value) as CalendarSpan)}>
            <option value={8}>Last 8 years (daily)</option>
            <option value="all">Full 26-year view</option>
            <option value={20}>Last 20 years</option>
            <option value={10}>Last 10 years</option>
            <option value={5}>Last 5 years</option>
            <option value={2}>Last 2 years</option>
            <option value={1}>1 year</option>
          </select>
        </label>
        <label className="frame-field">
          <span>Focus year</span>
          <select className="select select-small" value={focusYear} onChange={(e) => onFocusYear(Number(e.target.value))}>
            {years.slice().reverse().map((y) => <option key={y} value={y}>{y}{y === currentYear ? ' · to date' : ''}</option>)}
          </select>
        </label>
        <label className="frame-field">
          <span>Compare</span>
          <select className="select select-small" value={gap} onChange={(e) => onGap(Number(e.target.value) as 0 | 1 | 5 | 10)}>
            <option value={0}>Off</option>
            {gapOptions.map((g) => <option key={g} value={g}>With {focusYear - g} (−{g}y)</option>)}
          </select>
        </label>
      </div>

      {gap > 0 && (
        <div className="frame-compare" aria-live="polite">
          <div className="compare-head">
            <strong>{focusYear} against {cmp.refYear}</strong>
            <span className="muted">matched window · {cutoffLabel}</span>
            {delta !== null && (
              <span className={`compare-delta ${delta >= 0 ? 'up' : 'down'}`}>
                {delta >= 0 ? '+' : ''}{delta.toFixed(1)}% total
              </span>
            )}
          </div>
          <div className="compare-kpis">
            <div><span>{focusYear}</span><b>{nf(cmp.fTotal)}</b></div>
            <div><span>{cmp.refYear}</span><b>{nf(cmp.rTotal)}</b></div>
            <div className="compare-legend"><span><i className="focus" />{focusYear}</span><span><i className="ref" />{cmp.refYear}</span></div>
          </div>
          <div className="compare-bars" role="img" aria-label={`Month-by-month comparison, ${focusYear} against ${cmp.refYear}`}>
            {cmp.focus.map((v, i) => (
              <div key={i} className="compare-month">
                <div className="compare-pair">
                  <i
                    className="focus"
                    style={{ height: `${(v / cmp.peak) * 100}%` }}
                    title={`${MONTHS[i]} ${focusYear}: ${nf(v)} ${unitFor(metric)}`}
                  />
                  <i
                    className="ref"
                    style={{ height: `${(cmp.ref[i] / cmp.peak) * 100}%` }}
                    title={`${MONTHS[i]} ${cmp.refYear}: ${nf(cmp.ref[i])} ${unitFor(metric)}`}
                  />
                </div>
                <span>{MONTHS[i].slice(0, 1)}</span>
              </div>
            ))}
          </div>
          <p className="compare-note">
            Both sides stop at the same day of year, so a half-finished {currentYear} is never compared with a full
            {' '}{cmp.refYear}. Bars are monthly sums in {mode} mode; the totals above are the matched window.
          </p>
        </div>
      )}
    </div>
  );
}

function unitFor(metric: Metric): string {
  return metric === 'frp' ? 'MW' : metric === 'firedays' ? 'fire-days' : 'VIIRS-eq';
}

export function MonthBars({ cmp, metric }: { cmp: MonthComparison; metric: Metric }) {
  const width = 860;
  const height = 280;
  const padL = 48;
  const padB = 30;
  const padT = 18;
  const n = cmp.years.length;
  const max = Math.max(...cmp.years.map((y) => y.value), cmp.p75 * 1.2, 1);
  const bw = (width - padL - 16) / Math.max(1, n);
  const y = (v: number) => padT + (1 - v / max) * (height - padT - padB);
  const medianY = y(cmp.median);
  const unit = metric === 'frp' ? 'MW' : '';

  return (
    <ChartTable
      columns={['Year', 'Month total', 'Basis']}
      rows={cmp.years.map((yr) => [yr.year, nf(yr.value), yr.partial ? 'month to date' : 'full month'])}
      note={`Median ${nf(cmp.median)} · 25th ${nf(cmp.p25)} · 75th ${nf(cmp.p75)}. ${cmp.currentYear} sits at the ${ordinal(Math.round(cmp.percentile))} percentile of the comparable years. Metric: ${metric}.`}
    >
    <svg viewBox={`0 0 ${width} ${height}`} className="chart" role="img" aria-label={`Month comparison. ${cmp.currentYear} is ${ordinal(Math.round(cmp.percentile))} percentile versus the historical median.`}>
      <rect x={padL} y={y(cmp.p75)} width={width - padL - 16} height={Math.max(1, y(cmp.p25) - y(cmp.p75))} fill="rgba(110,231,255,.08)" />
      <line x1={padL} x2={width - 16} y1={medianY} y2={medianY} stroke="#6ee7ff" strokeDasharray="4 4" strokeOpacity={0.7} />
      <text x={padL + 4} y={medianY - 5} className="axis-label">median {nf(cmp.median)} {unit}</text>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={padL} x2={width - 16} y1={y(max * f)} y2={y(max * f)} stroke="rgba(140,180,220,.1)" />
          <text x={padL - 8} y={y(max * f) + 3} className="axis-label" textAnchor="end">{nf(max * f)}</text>
        </g>
      ))}
      {cmp.years.map((yr, i) => {
        const x = padL + i * bw + bw * 0.16;
        const w = bw * 0.68;
        const partial = yr.partial;
        const isCur = yr.year === cmp.currentYear;
        return (
          <g key={yr.year}>
            <rect
              x={x} y={y(yr.value)} width={w} height={height - padB - y(yr.value)}
              fill={isCur ? '#ffb020' : partial ? 'rgba(110,231,255,.35)' : 'rgba(110,231,255,.16)'}
              stroke={isCur ? '#ffd27a' : 'rgba(110,231,255,.28)'}
              rx={1.5}
            >
              <title>{yr.year}: {nf(yr.value)} {unit}{partial ? ' (month to date)' : ''}</title>
            </rect>
            {(i % 2 === 0 || isCur) && (
              <text x={x + w / 2} y={height - 10} className="axis-label" textAnchor="middle">
                {String(yr.year).slice(2)}
              </text>
            )}
          </g>
        );
      })}
      <text x={padL} y={height - 1} className="axis-label">Months since 2000 · highlighted bar is {cmp.currentYear}</text>
    </svg>
    </ChartTable>
  );
}

export function TrendCompare({ records, mode }: { records: DailyRecord[]; mode: Mode }) {
  const raw = annualSeries(records, 'hotspots', 'raw');
  const harm = annualSeries(records, 'hotspots', 'harmonized');
  const width = 860;
  const height = 260;
  const padL = 44;
  const padB = 28;
  const padT = 16;
  const max = Math.max(...raw.map((r) => r.value), ...harm.map((r) => r.value), 1) * 1.08;
  const years = raw.map((r) => r.year);
  const x = (yr: number) => padL + ((yr - years[0]) / Math.max(1, years[years.length - 1] - years[0])) * (width - padL - 20);
  const y = (v: number) => padT + (1 - v / max) * (height - padT - padB);
  const path = (s: { year: number; value: number }[]) => s.map((d, i) => `${i ? 'L' : 'M'}${x(d.year).toFixed(1)},${y(d.value).toFixed(1)}`).join(' ');
  const area = `${path(raw)} L${x(raw[raw.length - 1].year)},${y(0)} L${x(raw[0].year)},${y(0)} Z`;
  const breakX = x(2012);

  return (
    <ChartTable
      columns={['Year', 'Raw sensor record', 'Harmonized (VIIRS-eq)', 'Harmonized minus raw']}
      rows={raw.map((d) => {
        const h = harm.find((x) => x.year === d.year);
        const diff = h ? h.value - d.value : 0;
        return [d.year, nf(d.value), nf(h?.value ?? 0), `${diff >= 0 ? '+' : ''}${nf(diff)}`];
      })}
      note="Raw is the single-sensor count summed per year; harmonized is the VIIRS-equivalent series. The step at 2012 is the instrument change, not a change in burning."
    >
    <svg viewBox={`0 0 ${width} ${height}`} className="chart" role="img" aria-label="Raw versus harmonized annual hotspots with the 2012 sensor transition marked.">
      <defs>
        <linearGradient id="gap" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff7a45" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#ff7a45" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <rect x={breakX} y={padT} width={width - breakX - 20} height={height - padT - padB} fill="rgba(245,166,35,0.04)" />
      <line x1={breakX} x2={breakX} y1={padT} y2={height - padB} stroke="var(--amber)" strokeDasharray="3 4" strokeOpacity={0.9} />
      <text x={breakX + 6} y={padT + 12} className="axis-label" fill="var(--amber)" fontWeight="600">2012: VIIRS handover</text>
      <path d={area} fill="url(#gap)" />
      <path d={path(raw)} fill="none" stroke="#ff7a45" strokeWidth={1.8} strokeOpacity={0.9} />
      <path d={path(harm)} fill="none" stroke="#38bdf8" strokeWidth={2.2} />
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={padL} x2={width - 20} y1={y(max * f)} y2={y(max * f)} stroke="var(--line)" />
          <text x={padL - 8} y={y(max * f) + 4} textAnchor="end" className="axis-label">{nf(max * f)}</text>
        </g>
      ))}
      {years.filter((_, i) => i % 4 === 0).map((yr) => (
        <text key={yr} x={x(yr)} y={height - 8} textAnchor="middle" className="axis-label">{yr}</text>
      ))}
      <g transform={`translate(${width - 210},${padT + 4})`}>
        <rect x={0} y={0} width={190} height={56} fill="var(--bg-2)" stroke="var(--line-strong)" rx={4} />
        <line x1={8} x2={24} y1={14} y2={14} stroke="#ff7a45" strokeWidth={2} />
        <text x={30} y={17} className="axis-label">raw sensor record</text>
        <line x1={8} x2={24} y1={28} y2={28} stroke="#38bdf8" strokeWidth={2} />
        <text x={30} y={31} className="axis-label">harmonized (VIIRS-eq)</text>
        <text x={8} y={47} className="axis-label" fill="var(--muted)">active view: {mode}</text>
      </g>
    </svg>
    </ChartTable>
  );
}

export function Waterfall({ bias }: { bias: BiasResult }) {
  const width = 860;
  const height = 280;
  const padL = 26;
  const padR = 22;
  const padT = 58;
  const padB = 54;
  const short: Record<string, string> = {
    resolution: 'Resolution',
    overpass: 'Rescaled',
    sensitivity: 'Sensitivity',
    residual: 'Residual',
  };
  const total = bias.rawBreakPct - bias.correctedBreakPct;
  let run = 0;
  const steps = bias.components.map((c) => {
    const from = run;
    run += c.value;
    return { key: c.key, label: short[c.key] ?? c.label, value: c.value, lo: c.lo, hi: c.hi, from, to: run };
  });
  const items = [...steps, { key: 'total', label: 'Total removed', value: total, lo: total, hi: total, from: 0, to: total }];
  const lows = steps.map((s) => s.from + Math.min(s.lo, s.value, 0));
  const highs = steps.map((s) => s.from + Math.max(s.hi, s.value, 0));
  const minV = Math.min(0, ...lows);
  const maxV = Math.max(total, ...highs, 1);
  const plotH = height - padT - padB;
  const y = (v: number) => padT + ((maxV - v) / (maxV - minV)) * plotH;
  const bw = (width - padL - padR) / items.length;

  return (
    <ChartTable
      columns={['Component', 'Contribution', 'Attribution band']}
      rows={items.map((it) => [
        it.label,
        `${it.value > 0 ? '+' : ''}${it.value.toFixed(1)} pp`,
        it.key === 'total' ? '—' : `${it.lo.toFixed(1)} to ${it.hi.toFixed(1)} pp`,
      ])}
      note={`Raw 2012 break ${bias.rawBreakPct.toFixed(1)}% reduced to ${bias.correctedBreakPct.toFixed(1)}%; ${bias.reductionPct.toFixed(0)}% of the artefact removed. Weights come from measured ratios in this record; bands scale with the 90% interval on the bridge ratio.`}
    >
    <svg viewBox={`0 0 ${width} ${height}`} className="chart" role="img" aria-label="Bias X-ray waterfall: attributed components and the total 2012 break removed.">
      <text x={padL} y={16} className="axis-label">Raw 2012 break {bias.rawBreakPct.toFixed(1)}% → corrected {bias.correctedBreakPct.toFixed(1)}% · {bias.reductionPct.toFixed(0)}% removed</text>
      <text x={padL} y={31} className="axis-label" opacity={0.62}>bar height = percentage-point contribution; whiskers = scaled by the 90% interval on the bridge ratio</text>
      {minV < 0 && <line x1={padL} x2={width - padR} y1={y(0)} y2={y(0)} stroke="rgba(160,200,240,.28)" />}
      {items.map((it, i) => {
        const x = padL + i * bw + bw * 0.2;
        const w = bw * 0.6;
        const top = Math.min(y(it.from), y(it.to));
        const h = Math.max(2, Math.abs(y(it.to) - y(it.from)));
        const positive = it.value >= 0;
        const isTotal = it.key === 'total';
        return (
          <g key={it.key}>
            {i > 0 && (
              <line x1={x - bw * 0.2} x2={x} y1={y(it.from)} y2={y(it.from)} stroke="rgba(160,200,240,.25)" strokeDasharray="3 4" />
            )}
            <rect x={x} y={top} width={w} height={h} rx={2}
              fill={isTotal ? 'rgba(110,231,255,.5)' : positive ? 'rgba(255,122,69,.55)' : 'rgba(74,168,255,.5)'}
              stroke={isTotal ? '#6ee7ff' : positive ? '#ff9a6a' : '#79c0ff'} />
            {!isTotal && (
              <>
                <line x1={x + w * 0.2} x2={x + w * 0.8} y1={y(it.from + it.hi)} y2={y(it.from + it.hi)} stroke="rgba(220,240,255,.7)" />
                <line x1={x + w * 0.2} x2={x + w * 0.8} y1={y(it.from + it.lo)} y2={y(it.from + it.lo)} stroke="rgba(220,240,255,.7)" />
                <line x1={x + w / 2} x2={x + w / 2} y1={y(it.from + it.hi)} y2={y(it.from + it.lo)} stroke="rgba(220,240,255,.35)" />
              </>
            )}
            <text x={x + w / 2} y={height - 32} textAnchor="middle" className="axis-label">{it.label}</text>
            <text x={x + w / 2} y={height - 14} textAnchor="middle" className="axis-value" fill={isTotal ? '#9fe9ff' : positive ? '#ffb08a' : '#9fd0ff'}>
              {it.value > 0 ? '+' : ''}{it.value.toFixed(1)} pp
            </text>
          </g>
        );
      })}
    </svg>
    </ChartTable>
  );
}

export function SeasonDial({ clock, size = 300 }: { clock: SeasonClock; size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 34;
  const angle = (doy: number) => ((doy - 1) / 365) * Math.PI * 2 - Math.PI / 2;
  const pt = (doy: number, radius: number) => [cx + Math.cos(angle(doy)) * radius, cy + Math.sin(angle(doy)) * radius];
  const arc = (a: number, b: number, radius: number) => {
    const [x1, y1] = pt(a, radius);
    const [x2, y2] = pt(b, radius);
    const large = (b - a + 365) % 365 > 182 ? 1 : 0;
    return `M${x1},${y1} A${radius},${radius} 0 ${large} 1 ${x2},${y2}`;
  };
  const todayDoy = ((clock.peakDoy + clock.currentOffsetDays - 1 + 365) % 365) + 1;
  const [mx, my] = pt(todayDoy, r);
  const [px, py] = pt(clock.peakDoy, r);

  return (
    <ChartTable
      columns={['Season clock', 'Value']}
      rows={[
        ['Typical start', clock.startLabel],
        ['Typical peak', clock.peakLabel],
        ['Typical end', clock.endLabel],
        ['Peak day of year', clock.peakDoy],
        ['Current phase', clock.phase],
        ['Versus climatology', clock.direction],
        ['Offset from peak (days)', clock.currentOffsetDays],
        ['Share of expected activity so far', `${clock.yearShare.toFixed(0)}%`],
      ]}
      note="Positions are day-of-year values computed from this area's own record."
    >
    <svg viewBox={`0 0 ${size} ${size}`} className="chart dial" role="img" aria-label={`Season clock: typical start ${clock.startLabel}, peak ${clock.peakLabel}, end ${clock.endLabel}.`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(120,160,200,.16)" />
      {MONTHS.map((m, i) => {
        const [tx, ty] = pt((i * 30.4) + 15, r + 16);
        return <text key={m} x={tx} y={ty} className="axis-label" textAnchor="middle">{m}</text>;
      })}
      <path d={arc(clock.startDoy, clock.endDoy, r)} fill="none" stroke="rgba(255,176,32,.18)" strokeWidth={16} strokeLinecap="round" />
      <path d={arc(clock.startDoy, clock.endDoy, r)} fill="none" stroke="rgba(255,176,32,.75)" strokeWidth={2} strokeDasharray="2 4" />
      <circle cx={px} cy={py} r={8} fill="#ffb020" />
      <circle cx={px} cy={py} r={14} fill="none" stroke="#ffb020" strokeOpacity={0.35} />
      <circle cx={mx} cy={my} r={5} fill="#6ee7ff" />
      <text x={cx} y={cy - 16} textAnchor="middle" className="dial-label">PEAK</text>
      <text x={cx} y={cy + 6} textAnchor="middle" className="dial-value">{clock.peakLabel}</text>
      <text x={cx} y={cy + 28} textAnchor="middle" className="dial-sub">{clock.phase} · {clock.direction}</text>
      <text x={cx} y={size - 10} textAnchor="middle" className="dial-sub">{clock.yearShare.toFixed(0)}% of expected activity so far</text>
    </svg>
    </ChartTable>
  );
}

export function SandboxChart({ result }: { result: SandboxResult }) {
  const width = 860;
  const height = 250;
  const padL = 48;
  const padB = 30;
  const padT = 22;
  const n = Math.min(90, result.truth.length);
  const start = Math.max(0, result.truth.length - n);
  const truth = result.truth.slice(start);
  const apparent = result.apparent.slice(start);
  const corrected = result.corrected.slice(start);
  const max = Math.max(...truth, ...apparent, ...corrected, 1) * 1.08;
  const x = (i: number) => padL + (i / Math.max(1, n - 1)) * (width - padL - 22);
  const y = (v: number) => padT + (1 - v / max) * (height - padT - padB);
  const line = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  return (
    <ChartTable
      columns={['Simulated day', 'True activity', 'Apparent sensor count', 'Corrected estimate']}
      rows={truth.map((v, i) => [start + i + 1, v.toFixed(1), apparent[i].toFixed(1), corrected[i].toFixed(1)])}
      summary={`Table of the ${n} simulated days shown`}
      note={`Apparent counts carry a ${result.rawBiasPct.toFixed(0)}% bias; after correction the mean absolute recovery error is ${result.recoveryError.toFixed(1)}%. Day numbers index the simulated series, not calendar dates.`}
    >
    <svg viewBox={`0 0 ${width} ${height}`} className="chart" role="img" aria-label={`Sensor sandbox. Apparent counts are biased by ${result.rawBiasPct.toFixed(0)} percent; after correction the 7-day mean absolute recovery error is ${result.recoveryError.toFixed(1)} percent.`}>
      <defs>
        <linearGradient id="sandboxTruth" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={padL} x2={width - 22} y1={y(max * f)} y2={y(max * f)} stroke="rgba(140,180,220,.1)" />
          <text x={padL - 8} y={y(max * f) + 3} textAnchor="end" className="axis-label">{nf(max * f)}</text>
        </g>
      ))}
      <path d={`${line(truth)} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill="url(#sandboxTruth)" />
      <path d={line(truth)} fill="none" stroke="#ffffff" strokeWidth={1.6} strokeOpacity={0.9} />
      <path d={line(apparent)} fill="none" stroke="#ff7a45" strokeWidth={1.8} strokeDasharray="4 3" />
      <path d={line(corrected)} fill="none" stroke="#6ee7ff" strokeWidth={1.4} strokeOpacity={0.9} />
      <text x={padL} y={14} className="axis-label">last 90 simulated days · truth vs. what the sensor reports vs. after correction</text>
      <g transform={`translate(${width - 258},${padT + 4})`}>
        <rect x={0} y={0} width={246} height={54} rx={4} fill="rgba(6,12,20,.78)" stroke="rgba(140,180,220,.18)" />
        <line x1={8} x2={24} y1={12} y2={12} stroke="#fff" strokeWidth={2} />
        <text x={30} y={15} className="axis-label">true activity</text>
        <line x1={8} x2={24} y1={27} y2={27} stroke="#ff7a45" strokeWidth={2} strokeDasharray="3 2" />
        <text x={30} y={30} className="axis-label">apparent sensor count</text>
        <line x1={8} x2={24} y1={42} y2={42} stroke="#6ee7ff" strokeWidth={2} />
        <text x={30} y={45} className="axis-label">corrected estimate</text>
      </g>
    </svg>
    </ChartTable>
  );
}

export function TwinChart({ twin }: { twin: TwinResult }) {
  const width = 860;
  const height = 250;
  const padL = 46;
  const padB = 30;
  const padT = 18;
  const all = [...twin.observed, ...twin.analogs.flatMap((a) => a.values)];
  const max = Math.max(...all, 1) * 1.05;
  const years = twin.observed.length + 4;
  const x = (i: number) => padL + (i / Math.max(1, years - 1)) * (width - padL - 24);
  const y = (v: number) => padT + (1 - v / max) * (height - padT - padB);
  const line = (vals: number[], from = 0) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(from + i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const colors = ['#6ee7ff', '#a78bfa', '#7dd3fc'];

  return (
    <ChartTable
      columns={['Week', 'Current season', ...twin.analogs.map((a) => String(a.year))]}
      rows={twin.observed.map((v, i) => [
        twin.weeks[i] ?? `W${i + 1}`,
        nf(v),
        ...twin.analogs.map((a) => nf(a.values[i] ?? 0)),
      ])}
      note={`Analogs: ${twin.analogs.map((a) => `${a.year} (${Math.round(a.similarity)}% similar, next four weeks ${a.next4WeeksAnomalyPct >= 0 ? '+' : ''}${a.next4WeeksAnomalyPct.toFixed(0)}%)`).join('; ')}. Leave-one-out hit rate ${Math.round(twin.backtestHitRate)}% over ${twin.sampleYears} seasons.`}
    >
    <svg viewBox={`0 0 ${width} ${height}`} className="chart" role="img" aria-label="Current weekly activity versus the closest analog seasons, with the next four weeks left open.">
      <rect x={x(twin.observed.length - 1)} y={padT} width={width - x(twin.observed.length - 1) - 24} height={height - padT - padB} fill="rgba(255,176,32,.05)" />
      <line x1={x(twin.observed.length - 1)} x2={x(twin.observed.length - 1)} y1={padT} y2={height - padB} stroke="#ffb020" strokeDasharray="3 4" strokeOpacity={0.6} />
      <text x={x(twin.observed.length - 1) + 8} y={padT - 4} className="axis-label" fill="#ffb020">next 4 weeks</text>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={padL} x2={width - 24} y1={y(max * f)} y2={y(max * f)} stroke="rgba(140,180,220,.1)" />
          <text x={padL - 8} y={y(max * f) + 3} textAnchor="end" className="axis-label">{nf(max * f)}</text>
        </g>
      ))}
      {twin.analogs.map((a, i) => (
        <g key={a.year}>
          <path d={line(a.values)} fill="none" stroke={colors[i % colors.length]} strokeWidth={1.5} strokeOpacity={0.75} />
          <path d={line([a.values[a.values.length - 1], a.values[a.values.length - 1] * (1 + a.next4WeeksAnomalyPct / 100)] , twin.observed.length - 1)} fill="none" stroke={colors[i % colors.length]} strokeWidth={1.3} strokeDasharray="4 4" strokeOpacity={0.6} />
        </g>
      ))}
      <path d={line(twin.observed)} fill="none" stroke="#ffffff" strokeWidth={2.6} />
      {twin.observed.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r={2.6} fill="#fff" />
      ))}
      {twin.observed.map((_, i) => (
        <text key={i} x={x(i)} y={height - 8} textAnchor="middle" className="axis-label">{twin.weeks[i]}</text>
      ))}
      <g transform={`translate(${width - 206},${padT + 14})`}>
        <rect x={-8} y={-10} width={196} height={twin.analogs.length * 15 + 12} rx={4} fill="rgba(6,12,20,.82)" stroke="rgba(140,180,220,.18)" />
        {twin.analogs.map((a, i) => (
          <g key={a.year} transform={`translate(0,${i * 15})`}>
            <line x1={0} x2={14} y1={5} y2={5} stroke={colors[i % colors.length]} strokeWidth={2} />
            <text x={19} y={8} className="axis-label">{a.year} · {Math.round(a.similarity)}%</text>
          </g>
        ))}
      </g>
    </svg>
    </ChartTable>
  );
}

export function StatusMeter({ percentile, band }: { percentile: number; band: string }) {
  const width = 420;
  const height = 56;
  const x = 8 + (Math.min(100, Math.max(0, percentile)) / 100) * (width - 16);
  return (
    <ChartTable
      columns={['Measure', 'Value']}
      rows={[
        ['Percentile of historical record', Math.round(percentile)],
        ['Band', band],
      ]}
      summary="Table of the status position"
      note="The percentile is this area's month-to-date value ranked against its own history for the same calendar window."
    >
    <svg viewBox={`0 0 ${width} ${height}`} className="chart meter" role="img" aria-label={`Percentile ${Math.round(percentile)} of the historical record, ${band}.`}>
      <defs>
        <linearGradient id="meterGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#3d6f9c" />
          <stop offset="35%" stopColor="#56d6a0" />
          <stop offset="70%" stopColor="#ffc247" />
          <stop offset="100%" stopColor="#ff4d4d" />
        </linearGradient>
      </defs>
      <rect x={8} y={22} width={width - 16} height={10} rx={5} fill="url(#meterGrad)" opacity={0.9} />
      <line x1={x} x2={x} y1={12} y2={42} stroke="#fff" strokeWidth={2} />
      <circle cx={x} cy={27} r={7} fill="#fff" />
      <text x={8} y={10} className="axis-label">quiet</text>
      <text x={width - 8} y={10} textAnchor="end" className="axis-label">extreme</text>
      <text x={x} y={52} textAnchor="middle" className="axis-value">{ordinal(Math.round(percentile))} · {band}</text>
    </svg>
    </ChartTable>
  );
}

export function RankBars({ records, metric, mode, from, to }: { records: DailyRecord[]; metric: Metric; mode: Mode; from: string; to: string }) {
  const recs = recordsInRange(records, from, to);
  const byYear = new Map<number, number>();
  for (const r of recs) byYear.set(r.year, (byYear.get(r.year) ?? 0) + dailyValue(r, metric, mode));
  const sorted = [...byYear.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = sorted[0]?.[1] ?? 1;
  return (
    <div className="rankbars">
      {sorted.map(([yr, v]) => (
        <div key={yr} className="rankbar">
          <span>{yr}</span>
          <div><i style={{ width: `${(v / max) * 100}%` }} /></div>
          <b>{nf(v)}</b>
        </div>
      ))}
      <TableAlt
        columns={['Rank', 'Year', 'Total', 'Share of the highest year']}
        rows={sorted.map(([yr, v], i) => [i + 1, yr, nf(v), `${((v / max) * 100).toFixed(0)}%`])}
        summary="Table of the ranked years"
        note={`Top ${sorted.length} years for ${metric} in ${mode} mode, ${from} to ${to}.`}
      />
    </div>
  );
}

export function anomalyColor(pct: number): string {
  if (pct >= 75) return riskColor('extreme');
  if (pct >= 35) return riskColor('high');
  if (pct >= 5) return riskColor('elevated');
  if (pct >= -20) return riskColor('normal');
  return '#6f8fae';
}
