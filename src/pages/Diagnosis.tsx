import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { biasXray, bridgeFor, runSandbox } from '../lib/data';
import { Badge, Panel, PageHeader, Stat } from '../components/ui';
import { SandboxChart, TrendCompare, Waterfall } from '../components/charts';
import { nf, pct } from '../lib/format';
import { SATELLITE_SPECS } from '../lib/satellites';

export function Diagnosis() {
  const store = useStore();
  const bias = useMemo(() => biasXray(store.records), [store.records]);
  const bridge = useMemo(() => bridgeFor(store.region, store.live), [store.region, store.live]);
  const [overpassHour, setOverpassHour] = useState(13.5);
  const [pixelM, setPixelM] = useState(1000);
  const [minFrp, setMinFrp] = useState(10);
  const [correction, setCorrection] = useState(true);
  const [seed, setSeed] = useState(42);
  const result = useMemo(
    () => runSandbox(store.records, { overpassHour, pixelM, minFrp, correction, seed }),
    [store.records, overpassHour, pixelM, minFrp, correction, seed],
  );

  return (
    <div className="page diagnosis-page">
      <PageHeader
        eyebrow="Diagnosis · the record doctor"
        title="Find the step. Remove the step. Show the scar."
        intro={
          <>
            The 2012 MODIS → VIIRS handover added nine-times-smaller pixels to the observing system.
            Raw fire counts jumped. The fires did not. This is the arithmetic behind the correction —
            including its uncertainty and its residual.
          </>
        }
        chips={
          <>
            <Badge tone="good">calibration: real overlap days</Badge>
            <Badge tone="default">90% intervals</Badge>
            <Badge tone="warn">residual reported, not hidden</Badge>
          </>
        }
        actions={
          <>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => store.setView('outlook')}>Outlook →</button>
            <button type="button" className="btn btn-primary btn-small" onClick={() => store.setView('method')}>Full method</button>
          </>
        }
      />

      <div className="atlas-kpi-bar" role="region" aria-label="Key bias diagnosis metrics">
        <div className="atlas-kpi-card" style={{ borderLeftColor: '#ff8a3d' }}>
          <span className="atlas-kpi-label">Raw 2012 break</span>
          <div className="atlas-kpi-val" style={{ color: '#ff8a3d' }}>{pct(bias.rawBreakPct, 1)}</div>
          <span className="atlas-kpi-sub">MODIS → VIIRS uncorrected jump</span>
        </div>
        {bias.seam && (
          <div className="atlas-kpi-card">
            <span className="atlas-kpi-label">Archive seam</span>
            <div className="atlas-kpi-val">{pct(bias.seam.pct, 1)}</div>
            <span className="atlas-kpi-sub">{bias.seam.switches} switch{bias.seam.switches === 1 ? '' : 'es'} · first {bias.seam.from}</span>
          </div>
        )}
        <div className="atlas-kpi-card" style={{ borderLeftColor: '#34d399' }}>
          <span className="atlas-kpi-label">Harmonized residual</span>
          <div className="atlas-kpi-val" style={{ color: '#34d399' }}>{pct(bias.correctedBreakPct, 1)}</div>
          <span className="atlas-kpi-sub">after overlap-ratio correction</span>
        </div>
        <div className="atlas-kpi-card" style={{ borderLeftColor: '#38bdf8' }}>
          <span className="atlas-kpi-label">Break removed</span>
          <div className="atlas-kpi-val" style={{ color: '#38bdf8' }}>{Math.round(bias.reductionPct)}%</div>
          <span className="atlas-kpi-sub">quantified, not erased</span>
        </div>
        <div className="atlas-kpi-card">
          <span className="atlas-kpi-label">Era bridge ΣV/ΣM</span>
          <div className="atlas-kpi-val">{bias.ratio.toFixed(2)}<small>× contagion</small></div>
          <span className="atlas-kpi-sub">90% CI {bias.ratioLo.toFixed(2)}–{bias.ratioHi.toFixed(2)} · {bias.overlapDays} d</span>
        </div>
      </div>

      <Panel title="Bias X-ray" eyebrow="Decomposition of the 2012 sensor transition step" className="waterfall-panel" right={<Badge tone="default">pp = percentage points</Badge>}>
        <div className="waterfall-hero">
          <Waterfall bias={bias} />
        </div>
        <div className="component-grid">
          {bias.components.map((c) => (
            <article key={c.key} className="component-card">
              <div className="component-head">
                <strong>{c.label}</strong>
                <span className="mono-num">{pct(c.value, 1)}</span>
              </div>
              <div className="component-track">
                <i style={{ width: `${Math.min(100, (Math.abs(c.value) / Math.max(1, Math.abs(bias.rawBreakPct)))) * 100}%` }} />
              </div>
              <p>{c.explanation}</p>
              <small>attribution band {c.lo.toFixed(1)} to {c.hi.toFixed(1)} pp</small>
            </article>
          ))}
        </div>
        <details className="method-disclosure">
          <summary>Read full attribution methodology & terminology</summary>
          <div className="method-disclosure-content">
            <p>
              The total break is measured from the record. Its split across the four mechanisms is weighted by quantities
              measured in this same record — |ln <code>k</code>| = {bias.ratio.toFixed(2)}, the per-detection FRP ratio, the
              share of days with no VIIRS report, and the 90% interval on <code>k</code> — so the shares move when an area's
              own measurements move. The largest term here is{' '}
              {bias.components.reduce((a, b) => (Math.abs(b.value) > Math.abs(a.value) ? b : a)).label.toLowerCase()}. Even so,
              the bars are accounting, not causal identification: the residual term absorbs everything the weights cannot
              attribute, and a correction that reports zero residual is a correction that is hiding something.
            </p>
            <div className="glossary-grid">
              <div><strong>Era bridge</strong>: Empirical multiplier derived across years where both MODIS and VIIRS flew simultaneously.</div>
              <div><strong>VIIRS-equivalent</strong>: Standardized unit adjusting MODIS 1km observations to match VIIRS 375m spatial sensitivity.</div>
              <div><strong>FRP (Fire Radiative Power)</strong>: Instantaneous radiant heat output in Megawatts (MW) emitted by detected fires.</div>
              <div><strong>Residual term</strong>: Unexplained variance between observed and predicted break magnitude.</div>
            </div>
          </div>
        </details>
      </Panel>

      <div className="grid-2">
        <Panel title="The phantom trend" eyebrow="Raw versus harmonized annual totals">
          <TrendCompare records={store.records} mode="harmonized" />
          <p className="panel-note">
            The orange line is the record most dashboards display. The cyan line is the same fires, expressed in the same
            units across the handover. The gap at 2012 is the sensor change, not a change in burning.
          </p>
        </Panel>

        <Panel title="What the calibration says" eyebrow="Overlap-day method">
          <div className="equation">
            <div className="eq-line">k = Σ VIIRS<sub>overlap</sub> / Σ MODIS<sub>overlap</sub></div>
            <div className="eq-line">H = V on VIIRS days · H = k · M on MODIS-only days</div>
            <div className="eq-line">SE(k) ≈ k · √(1/ΣM + 1/ΣV)</div>
          </div>
          <p className="mini-copy">
            <strong>k</strong> is measured only on days both instruments observed the same area.
            <strong> H</strong> is the VIIRS-equivalent count. <strong>SE</strong> is a first-order delta-method
            approximation; the reported 90% interval is ±1.645 SE, widened for days with cloud or partial overpasses.
          </p>
          <div className="method-facts">
            <div><span>Overlap days in region</span><b>{nf(bias.overlapDays)}</b></div>
            <div><span>Era bridge ΣV/ΣM</span><b>{bias.ratio.toFixed(2)}×</b></div>
            <div><span>Applied bridge k</span><b>{bridge.k > 0 ? `${bridge.k.toFixed(2)}×` : '—'}</b></div>
            <div><span>Applied source</span><b>{bridgeSourceLabel(bridge.source)} · {nf(bridge.days)} d</b></div>
            <div><span>90% CI on era ratio</span><b>{bias.ratioLo.toFixed(2)}–{bias.ratioHi.toFixed(2)}</b></div>
          </div>
          <p className="panel-note">
            Two ratios are in play and both are measured here. The <strong>era ratio</strong> sums every published day of
            the VIIRS era and is what the break attribution below weights; it is broad because it spans the whole record.
            The <strong>applied bridge k</strong> is what the harmonized series actually multiplies MODIS-only days by; it
            uses the widest overlap that really observed both instruments in this area — the keyed FIRMS archive when it
            reaches, otherwise the live window — so it is narrower and can differ from the era ratio. Both are recomputed
            per area: switch the AOI and both numbers move, because each area has its own detection mix. Quiet, coastal or
            high-latitude areas get wider intervals rather than a typed constant.
          </p>
        </Panel>
      </div>

      <Panel
        title="Sensor sandbox"
        eyebrow="Build a virtual instrument. Watch the correction recover the truth."
        right={<Badge tone={correction ? 'good' : 'warn'}>{correction ? 'correction ON' : 'raw sensor only'}</Badge>}
      >
        <div className="sandbox">
          <div className="sandbox-controls">
            <label className="range-field">
              <span>
                Overpass hour{' '}
                <b>{`${String(Math.floor(overpassHour)).padStart(2, '0')}:${overpassHour % 1 ? '30' : '00'}`}</b>
              </span>
              <input type="range" min={6} max={18} step={0.5} value={overpassHour} onChange={(e) => setOverpassHour(Number(e.target.value))} />
              <small>Fires peak in the afternoon. A dawn overpass samples a different fire cycle.</small>
            </label>
            <label className="range-field">
              <span>Pixel size <b>{pixelM} m</b></span>
              <input type="range" min={250} max={2000} step={25} value={pixelM} onChange={(e) => setPixelM(Number(e.target.value))} />
              <small>Smaller pixels resolve smaller fires. This is the dominant term in the 2012 break.</small>
            </label>
            <label className="range-field">
              <span>Minimum FRP <b>{minFrp} MW</b></span>
              <input type="range" min={0} max={60} step={1} value={minFrp} onChange={(e) => setMinFrp(Number(e.target.value))} />
              <small>Raising the threshold hides cool fires — a policy choice disguised as data cleaning.</small>
            </label>
            <div className="sandbox-actions">
              <button type="button" className={`btn btn-small ${correction ? 'btn-live' : 'btn-ghost'}`} onClick={() => setCorrection((c) => !c)}>
                {correction ? 'Correction applied' : 'Apply correction'}
              </button>
              <button type="button" className="btn btn-small btn-ghost" onClick={() => setSeed((s) => s + 1)}>Resample noise</button>
            </div>
          </div>
          <div className="sandbox-chart">
            <SandboxChart result={result} />
            <div className="sandbox-results">
              <div><span>Apparent bias</span><b className="warn">{pct(result.rawBiasPct, 1)}</b></div>
              <div><span>Residual bias</span><b className="good">{pct(result.residualBiasPct, 1)}</b></div>
              <div><span>7-day recovery error</span><b className="good">{result.recoveryError.toFixed(1)}%</b></div>
              <div><span>Simulated days</span><b>{nf(result.truth.length)}</b></div>
              <div><span>Truth source</span><b>reference record</b></div>
            </div>
            <p className="panel-note">
              The sandbox draws Poisson detections from the real daily record using detection probability set by your
              instrument. Scores are computed on 7-day blocks because single-day Poisson noise is irreducible and says
              more about counting statistics than about the correction. It is a teaching instrument, not a forecast:
              the truth is the reference record — archive observations where the keyed FIRMS
              backfill reaches, reconstruction elsewhere.
            </p>
          </div>
        </div>
      </Panel>

      <Panel title="The constellation that made the record" eyebrow="Real orbits · real trade-offs">
        <div className="sat-table-wrap">
          <table className="sat-table">
            <thead>
              <tr><th>Spacecraft</th><th>Sensor</th><th>Pixel</th><th>Swath</th><th>Overpass</th><th>Era</th><th>Role</th></tr>
            </thead>
            <tbody>
              {SATELLITE_SPECS.map((s) => (
                <tr key={s.id}>
                  <td><i className="sat-dot" style={{ background: s.color }} />{s.name}</td>
                  <td>{s.sensor}</td>
                  <td>{s.pixelM} m</td>
                  <td>{nf(s.swathKm)} km</td>
                  <td>{s.overpass}</td>
                  <td>{s.era}</td>
                  <td className="cell-copy">{s.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="panel-note">
          TLEs are real and propagated with SGP4 in the browser. The detection record is historical; the orbital view is
          the actual geometry of the spacecraft overhead now.
        </p>
      </Panel>
    </div>
  );
}

function bridgeSourceLabel(source: 'firms-archive' | 'area' | 'country-window' | 'pilot-regions' | 'model-overlap'): string {
  if (source === 'firms-archive') return 'archive overlap';
  if (source === 'area') return 'live window';
  if (source === 'country-window') return 'country window';
  if (source === 'pilot-regions') return 'pooled pilots';
  return 'model overlap';
}
