import { lazy, Suspense } from 'react';
import { useStore, type ViewId } from './lib/store';
import type { StringKey } from './lib/i18n';
import { AlertCenter, JudgeTour, SettingsPanel, Toasts } from './components/Overlays';
import { nf } from './lib/format';
import { provenanceMix } from './lib/data';

// Only the landing route ships in the entry graph. Watch reaches three.js through components/Globe,
// and every document view reaches components/charts, so each is its own boundary: the first paint
// of a view downloads its page, never the other five. See docs/decisions.md ADR-21.
const Watch = lazy(() => import('./pages/Watch').then((m) => ({ default: m.Watch })));
const Atlas = lazy(() => import('./pages/Atlas').then((m) => ({ default: m.Atlas })));
const Diagnosis = lazy(() => import('./pages/Diagnosis').then((m) => ({ default: m.Diagnosis })));
const Outlook = lazy(() => import('./pages/Outlook').then((m) => ({ default: m.Outlook })));
const Brief = lazy(() => import('./pages/Brief').then((m) => ({ default: m.Brief })));
const Method = lazy(() => import('./pages/Method').then((m) => ({ default: m.Method })));

const BOOT_TITLES: Record<ViewId, string> = {
  watch: 'Assembling the orbital watch',
  atlas: 'Opening the burning atlas',
  diagnosis: 'Reading the bias X-ray',
  outlook: 'Building the four-week outlook',
  brief: 'Setting the field brief',
  method: 'Laying out the method',
};

function WatchBoot() {
  return (
    <div className="watch watch-boot" role="status" aria-live="polite">
      <div className="watch-boot-card">
        <span className="boot-mark" aria-hidden>◈</span>
        <strong>{BOOT_TITLES.watch}</strong>
        <p>Loading the globe, the live FIRMS window and the satellite tracks it calibrates to.</p>
        <span className="boot-line" aria-hidden />
      </div>
    </div>
  );
}

function PageBoot({ view }: { view: Exclude<ViewId, 'watch'> }) {
  return (
    <section className="boot-page page-boot" role="status" aria-live="polite">
      <span className="boot-mark" aria-hidden>◈</span>
      <strong>{BOOT_TITLES[view]}</strong>
      <span className="boot-line" aria-hidden />
    </section>
  );
}

const NAV: { id: ViewId; label: string; short: string }[] = [
  { id: 'watch', label: 'Orbital Watch', short: 'Watch' },
  { id: 'atlas', label: 'Atlas', short: 'Atlas' },
  { id: 'diagnosis', label: 'Diagnosis', short: 'Diagnose' },
  { id: 'outlook', label: 'Outlook', short: 'Outlook' },
  { id: 'brief', label: 'Brief', short: 'Brief' },
  { id: 'method', label: 'Method', short: 'Method' },
];

function TopNav() {
  const store = useStore();
  const high = store.alerts.filter((a) => a.status.percentile >= 85).length;
  const watching = store.watchlist.length;

  return (
    <header className="topnav">
      <button type="button" className="brand" onClick={() => store.setView('watch')} aria-label="Continuum home">
        <span className="brand-mark" aria-hidden>◈</span>
        <span className="brand-text">
          <strong>CONTINUUM</strong>
          <small>{store.t('tagline')}</small>
        </span>
      </button>

      <nav className="nav" aria-label="Primary">
        {NAV.map((n) => {
          const label = store.t(`nav_${n.id}` as StringKey);
          return (
            <button
              key={n.id}
              type="button"
              className={store.view === n.id ? 'active' : ''}
              aria-current={store.view === n.id ? 'page' : undefined}
              onClick={() => store.setView(n.id)}
              title={label}
            >
              <span className="nav-full">{label}</span>
              <span className="nav-short">{n.short}</span>
            </button>
          );
        })}
      </nav>

      <div className="nav-right">
        <span className={`nav-live ${store.live ? 'on' : ''}`} title="NASA FIRMS live window">
          <i /> <span>{store.live ? 'LIVE' : 'SYNC'}</span>
        </span>
        <button type="button" className="nav-alert" onClick={() => store.setAlertsOpen(true)} aria-label={`Open alert center, ${high} areas above the 85th percentile`}>
          <span className="alert-bell" aria-hidden>◉</span>
          <span className="nav-label">{store.t('alerts')}</span>
          {high > 0 && <span className="alert-count">{high}</span>}
        </button>
        <button type="button" className="nav-tour" onClick={() => store.setTourOpen(true)}>
          <span aria-hidden>✦</span> <span className="nav-label">{store.t('tour')}</span>
        </button>
        <button
          type="button"
          className="lang-btn"
          onClick={() => store.setSettings({ lang: store.settings.lang === 'en' ? 'es' : 'en' })}
          aria-label="Toggle language"
        >
          {store.settings.lang.toUpperCase()}
        </button>
        <button type="button" className="icon-btn nav-settings" onClick={() => store.setSettingsOpen(true)} aria-label="Settings">
          <span aria-hidden>⚙</span>
        </button>
      </div>
      <div className="nav-underline" aria-hidden />
      <span className="nav-watch-count" aria-hidden>{watching}/7 watched</span>
    </header>
  );
}

