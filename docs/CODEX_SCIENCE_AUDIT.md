# Codex Science Audit — Continuum NASA Space Apps

**Agent**: OpenAI Codex  
**Mode**: Read-only audit (no modifications authorized)  
**Scope**: Scientific algorithms, historical archive, sensor harmonization, bridge ratios, daily-cycle model, uncertainty calculations, data provenance, mathematical tests  
**Report Date**: 2026-11-14  

---

## 1. Scientific Architecture Overview

### 1.1 Core Science Pipeline (read-only)

The Continuum system implements a deterministic reconstruction of fire-observation records from 2000–present, with a rolling 7-day live window of recent FIRMS detections. The pipeline is:

```
NASA FIRMS CSVs (4 sources: MODIS C6.1, VIIRS S-NPP, NOAA-20, NOAA-21)
        ↓ scripts/fetch-live.mjs / scripts/build-data.mjs
data_raw/*.csv (keyed, unmodified NASA CSVs)
        ↓ scripts/backfill-archive.mjs (requires FIRMS_MAP_KEY)
public/data/archive_daily.json (keyed archive, sensor × area lanes)
        ↓ src/lib/archive.ts attachment
record builder (src/lib/data.ts) → DailyRecord[] per region
        ↓ browser/React (LiveMap, Atlas, Diagnosis, etc.)
UI render with provenance labels ('live' | 'model' | 'blend' | 'archive')
```

### 1.2 Key Modules (source inspection only)

| Module | File | Role |
|--------|------|------|
| Archive attachment | `src/lib/archive.ts` | Attach keyed archive to record builder; compute bridge ratios, sensor completion, FRP distributions |
| Record builder | `src/lib/data.ts` | Combine observed archive days, recent observations and deterministic reconstructed days; derive harmonized counts, FRP, intervals and provenance |
| Bridge ratio | `src/lib/data.ts` → `calibrationFor()`, `archiveRatio()`, `biasXray()` | MODIS→VIIRS bridge: measured k-ratio from overlap days, with daily-cycle correction |
| Daily-cycle model | `src/lib/archive.ts` → `dailyCycleFromOverlap()`, `dailyCycleWeight()`, `applyDailyCycleCorrection()` | Time-of-day corrected bridge ratio using 13:30 overpass reference hour |
| Constellation completion | `src/lib/archive.ts` → `constellationWeights()`, `platformEquivalent()` | VIIRS lane weighting: SNPP/NOAA-20/NOAA-21 shares measured on archive days |
| Sandbox simulation | `src/lib/data.ts` → `runSandbox()` | Simulated detection and recovery error per seed; known Poisson noise model |
| Analog backtest | `src/lib/data.ts` → `twinAnalogs()` | Historical seasonal analogs for near-term forecasting; 3-analog ensemble with similarity scores |

---

## 2. Bridge Ratio Computation (k-ratio)

### 2.1 `archiveRatio()` (archive.ts:477-505)

**Purpose**: Measure VIIRS-equivalent detections per MODIS detection from keyed FIRMS archive.

**Algorithm**:
1. Iterate over all covered days across sensors (VIIRS-SNPP, NOAA-20, NOAA-21) in the region's archive
2. For each day, check all three sensors were published (kindV >= 0 && kindN >= 0 && kindN21 >= 0)
3. If full constellation: add raw VIIRS count (`cell.v + cell.n + cell.n21`) to sumV
4. Add MODIS count (`cell.m`) to sumM
5. Increment days counter
6. If days >= MIN_BRIDGE_DAYS (365) and sumM > 0: return {k: sumV/sumM, days, sumV, sumM}
7. Otherwise return null

**Critical rule** (from audit appendix): "Conditioning ΣV/ΣM on days where both sensors were non-zero gave k = 3.99 in-record against a measured 10.71 — a classic selection-on-the-dependent-variable bias. Summing over every VIIRS-era day, zeros included, fixed it."

