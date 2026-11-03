import { useCallback, useMemo, useRef, useState, useEffect, type CSSProperties } from 'react';
import { Globe, type GlobeHandle } from '../components/Globe';
import { WorldSearch } from '../components/WorldSearch';
import { Badge, Sparkline, TableAlt } from '../components/ui';
import { useStore } from '../lib/store';
import { analogDeparture, calibrationFor, REGIONS, twinAnalogs } from '../lib/data';
import { countryWindow } from '../lib/countries';
import { SATELLITE_SPECS } from '../lib/satellites';
import { haversineKm } from '../lib/geo';
import { nf, longDate, riskColor, daysBetween, pct } from '../lib/format';
import { SENSOR_COLORS } from '../lib/types';

const SATS = SATELLITE_SPECS;
const SPEEDS = [1, 60, 600, 3600];

export function Watch() {
  const store = useStore();
  const globeRef = useRef<GlobeHandle>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(60);
  const [simMs, setSimMs] = useState(Date.now());
  const [offsetHours, setOffsetHours] = useState(0);
  const [selectedSat, setSelectedSat] = useState<string | null>('snpp');
  const [satStats, setSatStats] = useState<{ id: string; lat: number; lon: number; alt: number; covered: boolean }[]>([]);
  const [ticker, setTicker] = useState(0);

  const onTick = useCallback((ms: number) => setSimMs(ms), []);
  const onSatStats = useCallback((stats: { id: string; lat: number; lon: number; alt: number; covered: boolean }[]) => setSatStats(stats), []);
  const onSelectSat = useCallback((id: string | null) => setSelectedSat(id), []);
  const toast = store.toast;

  useEffect(() => {
    if (store.alerts.length < 2) return;
    const id = window.setInterval(() => setTicker((t) => (t + 1) % Math.min(3, store.alerts.length)), 5200);
    return () => window.clearInterval(id);
  }, [store.alerts.length]);

  const live = store.live;
  const perHour = useMemo(() => {
    if (!live) return [];
    const bins = new Array(168).fill(0);
    const end = new Date(`${live.meta.windowEnd}T23:59:59Z`).getTime() / 1000;
    for (const f of live.fires) {
      const h = Math.floor((f[5] - (end - 7 * 86400)) / 3600);
      if (h >= 0 && h < 168) bins[h]++;
    }
    return bins;
  }, [live]);

  const simDate = new Date(simMs);
  const freshness = daysBetween(store.today, new Date().toISOString().slice(0, 10));
  const alert = store.alerts[ticker];
  const sat = SATS.find((s) => s.id === selectedSat) ?? null;
  const stat = satStats.find((s) => s.id === selectedSat);
  const regionLive = useMemo(() => {
    // A country's own window is measured exactly, border to border; a hand-picked AOI falls back to
    // the detections the bundle holds inside its bbox, which is a stride sample outside the pilots.
    const cw = store.region.countryId ? countryWindow(store.region.countryId) : null;
    if (cw) return cw.total;
    if (!live) return 0;
    const days = live.meta.regionDays[store.region.id] ?? {};
    const pooled = Object.values(days).reduce((s, d) => s + d.m + d.v + d.n + (d.n21 ?? 0), 0);
    if (pooled) return pooled;
    const cal = calibrationFor(store.region, live);
    return cal ? cal.sumModis + cal.sumViirs : 0;
  }, [live, store.region.id]);

  const outlook = useMemo(() => {
    const twin = twinAnalogs(store.records, store.today);
    return { next4: analogDeparture(twin), hitRate: twin.backtestHitRate, years: twin.analogs.map((a) => a.year) };
  }, [store.records, store.today]);

  const cover = sat && stat
    ? (() => {
        const distanceKm = haversineKm([stat.lat, stat.lon], store.region.center);
        const edgeKm = (sat.swathKm / 2) * 0.92;
        return { covered: distanceKm <= edgeKm, distanceKm };
      })()
    : null;

  const handleSat = (id: string | null) => {
    setSelectedSat(id);
    if (id) globeRef.current?.focusSatellite(id);
  };

  const analyzeNadir = () => {
    if (!stat) return;
    store.selectCustom(Number(stat.lat.toFixed(2)), Number(stat.lon.toFixed(2)), 150, `${sat?.short ?? 'Satellite'} nadir`);
    store.setView('atlas');
    toast(`Now analysing the ${sat?.name ?? 'satellite'} nadir footprint.`);
  };

  return (
    <div className="watch">
      <Globe
        ref={globeRef}
        playing={playing}
        speed={speed}
        selectedSat={selectedSat}
        onSelectSat={onSelectSat}
        onTick={onTick}
        onToast={toast}
        onSatStats={onSatStats}
      />

      <div className="watch-vignette" aria-hidden />
      <div className="watch-grid">

        <section className="watch-hero">
          <div className="hero-eyebrow">
            <span className="hero-mark">◈</span> ORBITAL WATCH <span className="sep" /> 2026 NASA SPACE APPS
          </div>
          <h1>The fire record,<br /><span>repaired.</span></h1>
          <p>
            Five spacecraft. Two sensor families. One continuous, uncertainty-bearing record of burning —
            from Terra&apos;s first pass in 2000 to the VIIRS constellation overhead right now.
          </p>
          <div className="hero-actions">
            <button className="btn btn-primary" onClick={() => store.setView('atlas')}>Open the Atlas <span aria-hidden>→</span></button>
            <button className="btn btn-ghost" onClick={() => store.setView('outlook')}>Predict the future <span aria-hidden>→</span></button>
            <button className="link-btn hero-tour" onClick={() => store.setTourOpen(true)}>Judge tour</button>
          </div>
          <div className="hero-meta">
            <span><i className="live-dot" /> {live ? `${nf(live.meta.counts.kept)} real detections worldwide` : 'loading live data'}</span>
            <span className="sep" />
            <span>{live ? `${daysBetween(live.meta.windowStart, live.meta.windowEnd) + 1}-day rolling window` : '—'}</span>
            <span className="sep" />
            <span>real TLEs · SGP4</span>
          </div>
        </section>

        <section className="watch-constellation" aria-label="Satellite constellation">
          <div className="rail-head">
            <span className="eyebrow">Constellation</span>
            <button className="link-btn" onClick={() => { setOffsetHours(0); globeRef.current?.resetLive(); }}>reset view</button>
          </div>
          <div className="sat-list">
            {SATS.map((s) => {
              const st = satStats.find((x) => x.id === s.id);
              const active = selectedSat === s.id;
              return (
                <button
                  key={s.id}
                  className={`sat-row ${active ? 'active' : ''}`}
                  onClick={() => handleSat(s.id)}
                  aria-pressed={active}
                  style={{ '--sat': s.color } as CSSProperties}
                >
                  <span className="sat-orb" />
                  <span className="sat-body">
                    <span className="sat-name">{s.name}</span>
                    <span className="sat-meta">{s.sensor} · {s.pixelM} m · {st ? `${st.lat.toFixed(1)}°, ${st.lon.toFixed(1)}°` : s.overpass}</span>
                  </span>
                  <span className={`sat-status ${st?.covered ? 'ok' : ''}`} title={st?.covered ? 'Over the selected area now' : 'Not over the selected area'} />
                </button>
              );
            })}
          </div>
          {sat && (
            <div className="sat-detail">
              <div className="sat-detail-head">
                <strong style={{ color: sat.color }}>{sat.name}</strong>
                <span>{sat.agency} · {sat.era}</span>
              </div>
              <p>{sat.role}</p>
              <div className="sat-specs">
                <div><span>Altitude</span><b>{stat ? nf(stat.alt, 0) : sat.altitude} km</b></div>
                <div><span>Swath</span><b>{nf(sat.swathKm)} km</b></div>
                <div><span>Pixel</span><b>{sat.pixelM} m</b></div>
                <div><span>Overpass</span><b>{sat.overpass.split(' ')[0]}</b></div>
              </div>
              <div className="sat-cover">
                <span className={`cover-dot ${cover?.covered ? 'ok' : ''}`} />
                {store.region.shortName}: {cover?.covered ? 'inside the swath now' : `outside the swath (${nf(cover?.distanceKm ?? 0)} km from nadir)`}
              </div>
              <button className="btn btn-small btn-ghost" onClick={analyzeNadir}>Analyze nadir area →</button>
            </div>
          )}
          <div className="legend">
            <div><i style={{ background: SENSOR_COLORS[0] }} /> MODIS Terra / Aqua</div>
            <div><i style={{ background: SENSOR_COLORS[1] }} /> VIIRS S-NPP</div>
            <div><i style={{ background: SENSOR_COLORS[2] }} /> NOAA-20 VIIRS</div>
            <div><i style={{ background: SENSOR_COLORS[3] }} /> NOAA-21 VIIRS</div>
          </div>
        </section>

        <section className="watch-alert" aria-live="polite">
          <div className="eyebrow">Risk radar · {store.today}</div>
          {alert ? (
            <button className="alert-line" onClick={() => { store.selectRegion(alert.region.id); store.setView('atlas'); }}>
              <span className="alert-band" style={{ background: riskColor(alert.status.band) }} />
              <span className="alert-text">
                <strong>{alert.region.shortName}</strong> — {alert.status.band} · {Math.round(alert.status.percentile)}th percentile
              </span>
              <span className="alert-cta">inspect →</span>
            </button>
          ) : (
            <div className="muted">Computing today&apos;s risk across pilot regions…</div>
          )}
          <button className="alert-forecast" onClick={() => store.setView('outlook')}>
            <span className="alert-forecast-label">
              <span className="eyebrow">Predict the future</span>
              <span className="alert-forecast-window">next 4 weeks · median of {outlook.years.length || 3} analog seasons</span>
            </span>
            <strong style={{ color: outlook.next4 >= 0 ? 'var(--accent)' : 'var(--green)' }}>{pct(outlook.next4)}</strong>
            <span className="alert-forecast-base">{Math.round(outlook.hitRate)}% backtest hit rate</span>
            <span className="alert-forecast-go" aria-hidden>open →</span>
          </button>
          <div className="alert-foot">
            <span>Watchlist {store.watchlist.length}/7</span>
            <button className="link-btn" onClick={() => store.setAlertsOpen(true)}>alert center</button>
          </div>
        </section>

        <section className="watch-regions">
          <div className="rail-head">
            <span className="eyebrow">Pilot regions</span>
            <span className="muted">{store.region.country}</span>
          </div>
          <WorldSearch onFocusGlobe={(center) => globeRef.current?.focusRegion(center)} />
          <div className="region-chips">
            {REGIONS.map((r) => (
              <button
                key={r.id}
                className={`region-chip ${r.id === store.regionId ? 'active' : ''}`}
                onClick={() => { store.selectRegion(r.id); globeRef.current?.focusRegion(r.center); }}
              >
                {r.shortName}
              </button>
            ))}
            <button className="region-chip point" onClick={() => { store.setView('atlas'); toast('Click anywhere on the globe — land is named by its country, water becomes an open-ocean AOI.'); }}>
              + any point on Earth
            </button>
          </div>
          <div className="region-focus">
            <div>
              <div className="region-name">{store.region.name}</div>
              <div className="region-sub">{store.region.admin} · {nf(store.region.areaKm2)} km² · {store.region.biome}</div>
            </div>
            <div className="region-kpis">
              <div><span>Live window</span><b>{nf(regionLive)}</b></div>
              <div><span>Status</span><b style={{ color: riskColor(store.status.band) }}>{store.status.band}</b></div>
            </div>
          </div>
        </section>

        <section className="watch-timeline" aria-label="Simulation timeline">
          <div className="timeline-left">
            <button className="play-btn" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause simulation' : 'Play simulation'}>
              {playing ? '❚❚' : '▶'}
            </button>
            <div className="clock">
              <strong>{simDate.toISOString().slice(11, 19)}</strong>
              <span>UTC · {longDate(simDate.toISOString().slice(0, 10))}</span>
            </div>
          </div>
          <div className="timeline-mid">
            <div className="timeline-ticks" aria-hidden>
              {Array.from({ length: 13 }, (_, i) => <i key={i} />)}
            </div>
            <input
              type="range"
              min={-72}
              max={72}
              step={0.25}
              value={offsetHours}
              aria-label="Time offset in hours from live"
              onChange={(e) => {
                const hours = Number(e.target.value);
                setOffsetHours(hours);
                globeRef.current?.seek(Date.now() + hours * 3600_000);
              }}
            />
            <div className="timeline-scale"><span>−72 h</span><span>live</span><span>+72 h</span></div>
          </div>
          <div className="timeline-right">
            <div className="speeds">
              {SPEEDS.map((s) => (
                <button key={s} className={speed === s ? 'active' : ''} onClick={() => setSpeed(s)}>{s === 1 ? 'real' : `${s}×`}</button>
              ))}
            </div>
            <div className="timeline-fires">
              <Sparkline values={perHour} width={130} height={26} color="#ffb020" />
              <span>{nf(perHour.reduce((a, b) => a + b, 0))} fires / 7 d</span>
              <TableAlt
                columns={['Hour of window', 'Detections']}
                rows={perHour.map((v, i) => [`h${i + 1}`, v])}
                summary="Hourly detections table"
                note={`168 one-hour bins covering the rolling FIRMS window up to ${live?.meta.windowEnd ?? 'the window end'}. Bin 1 is the earliest hour; the sparkline plots the same series.`}
              />
            </div>
          </div>
        </section>

        <div className="watch-badges">
          <Badge tone="live" pulse>LIVE FIRMS</Badge>
          <Badge tone="default">DATA THROUGH {store.today}</Badge>
          {freshness > 2 && <Badge tone="warn">{freshness} d lag</Badge>}
          <span className="watch-sim">SIM {speed === 1 ? 'REAL TIME' : `${speed}×`} · REAL SGP4</span>
        </div>

        <div className="watch-hint">drag to rotate · scroll to zoom · click a satellite or any point</div>
      </div>
    </div>
  );
}
