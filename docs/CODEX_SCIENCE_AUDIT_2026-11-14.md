# Continuum — Independent Scientific Engine Audit

Report date: 2026-11-14, Asia/Katmandu. Agent: OpenAI Codex. Authorized output: this new dated report. Application inspection was read-only.

Continuum has substantial scientific and data-processing code, including stored NASA-derived data, archive overlays, sensor completion, historical comparisons and reproducible simulations. The current source contains unresolved integration contracts and calculations that can misrepresent freshness, historical baselines and scientific validation. It cannot be described as a fully working, scientifically validated fire-intelligence system on this evidence.

## A. Review scope and evidence boundary

### Scope

Inspected the scientific engine, historical archive, sensor harmonization, bridge ratios, daily-cycle drafts, uncertainty calculations, data provenance and mathematical tests. Read relevant browser/API consumers to establish whether scientific outputs retain their meaning. Backend execution belongs to Claude; frontend/product verification belongs to Qoder. Visual design was excluded.

Read the supplied audit instructions, working agreement and [production readiness traceability](<C:/Users/Ricky/Desktop/NASA HACKATHON/docs/production-readiness.md>). The later three-agent protocol narrows the earlier attachment's wider product remit. The owner approved this filename because [the existing science report](<C:/Users/Ricky/Desktop/NASA HACKATHON/docs/CODEX_SCIENCE_AUDIT.md>) already exists and must be preserved.

No application source, configuration, packages, datasets, existing reports, build artifacts or Git history were written by this audit. No installation, regeneration, formatting, build, application test, API startup, browser sweep or upstream download was performed. No messages were sent to the other agents.

Verification vocabulary:

- **verified**: a read-only inspection command ran and its output was recorded. Here this applies to file identities, source excerpts and serialized metadata only.
- **partial**: an implementation or mathematical argument covers some cases, with named gaps.
- **not verified**: no current application execution or independent scientific evidence was obtained.
- **blocked**: needs a host, credential or owner decision. Credential presence was not inspected; a stored archive does not require a download key merely to be read.

Every finding below is based on **source inspection**, except explicitly identified serialized-file observations. Application execution and empirical scientific validation are **not verified**. Mathematical examples are analytical counterexamples, not executed project tests. Old reports' command results are historical evidence and were not re-executed or adopted as verification of this tree.

### Source snapshots and concurrent changes

This was a shared working tree, not an atomic frozen snapshot. Files changed outside this audit while inspection was underway; authorship is not established.

| File | Inspected state | SHA256 |
| --- | --- | --- |
| [archive.ts](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/archive.ts>) | Initially 18,292 bytes; contained new daily-cycle functions | AC0F612CED08C4AD5C086C601610E2EA85299A833D3C4800503EA62BE0D55AB6 |
| archive.ts | Final inspected state: 10,715 bytes; those functions removed | 590DBE26E59762DB27214C217D830573259E1EDDCC4E59FCAAB5764F1C98FD0D |
| [data.ts](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/data.ts>) | Final inspected state | 074A2213C804DF853BBB7CF2420EA40C00E3274935C51132E2549E5ACABEAE58 |
| [countries.ts](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/countries.ts>) | Final inspected state | D3907393C10A5F81DCDEB21882FAA79DB47E2A729E8E0120F078866133ECD2C8 |
| [types.ts](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/types.ts>) | Final inspected state | CC0CE04846372DB207EE947FD2F70DE37329DC3F56C36C6B70B6116268FDE307 |

The final archive file's observed modification time was 2026-11-14 11:13:26 in the host's displayed time. The three removed methods are discussed as captured draft findings in C, not active functions in the final archive.

Two additional issues changed during inspection: the final [live.mjs](<C:/Users/Ricky/Desktop/NASA HACKATHON/server/live.mjs:330>) has one resetForTest declaration, and the final [liveClient.ts](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/liveClient.ts:136>) has a valid mock-hook delimiter. Their earlier duplicate/declaration syntax defects are not asserted against the final source. Other live integration problems remain. Final observed hashes:

- server/live.mjs: 3F9AD3269919CCDDB31AA1754A18E79BD9D915625A7CAA4A94E2A7E126274C18
- src/lib/liveClient.ts: 967F722964C8CC270017E6C78D46CBC970F03846B50ADCBA826EECD8B2992183
- src/components/LiveMap.tsx: A939833BA184241DDF1D2EA5D56C414A60E922C50CD12B9B4FF9692BAB9D5B85

The existing CODEX_SCIENCE_AUDIT.md hash before creating this report was A86AE5EEDB1ECD2D603754FFD52CE2AF77E277980330D3EF7195E9AA29A78344. Its contents were preserved.

### What is actually stored

Read-only PowerShell JSON inspection of the current public/data files produced:

| File | Observed serialized evidence | Interpretation |
| --- | --- | --- |
| [live_fires.json](<C:/Users/Ricky/Desktop/NASA HACKATHON/public/data/live_fires.json>) | generatedAt 2026-11-02T15:18:25.202Z; window 2026-10-26 to 2026-11-02; 71,882 retained tuples | A stored NRT snapshot, twelve calendar days behind the audit date |
| live_fires.json metadata | totalQuality 966,066; kept 71,882; region 50,072; globalSampled 21,810 | Metadata describes a larger input than the retained map/export point set; the upstream count was not independently downloaded |
| [archive_daily.json](<C:/Users/Ricky/Desktop/NASA HACKATHON/public/data/archive_daily.json>) | continuum-archive-1; generated_at 2026-11-02T15:18:09.299Z; requests 9,822; rows 4,066,557; seven region blocks | An existing serialized archive is present; its request/row totals are self-reported metadata |
| [climate_daily.json](<C:/Users/Ricky/Desktop/NASA HACKATHON/public/data/climate_daily.json>) | NASA POWER daily (MERRA-2 reanalysis), keyless point API; start 2000-01-01; end 2026-11-01; generatedAt 2026-11-02T08:54:39.915Z | Weather inputs are stored separately from reconstructed fire counts |
| [bundle_manifest.json](<C:/Users/Ricky/Desktop/NASA HACKATHON/public/data/bundle_manifest.json>) | continuum-2026-11-02-920de0617606 | A serialized manifest version; manifest integrity and deployed build parity were not verified |

Counting the union of each region's declared covered day-index ranges, without calling the application, gave:

| Pilot area | Declared days covered by at least one sensor | Span endpoints |
| --- | ---: | --- |
| Chilecito | 9,498 | index 0 to 9,497 |
| Pantanal | 9,498 | index 0 to 9,497 |
| California | 5,158 | index 0 to 9,497 |
| Greece | 3,254 | index 0 to 9,497 |
| Amazon | 1,084 | index 0 to 9,497 |
| Nepal | 889 | index 0 to 9,497 |
| Southeast Australia | 1,514 | index 0 to 9,497 |

Under the file's 2000-11-01 epoch, these endpoints are 2000-11-01 and 2026-11-02. The counts are declared coverage unions, not observed record totals, four-sensor overlap counts, positive-fire days, unique fires or project completion percentages. An endpoint does not prove continuous coverage. Unsupported partial constellations and missing lanes still affect what can be harmonized.

### How the science is assembled

The source describes three layers:

1. FIRMS ingestion and country aggregation create recent serialized counts and a retained point set.
2. A seeded deterministic model generates a daily reconstruction calibrated to available FIRMS levels and ratios. Stored weather influences its seasonality and variation; assumed coefficients and simulated fallback remain.
3. The record builder overlays covered archive observations, then recent observations. It preserves modeled counterparts and records source, sensor coverage, provisional state and constellation completion.

[buildRecord](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/data.ts:927>) implements this ordering. [attachArchive](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/archive.ts:79>) keeps coverage separate from sparse counts. [calibrationFor](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/data.ts:803>) selects area/country/pooled calibration; [bridgeFor](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/data.ts:378>) prefers supported archive overlap. Historical rankings, analogs, Bias X-ray and the sandbox consume the resulting DailyRecord arrays.

Therefore a long, gap-free displayed series is not proof of a long, gap-free measured archive. A real weather input does not turn simulated fire counts into observations.

## B. Prioritized scientific findings

P0 means a data-integrity or source-contract blocker. P1 means a material error in results or scientific interpretation. P2 means a narrower unit/semantic defect. All recommendations are proposals; none were implemented.

### F01 — P0: acquisition dates are advanced to the present

**Files/functions:** [data.ts: alignLiveToRealtime](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/data.ts:233>), lines 233–287; [countries.ts: alignCountryFiresToRealtime](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/countries.ts:74>), lines 74–118.

**Evidence:** data.ts computes secondsOffset = daysDiff * 86400 and adds it to every tuple's acquisition timestamp at line 273. It moves sensor envelopes and region dates and replaces generatedAt at line 279. loadLiveBundle calls this at line 313. The country loader moves daily count/FRP keys and window dates and invokes the transformation at line 128.

**Problem/impact:** old observations receive current dates in the normal browser loading path. The returned transformed tuples do not retain a separate original acquisition timestamp. This changes freshness, weather matching, monthly placement, forecasts and exports without obtaining a new observation. With the stored November 2 window and a November 14 target, the transformation adds twelve days, or 1,036,800 seconds; this is an analytical consequence of the source, not an executed loader probe.

**Recommended fix:** preserve observation timestamps and original production metadata. Compute acquisition age separately. A replay/demo clock needs explicit replay provenance and must never establish LIVE freshness.

**Evidence mode:** source inspection plus serialized metadata; application execution **not verified**.

### F02 — P0: current science exports and validation contracts do not agree

**Files/functions:** [data.ts: re-exports](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/data.ts:50>), [generateValidationReport](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/data.ts:1901>); [archive.ts](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/archive.ts>); [Calibration](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/types.ts:163>) and [SandboxResult](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/types.ts:311>).

**Evidence:**

- data.ts lines 51–53 re-export dailyCycleWeight, applyDailyCycleCorrection and archiveRatioWithDailyCycle; none exists in the final inspected archive.ts.
- Line 1920 calls archiveRatioWithDailyCycle, although a re-export does not establish a local binding.
- The report reads cal.days and cal.kCorrected at 1923–1924. Calibration has overlapDays and lacks both fields. The former archive-ratio return contract also did not supply the same provenance fields as Calibration.
- Lines 1943 and 1964 declare arrays using their own types: const monthlyStatus: typeof monthlyStatus[] and const sensitivity: typeof sensitivity[].
- Lines 2031–2032 read sandbox.apparentDays and sandbox.correctedDays, absent from SandboxResult.
- StatusResult.anomalyPct does exist; it is not a missing-field finding.

**Problem/impact:** the source has unresolved exports, an unbound call and incompatible report contracts. This is evidence of source-level build/type risks, not a claim that a current build command was run and failed. A previously generated API bundle cannot demonstrate these current source paths work.

**Recommended fix:** the integration owner should freeze one source version; an approved science owner should make exports/imports and a typed report schema consistent, then Claude should rebuild and verify the resulting artifacts.

**Evidence mode:** source inspection and symbol search; build/API execution **not verified**.

### F03 — P1: the validation report substitutes placeholders for validation

**File/function:** [data.ts: generateValidationReport](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/data.ts:1884>), lines 1884–2038.

**Evidence:**

- Comments promise held-out interval coverage, calibration checks and sensitivity, but the implementation provides no independent held-out dataset or coverage test.
- Ratio bounds are k * 0.8 and k * 1.2 at 2016–2017, explicitly commented as a placeholder.
- All four sensitivity rows have variedK: null at 1966–1992. No alternative ratio is recalculated. The “up to ~30%” statement has no demonstrated calculation here.
- No-live sandbox results are replaced by zero errors at 1938, rather than unavailable results.
- The “last 12 months” loop is January through December of the current year at 1948, including future months. It passes only that month's current-year rows to statusFor at 1951–1952, removing the historical baseline, and evaluates at the month's first day.
- Local new Date(year, month, day) values are converted through UTC isoDate, making these boundaries timezone-dependent.
- kCorrected is calculated locally but not returned or used. Repository searches found no other consumer or test of this report generator.

**Problem/impact:** the report can suggest confidence intervals, sensitivity and successful validation where those analyses have not happened. Its monthly rankings lack their comparison data. Its source contracts are additionally broken under F02.

**Recommended fix:** represent missing analyses as unavailable, remove unsupported validation wording, calculate real alternatives and intervals, and use a complete historically comparable input with UTC date boundaries. Require independent validation evidence before claiming an SR/PRD gate passes.

**Evidence mode:** source inspection; report generation and scientific validation **not verified**.

### F04 — P1: bridge/constellation calibration lacks seasonal and stability evidence