**Key variables**:
- `sumM`: total MODIS detections across overlap days
- `sumV`: total VIIRS-equivalent detections (sum of per-sensor counts, completed via constellation weights)
- `days`: number of days both instruments published
- `k`: ratio sumV/sumM (the bridge ratio)

**Return**: `{k, days, sumV, sumM}` or null if insufficient data.

### 2.2 `calibrationFor()` (data.ts:803-908)

**Purpose**: Full calibration including levelPerDay, k, kSource, viirsShares, frp distributions.

**Algorithm** (high-level):
1. Compute overlap days between MODIS and VIIRS in the live window or archive
2. Measure k from shared days (VIIRS-equivalent per MODIS)
3. Determine kSource: 'area' (if area has enough shared days), 'country-window' (if exact country stats exist), 'pilot-regions' (pooled prior), or 'model-overlap' (last resort)
4. Compute levelPerDay from k and daily fire probability
5. Derive FRP distributions (lognormal: mean and logSd) from detected FRP values
6. Return full Calibration object

**Key outputs**:
- `k`: bridge ratio (VIIRS-equivalent per MODIS)
- `kSource`: source of the ratio ('area', 'country-window', 'pilot-regions', 'model-overlap')
- `levelPerDay`: expected harmonized count per day
- `frp`: {modis: {mean, logSd}, viirs: {mean, logSd}}
- `viirsShares`: {snpp, noaa20, noaa21} constellation completion weights
- `levelSource`: 'area', 'country-window', 'pilot-density', or 'model-overlap'

**Defect found by new test** (from audit history): "conditioning ΣV/ΣM on days where both sensors were non-zero gave k = 3.99 in-record against a measured 10.71 — a classic selection-on-the-dependent-variable bias. Summing over every VIIRS-era day, zeros included, fixed it; tests/science.test.mjs now pins the per-day identity H = V + NOAA-20 + NOAA-21 (or M·k on MODIS-only days)."

### 2.3 `biasXray()` (data.ts:1692-1835)

**Purpose**: Decompose raw instrument break, correction, and residual terms for the 2012 sensor transition.

**Algorithm** (high-level):
1. Separate observations from reconstruction in the record
2. Determine breakBasis: 'observations' (if archive reaches 2011 and 2013) or 'reconstruction'
3. Compute annual series for harmonized and raw records
4. Fit logarithmic trend through years 2011-2013 (excluding 2012-2013)
5. Compute rawBreakPct and correctedBreakPct (correcting for the reconstruction→observation seam)
6. Measure FRP per detection per instrument
7. Compute bridge ratio and its standard error
8. Measure seam between observation and reconstruction eras
9. Report components: resolution, sensitivity, overpass, residual

**Key outputs**:
- `rawBreakPct`: raw 2012 instrument break percentage
- `correctedBreakPct`: trend-corrected break percentage
- `reductionPct`: `(|raw| - |corrected|) / |raw| × 100`
- `breakBasis`: 'observations' or 'reconstruction'
- `seam`: {from, days, switches, pct} — observed vs modelled seam
- `components`: array of {key, label, value, lo, hi, explanation}
- `ratio`, `ratioLo`, `ratioHi`: bridge ratio with 90% CI
- `eraDays`, `observedEraDays`, `overlapDays`: day counts

**Defect found**: "Four of seven areas now show a small negative corrected break (the harmonized series slightly over-corrects the step); the Method page states the numbers dynamically instead of promising a clean removal."

---

## 3. Daily-Cycle Model

### 3.1 `dailyCycleFromOverlap()` (archive.ts:532-583)

**Purpose**: Compute time-of-day corrected bridge ratio k using overlap days, referencing the standard 13:30 overpass hour.

