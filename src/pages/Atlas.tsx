import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { AreaBar } from '../components/AreaBar';
import { RegionMap } from '../components/RegionMap';
import { Badge, Panel, PageHeader, Stat } from '../components/ui';
import {
  CalendarFrame, CalendarHeatmap, MonthBars, TrendCompare, StatusMeter, RankBars,
} from '../components/charts';
import { monthComparison, recordsInRange, livePointsForRegion, annualSeries, sensorCount } from '../lib/data';
import { MONTHS_LONG, nf, pct, riskColor, longDate, shortDate, ordinal } from '../lib/format';
import { exportCSV, exportGeoJSON, exportHotspotCSV, exportSVGAsPNG } from '../lib/export';
import { SENSOR_SHORT } from '../lib/types';

export function Atlas() {
  const store = useStore();
  const { region, records, today, live, metric, mode, split, selectedDate, setSelectedDate, frame, setFrame } = store;
  const { res: calRes, span: calSpan, focusYear, gap } = frame;
  const [month, setMonth] = useState(() => Number(today.slice(5, 7)) || 11);

  useEffect(() => {
    const m = Number(today.slice(5, 7));
    if (m >= 1 && m <= 12) setMonth(m);
  }, [today]);
  const calendarRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<SVGSVGElement>(null);

  const fires = live?.fires ?? [];
  const windowStart = live?.meta.windowStart ?? today;
  const liveRecs = useMemo(() => recordsInRange(records, windowStart, today), [records, windowStart, today]);
  const liveCount = useMemo(() => liveRecs.reduce((s, r) => s + r.harmonized, 0), [liveRecs]);
  const liveDays = useMemo(() => liveRecs.filter((r) => r.harmonized > 0).length, [liveRecs]);
  const cmp = useMemo(() => monthComparison(records, month, metric, mode, today), [records, month, metric, mode, today]);
  const trend = useMemo(() => annualSeries(records, metric, mode), [records, metric, mode]);
  const firstYear = records[0]?.year ?? 2000;
  const lastYear = records[records.length - 1]?.year ?? 2026;
  const dayRec = selectedDate ? records.find((r) => r.date === selectedDate) ?? null : null;
  const dayFires = useMemo(
    () => (selectedDate ? livePointsForRegion(region, fires, selectedDate) : livePointsForRegion(region, fires)),
    [region, fires, selectedDate],
  );
  const provisionalDays = useMemo(() => records.filter((r) => r.date >= windowStart && r.provisional).length, [records, windowStart]);
  const recordYears = useMemo(() => Array.from(new Set(records.map((r) => r.year))), [records]);

  // A shared link can name a focus year this area's record does not reach; snap it to the
  // latest year so the frame still sums real rows instead of rendering an empty comparison.
  useEffect(() => {
    if (recordYears.length && !recordYears.includes(frame.focusYear)) {
      setFrame({ focusYear: recordYears[recordYears.length - 1] });
    }
  }, [recordYears, frame.focusYear, setFrame]);

  const onExportCSV = () => {
    const out = exportCSV(region, records, store.range[0], store.range[1], mode);
    store.toast(`CSV ready — ${nf(out.rows)} daily rows · ${out.filename}`);
  };
  const onExportGeoJSON = () => {
    const out = exportGeoJSON(region, fires, windowStart, today);
    store.toast(`GeoJSON ready — ${nf(out.rows)} real hotspot geometries from the live window.`);
  };
  const onExportHotspots = () => {
    const out = exportHotspotCSV(region, fires, windowStart, today);
    store.toast(out.rows
      ? `Hotspot CSV ready — ${nf(out.rows)} detected points · ${out.filename}`
      : `Hotspot CSV ready — no detection fell inside this area in the live window · ${out.filename}`);
  };
  const onExportPNG = async () => {
    const svg = calendarRef.current?.querySelector('svg') ?? null;
    const ok = await exportSVGAsPNG(svg, `continuum_${region.id}_calendar_${today}.png`);
    store.toast(ok ? 'Calendar PNG exported at 2× resolution.' : 'PNG export failed in this browser. Use Print brief instead.');
  };
  const share = async () => {
    const url = await store.shareLink();
    store.toast(`View link copied — ${url}`);
  };

  const showLiveMap = !selectedDate;
  const bandColor = riskColor(store.status.band);

  return (
    <div className="page atlas-page">
      <PageHeader
        eyebrow={`Atlas · burning calendar · ${today}`}
        title={region.name}
        intro={region.description}
        chips={
          <>
            <Badge tone="live" pulse>LIVE FIRMS WINDOW</Badge>
            <Badge tone="default">{firstYear}–{lastYear} record</Badge>
            <Badge tone={store.status.band === 'extreme' || store.status.band === 'high' ? 'warn' : 'good'}>
              {store.status.band.toUpperCase()} · {ordinal(Math.round(store.status.percentile))} pct
            </Badge>
            {provisionalDays > 0 && <Badge tone="warn">{provisionalDays} provisional days</Badge>}
          </>
        }
        actions={
          <>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => store.setView('method')}>How the model works</button>
            <button type="button" className="btn btn-ghost btn-small" onClick={share}>Share view</button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => store.setView('outlook')}>Predict 4 weeks →</button>
            <button type="button" className="btn btn-primary btn-small" onClick={() => store.setView('brief')}>Field brief →</button>
          </>
        }
      />

      <AreaBar />

      <div className="atlas-kpi-bar" role="region" aria-label="Key record metrics">
        <div className="atlas-kpi-card" style={{ borderLeftColor: bandColor }}>
          <span className="atlas-kpi-label">Current activity</span>
          <div className="atlas-kpi-val" style={{ color: bandColor }}>{store.status.band.toUpperCase()}</div>
          <span className="atlas-kpi-sub">{ordinal(Math.round(store.status.percentile))} percentile · {MONTHS_LONG[month - 1]} MTD</span>
        </div>
        <div className="atlas-kpi-card">
          <span className="atlas-kpi-label">{MONTHS_LONG[month - 1]} vs history</span>
          <div className="atlas-kpi-val">{pct(cmp.anomalyPct)}</div>
          <span className="atlas-kpi-sub">{nf(cmp.currentValue)} now · median {nf(cmp.median)}</span>
        </div>
        <div className="atlas-kpi-card">
          <span className="atlas-kpi-label">Live window</span>
          <div className="atlas-kpi-val">{nf(liveCount)}</div>
          <span className="atlas-kpi-sub">VIIRS-eq · {liveDays} active days · {shortDate(windowStart)}–{shortDate(today)}</span>
        </div>
        <div className="atlas-kpi-card">
          <span className="atlas-kpi-label">Record depth</span>
          <div className="atlas-kpi-val">{lastYear - firstYear} <small>yr</small></div>
          <span className="atlas-kpi-sub">{nf(records.length)} daily records · {nf(provisionalDays)} prov.</span>
        </div>
      </div>

      <Panel
        title="Burning calendar"
        eyebrow={`${firstYear} → ${lastYear} · ${calRes === 'day' ? 'every cell is one day' : `one cell per ${calRes === 'quarter' ? 'three months' : calRes}`}`}
        className="calendar-panel"
        right={
          <div className="panel-controls">
            <div className="segmented segmented-compact" role="group" aria-label="Metric">
              {(['hotspots', 'firedays', 'frp'] as const).map((m) => (
                <button key={m} type="button" className={metric === m ? 'active' : ''} onClick={() => store.setMetric(m)} aria-pressed={metric === m}>
                  {store.t(m === 'hotspots' ? 'metric_hotspots' : m === 'firedays' ? 'metric_firedays' : 'metric_frp')}
                </button>
              ))}
            </div>
            <div className="segmented segmented-compact" role="group" aria-label="Sensor mode">
              <button type="button" className={mode === 'harmonized' ? 'active' : ''} onClick={() => store.setMode('harmonized')} aria-pressed={mode === 'harmonized'}>{store.t('harmonized')}</button>
              <button type="button" className={mode === 'raw' ? 'active' : ''} onClick={() => store.setMode('raw')} aria-pressed={mode === 'raw'}>{store.t('raw')}</button>
            </div>
            <button type="button" className={`btn btn-small ${split ? 'btn-live' : 'btn-ghost'}`} onClick={() => store.setSplit(!split)} aria-pressed={split}>
              {split ? 'Split on' : 'Compare'}
            </button>
          </div>
        }
      >
        <CalendarFrame
          years={recordYears}
          resolution={calRes}
          onResolution={(res) => setFrame({ res })}
          span={calSpan}
          onSpan={(span) => setFrame({ span })}
          focusYear={focusYear}
          onFocusYear={(focusYear) => setFrame({ focusYear })}
          gap={gap}
          onGap={(gap) => setFrame({ gap })}
          records={records}
          metric={metric}
          mode={mode}
          today={today}
        />
        <div ref={calendarRef} className="chart-wrap">
          <CalendarHeatmap
            records={records}
            metric={metric}
            mode={mode}
            today={today}
            selected={selectedDate}
            onSelect={setSelectedDate}
            resolution={calRes}
            span={calSpan}
          />
        </div>
        {split && (
          <div className="split-calendar">
            <div className="split-head">
              <span className="eyebrow">Raw instrument count · last 12 years</span>
              <span className="muted">The 2012 VIIRS transition is visible as a step, not a fire.</span>
            </div>
            <CalendarHeatmap
              records={records}
              metric={metric}
              mode="raw"
              today={today}
              selected={selectedDate}
              onSelect={setSelectedDate}
              yearsBack={12}
              resolution={calRes}
              span={calSpan}
            />
          </div>
        )}
        <details className="method-disclosure">
          <summary>Calibration and sensor methodology</summary>
          <div className="method-disclosure-content">
            <p>
              {mode === 'harmonized'
                ? 'Each value is a VIIRS-equivalent hotspot count summed from the daily calibrated rows behind it. Use the frame to read the record by day, week, month, quarter or year, and to match one year against another at the same point in the season.'
                : 'Raw counts are exactly what the instruments reported. The 2012 step is a sensor-resolution artifact — this is the raw uncorrected record.'}
            </p>
            <p className="panel-note-sub">
              Historical baseline spans 2000–present. MODIS Terra/Aqua counts are bridged to VIIRS S-NPP resolution using empirical biome transfer functions.
            </p>
          </div>
        </details>
      </Panel>

      <div className="grid-2">
        <Panel
          title={`${MONTHS_LONG[month - 1]} through history`}
          eyebrow="Month-to-date comparison"
          right={
            <select className="select" value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Month">
              {MONTHS_LONG.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          }
        >
          <MonthBars cmp={cmp} metric={metric} />
          <div className="mini-stats">
            <div><span>Current</span><b>{nf(cmp.currentValue)}</b></div>
            <div><span>Median</span><b>{nf(cmp.median)}</b></div>
            <div><span>5-yr mean</span><b>{nf(cmp.mean5)}</b></div>
            <div><span>10-yr mean</span><b>{nf(cmp.mean10)}</b></div>
            <div><span>Rank</span><b>{ordinal(Math.round(cmp.percentile))}</b></div>
          </div>
          <p className="panel-note">
            Bars are complete historical months; the highlighted bar is {cmp.currentYear} to date.
            Shaded band = interquartile range of the historical record.
          </p>
        </Panel>

        <Panel title="Is this normal?" eyebrow="Month-to-date percentile" right={<Badge tone={store.status.band === 'high' || store.status.band === 'extreme' ? 'warn' : 'default'}>{store.status.band}</Badge>}>
          <StatusMeter percentile={store.status.percentile} band={store.status.band} />
          <p className="status-sentence">{store.status.sentence}</p>
          <div className="mini-stats">
            <div><span>Current</span><b>{nf(store.status.current)}</b></div>
            <div><span>Median</span><b>{nf(store.status.baselineMedian)}</b></div>
            <div><span>Ratio</span><b>{store.status.ratioToMedian ? `${store.status.ratioToMedian.toFixed(2)}×` : '—'}</b></div>
            <div><span>Freshness</span><b>{store.status.freshnessDays} d</b></div>
          </div>
          <div className="scale-note">
            <span>quiet</span><span>normal</span><span>elevated</span><span>high</span><span>extreme</span>
          </div>
          <p className="panel-note">
            Thresholds are fixed percentiles of the {Math.max(1, lastYear - firstYear)}-year record, not hand-tuned alerts.
            Provisional days are counted and labelled; they are never silently dropped.
          </p>
          <button type="button" className="link-btn" onClick={() => store.setView('method')}>How this is computed →</button>
        </Panel>
      </div>

      <Panel title="The record, sensor by sensor" eyebrow="Raw versus harmonized annual totals">
        <TrendCompare records={records} mode={mode} />
        <div className="grid-2-inside">
          <div>
            <h3 className="subhead">Top years in view</h3>
            <RankBars records={records} metric={metric} mode={mode} from={store.range[0]} to={store.range[1]} />
          </div>
          <div>
            <h3 className="subhead">Annual totals</h3>
            <div className="year-grid">
              {trend.filter((t) => !t.partial).slice(-8).map((t) => (
                <div key={t.year} className="year-cell">
                  <span>{t.year}</span>
                  <b>{nf(t.value)}</b>
                </div>
              ))}
            </div>
            <p className="panel-note">Live-window days are blended into {lastYear}; the current year is marked partial everywhere it appears.</p>
          </div>
        </div>
      </Panel>

      <div className="grid-2 grid-aside">
        <Panel
          title={selectedDate ? longDate(selectedDate) : 'Live footprint'}
          eyebrow={selectedDate ? 'Day inspector' : `${shortDate(windowStart)} – ${shortDate(today)}`}
          right={
            selectedDate ? (
              <button type="button" className="link-btn" onClick={() => store.setSelectedDate(null)}>clear day</button>
            ) : (
              <span className="muted">{nf(dayFires.length)} points</span>
            )
          }
        >
          <RegionMap ref={mapRef} region={region} fires={fires} day={selectedDate} dayRecord={dayRec} onSelectDay={setSelectedDate} />
          {selectedDate && dayRec ? (
            <div className="day-detail">
              <div className="day-kpis">
                <div><span>Harmonized</span><b>{nf(dayRec.harmonized, 1)}</b></div>
                <div><span>Raw</span><b>{nf(dayRec.raw)}</b></div>
                <div><span>90% CI (harmonized)</span><b>{nf(dayRec.lo, 1)}–{nf(dayRec.hi, 1)}</b></div>
                <div><span>FRP</span><b>{nf(dayRec.frp, 1)} MW</b></div>
              </div>
              <table className="sensor-table">
                <thead><tr><th>Sensor</th><th>Detections</th><th>Role</th></tr></thead>
                <tbody>
                  <tr><td>{SENSOR_SHORT[0]}</td><td>{sensorCount(dayRec, 'modis')}</td><td>1 km pixels · 2000–present</td></tr>
                  <tr><td>{SENSOR_SHORT[1]}</td><td>{sensorCount(dayRec, 'viirs')}</td><td>375 m pixels · 2012–present</td></tr>
                  <tr><td>{SENSOR_SHORT[2]}</td><td>{sensorCount(dayRec, 'noaa20')}</td><td>375 m pixels · 2018–present</td></tr>
                  <tr><td>{SENSOR_SHORT[3]}</td><td>{sensorCount(dayRec, 'noaa21')}</td><td>375 m pixels · 2022–present</td></tr>
                </tbody>
              </table>
              <div className="chip-row">
                <Badge tone={dayRec.live ? 'live' : 'default'}>{dayRec.live ? 'LIVE OBSERVATION' : 'REFERENCE RECORD'}</Badge>
                <Badge tone={dayRec.trust === 'high' ? 'good' : 'warn'}>{dayRec.trust} trust</Badge>
                {dayRec.provisional && <Badge tone="warn">provisional</Badge>}
                <Badge tone="mute">{dayRec.source}</Badge>
              </div>
              {!dayFires.length && (
                <p className="panel-note">
                  No point geometry for this date. Hotspot coordinates exist only for the live FIRMS window; the long record is daily tabular and exported as CSV.
                </p>
              )}
            </div>
          ) : (
            <div className="day-detail">
              <p className="panel-note">
                {showLiveMap
                  ? 'Real FIRMS detections from the rolling window. Click a calendar cell to inspect a specific day; click any point on the globe to create your own AOI.'
                  : 'Select a day in the calendar to see its sensor mix, uncertainty interval and trust label.'}
              </p>
              <div className="day-kpis">
                <div><span>Live detections</span><b>{nf(dayFires.length)}</b></div>
                <div><span>Active days</span><b>{liveDays}</b></div>
                <div><span>Record median</span><b>{nf(store.status.baselineMedian)}</b></div>
                <div><span>Freshness</span><b>{store.status.freshnessDays} d</b></div>
              </div>
            </div>
          )}
        </Panel>

        <div className="aside-stack">
          <Panel title="Take the record with you" eyebrow="Open formats">
            <div className="export-grid">
              <button type="button" className="export-btn" onClick={onExportCSV}>
                <span className="export-icon">CSV</span>
                <span><strong>Daily record</strong><small>Every day in range, CI + trust + provenance</small></span>
              </button>
              <button type="button" className="export-btn" onClick={onExportGeoJSON}>
                <span className="export-icon">GEO</span>
                <span><strong>Live hotspots</strong><small>Real FIRMS points + AOI polygon</small></span>
              </button>
              <button type="button" className="export-btn" onClick={onExportHotspots}>
                <span className="export-icon">CSV</span>
                <span><strong>Hotspot table</strong><small>One row per detected point</small></span>
              </button>
              <button type="button" className="export-btn" onClick={() => void onExportPNG()}>
                <span className="export-icon">PNG</span>
                <span><strong>Calendar image</strong><small>2× resolution, shareable</small></span>
              </button>
              <button type="button" className="export-btn" onClick={() => store.setView('brief')}>
                <span className="export-icon">PDF</span>
                <span><strong>Print brief</strong><small>One-page situational report</small></span>
              </button>
            </div>
            <p className="panel-note">
              The CSV footer states the method version and splits the record by source: rows observed from the NASA FIRMS archive, rows from the live window, and the remaining days — a calibrated reconstruction, not the official NASA archive. Every row is flagged.
            </p>
          </Panel>

          <Panel title="What changed at the break" eyebrow="2012 · MODIS → VIIRS">
            <p className="mini-copy">
              VIIRS sees roughly 2–3× more hotspots than MODIS at the same fire because its pixels are nine times smaller.
              Raw counts jump at the 2012 handover; the harmonized record removes that step instead of reporting it as a fire trend.
            </p>
            <div className="mini-cta">
              <button type="button" className="btn btn-small btn-primary" onClick={() => store.setView('diagnosis')}>Open the Bias X-ray →</button>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
