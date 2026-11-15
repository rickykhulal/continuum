import { useMemo } from 'react';
import { useStore } from '../lib/store';
import { AreaBar } from '../components/AreaBar';
import { Badge, Panel, PageHeader } from '../components/ui';
import { CalendarHeatmap, StatusMeter } from '../components/charts';
import { analogDepartureSummary, biasXray, monthComparison, recordsInRange, statusFor, twinAnalogs, seasonClock } from '../lib/data';
import { MONTHS_LONG, longDate, nf, pct, riskColor, ordinal } from '../lib/format';
import { exportCSV } from '../lib/export';
import { downloadPdf } from '../lib/pdf';

/** Shared wording for the rendered brief and its copied/text/PDF advisory. */
export function briefAnalogSummary(twin: Parameters<typeof analogDepartureSummary>[0]) {
  const statistics = analogDepartureSummary(twin);
  const medianText = statistics.median == null ? 'unavailable' : pct(statistics.median);
  const meanText = statistics.mean == null ? 'unavailable' : pct(statistics.mean);
  return {
    ...statistics, medianText, meanText,
    headline: `Median next-four-week departure ${medianText}.`,
    supplementary: `Supplementary mean next-four-week departure ${meanText} across ${statistics.sampleSize} available analog seasons.`,
  };
}

function cleanName(s: string): string {
  return s.replace(/[^a-z0-9\-]+/gi, '-').replace(/-+/g, '-').toLowerCase();
}