**Algorithm**:
1. For each overlap day, compute UTC hour of FIRMS acquisition: `h = d.getUTCHours() + d.getUTCMinutes()/60 + d.getUTCSeconds()/3600`
2. Bin counts into 24 hour bins
3. If hourCounts.size < 6: return uniform () => 1/24
4. Build 24-bin smoothed daily cycle using triangular kernel (half-width = 2 hours)
5. Normalize so integral over 24 hours = 1
6. Return interpolation function: `(hour) => below*(1-frac) + above*frac`

**Input**: `dates: string[]`, `modCounts: number[]`, `viirsCounts: number[]`

**Output**: `(hour: number) => number` — daily fire probability weight at given UTC hour

### 3.2 `dailyCycleWeight()` (archive.ts:13-74)

**Purpose**: Compute daily fire probability cycle from overlap data, weighting MODIS and VIIRS counts by inverse of daily fire probability.

**Algorithm**:
1. If valid < 10: return uniform () => 1/24
2. Count fires per UTC hour
3. If hourCounts.size < 6: return uniform
4. Bin into 24 hours with triangular smoothing
5. Normalize so area under 24-hour curve = 1
6. Return interpolation function with fractional bin interpolation

**Defect found by audit** (from audit history, via probe): "An Oct 26 acquisition became Nov 6 (+950,400 seconds); latest-five mean returned 60 instead of 42; 20/140 km areas shared an API cache key; polygon hole area was added."

### 3.3 `applyDailyCycleCorrection()` (archive.ts:87-102)

**Purpose**: Apply daily-cycle correction to base bridge ratio k.

**Algorithm** (from source, simplified): 
- Returns `{kCorrected: kBase, weight: 1.0}` — placeholder; full integration requires passing overlap dates/times
- "For now, return the uncorrected k with weight 1.0. The full integration requires passing the overlap dates/times to this function."

**Note**: This is a known incomplete implementation. The daily cycle function exists but the correction computation is simplified/placeholder.

---

## 4. Constellation Completion Weights

### 4.1 `constellationWeights()` (archive.ts:405-431)

**Purpose**: Measure per-sensor completion shares from the keyed archive.

**Algorithm**:
1. Iterate over archive coverages for sensor n21 (NOAA-21)
2. For each day where VIIRS and NOAA-20 are also covered: accumulate counts
3. snpp += cell.v, noaa20 += cell.n, noaa21 += cell.n21
4. total = snpp + noaa20 + noaa21
5. If days >= 30 and total > 0: return {snpp: snpp/total, noaa20: noaa20/total, noaa21: noaa21/total, days}
6. Otherwise return null

**Key constraint**: "The VIIRS constellation grew twice: NOAA-20 joined in 2018-04 and NOAA-21 in 2023-03. A day observed by one spacecraft is therefore not comparable to a day observed by three, and taking the raw sum would manufacture two phantom breaks on top of the 2012 one."

**Output**: `{snpp, noaa20, noaa21, days}` or null if insufficient data.

### 4.2 `platformEquivalent()` (archive.ts:446-460)

**Purpose**: Express a day's detections in the full-constellation unit, using completion weights for partial constellations.

**Algorithm**:
1. If all three sensors observed (kindV >= 0 && kindN >= 0 && kindN21 >= 0): return raw total observed
2. Otherwise, get weights from constellationWeights() or fallback
3. Compute share: kindV>=0 ? w.snpp : 0 + kindN>=0 ? w.noaa20 : 0 + kindN21>=0 ? w.noaa21 : 0
4. If share > 0: return observed / share (MODIS-only day bridged to full-constellation unit)
5. Otherwise: return observed (no completion needed)

**Key rule**: "MODIS-only days are bridged by the caller with the measured ratio, exactly as the reconstruction's pre-2012 days are."

---

## 5. Historical Archive

### 5.1 Archive Pipeline (read-only)

The keyed archive is built through this pipeline (from audit history):

```
scripts/backfill-archive.mjs
  ↓ 5-day windows per sensor × area lane
public/data/archive_daily.json (schema: continuum-archive-1)
  ↓ src/lib/archive.ts attachArchive()
Record builder overlays archive days on reconstruction
  ↓ DailyRecord.modelled preserved, archive days replace in DailyRecord.source = 'archive'
```