**Files/functions:** [archiveRatio](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/archive.ts:271>), [constellationWeights](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/archive.ts:199>), [platformEquivalent](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/archive.ts:240>), [calibrationFor](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/data.ts:803>).

**Evidence:** archiveRatio unions covered VIIRS lanes, deduplicates days, requires MODIS coverage, excludes unsupported partial subsets and returns a ratio only with at least 365 supported dates and a positive denominator. constellationWeights needs at least 30 all-three covered dates and positive total counts. Neither checks distribution across seasons, spatial exposure or stability across years. Completion shares measured in an overlap period are used for earlier constellations; area, country-window and pooled calibrations can substitute for direct local evidence.

**Problem/impact:** 365 dates could comprise repeated peak seasons rather than a full seasonal cycle. Thirty all-three dates do not prove decade-long share stability. The resulting unit is estimated full-constellation detections, not unique fire events, burned area or automatically sensor-independent burning activity.

**Positive evidence:** published zero days are included, absent sensor days are distinct, unsupported partials are not accepted as full calibration, and tests contain independent synthetic coverage fixtures. These safeguards should be retained.

**Recommended fix:** report calibration coverage by season/year/sensor and source, test stability, define the reference unit explicitly, and use held-out observed comparisons. Treat extrapolated constellation completion as an estimate with uncertainty.

**Evidence mode:** source/test inspection; empirical calibration validity **not verified**.

### F05 — P1: uncertainty bands are calculated but their coverage is unvalidated

**File/functions:** [data.ts: buildRecord ratio variance](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/data.ts:1052>), count intervals at 1078–1089, [archive overlay](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/data.ts:1140>) and [live overlay](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/data.ts:1200>); biasXray at 1751.

**Evidence:** ratio variance uses k²(1/max(12,M) + 1/max(12,V)). Direct-count intervals use H ± 1.645 sqrt(H + (aH+b)²), with assumed coefficients varying by branch/provisional state. The archive MODIS branch propagates ratio variance; the live MODIS-only overlay instead uses generic harmonized-count spread. Completion-share uncertainty, correlated detections, exposure and model uncertainty are not propagated. F03's report uses a different, fixed ±20% interval.

**Problem/impact:** normal-approximation arithmetic is not evidence of 90% independent coverage. Correlated multi-sensor fire detections and estimated completion weights undermine the simple independent-count interpretation. Sparse-data pseudocounts and arbitrary extra spreads require justification.

**Test evidence:** [science.test.mjs:199](<C:/Users/Ricky/Desktop/NASA HACKATHON/tests/science.test.mjs:199>) checks that bounds bracket the estimate and sometimes that relative width decreases. It does not measure held-out coverage.

**Recommended fix:** define the uncertainty target, validate coverage on independent observations, account for clustered/time-correlated sampling and completion calibration, and make propagation consistent across observation branches. Label unvalidated bounds accordingly.

**Evidence mode:** source/test inspection and mathematical interpretation; interval coverage **not verified**.

### F06 — P1: “latest N years” averages use the highest N values

**File/function:** [data.ts: monthComparison](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/data.ts:1310>), lines 1310–1356.

**Evidence:** years is sorted chronologically at 1333, but history is sorted by numeric total at 1334. lastN at 1339 averages history.slice(-n). mean5, mean10 and mean20 therefore select the largest totals. Current-month totals are elapsed-month values while historical totals are full months.

**Analytical counterexample:** historical chronological totals for 2020–2025 of [100,80,60,40,20,10] produce a latest-five result of 60 under the code; the chronological latest-five average is 42. No project test was executed for this example.

**Problem/impact:** recent-year trends and baseline comparisons can be materially wrong, even when the total and quantile arithmetic look plausible.

**Recommended fix:** maintain separate chronological and value-sorted arrays and use a common elapsed-day cutoff for current-month comparisons. Add independent descending-trend and partial-month fixtures.

**Evidence mode:** source inspection plus analytical counterexample; application execution **not verified**.

### F07 — P1: analog windows cross years incorrectly and backtests omit coverage gates

**File/function:** [data.ts: twinAnalogs](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/data.ts:1563>), lines 1563–1680.

**Evidence:** yStart and yEnd both use the same candidate year at 1596–1597. An eight-week December–January window has a December start after its January end. The backtest at 1631–1662 lacks the main selection's 80% day-count gate. Main climatology starts on end day at 1622, while the analog outcome begins the following day at 1610. Both climatology paths discard zero totals at 1625 and 1656; no separate covered-zero/missing distinction is used there.

**Problem/impact:** candidate selection and scored outcomes can reference different years/windows, incomplete data can enter scores, and legitimate quiet years are excluded. The shared series has already been reconstructed/harmonized using available calibration and climate; these components are not independently refitted inside each historical fold.

**Important correction:** trials is a real loop counter incremented at 1662, returned as sampleYears at 1677. It is not a hardcoded “20 trials.” A genuine count still does not prove valid trials or forecast skill. Similarity's /1.2 scale is heuristic, not a forecast probability.

**Recommended fix:** translate complete intervals with their year offsets, require measured coverage for predictors/outcomes, retain covered zeros, align forecast/climatology days, and evaluate the entire fitted pipeline within held-out folds.

**Evidence mode:** source/test inspection; forecast skill **not verified**.

### F08 — P1: status can label missing or modeled data as a fresh observation

**File/function:** [data.ts: statusFor](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/data.ts:1366>), lines 1366–1427; [random.ts](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/random.ts>) quantile and percentileRank.

**Evidence:** statusFor uses the same elapsed-day cutoff for past/current months, which is useful. However, it accepts records of every source. Its historical filter at 1390 can admit only 20 days for a 31-day comparison. Empty history yields a NaN median and percentile zero from the helpers, so bandFor returns quiet despite the warning sentence. Freshness at 1401–1402 uses the latest record date, including reconstructed days. With a zero baseline and positive current activity, ratioToMedian is zero and the narrative can say “100% below the historical median”; anomalyPct also becomes zero.

**Problem/impact:** insufficient observations can acquire an apparently reassuring band, synthetic extension can appear fresh, and a zero baseline reverses the narrative meaning.

**Recommended fix:** require an explicit source/completeness policy; return unavailable ranking/freshness when unsupported; base acquisition freshness on observations; handle zero baselines with an absolute difference or unavailable ratio. Preserve the correct elapsed-day comparison.

**Evidence mode:** source/test inspection; runtime display and ranking **not verified**.