export function Brief() {
  const store = useStore();
  const { region, records, today, live } = store;
  const status = store.status;
  const month = Number(today.slice(5, 7));
  const cmp = useMemo(() => monthComparison(records, month, 'hotspots', 'harmonized', today), [records, month, today]);
  const bias = useMemo(() => biasXray(records), [records]);
  const twin = useMemo(() => twinAnalogs(records, today, 8), [records, today]);
  const clock = useMemo(() => seasonClock(records, Number(today.slice(0, 4)), today), [records, today]);
  const liveRecs = useMemo(() => recordsInRange(records, live?.meta.windowStart ?? today, today), [records, live, today]);
  const liveSum = liveRecs.reduce((s, r) => s + r.harmonized, 0);
  const liveDays = liveRecs.filter((r) => r.harmonized > 0).length;
  const next4 = briefAnalogSummary(twin);
  const bandColor = status.band === 'normal' ? '#1b7a4c' : riskColor(status.band);
  const area = store.region.shortName;

  const advisory = useMemo(() => {
    const lines = [
      'CONTINUUM — BURNING ACTIVITY ADVISORY',
      `Generated ${new Date().toISOString().slice(0, 10)} · research prototype · NOT an official NASA product`,
      '',
      `AREA: ${region.name} (${region.country})`,
      `CENTRE: ${region.center[0].toFixed(2)}°, ${region.center[1].toFixed(2)}° · ${nf(region.areaKm2)} km²`,
      `RECORD: ${records[0]?.date ?? '2000-11-01'} to ${today} · ${nf(records.length)} harmonized daily values`,
      '',
      `STATUS: ${status.band.toUpperCase()} — ${ordinal(Math.round(status.percentile))} percentile for the first ${status.windowDays} days of ${MONTHS_LONG[month - 1]}.`,
      `Current ${nf(status.current)} vs. historical median ${nf(status.baselineMedian)} (${status.ratioToMedian.toFixed(2)}×).`,
      '',
      `LIVE WINDOW: ${liveRecs[0]?.date ?? '—'} to ${today}; ${nf(liveSum)} VIIRS-equivalent detections across ${liveDays} active days.`,
      `Sensor calibration: MODIS → VIIRS ratio ${bias.ratio.toFixed(2)}× (90% CI ${bias.ratioLo.toFixed(2)}–${bias.ratioHi.toFixed(2)}); the 2012 break in the raw record is ${bias.rawBreakPct.toFixed(0)}%, reduced to ${bias.correctedBreakPct.toFixed(0)}% after harmonization.`,
      `Analog seasons: ${twin.analogs.map((a) => `${a.year} (${Math.round(a.similarity)}%)`).join(', ')}. ${next4.headline} ${next4.supplementary} Leave-one-out hit rate ${Math.round(twin.backtestHitRate)}%.`,
      `Season: typical window ${clock.startLabel}–${clock.endLabel}, peak ${clock.peakLabel}; current phase ${clock.phase}, running ${clock.direction} of climatology (${Math.round(clock.yearShare)}% of expected to date).`,
      '',
      'WHAT WOULD CHANGE THE CALL:',
      `• A shift in the live window outside the ${bias.ratioLo.toFixed(1)}–${bias.ratioHi.toFixed(1)} calibration interval would widen the uncertainty and lower trust.`,
      '• Cloud cover or missed overpasses can hide fire; absence of detections is not absence of fire.',
      '• This advisory ranks activity against the same area\'s own history. It does not model ignition, spread or suppression.',
      '',
      `METHOD VERSION 0.1.0 · reference record calibrated to the live FIRMS window, not the official NASA archive.`,
      `Caveat: ${status.provisional ? 'The latest days are provisional.' : 'No provisional days in the current window.'} Supports situational awareness; not a warning, dispatch or evacuation service.`,
    ];
    return lines.join('\n');
  }, [region, records, today, status, month, liveRecs, liveSum, liveDays, bias, twin, next4, clock]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(advisory);
      store.toast('Advisory copied to the clipboard.');
    } catch {
      store.toast('Clipboard blocked by the browser. Use Print brief to capture the text.');
    }
  };

  const downloadText = () => {
    const blob = new Blob([advisory], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `continuum_advisory_${cleanName(region.shortName)}_${today}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    store.toast('Advisory downloaded as a text file.');
  };

  const downloadPdfFile = () => {
    const ok = downloadPdf(
      advisory.split('\n'),
      `continuum_advisory_${cleanName(region.shortName)}_${today}.pdf`,
    );
    store.toast(
      ok ? 'Advisory downloaded as a PDF.' : 'PDF download is unavailable in this browser. Use Print / PDF instead.',
    );
  };

  return (
    <div className="page brief-page">
      <PageHeader
        eyebrow="Brief · printable situational report"
        title="One page. Every number traceable."
        intro="A field-ready summary generated from the same record as every other screen. Print it, copy it, or export the underlying rows."
        className="no-print"
        actions={
          <>
            <button type="button" className="btn btn-ghost btn-small" onClick={copy}>Copy advisory</button>
            <button type="button" className="btn btn-ghost btn-small" onClick={downloadText}>Download .txt</button>
            <button type="button" className="btn btn-ghost btn-small" onClick={downloadPdfFile}>Download PDF</button>
            <button type="button" className="btn btn-primary btn-small" onClick={() => window.print()}>Print Brief</button>
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={() => {
                const out = exportCSV(region, records, store.range[0], store.range[1], store.mode);
                store.toast(`CSV ready — ${nf(out.rows)} rows.`);
              }}
            >
              Export CSV
            </button>
          </>
        }
      />

      <div className="no-print"><AreaBar compact /></div>

      <article className="brief-sheet" id="brief-sheet">
        <header className="brief-head">
          <div>
            <div className="brief-brand">◈ CONTINUUM <span>FIRE RECORD DOCTOR</span></div>
            <h2>BURNING ACTIVITY ADVISORY</h2>
            <div className="brief-sub">{region.name} · {region.admin}, {region.country}</div>
          </div>
          <div className="brief-stamp">
            <span>RESEARCH ADVISORY</span>
            <strong>NOT AN OFFICIAL WARNING</strong>
            <small>{longDate(today)}</small>
          </div>
        </header>

        <div className="brief-meta">
          <span><b>Centre</b> {region.center[0].toFixed(2)}°, {region.center[1].toFixed(2)}°</span>
          <span><b>Area</b> {nf(region.areaKm2)} km²</span>
          <span><b>Record Span</b> {records[0]?.year ?? 2000}–{today.slice(0, 4)}</span>
          <span><b>Comparison Baseline</b> {records[0]?.year ?? 2000}–{Number(today.slice(0, 4)) - 1}</span>
          <span><b>Method</b> v0.1.0</span>
          <span><b>Data through</b> {today}</span>
        </div>

        <div className="brief-hero">
          <div className="brief-status" style={{ borderColor: bandColor }}>
            <div className="eyebrow">Month-to-date status</div>
            <div className="brief-band" style={{ color: bandColor }}>{status.band.toUpperCase()}</div>
            <div className="brief-pct">{ordinal(Math.round(status.percentile))} percentile</div>
            <StatusMeter percentile={status.percentile} band={status.band} />
          </div>
          <div className="brief-numbers">
            <div><span>Current month</span><b>{nf(status.current)}</b></div>
            <div><span>Historical median</span><b>{nf(status.baselineMedian)}</b></div>
            <div><span>Ratio to median</span><b>{status.ratioToMedian ? `${status.ratioToMedian.toFixed(2)}×` : '—'}</b></div>
            <div><span>Live window</span><b>{nf(liveSum)}</b></div>
            <div><span>Analog median next 4 wk</span><b style={{ color: next4.median == null ? undefined : next4.median >= 0 ? '#ff8a3d' : '#56d6a0' }}>{next4.medianText}</b></div>
            <div><span>Weather source</span><b>NASA POWER</b></div>
          </div>
        </div>

        <section className="brief-section">
          <h3>Assessment</h3>
          <p>{status.sentence}</p>
          <p>
            The raw sensor record overstates the 2012 change by {Math.abs(bias.rawBreakPct).toFixed(0)}%. After overlap-ratio
            harmonization, the residual break is {bias.correctedBreakPct.toFixed(0)}% — {Math.round(bias.reductionPct)}% of the
            artefact removed. The correction is recomputed for this area, with a 90% calibration interval of
            {' '}{bias.ratioLo.toFixed(2)}–{bias.ratioHi.toFixed(2)}×. The current month sits at the {ordinal(Math.round(cmp.percentile))}
            percentile of {cmp.years.filter((y) => !y.partial).length} comparable years; {cmp.currentYear} is shown to date, never as a complete month.
          </p>
          <p>
            Analog seasons {twin.analogs.map((a) => a.year).join(', ')} are the closest matches to the last eight weeks.
            {' '}{next4.headline} {next4.supplementary} The leave-one-out hit rate is {Math.round(twin.backtestHitRate)}%
            over {twin.sampleYears} seasons. The typical burning window is {clock.startLabel}–{clock.endLabel}, peaking {clock.peakLabel};
            the current season is in its {clock.phase} phase, running {clock.direction} of climatology
            ({Math.round(clock.yearShare)}% of expected activity to date).
          </p>
        </section>

        <section className="brief-section">
          <h3>The calendar, at a glance</h3>
          <div className="brief-calendar">
            <CalendarHeatmap
              records={records}
              metric="hotspots"
              mode="harmonized"
              today={today}
              selected={null}
              onSelect={() => undefined}
              yearsBack={12}
            />
          </div>
          <div className="brief-sensor-row">
            <div><span>MODIS</span><b>{nf(liveRecs.reduce((s, r) => s + r.modis, 0))}</b></div>
            <div><span>VIIRS S-NPP</span><b>{nf(liveRecs.reduce((s, r) => s + r.viirs, 0))}</b></div>
            <div><span>NOAA-20</span><b>{nf(liveRecs.reduce((s, r) => s + r.noaa20, 0))}</b></div>
            <div><span>NOAA-21</span><b>{nf(liveRecs.reduce((s, r) => s + r.noaa21, 0))}</b></div>
            <div><span>Active days</span><b>{liveDays}/{liveRecs.length}</b></div>
            <div><span>Calibration</span><b>{bias.ratio.toFixed(2)}×</b></div>
          </div>
        </section>

        <section className="brief-section brief-two-col">
          <div>
            <h3>What would change the call</h3>
            <ul>
              <li>A live-window ratio outside {bias.ratioLo.toFixed(1)}–{bias.ratioHi.toFixed(1)}× would widen intervals and lower trust.</li>
              <li>Persistent cloud or a missed overpass can hide fire; no detection is not no fire.</li>
              <li>This is an activity ranking against the same area&apos;s history — not an ignition, spread or evacuation model.</li>
              <li>Provisional days: {status.provisional ? 'the latest days are provisional and labelled.' : 'none in the current window.'}</li>
            </ul>
          </div>
          <div>
            <h3>Provenance</h3>
            <ul>
              <li>Live detections: NASA FIRMS rolling 7-day public CSV (MODIS C6.1, VIIRS C2).</li>
              <li>Long record: NASA FIRMS archive detections wherever the keyed backfill reaches (<code>npm run archive</code>); the remaining days are a deterministic reconstruction calibrated to the live window, not the official NASA archive. Each exported row carries its source.</li>
              <li>Orbits: real TLEs propagated with SGP4; NOAA-20, NOAA-21, Suomi NPP, Terra, Aqua.</li>
              <li>Weather: NASA POWER daily MERRA-2 (T2M, PRECTOTCORR, RH2M).</li>
            </ul>
          </div>
        </section>

        <footer className="brief-foot">
          <div>
            <strong>Continuum — The Fire Record Doctor</strong>
            <span>Supports situational awareness and research. Not an official warning, dispatch, or evacuation service.</span>
          </div>
          <div className="brief-qr">
            <span>Share this view</span>
            <code>{store.shareUrl.replace(/^https?:\/\//, '').slice(0, 58)}</code>
          </div>
        </footer>
      </article>

      <Panel title="Advisory text" eyebrow="Copy-ready, plain text" className="no-print">
        <pre className="advisory-pre">{advisory}</pre>
        <div className="chip-row">
          <button type="button" className="btn btn-small btn-primary" onClick={copy}>Copy advisory</button>
          <button type="button" className="btn btn-small btn-ghost" onClick={downloadText}>Download .txt</button>
          <button type="button" className="btn btn-small btn-ghost" onClick={downloadPdfFile}>Download PDF</button>
          <button type="button" className="btn btn-small btn-ghost" onClick={() => window.print()}>Print / PDF</button>
        </div>
        <p className="panel-note">
          The advisory is generated client-side from the current view. It carries the method version and the non-official
          status in the text itself, so it cannot be mistaken for an official product when forwarded.
        </p>
      </Panel>
    </div>
  );
}