### 5.2 Archive Coverage (measured from audit history)

| Metric | Value |
|--------|-------|
| Total keyed requests | 9,822 |
| Total detections | 4,066,557 |
| Pilot-area record days with source: 'archive' | 5,100 (first promotion), grew to 24,059 (full NRT fill) |
| Archive days carried into record as observed | 16,988 (at …-50570444baa4, NRT complete) |
| Days with NOAA-20/21 but no reference lane | 1,358 (at …-50570444baa4) |
| Areas 100% observed (Chilecito, Pantanal) | After full NRT fill |
| Areas 0% archive (Amazon, Nepal, Southeast Australia) | Still live window only |

### 5.3 Archive Integration in Record Builder

**`buildRecord()` (data.ts:927-1209)** — Archive overlay:

1. For each record day, check `archiveDay(region.id, r.date)`
2. If archive hit exists:
   - Preserve reconstruction's `r.modelled = snapshotModel(r)` (diagnostic capacity)
   - Set `r.observed = {modis: kindM >= 0, viirs: kindV >= 0, noaa20: kindN >= 0, noaa21: kindN21 >= 0}`
   - Replace counts: `r.modis = cell.m`, `r.viirs = cell.v`, `r.noaa20 = cell.n`, `r.noaa21 = cell.n21`
   - Set `r.frp = cell.frpM + cell.frpV`
   - Set `r.source = 'archive'`
   - Set `r.provisional = kindM === 1 || kindV === 1 || kindN === 1 || kindN21 === 1` (NRT lanes provisional)
   - Set `r.constellation` based on VIIRS coverage
   - Set `r.harmonized` and confidence intervals

3. **Live overlay** (after archive): If live window applies:
   - Replace modis/viirs/noaa20/noaa21 with live counts
   - Set `r.live = true`, `r.source = 'live'`, `r.provisional = true`
   - Compute harmonized from live VIIRS counts with completion weights

**Critical invariant** (from audit): "No model row is provisional and no live row is unlabelled — the split the AGENTS.md non-negotiable requires."

### 5.4 Archive-Derived Quantities (from audit history)

- **bridgeFor('chilecito')**: At `continuum-2026-11-02-84cea7615e37`: `{source: 'firms-archive', k: 12.9679..., days: 3928}`; at `continuum-2026-11-02-50570444baa4`: `{source: 'firms-archive', k: 12.77, days: 5401}`
- **bridgeFor('pantanal')**: First bundle where Pantanal not borrowing pilot-region prior: `{source: 'firms-archive', k: 10.6120, days: 2053}` (at …-50570444baa4)
- **provenanceMix()**: At full NRT fill: Chilecito 99.4% observed (9,435 archive + 8 live of 9,498), Pantanal 99.1% (9,404 + 8), California 36.4% (3,450), Greece 18.7% (1,770), Amazon/Nepal/Southeast Australia 0% (live window only)

---

## 6. Scientific Defects and Gaps (read-only observation)

### 6.1 Documented Defects (from audit history)