### F09 — P1: Bias X-ray's waterfall is a heuristic allocation, not a causal decomposition

**File/function:** [data.ts: biasXray](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/data.ts:1692>), lines 1692–1834.

**Evidence:** observations are selected only if both 2011 and 2013 have at least 180 rows; otherwise the preserved reconstruction is used. A log-linear trend on harmonized annual values supplies the adjusted break. Component weights at 1787–1813 use abs(log(ratio)), an FRP ratio, rescaled-record share and relative ratio uncertainty. Line 1815 divides the total effect among these weights; line 1816 assigns abs(value)*relativeUncertainty + 0.4 bands.

**Problem/impact:** these quantities do not independently estimate resolution, sensitivity, overpass and residual causes. Partial-year observation totals can introduce seasonal differences. A reconstruction-generated break is internal model behavior, not external sensor validation. The FRP sensitivity explanation also claims an explicit mapping without a fitted mapping in this calculation.

**Positive evidence:** breakBasis and observedEraDays disclose observation versus reconstruction; seamRows attempts to separate source switches from whole-record model bias.

**Recommended fix:** describe the waterfall as a diagnostic heuristic unless independently calibrated causal components exist; require comparable observed seasonal coverage, preserve provenance, and remove unsupported component-confidence claims.

**Evidence mode:** source/test inspection; causal interpretation and sensor agreement **not verified**.

### F10 — P1: climate coverage treats forward-filled values as observed

**Files/functions:** [data.ts: attachClimate](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/data.ts:73>), [weatherCoverage](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/data.ts:212>), [climateSourceFor](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/data.ts:182>), [build-climate.mjs](<C:/Users/Ricky/Desktop/NASA HACKATHON/scripts/build-climate.mjs:16>).

**Evidence:** attachClimate replaces null BW values with the previous value at line 88. weatherCoverage counts all non-null values in that filled series at 221 as observed, without a raw-observation/imputation mask. climateSourceFor picks the nearest pilot climate point without a distance limit. The custom weather weights, 0.35 temperature, -0.25 humidity, 0.20 wind and -0.20 antecedent precipitation, are explicitly not fitted to fire counts. The record model also uses assumed coefficients and simulated fallback at data.ts 945–963.

**Problem/impact:** coverage can overstate direct weather availability. A far-away proxy cannot automatically establish local weather validity, and observed climate covariates do not validate simulated fire output.

**Recommended fix:** preserve raw missingness, publish observed/imputed/proxied coverage separately, state proxy distance limits and fit/validate any predictive fire-weather claim.

**Evidence mode:** source inspection; weather acquisition and model skill **not verified**.

### F11 — P1: sandbox recovery is internal simulation and its toggle does not change scores

**File/function:** [data.ts: runSandbox](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/data.ts:1837>), lines 1837–1882.

**Evidence:** a manually specified detection probability p is used both to generate Poisson(H*p) and recover A/p. “Truth” is the existing harmonized record, not independent known fire truth. Weekly metrics always use the corrected array at 1864–1872, while opts.correction only switches the returned plotted series at 1873. Fewer than seven input days yields zero recovery error; an all-zero truth with blocks can yield an undefined residual ratio.

**Problem/impact:** this demonstrates an assumed estimator under its own data generator. It does not measure real MODIS/VIIRS detection probability. A disabled correction can still show corrected recovery metrics; missing evaluation can appear perfect.

**Recommended fix:** keep simulation provenance explicit, score the selected output, mark unsupported/zero-denominator metrics unavailable, and use independent detection studies for an empirical sensor-recovery claim. More random seeds assess simulation stability, not real-world validity.

**Evidence mode:** source/test inspection and algebra; empirical recovery **not verified**.

### F12 — P2: FRP units and simulated expectations disagree

**Files/functions:** [types.ts: Calibration FRP comment](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/types.ts:177>), [data.ts: logStats](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/data.ts:585>), [simulated FRP](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/data.ts:1028>), [biasXray explanation](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/data.ts:1798>), [CSV header](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/export.ts:35>).

**Evidence:** FIRMS FRP and export headers use MW, while the type comment and Bias X-ray text say MJ/min without a multiplication by 60. logStats returns exp(mu + sigma²/2), an arithmetic lognormal mean. The simulator multiplies this by exp(sigma*Z), without the -sigma²/2 centering term.

**Problem/impact:** expected simulated FRP becomes mean*exp(sigma²/2); at sigma=1 the multiplier is approximately 1.6487. This is an analytical expectation, not a measured project output. Observation FRP also sums detections across available sensors while the count metric selects/completes VIIRS or bridges MODIS; no fitted FRP harmonization mapping is supplied.

**Recommended fix:** use consistent MW units or explicit conversion, center the random multiplier if preserving the measured arithmetic mean, and define whether FRP is a sum of sampled observations or a harmonized physical estimate. Do not interpret repeated satellite detections as unique-fire total power.

**Evidence mode:** source inspection and mathematical derivation; runtime FRP output **not verified**.

## C. Scientific methodology review

### C1. Bridge ratio and constellation completion

For a covered day d, let V(d) be the sum of available VIIRS spacecraft detections. If all three spacecraft are covered, the equivalent is V(d). For a supported subset, the implementation uses V_equiv(d) = V(d) / sum(available spacecraft shares). With no VIIRS observation, platformEquivalent returns null. Without supported shares, it retains the partial observed total; archiveRatio excludes that unsupported partial from calibration.

The archive bridge is k = sum(V_equiv(d)) / sum(MODIS(d)) over supported shared dates, including covered zeros. It requires at least 365 dates and positive summed MODIS detections. Shares are each spacecraft's fraction of the summed three-spacecraft counts on at least 30 shared published dates.

**Inputs:** serialized sensor counts and coverage, with recent-window shares as a possible fallback. **Assumptions:** stable relative sensor response, compatible spatial/time sampling and a chosen full-constellation reference unit. **Limitations:** F04–F05; sample size does not establish seasonal representativeness or unbiased exposure. **Verdict: partial.** The estimator and useful missing-data rules exist; empirical transferability and uncertainty coverage are **not verified**.

### C2. Daily-cycle functions: captured draft versus current source

The three named methods were present in the initial archive.ts snapshot identified in A. They are absent from the final snapshot. Former line references below describe the captured version, not the file currently on disk.

