import { useCallback, useMemo, useRef, useState, useEffect, type CSSProperties } from 'react';
import { Globe, type GlobeHandle } from '../components/Globe';
import { WorldSearch } from '../components/WorldSearch';
import { Sparkline, TableAlt } from '../components/ui';
import { useStore } from '../lib/store';
import { analogDeparture, calibrationFor, REGIONS, twinAnalogs } from '../lib/data';
import { countryWindow } from '../lib/countries';
import { SATELLITE_SPECS } from '../lib/satellites';
import { haversineKm } from '../lib/geo';
import { nf, longDate, riskColor, daysBetween, pct, ordinal } from '../lib/format';
import { SENSOR_COLORS } from '../lib/types';

const SATS = SATELLITE_SPECS;
const SPEEDS = [1, 60, 600, 3600];

type WatchTab = 'constellation' | 'radar' | 'regions';

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
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<WatchTab>('constellation');

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

      {/* Floating unboxed hero - stays strictly top-left, never overlaps globe center */}
      <div className="watch-hero-clean">
        <div className="watch-hero-eyebrow">
          <span className="hero-mark">◈</span> ORBITAL OBSERVATORY <span className="sep" /> 2000–{new Date().getFullYear()}
        </div>
        <h1 className="watch-hero-title">
          The fire record,<br />
          <span className="accent-text">repaired.</span>
        </h1>
        <p className="watch-hero-copy">
          Five spacecraft. Two sensor families. One continuous, uncertainty-bearing record of burning from Terra to VIIRS.
        </p>
        <div className="watch-hero-actions">
          <button type="button" className="btn btn-primary" onClick={() => store.setView('atlas')}>
            Open the Atlas <span aria-hidden>→</span>
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => store.setView('outlook')}>
            Predict the future <span aria-hidden>→</span>
          </button>
        </div>
        <div className="watch-hero-stats">
          <span className="hero-stat-live">
            <i className="live-dot" />
            {live ? `${nf(live.meta.counts.kept)} real detections worldwide` : 'Syncing live FIRMS window'}
          </span>
          <span className="hero-stat-sep">·</span>
          <span>Real TLEs & SGP4 orbits</span>
        </div>
      </div>

      {/* Collapsible Mission Dock on the right */}
      {sidePanelOpen && (
        <aside className="watch-side-dock" aria-label="Mission controls and details">
          <div className="side-dock-head">
            <div className="side-dock-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'constellation'}
                className={`side-tab ${activeTab === 'constellation' ? 'active' : ''}`}
                onClick={() => setActiveTab('constellation')}
              >
                Constellation
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'radar'}
                className={`side-tab ${activeTab === 'radar' ? 'active' : ''}`}
                onClick={() => setActiveTab('radar')}
              >
                Risk Radar
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'regions'}
                className={`side-tab ${activeTab === 'regions' ? 'active' : ''}`}
                onClick={() => setActiveTab('regions')}
              >
                Pilot Regions
              </button>
            </div>
            <button
              type="button"
              className="side-dock-close"
              onClick={() => setSidePanelOpen(false)}
              aria-label="Collapse panel"
            >
              ✕
            </button>
          </div>

          <div className="side-dock-body">
            {activeTab === 'constellation' && (
              <div className="dock-section">
                <div className="rail-head">
                  <span className="eyebrow">Active Satellites</span>
                  <button type="button" className="link-btn" onClick={() => { setOffsetHours(0); globeRef.current?.resetLive(); }}>
                    reset view
                  </button>
                </div>
                <div className="sat-list">
                  {SATS.map((s) => {
                    const st = satStats.find((x) => x.id === s.id);
                    const active = selectedSat === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className={`sat-row ${active ? 'active' : ''}`}
                        onClick={() => handleSat(s.id)}
                        aria-pressed={active}
                        style={{ '--sat': s.color } as CSSProperties}
                      >
                        <span className="sat-orb" />
                        <span className="sat-body">
                          <span className="sat-name">{s.name}</span>
                          <span className="sat-meta">{s.sensor} · {s.pixelM}m · {st ? `${st.lat.toFixed(1)}°, ${st.lon.toFixed(1)}°` : s.overpass}</span>
                        </span>
                        <span className={`sat-status ${st?.covered ? 'ok' : ''}`} title={st?.covered ? 'Over target area' : 'Outside swath'} />
                      </button>
                    );
                  })}
                </div>
                {sat && (
                  <div className="sat-detail">
                    <div className="sat-detail-head">
                      <strong style={{ color: sat.color }}>{sat.name}</strong>
                      <span className="mono">{sat.agency} · {sat.era}</span>
                    </div>
                    <p>{sat.role}</p>
                    <div className="sat-specs">
                      <div><span>Altitude</span><b>{stat ? nf(stat.alt, 0) : sat.altitude} km</b></div>
                      <div><span>Swath</span><b>{nf(sat.swathKm)} km</b></div>
                      <div><span>Resolution</span><b>{sat.pixelM} m</b></div>
                      <div><span>Overpass</span><b>{sat.overpass.split(' ')[0]}</b></div>
                    </div>
                    <div className="sat-cover">
                      <span className={`cover-dot ${cover?.covered ? 'ok' : ''}`} />
                      {store.region.shortName}: {cover?.covered ? 'inside the swath now' : `outside (${nf(cover?.distanceKm ?? 0)} km)`}
                    </div>
                    <button type="button" className="btn btn-small btn-secondary" onClick={analyzeNadir}>
                      Analyze nadir area →
                    </button>
                  </div>
                )}
                <div className="legend">
                  <div><i style={{ background: SENSOR_COLORS[0] }} /> MODIS Terra / Aqua</div>
                  <div><i style={{ background: SENSOR_COLORS[1] }} /> VIIRS S-NPP</div>
                  <div><i style={{ background: SENSOR_COLORS[2] }} /> NOAA-20 VIIRS</div>
                  <div><i style={{ background: SENSOR_COLORS[3] }} /> NOAA-21 VIIRS</div>
                </div>
              </div>
            )}

            {activeTab === 'radar' && (
              <div className="dock-section">
                <div className="rail-head">
                  <span className="eyebrow">Risk Radar · {store.today}</span>
                </div>
                {alert ? (
                  <button type="button" className="alert-line" onClick={() => { store.selectRegion(alert.region.id); store.setView('atlas'); }}>
                    <span className="alert-band" style={{ background: riskColor(alert.status.band) }} />
                    <span className="alert-text">
                      <strong>{alert.region.shortName}</strong> — {alert.status.band} · {ordinal(Math.round(alert.status.percentile))} percentile
                    </span>
                    <span className="alert-cta">inspect →</span>
                  </button>
                ) : (
                  <div className="muted">Computing today&apos;s risk across regions…</div>
                )}
                <button type="button" className="alert-forecast" onClick={() => store.setView('outlook')}>
                  <span className="alert-forecast-label">
                    <span className="eyebrow">Four-Week Outlook</span>
                    <span className="alert-forecast-window">median of {outlook.years.length || 3} analog seasons</span>
                  </span>
                  <strong style={{ color: outlook.next4 >= 0 ? 'var(--accent)' : 'var(--green)' }}>{pct(outlook.next4)}</strong>
                  <span className="alert-forecast-base">{Math.round(outlook.hitRate)}% backtest hit rate</span>
                  <span className="alert-forecast-go" aria-hidden>open →</span>
                </button>
                <div className="alert-foot">
                  <span>Watchlist {store.watchlist.length}/7</span>
                  <button type="button" className="link-btn" onClick={() => store.setAlertsOpen(true)}>
                    open alert center
                  </button>
                </div>
                <p className="drawer-note" style={{ fontSize: '11px', marginTop: '12px', color: 'var(--muted)' }}>
                  Research advisory only — not an official warning or dispatch service.
                </p>
              </div>
            )}

            {activeTab === 'regions' && (
              <div className="dock-section">
                <div className="rail-head">
                  <span className="eyebrow">Pilot Regions</span>
                  <span className="muted">{store.region.country}</span>
                </div>
                <WorldSearch onFocusGlobe={(center) => globeRef.current?.focusRegion(center)} />
                <div className="region-chips">
                  {REGIONS.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className={`region-chip ${r.id === store.regionId ? 'active' : ''}`}
                      onClick={() => { store.selectRegion(r.id); globeRef.current?.focusRegion(r.center); }}
                    >
                      {r.shortName}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="region-chip point"
                    onClick={() => { store.setView('atlas'); toast('Click anywhere on the globe — land is named by its country, water becomes an open-ocean AOI.'); }}
                  >
                    + any point on Earth
                  </button>
                </div>
                <div className="region-focus">
                  <div>
                    <div className="region-name">{store.region.name}</div>
                    <div className="region-sub">{store.region.admin} · {nf(store.region.areaKm2)} km² · {store.region.biome}</div>
                  </div>
                  <div className="region-kpis">
                    <div><span>Live detections</span><b>{nf(regionLive)}</b></div>
                    <div><span>Risk band</span><b style={{ color: riskColor(store.status.band) }}>{store.status.band}</b></div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* Slim timeline scrubber bar at bottom */}
      <div className="watch-scrubber-bar">
        <div className="scrubber-left">
          <button
            type="button"
            className="scrubber-play-btn"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? 'Pause simulation' : 'Play simulation'}
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <div className="scrubber-clock">
            <strong className="mono">{simDate.toISOString().slice(11, 19)} UTC</strong>
            <span>{longDate(simDate.toISOString().slice(0, 10))}</span>
          </div>
        </div>

        <div className="scrubber-mid">
          <span className="scrubber-edge-label mono">-72h</span>
          <div className="scrubber-slider-wrap">
            <input
              type="range"
              min={-72}
              max={72}
              step={0.25}
              value={offsetHours}
              aria-label="Simulation offset from live time"
              onChange={(e) => {
                const hours = Number(e.target.value);
                setOffsetHours(hours);
                globeRef.current?.seek(Date.now() + hours * 3600_000);
              }}
            />
            <span className="scrubber-offset-badge mono">
              {offsetHours === 0 ? 'LIVE NOW' : `${offsetHours > 0 ? '+' : ''}${offsetHours}h`}
            </span>
          </div>
          <span className="scrubber-edge-label mono">+72h</span>
        </div>

        <div className="scrubber-right">
          <div className="scrubber-speeds" role="group" aria-label="Playback speed">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                className={speed === s ? 'active' : ''}
                onClick={() => setSpeed(s)}
                aria-pressed={speed === s}
              >
                {s === 1 ? '1×' : `${s}×`}
              </button>
            ))}
          </div>
          <div className="scrubber-fires">
            <Sparkline values={perHour} width={90} height={20} color="#ff8a3d" />
            <TableAlt
              columns={['Hour', 'Detections']}
              rows={perHour.map((v, i) => [`h${i + 1}`, v])}
              summary="Hourly detections table"
              note="168 hourly bins of the live 7-day window."
            />
          </div>
          <button
            type="button"
            className={`side-dock-toggle ${sidePanelOpen ? 'active' : ''}`}
            onClick={() => setSidePanelOpen(!sidePanelOpen)}
            aria-label="Toggle mission panels"
          >
            <span>{sidePanelOpen ? 'Close panels ❯' : 'Mission panels ❮'}</span>
          </button>
        </div>
      </div>

      {/* Bottom docked metadata bar - explicit columns preventing any text collision */}
      <div className="watch-dock-footer">
        <div className="dock-foot-item left">
          <span className="mono">LIVE FIRMS WINDOW</span>
          <span className="sep" />
          <span>DATA THROUGH {store.today}</span>
          {freshness > 2 && <span className="dock-lag">({freshness}d lag)</span>}
        </div>
        <div className="dock-foot-item center">
          <span>drag to rotate · scroll to zoom · click satellite or country</span>
        </div>
        <div className="dock-foot-item right">
          <span>Research advisory · Not an official warning or evacuation service</span>
        </div>
      </div>
    </div>
  );
}