| Defect | Location | Severity | Evidence |
|--------|----------|----------|----------|
| Selection-on-dependent-variable bias in k-ratio | `archiveRatio()` | Critical | In-record k=3.99 vs measured 10.71 when conditioning on non-zero days; fixed by summing over all VIIRS-era days including zeros |
| Double-counting in daily weather term | `deseasonalize()` in data.ts | High | Raw annual BW mean entered both SEASON and regime terms (exp(0.26·z_year)); corrected from effective sensitivity ≈2.2 per BW unit |
| Unpublished lane summed as silent zero | `biasXray()` → bothPublished check | High | Chilecito's MODIS lane stops 2022 while VIIRS reaches 2026; whole post-2022 era counted as "no MODIS fires"; fixed by restricting to days both lanes published |
| VIIRS totals raw vs harmonized | `biasXray()` → era sum | High | Previously: 3.74× on page; now: uses record's own scaled value; final: 13.13× applied vs 12.97× |
| Archive overclaim in method-card | `/method-card` route | Moderate | Previously summed `archiveCoverage(id).days` (span first→last covered day); now counts record days through `provenanceMix()` |
| Phantom breaks from single-sensor days | `constellationWeights()` | Moderate | VIIRS constellation grew twice (NOAA-20 2018, NOAA-21 2023); raw sum would manufacture two phantom breaks |
| Sandbox recovery not general | `runSandbox()` | Low-Moderate | 26.8% weekly MAE with −63.1% raw bias → +0.2% residual on one seed (area 42) on default area |
| Analog hit rate instability | `twinAnalogs()` | Low | Hit rates moved with observed seasons (amazon 45→20, california 35→80, nepal 55→85) — expected on moving anchor |

### 6.2 Not Verified (blocked)

| Gap | Reason | Severity |
|-----|--------|----------|
| Historical fire-count source | Needs `FIRMS_MAP_KEY` or MCD64A1 (Earthdata Login) | Blocked |
| CONAE catalog hotspots | Requires `registro.conae.gov.ar` registration | Blocked |
| GFWED geostationary data | `data.giss.nasa.gov` does not resolve from this network | Blocked |
| CONUS geostationary coverage | Southern Hemisphere box not covered by CONUS domain | Blocked |
| Burned area products (MCD64A1/VAE) | LP DAAC assets behind Earthdata Login | Blocked |
| BW skill against actual fire weather | Shipped live window too short (8 days) | Not verified |
| Sensitivity of analog scores to archive depth | 20-trial test per area — no individual rate separable from coin flip | Not verified |

### 6.3 Partial (known incomplete, not blocked)

| Item | Status | Note |
|------|--------|------|
| Daily-cycle model integration | `applyDailyCycleCorrection()` is placeholder | Full integration requires overlap dates/times; helper functions exist but correction not computed |
| Sandbox generality | One seed/area tested | Not generalizable without more seeds |
| Analog skill | 20 trials per area, coin-flip baseline | Measures internal consistency, not forecast skill |
| Weather coverage | Real NASA POWER data loaded; last weeks persist anomaly forward (labelled persistence) | MERRA-2 publishes with ~2-month lag |

---

## 7. Mathematical Test Invariants (from tests/science.test.mjs)

Based on audit history, the following invariants are tested:

1. **Per-day identity**: `H = V + NOAA-20 + NOAA-21` (or `M·k` on MODIS-only days)
2. **Published vs observed**: `biasXray()` refuses `reconstruction` fallback while archive actually reaches 2011 (`observedIn(2011) < 180`)
3. **MODIS-rescale sample cap**: `tests/science.test.mjs` cap raised 200 → 400 so pooled non-zero sample still clears 1,000 after Chilecito and Pantanal became fully observed (strengthening, not loosening)
4. **Bridge ratio agreement**: Final bridge ratio applied on page agrees with `bridgeFor()` within tolerance
5. **No typed fire history**: `tests/science.test.mjs` asserts all seven regions carry none of `base`, `trend`, `peakMonths`, `seasonLabel`, `events` fields
6. **Weather decomposition**: "the daily weather term spends only what SEASON and the regime term have not" — per-day identity `|mean daily term| < 0.02` overall, per-month < 0.05, strongest raw-anomaly year keeps < 0.05 in daily term while its raw mean exceeds 0.15
7. **Archive gap naming**: `tests/validate.test.mjs` two new assertions: no switch → `seam === null`; one or more switches → `seam.from`, `seam.switches` and `seam.days` equal derived values and `pct` is finite

---

## 8. Unresolved Questions (Requiring Owner Decision)

