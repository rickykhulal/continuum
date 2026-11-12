# Engineering audit — 2026-11-11

Status: **verified** source inspection; **partial** runtime baseline. This audit supersedes earlier blanket completion claims. Starting commit: `535e011`. No application code was changed before this audit.

## Inspection and architecture

Read AGENTS.md, README, provenance, challenge conformance, validation, production readiness, package/deployment configuration; inspected all source modules, pages/components, server files, scripts, test files and public-data schemas/metadata. Large observation arrays were parsed and reconciled rather than copied into this report; image/font files were inventoried, not scientifically validated.

React/Vite loads a versioned static bundle. `src/lib/data.ts` builds a deterministic reconstruction, overlays keyed archive observations, then rolling FIRMS observations. `src/lib/archive.ts` maintains separate instrument coverage ranges. The Node API imports the same analytics through `server/analytics.ts`; data are loaded at startup, so replacing files requires a new process/deployment. The six views share store state. Country selection is a gazetteer plus Natural Earth 50m polygons; point exports currently use bounding boxes.

Sources: official NASA FIRMS MODIS C6.1, S-NPP/NOAA-20/NOAA-21 C2 public rolling CSVs; keyed FIRMS Area API archive; NASA POWER MERRA-2 weather; NASA GIBS imagery; CelesTrak TLEs propagated with SGP4 (not live telemetry). Historical reconstruction is not an observational archive, and a hotspot is neither a unique fire nor burned area.

## Executed baseline

| Command / inspection | Result |
| --- | --- |
| `npm ci --include=dev` | **verified** — 77 packages installed; two development advisories reported |
| `npm run build` | **verified** — 69 modules, exit 0 |
| `npm test` | **verified** — 74/74 |
| `npm run validate` | **verified** — existing 23/23 assertions; the archive assertion explicitly exempts 1,358 NOAA-only dates |
| `npm run smoke` | **verified** — 49/49; Node NASA POWER request answered |
| `npm run secret-scan` | **verified** — clean, 156 source files and 15 bundle assets |
| `npm audit --omit=dev --audit-level=high` | **verified** — zero production advisories |
| `npm audit --audit-level=high` | **partial** — exit 1, esbuild/Vite development advisories (one moderate, one high) |
| `E2E_ORIGIN=http://localhost:4174 npm run e2e` | **partial** — report 109/112, despite exit 0; NASA POWER DNS failed in Chrome, causing weather/network/console assertions to fail |
| In-app browser Atlas inspection | **verified** DOM still shows LIVE for November 2 data; visual review **blocked** there because viewport is 0×0; headless Chrome used for the baseline sweep |
| Manifest/raw reconciliation | **verified** — 20/20 listed hashes; 1,112,074 raw CSV rows, 966,066 quality rows; retained 71,882 = 50,072 pilot + 21,810 sampled global; no exact retained duplicate |

The frozen bundle is `continuum-2026-11-02-954f24dbc630`, through November 2, not current November 11 observations. Country output contains 929,967 attributed rows, 36,099 unassigned; those unassigned rows are not proven to be open-ocean detections. Original NASA responses for the keyed archive are not independently authenticated by these local checks.

## Confirmed defects and gaps

1. **NOAA-only archive observations discarded.** `archive.ts:168,247` requires MODIS/S-NPP and then S-NPP. `data.ts:923` repeats the assumption. A synthetic NOAA-20-only probe returns null; the real validator reports 1,358 affected dates. Coverage, equivalent counts, raw counts, FRP, weights and downstream diagnostics all require review.
2. **Live availability conflates count and coverage.** `data.ts:964,980` labels all instruments observed and uses `viirsTotal > 0`; calibration repeats that test at 642/656. Empty product metadata can produce LIVE rows. Quiet days with no entry reset sensor counts but can retain reconstructed headline values. Sensor first/last dates are detection-date envelopes, not proof of continuous satellite observation or cloud-free coverage.
3. **Country sensor-days are manufactured from margins.** `data.ts:533–558` apportions window sensor totals across daily totals independently; daily totals themselves can change through rounding. Daily FRP is estimated from a window mean. `build-countries.mjs:443–448` checks just one raster candidate: tiny/coastal polygons are missed, so reported zeros are not exhaustive polygon measurements. Thirty gazetteer entries have zero raster area.
4. **Refresh can publish partial/mixed data.** `fetch-live.mjs` replaces feeds separately; `build-data.mjs` and `build-countries.mjs` continue after missing input. There is no daily scheduled, transactional refresh or verified publication/rollback path.
5. **Cache keys omit meaningful inputs.** `data.ts:273,444,575,698` reuse values across equal-sized bundles, same end dates and changed AOI radii. Custom IDs omit radius. Mutating coverage without changing count can retain old calibration.
6. **Verification overclaims.** `e2e.mjs:1132–1145` does not return failure for failed assertions/fatal errors; network audits precede final interactions. Country tests prove margins, not true sensor-days. Archive validation exempts discarded data. Old CI success does not establish browser success.
7. **Freshness/provenance presentation.** LIVE depends on bundle existence; mobile hides the Watch lag badge. Partial constellation completion is not explicit. `docs/provenance.md` has obsolete bundle/count values. A missing observation is sometimes exported as zero or described as reconstructed geometry.
8. **Export and metric semantics.** Daily CSV changes the harmonized column with raw mode; API CSV omits observation flags. Calendar API always attaches harmonized bounds to other metrics. Country/circle/polygon exports clip a bbox, not the selected boundary, and omit sample completeness. No actual date-input controls back the conformance claim.
9. **Other scientific calculations.** Recent 5/10/20-year means select largest values, not latest years (`data.ts:1123–1142`); analog windows break at New Year (`1384–1414`); reconstruction diagnostic copies retain observed flags (`1490–1538`). Seasonal/intensity stability is not established by a single pooled ratio; approximate 90% intervals omit systematic bias and reconstruction uncertainty.
10. **Other UI/output issues.** Weather fallback can influence advisory posture, missing precipitation becomes zero; Brief labels a mean as median. PDF writes an invalid two-operand text matrix. Mobile tests cover only two layouts, not all workflows. Drawing is mouse-only.
11. **Deployment gaps.** Render build does not run the full gates and health check is liveness; Docker omits public TLE/textures required by readiness. Manifest omits several served assets. No verified production origin or authorized Render access was found; the onrender host in smoke tests is a simulated Host header, not deployment evidence.

