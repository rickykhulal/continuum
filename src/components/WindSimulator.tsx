import { useId, type CSSProperties } from 'react';

export interface WindSimulatorProps {
  lat: number;
  lon: number;
  onClose: () => void;
}

// Fixed demonstration scenario, not observed wind or an operational forecast.
const simulatedWind = { direction: 'NE', degrees: 45, speedMetersPerSecond: 12 } as const;

function formatCoordinates(lat: number, lon: number): string {
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

function formatWind(): string {
  return `${simulatedWind.direction} (${simulatedWind.degrees}°) at ${simulatedWind.speedMetersPerSecond} m/s`;
}

const styles = {
  panel: {
    position: 'fixed',
    right: 16,
    bottom: 16,
    zIndex: 1000,
    boxSizing: 'border-box',
    width: 'min(420px, calc(100vw - 32px))',
    maxHeight: 'calc(100dvh - 32px)',
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

export function WindSimulator({ lat, lon, onClose }: WindSimulatorProps) {
  const titleId = useId();

  return (
    <aside aria-labelledby={titleId} style={styles.panel}>
      <p style={styles.eyebrow}>Wind / Smoke Evacuation Simulator</p>
      <h2 id={titleId} style={styles.heading}>
        <span aria-hidden="true">🔥</span> Fire Detected at {formatCoordinates(lat, lon)}
      </h2>
      <div style={styles.wind}>
        <span aria-hidden="true" style={styles.arrow}>↗</span>
        <p style={styles.windText}>Wind Direction: <strong>{formatWind()}</strong></p>
      </div>
      <p style={styles.advisory}>Downwind areas should be on alert.</p>
      <p style={styles.scenario}>Simulation · fixed wind scenario</p>
      <button type="button" onClick={onClose} style={styles.close}>Close</button>
    </aside>
  );
}

export default WindSimulator;