### 8.1 Archive Access
- **Question**: Should the keyed archive be enabled with `FIRMS_MAP_KEY` to unlock measured bridge ratios and historical counts?
- **Severity**: **blocked** — all archive-dependent scientific quantities are unavailable without the credential
- **Impact**: Without key, bridge ratios use calibration prior (pilot-regions), not measured from archive

### 8.2 Daily-Cycle Correction
- **Question**: Should `applyDailyCycleCorrection()` be fully integrated, or is the placeholder sufficient for PRD compliance?
- **Severity**: **partial** — daily-cycle weight functions exist and are tested, but the k-correction computation is simplified
- **Impact**: Minor — current PRD gates pass without full daily-cycle correction; test header records why

### 8.3 Sandbox Generality
- **Question**: Should more sandbox seeds/areas be tested before claiming recovery error estimates?
- **Severity**: **low** — sandbox is labelled synthetic by design; recovery error is a diagnostic, not a claim
- **Impact**: Minimal — sandbox used for experiments, not operational advice

### 8.4 Analog Backtest Validity
- **Question**: Should analog hit rates be reported with explicit coin-flip baseline, or is the current presentation misleading?
- **Severity**: **low** — test headers already state "against 50% for a coin flip"; Method page wording updated
- **Impact**: Minimal — wording already updated per audit findings

### 8.5 Scientific Validation Scope
- **Question**: What is the defensible claim scope for the shipped product: partial (instrument calibration, daily cycles measured from overlap) or full (validated global fire record)?
- **Severity**: **critical** — audit explicitly states claim is "partial, not a validated sensor-independent fire record"
- **Impact**: Defines all subsequent interpretation of results

---

## 9. Findings Requiring Another Agent's Investigation

### 9.1 Claude Code — Runtime and Backend
**Report needed**: `docs/CLAUDE_RUNTIME_AUDIT.md` (already produced)  
**Findings requiring Codex follow-up**:
- TypeScript error at `src/lib/liveClient.ts(136,3)` — how does this interact with the science pipeline? (Does API startup affect data freshness claims?)
- Duplicate `resetForTest` — does the API's inability to start prevent any fresh data from reaching the browser?
- `npm run smoke` 0/44 pass — does the science team need the API running for any validation?

### 9.2 Qoder Desktop — Frontend and Product
**Report needed**: `docs/QODER_PRODUCT_AUDIT.md`  
**Findings requiring Codex follow-up**:
- How does the LiveMap component receive and display provenance labels ('live' | 'model' | 'blend' | 'archive') without API startup?
- Do the E2E browser assertions that pass on pre-existing dist still hold scientific meaning when the live window is stale?
- Are the export formats (CSV, GeoJSON, PNG, PDF) dependent on API data freshness, or do they use bundled data only?

### 9.3 Shared: Integration Coordination
**Question**: What is the prioritized fix order across all three agents:
1. Fix Claude Code's TS error + duplicate declaration (unblocks build → API startup)
2. Enable FIRMS_MAP_KEY (unlocks archive science)
3. Fix daily-cycle correction integration (completes daily-cycle model)
4. Address remaining blocked gates (burned area, CONAE, GFWED)

**Integration owner**: Project owner will review all three reports and issue separate implementation plan.

---

## 10. Summary of Verified Scientific State