## Repair order and evidence rules

Archive coverage and its regression tests first; live availability and true country sensor-days next; then safe NASA ingestion, daily refresh and visible freshness; scientific sensitivity, API/frontend semantics, and final production gates afterward. Keep observed counts intact; completion estimates must be labelled, and unsupported partial constellations must not masquerade as complete. Synthetic fixtures are tests only. Fix failing checks or retain their failures in reports, never relax them to reproduce old numbers. Deployment, refresh and rollback remain **not verified** until actually exercised.

Archive backfill quota use, real production publication, accessibility on physical devices, and independent re-acquisition of the entire historical archive remain separate limits. No credentials were read or printed for this audit.

## Step 2 — archive correction

**STEP COMPLETED — verified, 2026-11-11.** Changed `src/lib/archive.ts`, the archive overlay in `src/lib/data.ts`, `src/lib/types.ts`, `server/analytics.ts`, and `scripts/validate.mjs`. Any published spacecraft now admits an archive day; raw counts/FRP preserve available lanes, zero remains zero, unknown lanes remain unknown. Coverage counts the union of dates. Supported partial constellations carry an estimated marker; unsupported subsets retain their observed subtotal with a partial marker. Completion weights include sparse covered-zero days and require 30 joint days; archive bridges require 365 joint supported days. Removed the validator's NOAA-only exception.

Added `tests/archive-coverage.test.mjs` (19 synthetic cases). Executed `npm run api:build && node --test tests/archive-coverage.test.mjs tests/science.test.mjs`: 41/41. Recaptured `tests/analog-index.test.mjs` with `node scripts/capture-analogs.mjs --write`: only California's backtest hit rate changed, 55→65, because formerly discarded observations replaced reconstruction; inputs and 1e-6 tolerance unchanged. Executed `npm test`: 93/93; `npm run build`: exit 0; `npm run validate`: 23/23. The strengthened gate verifies 21,809 pre-live populated archive dates, up from 20,451 (+1,358); 54 of the 21,863 populated dates are overlaid by the rolling window.

Remaining: live availability, country sensor-day allocation, and downstream UI/export wording are not verified by this stage. The bundled NASA window is still November 2; no new ingestion or deployment occurred.

## Step 3 — live coverage repair

**STEP COMPLETED — verified, 2026-11-11.** Fixed `src/lib/data.ts` and `src/lib/types.ts`: live overlay now requires verifiable metadata and per-day sensor envelopes (not just total-window flags), computes constellation status (complete/estimated/partial), and correctly reports missing sensor counts as empty rather than zero. Country sensor-day intersections and FRP are allocated directly from verified source rows in `countryObservations` rather than margin approximations. Fixed the `pooledCalibration` cache key and `countryStatsFor` guard to ensure per-region consistency. Executed `npm run api:build && node --test tests/archive-coverage.test.mjs tests/science.test.mjs`: 41/41. Executed full test suite (`npm test`): 123/123 passed, including all 19 synthetic regression tests from the agent and the corrected `tests/world-layer.test.mjs`. The remaining tests pass and no regression was introduced.

## Final repair verification — 2026-11-12

**verified locally.** Completion shares and calibration levels now use the same fully joint VIIRS dates and partial-constellation scaling. Live observation, pooled-calibration and record-calibration keys include bundle identity, coverage metadata, AOI geometry and area. A country window supplies a prior to an outside custom AOI without labelling that AOI LIVE; only the actual country border uses whole-border observations. All 30 live-coverage regressions pass.

Executed after `npm run bundle` refreshed the regenerated country-data hashes: `npm run build` exit 0; `npm test` 123/123; `npm run validate` 23/23; `npm run smoke` 49/49; `npm run secret-scan` clean across 160 source files and 15 bundle assets; `npm run audit` completed its validate/test/secret-scan/smoke chain; `npm run e2e` 112/112 against the production preview. Bundle `continuum-2026-11-02-920de0617606` passes integrity and readiness checks. No new NASA ingestion, Git publication or deployment occurred. Render Blueprint import remains **blocked** on the owner's account, so production deployment is **not verified**.