**dailyCycleWeight — captured archive.ts lines 13–74.** The implementation builds a 24-bin UTC histogram, smooths it with a periodic triangular kernel and normalizes the bins. It increments once per nonzero input day/sample rather than weighting actual fire counts. The captured caller passes date-only strings from indexDate at former line 161. Parsing them gives midnight UTC for every sample, so the distinct-hour threshold fails and the returned density is uniform, 1/24.

The normalization is mathematically sound for a periodic piecewise-linear curve over 24 one-hour bins: its integral equals the sum of normalized bin heights, which is one. The defect is not that normalization. A distribution of acquisition hours mixes satellite scheduling, visibility and fire activity; it is not a measured probability of detecting a fire. UTC hour also cannot represent a fixed 13:30 local-solar reference across longitudes without conversion.

**archiveRatioWithDailyCycle — captured archive.ts lines 113–208.** The draft computes raw k from shared daily sums, then kCorrected = k * meanWeight at former line 198. With the uniform fallback, kCorrected = k/24. A neutral timing correction should leave k unchanged. Multiplying a dimensionless ratio by a normalized density per hour also changes the intended units. The expression parsing T12:00:00Z and adding 12 at former line 187 evaluates to hour 24, which wraps to midnight; the reference-hour constant is unused.

**applyDailyCycleCorrection — captured archive.ts lines 87–102.** It returns kCorrected = kBase and weight = 1.0, with a comment acknowledging incomplete integration. This is a placeholder identity, not an estimated correction.

**Current integration:** [dailyCycleFromOverlap](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/data.ts:532>) remains as an unused helper with the same date/hour-density approach. [bridgeFor](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/data.ts:378>) and [buildRecord](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/data.ts:1050>) call the original archiveRatio. The new report still references a removed method (F02). Searches of tests found no references to the three removed methods.

**Severity/impact:** P1 for the captured correction's scientific interpretation, with the current missing exports covered by P0 F02. Restoring the draft would not establish a valid correction.

**Recommended method:** first define the target quantity and collect actual acquisition times, local-solar time, matched spatial support and observation exposure. If inverse-probability weighting is appropriate, it requires defensible inclusion probabilities; an acquisition-hour histogram is insufficient. Adding a factor of 24 alone would only repair one invariance check, not validate the method.

**Verdict: partial** as an explored draft, with current named implementations **NOT FOUND**. Runtime and scientific validity are **not verified**. “NOT FOUND” describes source presence, not a verification grade.

### C3. generateValidationReport

An empirical interval-coverage calculation would count held-out outcomes inside their predicted intervals and divide by the number of eligible held-out cases, while reporting sample size and uncertainty. Sensitivity requires changing an assumption, rerunning the estimator and comparing results.

The actual function aggregates existing outputs, creates ±20% ratio bounds and emits null sensitivity values. It neither constructs held-out cases nor recalculates the proposed alternatives. The monthly inputs remove their own historical comparison data. See F02–F03 for exact evidence.

**Inputs:** mixed DailyRecord arrays, region, date and optional stored live bundle. **Assumptions/limitations:** no independent validation sample; missing results can become zero errors. **Verdict: partial** implementation with placeholders; validation claims **not verified**.

### C4. biasXray

The break calculation is approximately:

- Fit log annual harmonized activity against year, using years 2004–2025 while excluding 2012, 2013 and annual rows flagged partial.
- Let T = predicted(2013) / predicted(2011).
- Raw break = 100 * ((raw2013 / max(1, raw2011)) / T - 1).
- Corrected break uses the corresponding harmonized totals.
- Allocate their difference among component weights: component_j = total effect * weight_j / sum(weights).

**Inputs:** observations if the two comparison years have at least 180 rows each; otherwise reconstructed counterparts. **Assumptions:** annual trend captures background change and comparison seasons are representative. **Limitations:** source switches, partial coverage and reconstruction circularity; the allocation is not independent causal estimation. **Verdict: partial** diagnostic with useful provenance fields; causal attribution and empirical bias removal **not verified**.

### C5. runSandbox

The assumed detection probability is:

p = clamp(0.93 * (375/pixelM)^0.55 * diurnal(overpassHour) * exp(-minFrp/26), 0.02, 1),

where diurnal is a bounded cosine centered at 13.5 hours. For each reference value H, apparent count A is drawn from Poisson(H*p), and corrected count is A/p. Under that exact assumed model, E[A/p | H,p] = H. The weekly recovery metric is mean absolute error divided by mean weekly reference activity.

**Inputs:** existing harmonized values and a seeded synthetic detector. **Assumptions:** known p, Poisson sampling and correctness of H as a reference. **Limitations:** no independent true-fire observations, no fitted detector, no p uncertainty, and scoring/empty-input defects in F11. **Verdict: partial** educational simulation. Reproducibility is testable; real sensor recovery is **not verified**.

### C6. statusFor

The intended statistic is the percentile of the current month's cumulative activity through day c relative to historical cumulative activity through the same day. Median ratios and fixed percentile bands translate that statistic into a status.

**Inputs:** every admitted DailyRecord source, including reconstruction and estimates. **Assumptions:** comparable coverage, reference units and history. **Limitations:** F08's empty-history, zero-baseline, missingness and freshness problems. The correct elapsed-day cutoff is already present. **Verdict: partial** ranking implementation; observational status validity **not verified**.

### C7. Historical archive and weather interpretation

Archive coverage flags distinguish published zero counts from unpublished lanes; sparse storage alone does not mean missing observations. This is a meaningful design strength. However, an archive union day is not necessarily a fully observed constellation or a supported bridge day.

The weather index is a custom weighted standardized covariate. Its coefficients are stated in code and not fitted to fire observations. Using real NASA POWER inputs makes the covariate provenance stronger, but does not establish predictive accuracy of the reconstructed fire series. Forward filling and distant pilot proxies need separate labels and coverage accounting (F10).

**Verdict: partial.** Existing data and method code are present; independent upstream integrity, reconstruction accuracy and predictive skill are **not verified** in this audit.

## D. Scientific integration findings and cross-agent handoffs

These are independently inspected boundary findings relevant to scientific outputs. They do not replace Claude's runtime audit or Qoder's product audit. All are source inspection; runtime behavior is **not verified**.

### D01 — P1: browser and API use different observation dates and refresh paths

**Evidence:** the browser's [loadLiveBundle](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/data.ts:295>) and [loadWorldLayer](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/countries.ts:120>) invoke F01's date transformations. [server/api.mjs:52](<C:/Users/Ricky/Desktop/NASA HACKATHON/server/api.mjs:52>) reads stored JSON directly and hydrates unshifted country data at 63–68. API analytics call regionRecord with the startup live object at line 223. The [store](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/store.tsx:260>) loads the bundle into state and derives records at 331–334.

