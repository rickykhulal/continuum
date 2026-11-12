import type { CSSProperties, ReactNode } from 'react';

export function Panel({
  title, eyebrow, right, children, className = '', id, dense,
}: {
  title?: string;
  eyebrow?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
  dense?: boolean;
}) {
  return (
    <section className={`panel ${dense ? 'panel-dense' : ''} ${className}`} id={id}>
      {(title || eyebrow) && (
        <header className="panel-head">
          <div>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            {title && <h2>{title}</h2>}
          </div>
          {right && <div className="panel-right">{right}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={accent ? { color: accent } : undefined}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'default', pulse }: { children: ReactNode; tone?: 'default' | 'live' | 'warn' | 'good' | 'mute'; pulse?: boolean }) {
  return (
    <span className={`badge badge-${tone}`}>
      {pulse && <i className="dot" />}
      {children}
    </span>
  );
}

export function Segmented<T extends string>({
  options, value, onChange, ariaLabel, compact,
}: {
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
  compact?: boolean;
}) {
  return (
    <div className={`segmented ${compact ? 'segmented-compact' : ''}`} role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          className={value === o.value ? 'active' : ''}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Sparkline({
  values, width = 120, height = 32, color = '#6ee7ff', fill = true, strokeWidth = 1.6,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  strokeWidth?: number;
}) {
  if (!values.length) return <svg width={width} height={height} aria-hidden />;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const pts = values.map((v, i) => [i * step, height - 2 - ((v - min) / span) * (height - 4)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${d} L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="spark">
      {fill && <path d={area} fill={color} opacity={0.13} />}
      <path d={d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function Gauge({ value, size = 92, label, color = '#6ee7ff' }: { value: number; size?: number; label?: string; color?: string }) {
  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="gauge" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(130,170,210,.18)" strokeWidth={5} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={5}
          strokeDasharray={`${(v / 100) * c} ${c}`} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray .7s cubic-bezier(.22,1,.36,1)' }}
        />
      </svg>
      <div className="gauge-center">
        <strong>{Math.round(value)}</strong>
        {label && <span>{label}</span>}
      </div>
    </div>
  );
}

export function Delta({ value, digits = 0 }: { value: number; digits?: number }) {
  const tone = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  const sign = value > 0 ? '+' : '';
  return <span className={`delta delta-${tone}`}>{sign}{value.toFixed(digits)}%</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Definition({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="def">
      <div className="def-term">{term}</div>
      <div className="def-body">{children}</div>
    </div>
  );
}

export function ChartTable({
  columns,
  rows,
  note,
  summary,
  children,
}: {
  columns: string[];
  rows: (string | number)[][];
  note?: string;
  summary?: string;
  children: ReactNode;
}) {
  return (
    <>
      {children}
      <TableAlt summary={summary} columns={columns} rows={rows} note={note} />
    </>
  );
}

export const visuallyHidden: CSSProperties = {
  position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap',
};

export function PageHeader({
  eyebrow, title, intro, chips, actions, className = '',
}: {
  eyebrow?: string;
  title: ReactNode;
  intro?: string | ReactNode;
  chips?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`page-head ${className}`} id="main">
      <div className="page-head-main">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {intro && <p>{intro}</p>}
        {chips && <div className="chip-row">{chips}</div>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </header>
  );
}

/** FR-33: every chart carries the same numbers as a collapsible, screen-reader-friendly table. */
export function TableAlt({
  summary = 'View data',
  columns,
  rows,
  note,
}: {
  summary?: string;
  columns: string[];
  rows: (string | number)[][];
  note?: string;
}) {
  return (
    <details className="table-alt">
      <summary>{summary.startsWith('Table of') ? 'View data' : summary}</summary>
      {rows.length === 0 ? (
        <p className="alt-note">No rows in the current window.</p>
      ) : (
        <div className="alt-scroll">
          <table className="alt-table">
            <thead>
              <tr>{columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {r.map((cell, j) => (
                    <th key={j} scope={j === 0 ? 'row' : undefined}>
                      {j === 0 ? cell : <span className="mono">{cell}</span>}
                    </th>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {note && <p className="alt-note">{note}</p>}
    </details>
  );
}