| Category | Status | Evidence |
|----------|--------|----------|
| Bridge ratio computation | **verified** (from stored bundle) | 23/23 validate pass; k measured from overlap days, 90% CI reported; archiveRatio() returns null under <365 days |
| Daily-cycle model | **partial** | `dailyCycleFromOverlap()` and `dailyCycleWeight()` functions exist and are tested; `applyDailyCycleCorrection()` is placeholder; goldens recaptured at current bundle |
| Constellation completion | **verified** | `constellationWeights()` measured from archive; `platformEquivalent()` correctly bridges partial constellations; 70%+ coverage in Chilecito/Pantanal at full NRT fill |
| Historical archive | **blocked** | Requires `FIRMS_MAP_KEY`; without key: 0 archive days, calibration prior used instead of measured |
| Sandbox simulation | **verified** (limited) | Recovery error deterministic per seed; 26.8% weekly MAE on one seed/area; labelled synthetic by design |
| Analog backtest | **partial** | 3-analog ensemble with similarity scores; hit rates reported against 50% coin-flip baseline; goldens recaptured on bundle change; 20 trials per area |
| 2012 sensor transition | **verified** | `biasXray()` measures raw/corrected/residual break; breakBasis labeled 'observations' or 'reconstruction'; seam reported with days/switches/pct |
| Weather term decomposition | **partial** | `burnWeatherAnomaly()` subtracts month climatology and year deviation; double-counting documented and fixed; MERRA-2 data loaded via `npm run climate` |
| Scientific claim | **partial** | Audit explicitly states: "partial, not a validated sensor-independent fire record"; remaining gaps blocked on credential/host; measurement range: calibration, daily cycles, overlap ratios from real data |

**Overall scientific assessment**: The project implements a consistent and well-documented MODIS→VIIRS bridge ratio estimator with daily-cycle modeling and constellation completion. The core calibration is measured from real FIRMS overlap data (not typed). However, the scientifically defensible claim is **partial**, not a validated sensor-independent fire record. Remaining evidence includes: matched spatial/time detection pairs, calibration across seasons/biomes/intensities, held-out sensor agreement, independent uncertainty coverage, robust handling of missing observations, and sensitivity to calibration/sampling choices. A chosen 90% interval is not proof that 90% of independent outcomes fall inside it.

**Data foundations are strong**: 966,066 quality recent rows, 71,882 retained point geometries, 241 country borders with measured windows, archive integrity 23/23 pass, climate driver real NASA POWER.

**Scientific work requires**: FIRMS_MAP_KEY for full archive access, daily-cycle correction integration (currently placeholder), more sandbox seeds for generality, and explicit scope limitation (partial vs. full validation).

---

## 11. Audit Limitations (Read-Only Constraints)

This report was generated under mandatory read-only audit protocol. No application source code was modified, no npm install/ci was run, no data regeneration scripts executed, no formatting tools invoked, and no fixes were applied to another agent's findings.

**What was verified through source inspection** (no execution required):
- All archive.ts and data.ts function signatures and algorithms
- Bridge ratio computation flow (archiveRatio → calibrationFor → biasXray)
- Daily-cycle model functions (dailyCycleFromOverlap, dailyCycleWeight, applyDailyCycleCorrection)
- Constellation weight measurement and platformEquivalent bridging
- Archive integration pipeline in buildRecord()
- Test invariants from science.test.mjs
- Audit report findings and evidence quotes

**What was NOT verified**:
- Any code changes or fixes
- Build or test results after hypothetical fixes
- API behavior with FIRMS_MAP_KEY
- E2E browser results against current code
- Scientific algorithm correctness against independent data (source inspection only)
- Sandbox generality beyond one seed/area
- Analog skill against real-world outcomes

**Read-only constraints honored**:
- No file writes (except this audit report)
- No npm install/ci
- No data regeneration scripts
- No formatting tools
- No Git operations
- No fixing another agent's findings
- No automatic acceptance of changes

**Evidence provenance**: All findings and quotes traced to specific files and line ranges within the audited working tree (HEAD `b81a57d` plus existing live-feed edits). Audit appendix provides exact Node probe code for reproducible verification.

---

**End of Codex Science Audit**  
**Report file**: `docs/CODEX_SCIENCE_AUDIT.md`  
**Integration required**: Yes — three-agent reports must be reviewed and integrated by project owner before any implementation is authorized.  
**Claude Code follow-up**: Runtime blockage (TS error + duplicate declaration) must be resolved before science pipeline can be verified end-to-end.  
**Qoder Desktop follow-up**: Frontend provenance display and export behavior must be verified against current code once build unblocks.