function Footer() {
  const store = useStore();
  const mix = provenanceMix(store.records);
  return (
    <footer className="footer">
      <div className="footer-top">
        <div className="footer-brand">
          <span className="brand-mark" aria-hidden>◈</span>
          <div>
            <strong>CONTINUUM</strong>
            <span>One continuous record of burning, from Terra to VIIRS.</span>
          </div>
        </div>
        <div className="footer-links">
          <button type="button" onClick={() => store.setView('watch')}>Orbital Watch</button>
          <button type="button" onClick={() => store.setView('atlas')}>Atlas</button>
          <button type="button" onClick={() => store.setView('diagnosis')}>Diagnosis</button>
          <button type="button" onClick={() => store.setView('outlook')}>Outlook</button>
          <button type="button" onClick={() => store.setView('brief')}>Brief</button>
          <button type="button" onClick={() => store.setView('method')}>Method</button>
        </div>
        <div className="footer-meta">
          <span>Live detections: {nf(store.live?.meta.counts.kept ?? 0)}</span>
          <span>Data through {store.today}</span>
          <span>Method v0.1.0</span>
        </div>
      </div>
      <div className="footer-bottom">
        <p>
          Supports situational awareness and research. Not an official warning, dispatch, or evacuation service.
          {mix.archived > 0
            ? `${nf(mix.archived)} of ${nf(mix.days)} record days are NASA FIRMS archive detections; the rest is a calibrated reconstruction. The live window and orbital positions are real.`
            : 'The long record is a calibrated reconstruction; the live window and orbital positions are real.'}
        </p>
        <p>
          Built for the 2026 NASA Space Apps Challenge. NASA FIRMS · NASA POWER · NASA GIBS · CelesTrak · Natural Earth.
        </p>
      </div>
    </footer>
  );
}

export function App() {
  const store = useStore();
  const view = store.view;

  return (
    <div className={`app view-${view}`}>
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          // Routing lives in location.hash, so letting the default anchor jump fire would rewrite the
          // hash to "#main", which parseHash() reads as an unknown view and resets region, metric and range.
          e.preventDefault();
          const main = document.getElementById('main');
          main?.focus();
          main?.scrollIntoView({ block: 'start' });
        }}
      >
        Skip to content
      </a>
      <TopNav />
      <main id="main" tabIndex={-1} className={view === 'watch' ? 'main main-watch' : 'main'}>
        {!store.live ? (
          <section className="boot-page" role="status" aria-live="polite">
            <span className="boot-mark" aria-hidden>◈</span>
            <strong>Acquiring the live FIRMS window</strong>
            <p>
              The record is calibrated to that window, so nothing numeric is rendered before it arrives.
              The keyed archive and the MERRA-2 driver load with it.
            </p>
            <span className="boot-line" aria-hidden />
          </section>
        ) : (
          <Suspense fallback={view === 'watch' ? <WatchBoot /> : <PageBoot view={view} />}>
            {view === 'watch' && <Watch />}
            {view === 'atlas' && <Atlas />}
            {view === 'diagnosis' && <Diagnosis />}
            {view === 'outlook' && <Outlook />}
            {view === 'brief' && <Brief />}
            {view === 'method' && <Method />}
          </Suspense>
        )}
      </main>
      {view !== 'watch' && store.live && <Footer />}
      <AlertCenter />
      <SettingsPanel />
      <JudgeTour />
      <Toasts />
    </div>
  );
}
