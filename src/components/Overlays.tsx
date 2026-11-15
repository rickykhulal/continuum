import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { apiFetch } from '../lib/api';
import { REGIONS } from '../lib/data';
import { classifyLiveResponse } from '../lib/liveClient';
import { highFrpAlerts, verifiedCommunityAlerts, HIGH_FRP_MW, type CommunityAlert } from '../lib/realAlerts';
import type { LiveFire } from '../lib/types';
import { Badge } from './ui';
import { nf, shortDate } from '../lib/format';
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
  const [community, setCommunity] = useState<CommunityAlert[]>([]);
  const [communityError, setCommunityError] = useState<string | null>(null);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveNotice, setLiveNotice] = useState('Bundled FIRMS snapshot');
  const [fresh, setFresh] = useState<{ fires: LiveFire[]; start: string; end: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    setCommunity([]);
    setCommunityError(null);
    setCommunityLoading(true);
    setLiveLoading(true);
    setFresh(null);
    setLiveNotice('Bundled FIRMS snapshot · refreshing live feed');
    let feedDone = false;
    let liveDone = false;
    const feed = apiFetch('/community/feed', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`Community feed unavailable (HTTP ${response.status}).`);
        const reports = verifiedCommunityAlerts(await response.json());
        if (!controller.signal.aborted) setCommunity(reports);
      })
      .catch(error => { if (!controller.signal.aborted) setCommunityError(error instanceof Error ? error.message : 'Community feed unavailable.'); })
      .finally(() => { feedDone = true; if (!controller.signal.aborted) setCommunityLoading(false); });
    const live = apiFetch('/live-firms', { signal: controller.signal })
      .then(async response => {
        const result = classifyLiveResponse(response.status, await response.json().catch(() => null), null);
        if (controller.signal.aborted) return;
        if (result.provenance === 'live' && result.meta) {
          const fires = result.data.filter((fire): fire is LiveFire => Array.isArray(fire) && fire.length >= 6 &&
            fire.every(Number.isFinite) && Math.abs(fire[0]) <= 90 && Math.abs(fire[1]) <= 180 &&
            Number.isInteger(fire[3]) && fire[3] >= 0 && fire[3] <= 3 &&
            Number.isInteger(fire[4]) && fire[4] >= 0 && fire[4] <= 2);
          setFresh({ fires, start: result.meta.windowStart, end: result.meta.windowEnd });
          setLiveNotice(result.status === 'stale' ? 'Cached FIRMS feed · stale' : 'Latest FIRMS feed');
        } else setLiveNotice('Live feed unavailable · bundled FIRMS snapshot');
      })
      .catch(() => { if (!controller.signal.aborted) setLiveNotice('Live feed unavailable · bundled FIRMS snapshot'); })
      .finally(() => { liveDone = true; if (!controller.signal.aborted) setLiveLoading(false); });
    Promise.allSettled([feed, live]).then(() => clearTimeout(timer));
    const timeout = () => {
      setCommunityLoading(false);
      setLiveLoading(false);
      if (!feedDone) setCommunityError('Community refresh timed out. Please retry.');
      if (!liveDone) setLiveNotice('Live feed unavailable · bundled FIRMS snapshot');
    };
    controller.signal.addEventListener('abort', timeout, { once: true });
    return () => {
      controller.signal.removeEventListener('abort', timeout);
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, attempt]);

  const start = fresh?.start ?? store.live?.meta.windowStart ?? '';
  const end = fresh?.end ?? store.live?.meta.windowEnd ?? '';
  const alerts = useMemo(() => highFrpAlerts(fresh?.fires ?? store.live?.fires ?? [], [store.region, ...REGIONS], start, end), [fresh, store.live, store.region, start, end]);
  const current = alerts.find(alert => alert.id === selected) ?? alerts[0];
  const message = current ? [
    `CONTINUUM FIRE REPORT — ${current.region.shortName.toUpperCase()}`,
    `${current.date} · ${liveNotice}`,
    `${nf(current.points)} detections with FRP ≥ ${HIGH_FRP_MW} MW.`,
    `Peak FRP: ${current.peakFrp.toFixed(1)} MW. Summed detection FRP: ${current.totalFrp.toFixed(1)} MW.`,
    `Measured window: ${start} to ${end}. Counts are satellite detections, not separate fires.`,
    'NASA FIRMS NRT observations; provisional. Research context, not an official warning.',
  ].join('\n') : '';
  if (!open) return null;

  return (
    <div className="drawer-wrap" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) store.setAlertsOpen(false); }}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="alert-title">
        <header className="drawer-head">
          <div><div className="eyebrow">Alert center</div><h2 id="alert-title">Fire detections &amp; community reports</h2></div>
          <button type="button" className="icon-btn" onClick={() => store.setAlertsOpen(false)} aria-label="Close alert center">✕</button>
        </header>
        <div className="alert-summary">
          <div><span>Area-day alerts</span><b>{nf(alerts.length)}</b></div>
          <div><span>Verified reports</span><b>{communityLoading || communityError ? '—' : nf(community.length)}</b></div>
          <div><span>FRP threshold</span><b>{HIGH_FRP_MW} MW</b></div>
          <div><span>Data through</span><b>{end ? shortDate(end) : 'Unavailable'}</b></div>
        </div>
        <button type="button" className="btn btn-small btn-ghost" onClick={() => setAttempt(a => a + 1)} disabled={communityLoading || liveLoading}>Refresh alerts</button>
        <section className="alert-community" aria-label="Verified community anomalies">
          <div className="drawer-section-head"><span className="eyebrow">Verified community anomalies</span></div>
          <div className="alert-list" aria-live="polite">
            {communityLoading && <p role="status">Fetching community reports...</p>}
            {communityError && <p role="status">{communityError}</p>}
            {!communityLoading && !communityError && !community.length && <div className="empty">No verified community anomalies yet.</div>}
            {community.map(report => <button key={report.id} type="button" className="alert-item community-alert" onClick={() => { store.setAlertsOpen(false); store.setView('community'); }}>
              <span className="alert-band" style={{ background: '#ff8a3d' }} />
              <span className="alert-item-main">
                <span className="alert-item-title">{report.content}</span>
                <span className="alert-item-meta">{report.author} · {shortDate(report.createdAt.slice(0, 10))} · verified community report</span>
              </span>
            </button>)}
          </div>
        </section>
        <section aria-label="High FRP fire detections">
          <div className="drawer-section-head"><span className="eyebrow">Recent high-FRP detections</span></div>
          <p className="drawer-note">{liveNotice} · {start && end ? `${start} – ${end}` : 'Window unavailable'}. Selected area and seven pilot regions. Detections ≥ {HIGH_FRP_MW} MW, newest first; overlapping areas may share detections.</p>
          {liveLoading && <p role="status">Fetching latest fire detections...</p>}
          <div className="alert-list">
            {alerts.map(alert => <button key={alert.id} type="button" className={`alert-item fire-alert ${current?.id === alert.id ? 'active' : ''}`} aria-pressed={current?.id === alert.id} onClick={() => setSelected(alert.id)}>
              <span className="alert-band" style={{ background: '#ff8a3d' }} />
              <span className="alert-item-main">
                <span className="alert-item-title">High FRP detected in {alert.region.shortName} · {nf(alert.points)} points</span>
                <span className="alert-item-meta">{shortDate(alert.date)} · peak {alert.peakFrp.toFixed(1)} MW</span>
              </span>
            </button>)}
            {!alerts.length && <div className="empty">{store.loading || liveLoading ? 'Loading fire detections...' : 'No high-FRP detections in the measured window for these areas.'}</div>}
          </div>
        </section>
        {current && <div className="dispatch alert-report">
          <div className="drawer-section-head"><span className="eyebrow">Detection report</span><Badge>NASA FIRMS · provisional</Badge></div>
          <div className="phone-bubble"><pre>{message}</pre></div>
          <div className="dispatch-actions">
            <button type="button" className="btn btn-small btn-primary" onClick={() => copyText(message, () => store.toast('Detection report copied.'), () => store.toast('Clipboard blocked. Select the text manually.'))}>Copy report</button>
            <button type="button" className="btn btn-small btn-ghost" onClick={() => {
              const url = URL.createObjectURL(new Blob([message], { type: 'text/plain;charset=utf-8' }));
              const link = document.createElement('a');
              link.href = url;
              link.download = `continuum_fire_${current.region.id}_${current.date}.txt`;
              document.body.appendChild(link);
              link.click();
              link.remove();
              setTimeout(() => URL.revokeObjectURL(url), 3000);
            }}>Download report</button>
            <button type="button" className="btn btn-small btn-ghost" onClick={() => {
              if (current.region.id !== store.region.id) store.selectRegion(current.region.id);
              store.setSelectedDate(current.date);
              store.setAlertsOpen(false);
              store.setView('atlas');
            }}>Open Atlas →</button>
          </div>
        </div>}
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
