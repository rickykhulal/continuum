import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { analogDeparture, biasXray, getRecord, recordsInRange, twinAnalogs } from '../lib/data';
import { Badge } from './ui';
import { MONTHS_LONG, nf, pct, riskColor, shortDate } from '../lib/format';
import type { ViewId } from '../lib/store';

const TOUR: { view: ViewId; title: string; body: string; award: string }[] = [
  {
    view: 'watch',
    title: 'A record in orbit',
    body: 'Five real spacecraft move on SGP4 orbits above the live FIRMS detections. Click a satellite to focus the Earth on its ground track, or click any point to create an analysis area.',
    award: 'Best Use of Technology · Best Art & Technology',
  },
  {
    view: 'atlas',
    title: 'The repaired calendar',
    body: 'Every cell is one day from 2000 to now. Toggle raw versus harmonized and watch the 2012 step appear and disappear. Click any day for its sensor mix, uncertainty interval and trust label.',
    award: 'Best Use of Science · Best Use of Data',
  },
  {
    view: 'atlas',
    title: '“Is this normal?”',
    body: 'Month-to-date is compared with the same area’s own history. The answer is a percentile, a band and a sentence — not a naked number. Elevated begins at the 75th percentile, extreme at the 97th.',
    award: 'Local Impact',
  },
  {
    view: 'atlas',
    title: 'Anywhere on Earth',
    body: 'Search a place, enter coordinates, or click the globe: inside a country border the click selects that country, on water it drops a 150 km AOI. Pilot regions carry curated long records; custom AOIs are labelled exploratory. Share links preserve the area, metric and range.',
    award: 'Global Connection',
  },
  {
    view: 'diagnosis',
    title: 'Bias X-ray',
    body: 'The 2012 phantom trend is decomposed into resolution, overpass, sensitivity and residual terms. The calibration ratio is recomputed from overlap days, with a 90% interval — never a hard-coded constant.',
    award: 'Best Use of Science',
  },
  {
    view: 'diagnosis',
    title: 'Break the instrument',
    body: 'The Sensor Sandbox lets you build a virtual sensor — overpass hour, pixel size, FRP threshold — and watch the correction recover the known truth. A method you cannot falsify is a belief.',
    award: 'Best Mission Concept · Most Inspirational',
  },
  {
    view: 'outlook',
    title: 'Analog seasons + real weather',
    body: 'The Fire Twin finds the closest historical seasons and backtests its own predictions. NASA POWER daily reanalysis adds the present fire-weather condition, labelled with source and fit.',
    award: 'Best Use of Data',
  },
  {
    view: 'brief',
    title: 'One page a mayor can use',
    body: 'A printable, copy-ready advisory that carries its own uncertainty, method version and non-official status. Export the daily record as CSV or the real hotspots as GeoJSON.',
    award: 'Best Storytelling · Local Impact',
  },
  {
    view: 'method',
    title: 'The audit trail',
    body: 'Equations, validation ledger, provenance, known limits, responsible use and the honest boundary between internal validation and independent archive comparison. The science is the interface.',
    award: 'Galactic Impact',
  },
];

function copyText(text: string, onOk: () => void, onFail: () => void) {
  navigator.clipboard.writeText(text).then(onOk).catch(onFail);
}