**Impact:** the same selected area can have different dates and freshness across consumers. Refreshing the independent live provider does not by itself replace the startup analytics bundle.

**Recommendation/handoff:** Claude should verify observation/version parity and refresh propagation; Qoder should verify that scientific consumers use the same observation payload and provenance.

### D02 — P0: live hook and caller contracts disagree; P1: fresh points are not integrated

**Evidence:** [useLiveFirms](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/liveClient.ts:61>) ends at line 114 without returning a value. [LiveMap](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/components/LiveMap.tsx:54>) destructures status and data from it. The hook requests /api/live-firms at line 72, whereas [API routes](<C:/Users/Ricky/Desktop/NASA HACKATHON/server/api.mjs:491>) expose /live-firms and the /api/v1 prefix handled at 853–860.

LiveMap's callback at 55–59 updates status/time labels only; regionPoints still derive from the original fires prop at 67–69. The hook sets every successful response to live at 85–87 and reuses that status after failures, without reading the server's stale field. DataSource at liveClient line 44 is a provenance union, yet it is used as if it were the connection-state union. The module still reads process.env in browser code at line 130.

**Impact:** the source contract cannot support the caller as written; the intended refresh path does not establish refreshed point data or honest stale classification.

**Recommendation/handoff:** Qoder and Claude should agree on one response, hook, route and state contract, then verify that a changed acquisition changes points and analytics. Preserve observation provenance separately from transport status. The previously malformed delimiter is now fixed in source; this does not resolve these other issues.

### D03 — P1: provider counts and data can lose consistency during refresh

**Evidence:** [server/live.mjs: refresh](<C:/Users/Ricky/Desktop/NASA HACKATHON/server/live.mjs:177>) updates shared perSatelliteCounts at 191 before the successful whole-window swap at 197. The all.push(...tuples) call at 192 risks an argument-count failure on a large global feed. Thrown errors go through finally at 209, bypassing the explicit stale branch at 201–204. [getResponse](<C:/Users/Ricky/Desktop/NASA HACKATHON/server/live.mjs:304>) emits the stored stale flag without recomputing age.

**Impact:** a partial/failed refresh can mix new sensor counts with previous detections or keep an outdated freshness flag.

**Recommendation/handoff:** Claude should verify failure cases and global-feed volume, stage all state together and recompute freshness from acquisition/fetch time. The final source has a single resetForTest declaration; no duplicate-startup failure is claimed for that snapshot.

### D04 — P1: selected geometry and cached analytics can describe different areas

**Evidence:** [geometryToCircle](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/geometry.ts:198>) replaces a polygon with a centroid/equal-area circle; [observeArea](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/data.ts:613>) filters detections by bounding box. [polygonAreaKm2](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/geometry.ts:67>) adds the absolute area of every ring at line 78, including holes. inspectGeometry at 162–190 does not check self-intersections.

[customRegion](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/data/places.ts:76>) gives different radii the same coordinate-derived id and does not retain radiusKm as a property. The [API record cache](<C:/Users/Ricky/Desktop/NASA HACKATHON/server/api.mjs:223>) keys on id, center and region.radiusKm, so different radii at the same center can collide.

**Impact:** counts, density, calibration and exported point membership can refer to an approximation or to a previously cached area. Hole area is mathematically wrong for standard polygon semantics.

**Recommendation/handoff:** Qoder and Claude should agree on exact versus explicitly approximated geometry, subtract holes, validate topology and include complete geometry identity in caches. Runtime reproduction belongs to their integration checks.

### D05 — P1: exported values and intervals can have mismatched meanings

**Evidence:** [exportCSV](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/export.ts:35>) labels a column harmonized_viirs_equiv but fills it using dailyValue with the selected mode at line 40, so raw mode can populate that column with raw values while retaining harmonized bounds. [API calendar output](<C:/Users/Ricky/Desktop/NASA HACKATHON/server/api.mjs:285>) emits selected metric/mode values beside r.lo/r.hi, which are harmonized hotspot bounds, even for FRP or fire-days.

[hotspotsInWindow](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/export.ts:51>) uses bounding-box membership and the retained point set. That set is sampled outside detailed areas; it is not the full global input or the complete country aggregate.

**Impact:** consumers can combine a value and interval with different units or interpret sampled points as complete counts.

**Recommendation/handoff:** Qoder should align export columns, units, provenance and spatial/sample descriptions; Claude should make interval fields metric-specific or explicitly unavailable.

### D06 — P2: Brief calls an arithmetic mean a median

**Evidence:** [Brief.tsx:28](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/pages/Brief.tsx:28>) computes mean of analog departures. Text at lines 46 and 173 calls this the median. The shared [analogDeparture](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/data.ts:1688>) uses a median.

**Impact:** brief/advisory summaries can disagree with the stated statistic and other consumers.

**Recommendation/handoff:** Qoder should use the agreed shared statistic and consistent wording, then check the exported brief.

### D07 — P1: live weather missing values and fitted relationships need provenance controls

**Evidence:** [weather.ts: fetchWeather](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/weather.ts:77>) converts missing precipitation to zero in rainByDate; the trailing sum does the same at 114. Missing humidity contributes a fixed 0.3 dry-air term at 120. Regression at 125–140 uses harmonized records without excluding reconstruction. [offlineWeather](<C:/Users/Ricky/Desktop/NASA HACKATHON/src/lib/weather.ts:219>) generates sinusoidal stress and fits a relationship against it, although its source label correctly says offline estimate. The loadWeather cache key at 43 omits record identity.

**Impact:** missing rain can look like dry weather, an in-sample relationship can be circular, and results can remain cached after the fire series changes.

**Recommendation/handoff:** preserve missingness and proxy flags, distinguish simulated relationships, and invalidate derived weather fits when records change. Claude/Qoder should verify transport and consumer behavior; a science owner should define the fitting policy.

### Integration classification

