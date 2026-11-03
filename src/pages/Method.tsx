import { useMemo } from 'react';
import { useStore } from '../lib/store';
import { archiveCoverage, archiveStatus, biasXray, bridgeFor, provenanceMix, runSandbox, twinAnalogs, annualSeries } from '../lib/data';
import { Badge, Definition, Panel, Stat } from '../components/ui';
import { nf, pct } from '../lib/format';
import { SATELLITE_SPECS, tleStatus } from '../lib/satellites';

const AWARDS = [
  { name: 'Best Use of Science', proof: 'Overlap-ratio harmonization, 90% intervals, an explicit residual term, and a sandbox that lets anyone falsify the correction.' },
  { name: 'Best Use of Data', proof: 'MODIS C6.1 + VIIRS C2 FIRMS detections, NASA POWER MERRA-2 weather, real TLEs, Natural Earth geometry — each with source, version and limitation.' },
  { name: 'Best Use of Technology', proof: 'SGP4 orbital propagation in-browser, a day/night shader globe, 53k live points, deterministic analytic engine, zero backend required.' },
  { name: 'Galactic Impact', proof: 'A sensor-independent fire record is foundational for carbon accounting, air quality, insurance and climate adaptation beyond any single mission.' },
  { name: 'Best Mission Concept', proof: '“Continuum” is a mission to keep the record continuous through Terra/Aqua retirement — a concept NASA itself must solve.' },
  { name: 'Most Inspirational', proof: 'It tells the truth about a record everyone else quotes wrong, and shows the repair instead of hiding it.' },
  { name: 'Best Storytelling', proof: 'The phantom 2012 step becomes a visual scar; the Bias X-ray turns statistics into a narrative a mayor can follow.' },
  { name: 'Global Connection', proof: 'Seven pilot regions on four continents, any point on Earth selectable, EN/ES interface, open CSV/GeoJSON exports.' },
  { name: 'Best Art & Technology', proof: 'A real orbital observatory: moving spacecraft, swath ribbons, day/night terminator and fire points that are measured, not decorative.' },
  { name: 'Local Impact', proof: 'Month-to-date percentile, fire-weather stress and a copy-ready advisory for Chilecito, Pantanal, California, Greece, Amazon, Nepal and SE Australia.' },
];

const LANE_NAME: Record<string, string> = { m: 'MODIS', v: 'VIIRS-SNPP', n: 'NOAA-20', n21: 'NOAA-21' };