export function AlertCenter() {
  const store = useStore();
  const open = store.alertsOpen;
  const [selected, setSelected] = useState<string | null>(null);
  const alerts = store.alerts;
  const current = alerts.find((a) => a.region.id === selected) ?? alerts[0];
  const message = useMemo(() => {
    if (!current) return '';
    const r = current.region;
    const st = current.status;
    const liveRecs = store.live ? recordsInRange(getRecord(r.id, store.live), store.live.meta.windowStart, store.live.meta.windowEnd) : [];
    const liveSum = liveRecs.reduce((s, d) => s + d.harmonized, 0);
    const bias = store.live ? biasXray(getRecord(r.id, store.live)) : null;
    return [
      `CONTINUUM WATCH — ${r.shortName.toUpperCase()}`,
      `${st.date} · ${st.band.toUpperCase()} activity · ${Math.round(st.percentile)}th percentile`,
      `First ${st.windowDays} days of ${MONTHS_LONG[Number(st.date.slice(5, 7)) - 1]}: ${nf(st.current)} VIIRS-eq vs median ${nf(st.baselineMedian)} (${st.ratioToMedian ? st.ratioToMedian.toFixed(1) + '×' : '—'}).`,
      `Live window: ${nf(liveSum)} detections across ${nf(liveRecs.filter((d) => d.harmonized > 0).length)} active days.`,
      bias ? `Sensor calibration ${bias.ratio.toFixed(2)}× (90% CI ${bias.ratioLo.toFixed(2)}–${bias.ratioHi.toFixed(2)}). Raw 2012 break reduced from ${bias.rawBreakPct.toFixed(0)}% to ${bias.correctedBreakPct.toFixed(0)}%.` : '',
      st.provisional ? 'Latest days are provisional.' : 'No provisional days in the current window.',
      'Research advisory — not an official warning, dispatch or evacuation service. Continuum · NASA Space Apps 2026.',
    ].filter(Boolean).join('\n');
  }, [current, store.live]);

  const forecast = useMemo(() => {
    if (!current) return null;
    const recs = getRecord(current.region.id, store.live);
    if (!recs.length) return null;
    const twin = twinAnalogs(recs, store.today);
    return { next4: analogDeparture(twin), hitRate: twin.backtestHitRate, seasons: twin.analogs.length };
  }, [current, store.live, store.today]);

  useEffect(() => {
    if (open && alerts.length && !selected) setSelected(alerts[0].region.id);
  }, [open, alerts, selected]);

  if (!open) return null;
  const high = alerts.filter((a) => a.status.percentile >= 90).length;
  const elevated = alerts.filter((a) => a.status.percentile >= 75).length;

  return (
    <div className="drawer-wrap" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) store.setAlertsOpen(false); }}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="alert-title">
        <header className="drawer-head">
          <div>
            <div className="eyebrow">Alert center · simulation</div>
            <h2 id="alert-title">Risk radar</h2>
          </div>
          <button type="button" className="icon-btn" onClick={() => store.setAlertsOpen(false)} aria-label="Close alert center">✕</button>
        </header>

        <div className="alert-summary">
          <div><span>High or extreme</span><b style={{ color: '#ff8a3d' }}>{high}</b></div>
          <div><span>Elevated or above</span><b>{elevated}</b></div>
          <div><span>Watched</span><b>{store.watchlist.length}/7</b></div>
          <div><span>Data through</span><b>{shortDate(store.today)}</b></div>
        </div>

        {forecast && (
          <div className="alert-future">
            <div>
              <div className="eyebrow">Predict the future · 4 weeks</div>
              <strong style={{ color: forecast.next4 >= 0 ? 'var(--accent)' : 'var(--green)' }}>{pct(forecast.next4)}</strong>
              <span>{forecast.seasons} analog seasons · {Math.round(forecast.hitRate)}% backtest</span>
            </div>
            <button
              type="button"
              className="btn btn-small btn-ghost"
              onClick={() => {
                if (current) store.selectRegion(current.region.id);
                store.setAlertsOpen(false);
                store.setView('outlook');
              }}
            >
              Open outlook →
            </button>
          </div>
        )}

        <div className="alert-list">
          {alerts.map((a) => {
            const active = (current?.region.id ?? '') === a.region.id;
            const watching = store.watchlist.includes(a.region.id);
            return (
              <button
                key={a.region.id}
                type="button"
                className={`alert-item ${active ? 'active' : ''}`}
                onClick={() => setSelected(a.region.id)}
                aria-pressed={active}
              >
                <span className="alert-band" style={{ background: riskColor(a.status.band) }} />
                <span className="alert-item-main">
                  <span className="alert-item-title">{a.region.shortName}<small>{a.region.country}</small></span>
                  <span className="alert-item-meta">{a.status.band} · {Math.round(a.status.percentile)}th pct · {a.status.freshnessDays} d lag</span>
                </span>
                <span className={`watch-star ${watching ? 'on' : ''}`} aria-hidden>{watching ? '●' : '○'}</span>
              </button>
            );
          })}
          {!alerts.length && <div className="empty">Loading regional status…</div>}
        </div>

        {current && (
          <div className="dispatch">
            <div className="drawer-section-head">
              <span className="eyebrow">Dispatch preview</span>
              <Badge tone="warn">SIMULATED MESSAGE</Badge>
            </div>
            <div className="phone-bubble">
              <div className="bubble-head">
                <strong>CONTINUUM WATCH</strong>
                <span>{shortDate(store.today)}</span>
              </div>
              <pre>{message}</pre>
            </div>
            <div className="dispatch-actions">
              <button
                type="button"
                className="btn btn-small btn-primary"
                onClick={() => copyText(message, () => store.toast('Dispatch message copied — ready for a duty officer to review.'), () => store.toast('Clipboard blocked. Select the text manually.'))}
              >
                Copy message
              </button>
              <button
                type="button"
                className="btn btn-small btn-ghost"
                onClick={() => {
                  const blob = new Blob([message], { type: 'text/plain;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `continuum_watch_${current.region.id}_${store.today}.txt`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  setTimeout(() => URL.revokeObjectURL(url), 3000);
                  store.toast('Dispatch message downloaded.');
                }}
              >
                Download
              </button>
              <button
                type="button"
                className="btn btn-small btn-ghost"
                onClick={() => {
                  store.selectRegion(current.region.id);
                  store.setAlertsOpen(false);
                  store.setView('atlas');
                }}
              >
                Open Atlas →
              </button>
              <button
                type="button"
                className={`btn btn-small ${store.watchlist.includes(current.region.id) ? 'btn-live' : 'btn-ghost'}`}
                onClick={() => store.toggleWatch(current.region.id)}
              >
                {store.watchlist.includes(current.region.id) ? '● Watching' : '○ Watch'}
              </button>
            </div>
            <p className="drawer-note">
              Nothing is sent. This is the message a duty officer could review, built from the same uncertainty-bearing
              record as the screen. Automatic dispatch would require an official agreement and is deliberately absent.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

export function SettingsPanel() {
  const store = useStore();
  const { settings } = store;
  if (!store.settingsOpen) return null;
  return (
    <div className="drawer-wrap" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) store.setSettingsOpen(false); }}>
      <aside className="drawer drawer-settings" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="drawer-head">
          <div>
            <div className="eyebrow">Settings</div>
            <h2 id="settings-title">Make it yours</h2>
          </div>
          <button type="button" className="icon-btn" onClick={() => store.setSettingsOpen(false)} aria-label="Close settings">✕</button>
        </header>

        <section className="settings-section panel-card">
          <div className="panel-card-body">
            <h3>Theme</h3>
            <div className="theme-cards">
              <button type="button" className={`theme-card dark ${settings.theme === 'dark' ? 'active' : ''}`} onClick={() => store.setSettings({ theme: 'dark' })}>
                <span className="theme-preview" />
                <strong>Mission control</strong>
                <small>Dark · default</small>
              </button>
              <button type="button" className={`theme-card light ${settings.theme === 'light' ? 'active' : ''}`} onClick={() => store.setSettings({ theme: 'light' })}>
                <span className="theme-preview" />
                <strong>Daylight</strong>
                <small>Light theme</small>
              </button>
            </div>
          </div>
        </section>

        <section className="settings-section panel-card">
          <div className="panel-card-body">
            <h3>Accessibility</h3>
            <label className="switch-row">
              <span><strong>High contrast</strong><small>Stronger borders and text</small></span>
              <input type="checkbox" checked={settings.contrast} onChange={(e) => store.setSettings({ contrast: e.target.checked })} />
            </label>
            <label className="switch-row">
              <span><strong>Pattern fills</strong><small>Texture behind chart colors</small></span>
              <input type="checkbox" checked={settings.textures} onChange={(e) => store.setSettings({ textures: e.target.checked })} />
            </label>
            <label className="switch-row">
              <span><strong>Reduce motion</strong><small>Stop globe and transition animation</small></span>
              <input type="checkbox" checked={settings.reduceMotion} onChange={(e) => store.setSettings({ reduceMotion: e.target.checked })} />
            </label>
            <label className="switch-row">
              <span><strong>Map labels</strong><small>Show satellite and region labels</small></span>
              <input type="checkbox" checked={settings.labels} onChange={(e) => store.setSettings({ labels: e.target.checked })} />
            </label>
          </div>
        </section>

        <section className="settings-section panel-card">
          <div className="panel-card-body">
            <h3>Language</h3>
            <div className="segmented">
              <button type="button" className={settings.lang === 'en' ? 'active' : ''} onClick={() => store.setSettings({ lang: 'en' })} aria-pressed={settings.lang === 'en'}>English</button>
              <button type="button" className={settings.lang === 'es' ? 'active' : ''} onClick={() => store.setSettings({ lang: 'es' })} aria-pressed={settings.lang === 'es'}>Español</button>
            </div>
            <p className="drawer-note">Navigation and core chart labels switch language immediately; scientific method text remains in English with a Spanish abstract.</p>
          </div>
        </section>

        <section className="settings-section panel-card">
          <div className="panel-card-body">
            <h3>Session</h3>
            <div className="session-facts">
              <div><span>Method</span><b>v0.1.0</b></div>
              <div><span>Data through</span><b>{store.today}</b></div>
              <div><span>Live detections worldwide</span><b>{nf(store.live?.meta.counts.kept ?? 0)}</b></div>
              <div><span>Record rows</span><b>{nf(store.records.length)}</b></div>
            </div>
          </div>
        </section>

        <button
          type="button"
          className="btn btn-small btn-ghost"
          onClick={() => {
            localStorage.removeItem('continuum.settings.v2');
            localStorage.removeItem('continuum.watchlist.v2');
            store.toast('Local settings and watchlist cleared. Reload to reset every view.');
          }}
        >
          Reset local settings
        </button>

        <p className="drawer-note">
          Only theme, language and watchlist are stored locally. No account, no tracking, no server-side record of your AOIs.
        </p>
      </aside>
    </div>
  );
}

export function JudgeTour() {
  const store = useStore();
  const [step, setStep] = useState(0);
  const open = store.tourOpen;

  useEffect(() => {
    if (!open) return;
    store.setView(TOUR[step].view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') store.setTourOpen(false);
      if (e.key === 'ArrowRight') setStep((s) => Math.min(TOUR.length - 1, s + 1));
      if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, store]);

  if (!open) return null;
  const t = TOUR[step];
  return (
    <div className="tour">
      <div className="tour-head">
        <div>
          <div className="eyebrow">Judge tour · {step + 1} / {TOUR.length}</div>
          <Badge tone="good">{t.award}</Badge>
        </div>
        <button type="button" className="icon-btn" onClick={() => store.setTourOpen(false)} aria-label="Close tour">✕</button>
      </div>
      <h2>{t.title}</h2>
      <p>{t.body}</p>
      <div className="tour-progress" aria-hidden>
        {TOUR.map((_, i) => <i key={i} className={i <= step ? 'on' : ''} />)}
      </div>
      <div className="tour-actions">
        <button type="button" className="btn btn-small btn-ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>← Back</button>
        {step < TOUR.length - 1 ? (
          <button type="button" className="btn btn-small btn-primary" onClick={() => setStep((s) => s + 1)}>Next stop →</button>
        ) : (
          <button type="button" className="btn btn-small btn-primary" onClick={() => store.setTourOpen(false)}>Finish tour</button>
        )}
      </div>
      <div className="tour-foot">
        <span>Use ← → keys · Esc closes</span>
        <button type="button" className="link-btn" onClick={() => setStep(0)}>restart</button>
      </div>
    </div>
  );
}

export function Toasts() {
  const store = useStore();
  if (!store.toastMsg) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      <i className="toast-dot" />
      <span>{store.toastMsg}</span>
    </div>
  );
}