| Scientific capability | Source assessment | Verification status |
| --- | --- | --- |
| Archive attachment and record overlay | Implemented paths and coverage fixtures; uneven observed coverage | partial |
| MODIS/VIIRS bridge and constellation completion | Implemented with fallback and missing-data rules; empirical stability gaps | partial |
| Daily-cycle correction | Named archive implementations absent; unused helper and broken report references remain | partial |
| Validation report | Contract errors and placeholder analyses | partial |
| Live refresh into scientific state | Contract, route, freshness and state-propagation gaps | partial |
| Historical comparisons and analogs | Implemented with F06–F08 defects | partial |
| Scientific exports/advisory | Implemented with geometry, statistic and interval semantics gaps | partial |
| Six-section navigation, globe/satellite UX and deployment | Assigned to Qoder/Claude; no functional claim made here | not verified |

## E. Mathematical test coverage and evidence gaps

### Useful tests already present

[archive-coverage.test.mjs](<C:/Users/Ricky/Desktop/NASA HACKATHON/tests/archive-coverage.test.mjs>) contains independent synthetic fixtures explicitly labeled TEST ONLY. They cover absent lanes versus covered zeros, FRP addition order, constellation-share thresholds, unsupported subsets and union/deduplication of coverage. Relevant cases include lines 134, 195, 229, 276, 295, 301, 314 and 339. These are valuable contract tests; their use of synthetic input is appropriate for testing deterministic arithmetic.

[science.test.mjs](<C:/Users/Ricky/Desktop/NASA HACKATHON/tests/science.test.mjs>) includes fixed-seed reproducibility, per-record identities, provenance distinctions and weather decomposition checks. [analog-index.test.mjs](<C:/Users/Ricky/Desktop/NASA HACKATHON/tests/analog-index.test.mjs:71>) preserves historical outputs and checks cache separation across record arrays. Existing results were not executed during this audit.

### E01 — P1: important scientific behavior has no independent validation coverage

**Evidence:** searches across tests found no references to dailyCycleWeight, applyDailyCycleCorrection, archiveRatioWithDailyCycle, generateValidationReport, alignLiveToRealtime, alignCountryFiresToRealtime or monthComparison.

The interval test at [science.test.mjs:199](<C:/Users/Ricky/Desktop/NASA HACKATHON/tests/science.test.mjs:199>) brackets estimates; its low/high-count comparison is conditional and may execute no width assertion. Sandbox tests at 343–350 assess the same assumed detector used by the simulator. Analog tests at 353–359 check target-year exclusion and hit-rate bounds. Status tests at 362–366 check enum/range/text presence. These do not establish empirical calibration.

Analog golden cases use the stored window end ([analog-index.test.mjs:75](<C:/Users/Ricky/Desktop/NASA HACKATHON/tests/analog-index.test.mjs:75>)), leaving December–January, leap-date and missing-outcome behavior unproven.

**Recommendation:** after implementation approval, prioritize independent chronology, zero/missing baseline, date-preservation, cross-year, uniform-correction and interval-coverage fixtures. Use observation-based held-out evaluations for scientific claims. Preserve existing useful synthetic tests.

**Evidence mode:** test-source inspection; test execution **not verified**.

### E02 — P1: old generated analytics can mask the state of current source

**Evidence:** [science.test.mjs:10](<C:/Users/Ricky/Desktop/NASA HACKATHON/tests/science.test.mjs:10>) imports dist-server/analytics.mjs. The [package scripts](<C:/Users/Ricky/Desktop/NASA HACKATHON/package.json>) normally rebuild it before npm test. Directly running generated-bundle tests or reading old result files does not prove current source, especially F02, is buildable.

**Recommendation/handoff:** Claude should record source/build identities and execute the approved build/test chain against one frozen source state. No build or test was run here.

**Evidence mode:** source inspection; artifact parity **not verified**.

### E03 — P1: keyed tests and E2E reporting need runtime-owner investigation

**Evidence:** [coder-live.test.mjs:108](<C:/Users/Ricky/Desktop/NASA HACKATHON/tests/coder-live.test.mjs:108>), 135 and 150 use standalone test.skip calls as if they conditionally skip surrounding tests/suites. They do not establish that enclosing keyed tests are skipped. The test file also uses one started server and rate-limit cases, so isolation and shared counters need checking.

In [e2e.mjs:1132](<C:/Users/Ricky/Desktop/NASA HACKATHON/scripts/e2e.mjs:1132>), failed checks and caught fatal errors are written to reports/logs without these branches setting a failure exit code. A successful process exit can therefore be weaker evidence than the detailed report.

**Recommendation/handoff:** Claude/Qoder should verify actual skip semantics, isolation and failure exit behavior. Core scientific suites had no explicit skip found in the inspected sources. No tests were run here.

**Evidence mode:** source inspection; runner behavior **not verified**.

## F. Comparison against previous audit findings

These labels describe source comparison, not verification grades. “FIXED IN SOURCE” does not mean runtime verified. The previous report mixes historical runtime results with source descriptions; its numerical outcomes cannot be reused as current evidence.

| Earlier issue or claim | Comparison | Current evidence |
| --- | --- | --- |
| Acquisition timestamps shifted forward | STILL PRESENT | F01; both loaders invoke shifting functions |
| Browser/API observation inconsistency | STILL PRESENT | D01; transformed browser payload versus startup stored API payload |
| Live hook return type and caller mismatch | STILL PRESENT | D02; void hook destructured by LiveMap |
| New observations update labels but not map data | STILL PRESENT | D02; callback does not replace points/store input |
| Cached/stale observations classified as live | STILL PRESENT | D02–D03; stale response field ignored and prior live status reused |
| Browser process.env reference | STILL PRESENT | liveClient.ts:130 |
| Malformed mock-hook delimiter | FIXED IN SOURCE | Final liveClient.ts:136 is a valid arrow-function delimiter |
| Duplicate resetForTest declarations | FIXED IN SOURCE | Final live.mjs contains one declaration at 330 |
| Provider updates counts before complete data swap; spread risk | STILL PRESENT | D03 |
| Weather missing values treated as zero | STILL PRESENT | D07; forward-filled coverage also affects F10 |
| Chronological monthly averages | STILL PRESENT | F06 |
| Cross-year analog/date and coverage issues | STILL PRESENT | F07 |
| Analog trial count is hardcoded | NOT FOUND | trials increments inside the actual backtest loop |
| Geometry approximation, holes and radius cache identity | STILL PRESENT | D04 |
| Export interval/column mismatch and brief mean/median mismatch | STILL PRESENT | D05–D06 |
| Named daily-cycle functions exist and are tested | NOT FOUND | Draft functions were removed; no tests of the named functions were found |
| Daily-cycle correction is fully integrated | STILL PRESENT | The integration gap remains: references survive removal of the implementations; production bridging uses the original archiveRatio |
| Placeholder daily correction is sufficient for scientific compliance | CANNOT DETERMINE | An owner-defined claim/gate is needed; the inspected method supplies no empirical validation |
| All archive science is unavailable without a key | NOT FOUND | A current archive file exists; attachArchive reads it without a runtime download key. New keyed downloads are a separate operation |
| Amazon/Nepal/Southeast Australia have zero archive coverage | NOT FOUND in current serialized coverage | Declared union days are 1,084 / 889 / 1,514 respectively; A explains the limits of those counts |
| Bridge, constellation completion and transition are scientifically “verified” | CANNOT DETERMINE | Useful source and fixtures exist; seasonal transfer, causal attribution and independent interval coverage remain not verified |
| Historical build/test/smoke/validate success applies to current tree | CANNOT DETERMINE | No current run here; files changed during inspection |