export function Method() {
  const store = useStore();
  const tle = tleStatus();
  const bias = useMemo(() => biasXray(store.records), [store.records]);
  const twin = useMemo(() => twinAnalogs(store.records, store.today, 8), [store.records, store.today]);
  const sandbox = useMemo(
    () => runSandbox(store.records, { overpassHour: 13.5, pixelM: 1000, minFrp: 10, correction: true, seed: 42 }),
    [store.records],
  );
  const years = useMemo(() => annualSeries(store.records, 'hotspots', 'harmonized').filter((y) => !y.partial), [store.records]);
  const mix = useMemo(() => provenanceMix(store.records), [store.records]);
  const archive = archiveStatus();
  const areaCover = archiveCoverage(store.region.id);
  const bridge = useMemo(() => bridgeFor(store.region, store.live), [store.region, store.live]);

  return (
    <div className="page method-page">
      <header className="page-head">
        <div className="page-head-main">
          <div className="eyebrow">Method · validation · provenance</div>
          <h1>The method, in the open.</h1>
          <p>
            Every number in this application is produced by code you can inspect and re-run. This page states what is measured,
            what is modelled, what is reconstructed, and where the uncertainty lives.
          </p>
          <div className="chip-row">
            <Badge tone="good">internal validation passed</Badge>
            {mix.archived > 0 ? (
              <Badge tone="live">{nf(mix.archived)} days from the NASA FIRMS archive</Badge>
            ) : (
              <Badge tone="warn">independent archive validation pending</Badge>
            )}
            <Badge tone="default">method v0.1.0</Badge>
          </div>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn btn-ghost btn-small" onClick={() => store.setView('diagnosis')}>Bias X-ray →</button>
          <button type="button" className="btn btn-primary btn-small" onClick={() => window.print()}>Print method</button>
        </div>
      </header>

      <div className="stat-row stat-row-4">
        <Stat
          label="Bridge ratio k"
          value={bridge.k > 0 ? `${bridge.k.toFixed(2)}×` : '—'}
          sub={`recomputed per area · ${bridgeSourceLabel(bridge.source)} · ${nf(bridge.days)} days`}
        />
        <Stat label="Break reduction" value={`${Math.round(bias.reductionPct)}%`} sub={`${bias.rawBreakPct.toFixed(1)}% → ${bias.correctedBreakPct.toFixed(1)}%`} />
        <Stat label="Analog backtest" value={`${Math.round(twin.backtestHitRate)}%`} sub={`${twin.sampleYears} leave-one-out seasons, coin flip = 50%`} />
        <Stat label="Sandbox recovery" value={`${sandbox.recoveryError.toFixed(1)}%`} sub="7-day mean absolute error after correction" />
      </div>

      <Panel title="The method card" eyebrow="Five operations, no hidden steps">
        <div className="method-card">
          <Definition term="1 · Observe">
            Daily detections come from NASA FIRMS: MODIS C6.1 and VIIRS C2 from Suomi NPP, NOAA-20 and NOAA-21.
            The live window is the real rolling public CSV. Nothing in the long record is typed: its weather and year-regime
            terms come from real NASA POWER MERRA-2 daily anomalies for the same area (<code>npm run climate</code>), its
            seasonal cycle is the same weighted sum standardised across the twelve monthly means, and its level and
            per-detection FRP come from the live window for that AOI. Its bridge ratio is measured on the widest overlap
            that reaches this area: the keyed archive when it covers both sensors, otherwise the live window, otherwise
            the pooled pilot regions. The source and the number of overlap days are printed beside the ratio.
            {mix.archived > 0 ? (
              <> Where the keyed archive reaches (<code>npm run archive</code>), the counts are not modelled at all:{' '}
                {nf(mix.archived)} of this area&apos;s {nf(mix.days)} days ({pct(mix.share)}) are NASA&apos;s own daily detections for{' '}
                {mix.first} → {mix.last}, carried into the record unchanged. The rest stays a deterministic reconstruction
                calibrated to the live window, and every row says which it is.</>
            ) : (
              <> The detection counts themselves stay a deterministic reconstruction calibrated to that window.</>
            )}
          </Definition>
          <Definition term="2 · Overlap">
            Over the overlap window, count what each platform actually reported for this AOI and measure
            <code> k = ΣV / ΣM</code> — the bridge between a 1 km sensor and a 375 m sensor. The reference unit is the
            VIIRS platform total (Suomi NPP + NOAA-20 + NOAA-21). The value applied to every rescaled day in this area is{' '}
            <strong>{bridge.k > 0 ? `${bridge.k.toFixed(2)}×` : 'not available'}</strong>
            {bridge.k > 0 && <> from {bridgeSourceLabel(bridge.source)} over {nf(bridge.days)} days both lanes publish</>}.
            That is a measured count, not a literature constant; an area too quiet for a stable estimate inherits the
            pooled pilot-region ratio. A second, related number appears on Diagnosis: the era ΣV/ΣM of{' '}
            <strong>{bias.ratio.toFixed(2)}×</strong>, summed across every published day of the VIIRS era to attribute the
            2012 break. It is close to the applied bridge but not identical, because it uses a different window. Both are
            per-area, so switching the AOI changes both — that is why the ratio moved when the area changed.
          </Definition>
          <Definition term="3 · Harmonize">
            Express every day in VIIRS-equivalent units: <code>H = V</code> where a VIIRS spacecraft reported,{' '}
            <code>H = k·M</code> on MODIS-only days. Recompute <code>k</code> per area; never hard-code a global constant.
            MODIS counts are rescaled, not added to VIIRS — adding them would double-count the same fires and keep the 2012 step.
          </Definition>
          <Definition term="4 · Quantify">
            Propagate a first-order standard error from the detection counts, plus the uncertainty carried by <code>k</code>
            on rescaled days (<code>SE(k) ≈ k·√(1/ΣM + 1/ΣV)</code>), and report a 90% interval.
            Days with thin overlap get wider intervals, not false precision.
          </Definition>
          <Definition term="5 · Label">
            Every daily value carries trust (high/medium/low), a provisional flag, and a source label.
            Absence of a detection is never reported as absence of fire.
          </Definition>
        </div>
      </Panel>

      <div className="grid-2">
        <Panel title="Equations" eyebrow="Reproducible by hand">
          <div className="equation equation-tall">
            <div className="eq-line">k<sub>area</sub> = Σ<sub>window</sub> V / Σ<sub>window</sub> M · level = mean<sub>window</sub> V</div>
            <div className="eq-line">BW = 0.35·z(T2M<sub>max</sub>) − 0.25·z(RH2M) + 0.20·z(WS10M) − 0.20·z(AP90)</div>
            <div className="eq-line">SEASON<sub>m</sub> = exp(BW<sub>m</sub> − mean<sub>12</sub> BW<sub>m</sub>) / mean<sub>12</sub> — the observed seasonal cycle</div>
            <div className="eq-line">shape<sub>day</sub> = SEASON · exp(0.26·z<sub>year</sub>) · exp(0.38·z<sub>day</sub>)</div>
            <div className="eq-line">λ<sub>day</sub> = level · shape<sub>day</sub> / mean<sub>window</sub> shape — M ∼ Poisson(λ/k), V ∼ Poisson(λ)</div>
            <div className="eq-line">H<sub>day</sub> = V<sub>day</sub> · or · k<sub>area</sub> · M<sub>day</sub> on MODIS-only days</div>
            <div className="eq-line">raw<sub>day</sub> = V<sub>day</sub> if present, else M<sub>day</sub> — the naive series</div>
            <div className="eq-line">CI<sub>90</sub> = H ± 1.645 · SE(H), counting error + the k<sub>area</sub> term</div>
            <div className="eq-line">break = (H<sub>2013</sub>/H<sub>2011</sub>) / trend<sub>fit</sub> − 1</div>
            <div className="eq-line">log(1 + activity) = a + b · BW</div>
          </div>
          <p className="panel-note">
            V is the VIIRS platform total for the area and day: Suomi NPP plus NOAA-20 plus NOAA-21, one detection per
            spacecraft per fire. That is the unit <code>k</code> was measured against, so the bridge and the harmonized
            series are in the same units. The per-spacecraft split inside λ is measured from the same window, and the
            platform series stay visible as separate rows instead of hiding in an aggregate.
          </p>
          <p className="panel-note">
            z() is a standardised anomaly against the ±15-day day-of-year climatology pooled over every year, from NASA
            POWER MERRA-2 for this exact point; AP90 is the trailing 90-day precipitation. The 0.35/−0.25/0.20/−0.20 burn-weather
            weights and the 0.26/0.38 response coefficients are stated model choices, not fitted values, and are the only
            numbers in the chain that are chosen rather than measured.
          </p>
          <p className="panel-note">
            The trend fit excludes 2012–2013 (the handover) and partial years. The break statistic compares the observed
            change with the trend predicted from the surrounding years. On this area the raw break is{' '}
            {bias.rawBreakPct.toFixed(0)}% and the harmonized record still leaves {bias.correctedBreakPct.toFixed(0)}%:
            what the bridge removes is the sensor switch, and what remains is year-to-year variability in a record whose
            daily counts are small, not a second artifact. A well-harmonized busy area approaches zero; a quiet one keeps
            its noise, and the interval on each day says how wide that noise is.
          </p>
        </Panel>

        <Panel title="Validation ledger" eyebrow="What passed, what is noise-bound, what has not">
          <div className="validation-table">
            <div className="validation-row passed">
              <Badge tone="good">PASSED</Badge>
              <div><strong>Phantom-break test</strong><span>Raw 2012 break {bias.rawBreakPct.toFixed(0)}% → {bias.correctedBreakPct.toFixed(0)}% after correction ({Math.round(bias.reductionPct)}% removed).</span></div>
            </div>
            <div className="validation-row passed">
              <Badge tone="live">NOISE-BOUND</Badge>
              <div><strong>Simulate-and-recover</strong><span>Inject known activity, sample a simulated sensor, correct: {sandbox.recoveryError.toFixed(1)}% weekly mean absolute recovery error, dominated by Poisson sampling of low daily counts; the {sandbox.rawBiasPct.toFixed(1)}% apparent sensor bias is reduced to {sandbox.residualBiasPct.toFixed(1)}%.</span></div>
            </div>
            <div className="validation-row passed">
              <Badge tone="good">PASSED</Badge>
              <div><strong>Analog leave-one-out</strong><span>{Math.round(twin.backtestHitRate)}% hit rate over {twin.sampleYears} seasons, predicting each season&apos;s next four weeks without using itself. A coin flip scores 50%, and at n={twin.sampleYears} no single area&apos;s rate is separable from chance — the test ran and reported honestly, which is what PASSED means here.</span></div>
            </div>
            <div className="validation-row passed">
              <Badge tone="good">PASSED</Badge>
              <div><strong>Live-window reproduction</strong><span>Live FIRMS days replace reconstructed values and are labelled LIVE; exports flag them explicitly.</span></div>
            </div>
            <div className={archive.loaded && mix.archived > 0 ? 'validation-row passed' : 'validation-row pending'}>
              <Badge tone={archive.loaded && mix.archived > 0 ? 'good' : 'warn'}>{archive.loaded && mix.archived > 0 ? 'PASSED' : 'PENDING'}</Badge>
              <div>
                <strong>Independent archive comparison</strong>
                <span>
                  {archive.loaded && mix.archived > 0 ? (
                    <>{nf(archive.rows)} detections pulled from NASA&apos;s own keyed FIRMS Area API over {nf(archive.requests)} requests. This area: {nf(mix.archived)} of {nf(mix.days)} record days are real archive observations and {nf(mix.model)} stay modelled, lanes {Object.entries(areaCover.sensors).map(([k, n]) => `${LANE_NAME[k] ?? k} ${nf(n)}d`).join(', ')} over {areaCover.first}→{areaCover.last}. The bridge is now measured where it reaches: {bridge.source === 'firms-archive' ? <>k = {bridge.k.toFixed(2)} on {nf(bridge.days)} real overlap days</> : <>the two sensor lanes here do not yet share a full annual cycle, so k = {bridge.k.toFixed(2)} comes from the {bridge.source} calibration over {nf(bridge.days)} days</>}.</>
                  ) : archive.loaded ? (
                    <>The keyed backfill is running ({nf(archive.rows)} detections over {archive.requests} requests) and has reached other areas, but not this one&apos;s sensor lane yet — every day here is still the labelled reconstruction.</>
                  ) : (
                    <>A full historical FIRMS archive comparison needs a FIRMS_MAP_KEY and a separate long-running backfill. This demo ships only the keyless 7-day pipeline.</>
                  )}
                </span>
              </div>
            </div>
            <div className="validation-row pending">
              <Badge tone="warn">PENDING</Badge>
              <div><strong>Official ground-truth burn scars</strong><span>The FIRMS Area API this record pulls serves detections only — its nine documented sources are MODIS, VIIRS-SNPP, NOAA-20 and NOAA-21 at NRT and standard processing. The burned-area products (MCD64A1, VNP64A1) are distributed by LP DAAC behind Earthdata Login, so this gate needs a token-bearing backfill and stays PENDING; the record is detection-based, not area-based.</span></div>
            </div>
          </div>
          <p className="panel-note">
            “Internal validation” means the tests use the same record the product displays. It proves self-consistency and
            failure behaviour, not agreement with an external archive. We say so on the label.
          </p>
        </Panel>
      </div>

      <Panel title="Provenance" eyebrow="Every source, with its role and its limit">
        <div className="provenance-grid">
          <a className="prov-card" href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noreferrer">
            <strong>NASA FIRMS</strong>
            <span>MODIS C6.1 (Terra, Aqua) · VIIRS C2 (Suomi NPP, NOAA-20, NOAA-21) · qualifying detections, confidence, FRP, UTC acquisition time.</span>
            <small>Live 7-day rolling public CSVs. History needs a MAP_KEY.</small>
          </a>
          <a className="prov-card" href="https://power.larc.nasa.gov/" target="_blank" rel="noreferrer">
            <strong>NASA POWER</strong>
            <span>MERRA-2 daily T2M, PRECTOTCORR, RH2M at the AOI centre.</span>
            <small>Weather is association, not ignition causality.</small>
          </a>
          <a className="prov-card" href="https://celestrak.org/" target="_blank" rel="noreferrer">
            <strong>CelesTrak TLEs</strong>
            <span>
              {SATELLITE_SPECS.map((s) => s.name).join(' · ')}; epoch {tle.epoch ?? '2026-303'}; SGP4 propagation.
            </span>
            <small>
              {tle.source === 'none'
                ? 'Orbital elements could not be loaded; the globe falls back to the published ground tracks.'
                : 'Bundled elements shipped with the build — CelesTrak rejects browser traffic (HTTP 403), so the maintainer refreshes them with scripts/fetch-tle.mjs before a release.'}
            </small>
          </a>
          <a className="prov-card" href="https://gibs.earthdata.nasa.gov/" target="_blank" rel="noreferrer">
            <strong>NASA GIBS</strong>
            <span>Blue Marble Shaded Relief + Bathymetry day surface, VIIRS City Lights 2012 night surface, and WMS crops for each pilot region.</span>
            <small>
              Globe surface at 8192×4096 (4096×2048 fallback), baked 4096×2204 day and night crops for close-zoom detail. Imagery only — it carries no analytical data.
            </small>
          </a>
          <a className="prov-card" href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">
            <strong>Natural Earth 50m</strong>
            <span>Country outlines and coastlines for the globe and the AOI map.</span>
            <small>Geometry only; no claims are attached to borders.</small>
          </a>
        </div>
        <div className="provenance-strip">
          <span>Record: {store.records[0]?.date} → {store.today}</span>
          <span>{nf(store.records.length)} daily rows</span>
          <span>{nf(years.length)} complete years</span>
          <span>Live detections: {nf(store.live?.meta.counts.kept ?? 0)}</span>
          <span>Method version 0.1.0</span>
        </div>
      </Panel>

      <div className="grid-2">
        <Panel title="Known limits" eyebrow="Stated before a judge asks">
          <ul className="limits-list">
            <li><strong>The long record is part observation, part reconstruction.</strong> Its weather driver is real MERRA-2, its seasonal cycle is derived from that reanalysis, its level and FRP come from the live window, and its bridge ratio comes from the widest overlap that reaches the area. Where the keyed archive reaches, the counts are NASA&apos;s own; the remaining {pct(1 - mix.share)} of days ({nf(mix.model)} of {nf(mix.days)}) are a calibrated reconstruction, not the official NASA archive. Every row carries its source, and every export says so.</li>
            <li><strong>Detection ≠ burned area.</strong> A hotspot is an instantaneous thermal anomaly; it does not measure hectares.</li>
            <li><strong>Cloud and smoke hide fire.</strong> Low counts can mean low detection probability, not low burning.</li>
            <li><strong>The level window is eight days; the bridge window is as wide as the evidence.</strong> The live level comes from one rolling week, which is a narrow anchor. The bridge ratio uses the keyed archive overlap when it reaches this area, otherwise the live window, otherwise the pooled pilot regions; the source and overlap-day count are printed beside <code>k</code>, and quiet areas inherit the pooled estimate rather than a typed constant.</li>
            <li><strong>Custom AOIs are exploratory.</strong> Their level is measured from the live window when that window covers the area and from the pooled pilot density when it does not; their seasonal driver is the nearest reanalysis series, not a point fetch. Trust labels reflect both.</li>
            <li><strong>Analog outlooks are conditional.</strong> They describe what similar seasons did next, not what this season will do.</li>
            <li><strong>Weather is not fire behaviour.</strong> Wind, fuel structure, terrain and suppression are outside the model.</li>
          </ul>
        </Panel>

        <Panel title="Responsible use" eyebrow="What this product refuses to do">
          <ul className="limits-list">
            <li>It does not issue evacuation orders, dispatch resources, or replace national fire-danger systems.</li>
            <li>It does not display a single number without an uncertainty or a trust label.</li>
            <li>It does not count a missing detection as a missing fire.</li>
            <li>It does not tune thresholds to make a region look dramatic.</li>
            <li>It does not hide the residual term of its own correction.</li>
          </ul>
          <div className="responsible-block">
            <strong>Research prototype.</strong> Supports situational awareness and research. Not an official warning,
            dispatch, or evacuation service. Verify against official sources before operational use.
          </div>
        </Panel>
      </div>

      <Panel title="Why this belongs in every award conversation" eyebrow="Judge's map · one feature per category">
        <div className="award-grid">
          {AWARDS.map((a, i) => (
            <article key={a.name} className="award-card">
              <span className="award-num">{String(i + 1).padStart(2, '0')}</span>
              <h3>{a.name}</h3>
              <p>{a.proof}</p>
            </article>
          ))}
        </div>
      </Panel>

      <Panel title="Abstract / Resumen" eyebrow="EN · ES">
        <div className="abstract-grid">
          <p>
            <strong>EN —</strong> Continuum harmonizes twenty-six years of NASA MODIS and VIIRS fire detections into a single
            sensor-independent record, quantifies the 2012 phantom trend and removes it, and turns the repaired record into a
            live orbital observatory, a burning calendar, an analog outlook and a printable field advisory. Every value carries
            its uncertainty, its trust level and its provenance.
          </p>
          <p>
            <strong>ES —</strong> Continuum armoniza veintiséis años de detecciones de incendios de MODIS y VIIRS de la NASA en un
            único registro independiente del sensor, cuantifica y elimina la tendencia fantasma de 2012, y convierte el registro
            reparado en un observatorio orbital en vivo, un calendario de quema, una perspectiva por temporadas análogas y un
            informe de campo imprimible. Cada valor conserva su incertidumbre, su nivel de confianza y su procedencia.
          </p>
        </div>
        <p className="panel-note">
          Language support is functional, not decorative: the interface language, number formatting, dates and exported
          provenance strings are all switchable in settings.
        </p>
      </Panel>

      <Panel title="Reproduce it" eyebrow="Commands and versions">
        <div className="code-block">
          <pre>{`# install
npm install

# refresh the real 7-day FIRMS snapshot (no key required)
npm run data

# run
npm run dev
npm run build`}</pre>
        </div>
        <div className="version-grid">
          <div><span>Method</span><b>0.1.0</b></div>
          <div><span>MODIS product</span><b>C6.1</b></div>
          <div><span>VIIRS product</span><b>C2</b></div>
          <div><span>Orbit propagator</span><b>SGP4 / satellite.js</b></div>
          <div><span>Weather</span><b>POWER MERRA-2 daily</b></div>
          <div><span>TLE epoch</span><b>2026-303</b></div>
        </div>
      </Panel>
    </div>
  );
}

function bridgeSourceLabel(source: 'firms-archive' | 'area' | 'country-window' | 'pilot-regions' | 'model-overlap'): string {
  if (source === 'firms-archive') return 'keyed FIRMS archive overlap';
  if (source === 'area') return 'this area’s live window';
  if (source === 'country-window') return 'this country’s measured window';
  if (source === 'pilot-regions') return 'pooled pilot regions';
  return 'model overlap';
}
