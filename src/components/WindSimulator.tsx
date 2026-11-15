import { useEffect, useId, useState, type CSSProperties } from 'react';
import { fetchWind, windCompass, type WindData } from '../lib/wind';

export interface WindSimulatorProps {
  lat: number;
  lon: number;
  date?: string | null;
  locationLabel?: string;
  onClose: () => void;
}

function formatCoordinates(lat: number, lon: number): string {
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

const styles = {
  panel: {
    position: 'fixed',
    right: 16,
    top: 80,
    zIndex: 1000,
    boxSizing: 'border-box',
    width: 'min(420px, calc(100vw - 32px))',
    maxHeight: 'calc(100dvh - 96px)',
    overflowY: 'auto',
    padding: 24,
    border: '1px solid var(--line-strong, rgba(255, 255, 255, 0.16))',
    borderTop: '3px solid var(--accent, #ff8a3d)',
    borderRadius: 16,
    background: 'var(--panel-solid, #121316)',
    color: 'var(--text, #f4f4f6)',
    fontFamily: 'var(--font-sans, system-ui, sans-serif)',
    lineHeight: 1.5,
    boxShadow: '0 16px 48px rgba(0, 0, 0, 0.3)',
  },
  eyebrow: {
    margin: '0 0 12px',
    color: 'var(--muted, #9fa2a8)',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  heading: {
    margin: '0 0 20px',
    fontSize: 20,
    fontWeight: 600,
    lineHeight: 1.4,
    overflowWrap: 'anywhere',
  },
  wind: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    border: '1px solid var(--line-strong, rgba(255, 255, 255, 0.16))',
    borderRadius: 10,
    background: 'var(--panel-raised, #1b1d21)',
  },
  arrow: {
    flexShrink: 0,
    color: 'var(--accent, #ff8a3d)',
    fontSize: 32,
    lineHeight: 1,
  },
  windText: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.6,
  },
  advisory: {
    margin: '16px 0 8px',
    color: 'var(--text-soft, #d2d4d8)',
    fontSize: 14,
  },
  scenario: {
    margin: '0 0 20px',
    color: 'var(--muted, #9fa2a8)',
    fontSize: 12,
  },
  close: {
    width: '100%',
    minHeight: 44,
    padding: '10px 16px',
    border: 0,
    borderRadius: 8,
    background: 'var(--btn-primary-bg, #ff8a3d)',
    color: 'var(--btn-primary-text, #0b0c0e)',
    fontFamily: 'inherit',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
} satisfies Record<string, CSSProperties>;

export function WindSimulator({ lat, lon, date, locationLabel, onClose }: WindSimulatorProps) {
  const titleId = useId();
  const [wind, setWind] = useState<WindData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setWind(null);
    setError(null);
    setLoading(true);
    fetchWind(lat, lon, date, controller.signal)
      .then(data => { if (!controller.signal.aborted) setWind(data); })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not fetch wind data.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [lat, lon, date, attempt]);

  return (
    <aside className="wind-panel" aria-labelledby={titleId} style={styles.panel}>
      <p style={styles.eyebrow}>Wind conditions</p>
      <h2 id={titleId} style={styles.heading}>
        {locationLabel ?? 'Selected fire'} · {formatCoordinates(lat, lon)}
      </h2>
      <div aria-live="polite" aria-busy={loading}>
        {loading && <p role="status">Fetching wind data...</p>}
        {error && <div role="status"><p>{error}</p><button type="button" className="btn btn-small" onClick={() => setAttempt(a => a + 1)}>Retry wind data</button></div>}
        {wind && <>
          <div style={styles.wind}>
            <span aria-hidden="true" style={{ ...styles.arrow, transform: `rotate(${wind.direction + 180}deg)` }}>↑</span>
            <p style={styles.windText}>Wind from <strong>{windCompass(wind.direction)} ({wind.direction.toFixed(0)}°) at {wind.speedKmh.toFixed(1)} km/h</strong></p>
          </div>
          <p style={styles.scenario}>{wind.source} · {wind.historical ? 'daily reanalysis at 10 m' : 'current forecast at 10 m'} · {wind.time}{wind.historical ? '' : ' UTC'}</p>
          <p style={styles.advisory}>Wind provides context for possible smoke movement. It does not predict fire spread or evacuation routes.</p>
        </>}
      </div>
      <button type="button" onClick={onClose} style={styles.close}>Close</button>
    </aside>
  );
}

export default WindSimulator;