The claim that daily-cycle normalization is intrinsically incorrect is also not supported by the inspected mathematics. The periodic normalized interpolant integrates to one. Its inputs, probability interpretation and application to k are the problems.

## G. Recommended next fixes — proposals only

The integration owner must approve an implementation plan and designate the owner of each change before work begins. Suggested order:

1. **Freeze a reviewable source/data version and restore honest provenance.** Resolve F01–F02 and the live contract/route issues in D01–D02. Preserve actual acquisition times and make observation/version identity common across consumers.
2. **Make refresh and scientific output semantics consistent.** Address atomic provider state, stale classification, geometry identity and metric-specific intervals/exports.
3. **Correct deterministic scientific arithmetic.** Fix chronological monthly averages, cross-year analog windows, zero/missing baselines, FRP expectation/units and sandbox score selection. Add independent fixtures for the reproduced edge cases.
4. **Replace placeholder validation with evidence or explicit unavailability.** Define the reference unit and permissible claims. Do not restore the captured daily-cycle draft as a validated method.
5. **Evaluate calibration and forecasts independently.** Use seasonally representative matched observations, held-out sensor/region/time folds, coverage-aware baselines and uncertainty calibration. Propagate uncertainty in completion shares and any estimated detection probabilities.
6. **Perform approved integration verification.** Claude should record the build/runtime/data-freshness evidence; Qoder should verify product consumers and exports. Reconcile all three reports against the frozen version.

Suggested responsibility follows the user's protocol: Codex for scientific equations and mathematical fixtures, Claude for runtime/backend/data ingestion, Qoder for product consumers and exports. Shared files require the integration owner's explicit assignment. These suggestions do not authorize edits.

## H. Final assessment and open questions

| Dimension | Assessment | What remains |
| --- | --- | --- |
| Scientific code completeness | partial | Substantial archive/calibration/model/diagnostic code exists; current contracts and several calculations are incomplete or defective |
| Runtime verification | not verified | No build, application test, API startup or browser execution in this audit |
| Real-time data integration | partial | Stored FIRMS data and provider/client code exist; stored window ends November 2, and date shifting plus refresh contracts prevent a defensible current-data claim |
| Historical observation coverage | partial | Archive blocks exist for all seven pilots with uneven sensor/day coverage; the remaining record is reconstruction or extrapolation |
| Scientific validity | partial | Some estimator identities and missing-data rules are defensible under assumptions; sensor independence, causal decomposition, interval coverage and forecast skill need independent evidence |
| Submission readiness | partial | A prototype can be explained, but current buildability, end-to-end behavior and the intended scientific claims require reconciliation with Claude/Qoder and approved fixes |

No completion percentage is assigned. There is no frozen, weighted acceptance checklist with current passing evidence, and coverage percentages would measure a different thing from completed project work. The concrete dataset counts in A provide an evidence-based view of what is present.

### Unresolved scientific questions

1. Is the target unit full-constellation detection count, a single-reference-platform equivalent, unique fire events, radiative power or burned area? The present methods support different subsets of those claims.
2. What scientific quantity should the daily-cycle correction estimate, and what actual acquisition-time, exposure and local-solar-time data are available?
3. What seasonal, spatial and sensor coverage is required before a calibration can be applied to another era or region?
4. Which held-out datasets and evaluation folds will be used, and what independent interval coverage/forecast skill is acceptable?
5. How should missing, partial, imputed and reconstructed days affect rankings, freshness, forecasts and exports?
6. What geographic proxy distance and imputation policy is acceptable for weather?
7. Which inspected source/data snapshot will the integration owner freeze and designate for the final check?

### Findings requiring the other agents' investigation

**Claude:** establish current build/API startup and source/artifact parity; verify actual acquisition freshness, correct routes, atomic refresh/caching/stale behavior, full-feed volume, API metric/interval contracts, keyed-test isolation and failure reporting. This report does not assume that credentials are absent or that an old runtime failure remains.

**Qoder:** verify that refreshed points and analytics reach consumers; preserve acquisition/provenance labels; show unavailable rankings honestly; reconcile geometry/sample semantics, export units/columns, brief statistics and E2E failure signals. The six product sections and globe/satellite interface remain within Qoder's assigned scope.

### Inspection record

The audit executed read-only Get-Content/rg source searches, Get-FileHash identity checks, Get-Item/Test-Path inspection, PowerShell ConvertFrom-Json metadata reads and union-count arithmetic over serialized coverage ranges. Recorded outputs include:

- Exact source hashes in A, rechecked after resuming the interrupted report-writing step.
- Symbol search: the three daily-cycle names remain at data.ts lines 51–53 and 1920; no definitions were found in the final archive.ts.
- Serialized metadata and declared coverage unions listed in A.
- Test-source search: no matches for the seven named daily-cycle/report/date-shift/month-comparison functions listed in E01.
- Read-only git status showed a pre-existing modified/untracked working tree. It also warned that the global Git ignore file could not be read. No Git mutation was performed and unrelated file changes are not attributed to this audit.

The file-level evidence is **verified** only as read-only inspection output. It does not upgrade application execution or scientific validity to verified. Existing reports' build/test totals were not reproduced. No keys or credentials were read or printed.

Final read-only report checks returned all eight required sections A–H, 28 distinct referenced files with zero missing files, no continuation marker and a completed disposition. Seven sampled source files and the existing science report matched the hashes recorded above. These checks verified the saved report and file identities; they did not execute application code.

**Audit disposition:** assigned science audit completed; implementation awaits the project owner's integration approval. This report is the only file authored by this audit.


