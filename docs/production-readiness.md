# Continuum — Production readiness traceability

- Date: 2026-11-03 (this file supersedes the 2026-11-01 snapshot; every row below was
  re-checked against the tree as it stands now, on bundle `continuum-2026-11-02-954f24dbc630`)
- Reference: the two requirement briefs (`docs/full prd.pdf` — Continuum PRD: Production Ready
  Deployment, 31 Oct 2026 — and `docs/Continuum Product Requirements Document (Full).pdf`, 40 FR /
  35 US / SR-DR-UX-NFR) are read-only source material and are gitignored: the published repository
  carries this file, `docs/PLAN.md`, `docs/validation.md` and the machine-readable reports, which
  restate every gate with a command and its output. IDs below are the ones in those briefs.
- Scope of this file: map every production gate and every **Must** requirement to repository
  evidence, and keep the boundary explicit between what was executed here and what needs a host, a
  key, or an owner decision.

## 1. Verified baseline (this machine, this tree)

| Command | Result |
| --- | --- |
| `npm run build` (`tsc -b && vite build`) | exit 0 — 69 modules, `dist/` emitted, 2.96 s |
| `npm run validate` | 23/23 checks passed (`docs/validation-report.json`) |
| `npm test` | 74 pass / 0 fail (`node:test` over the API bundle, plus contract cases against a server spawned on an isolated port) — four of the 74 drive the shipped search ranker over 194 independent-state names and thirteen UN/ISO long forms |
| `npm run secret-scan` | clean — no credentials in the tracked tree or the built bundle (155 source files, 19.3 MB, 15 bundle assets on 2026-11-03; it walks the working tree and skips `node_modules`, `.git` and `data_raw`, so the count moves with local scratch artifacts, not with the published content — 136 files are tracked) |
| `npm run smoke` | 49/49 checks passed (`docs/api-smoke-report.json`) — three of them the world layer over HTTP, two of them the scheme-dependent headers a TLS terminator needs |
| `npm run e2e` (headless Chrome, `E2E_ORIGIN=http://localhost:8787`) | **112/112**, `failed []`, zero console errors — incl. checks that every territory Natural Earth 50m has no polygon for is reachable by name, that open water labels itself, that a click inside a border selects that border country-wide instead of a 150 km circle, that a name the gazetteer abbreviates ("Marshall Islands" vs published "Marshall Is.") still opens its own border, that typed latitude/longitude open the area they name, and that the per-point hotspot CSV and the per-point GeoJSON carry exactly the same detections |
| `npm run perf` (headless Chrome + API on one loopback origin) | **every measurable §2 objective met**, zero breaches; three whole-session near-misses are listed in the report rather than smoothed away (`docs/perf-report.json`) — see §2 Performance |
| `npm run rehearse` (backup/restore drill, API on :4198) | **12/12 steps** on 2026-11-03 against the full 9-file bundle — `/ready` 200 → 503 → 200 around a one-byte change and a deleted file, `npm run validate` failing and recovering on the same bytes (`docs/rehearsal-report.json`). This row was 12/12 on 2026-11-01 against a 4-file bundle; the drill's hand-written file list had stopped following the manifest, so it could no longer pass in a tree that ships the world layer — CI caught it on the first push, `scripts/rehearse-restore.mjs` now derives the list from `bundle_manifest.json` |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |
| `npm audit --audit-level=high` (dev included) | 2 advisories, both dev-server only — see §7 |
| `public/data/snapshot.json` | 7 pilot regions, live window 2026-10-26 → 2026-11-02 |
| `public/data/countries.json` | 241 Natural Earth 50m countries, 1,616 polygons, per-country area + measured `detections` |
| `public/data/country_fires.json` | the same live window attributed by point-in-polygon: 966,066 quality rows read, 929,967 (96.26 %) inside a border, 178 of 241 countries with at least one detection |
| `public/data/bundle_manifest.json` | content-derived `bundle_version`, per-file sha256 + byte counts |
| Published clone of `main` (`https://github.com/rickykhulal/continuum`), same chain | build exit 0 with identical hashed assets, tests 70/70, validate 23/23 (16 shipped files, 4 `data_raw` inputs named as absent), smoke 49/49, e2e 100/100, `GET /ready` 200 `integrity {ok:true, files:20}` — `docs/runbooks.md` §6.1 |
| GitHub Actions, `ubuntu-latest` | **success on every push since `ab3e0c0`** — twelve consecutive runs measured through `104e58d`, which concluded success at 2026-11-04T04:09:20Z (read from the Actions API with `event=push`, not from the badge; `run_number` 15, `run_started_at` 03:59:32Z, all **20/20 steps success**); the docs commit that recorded it, `56625a9`, was green at 04:20:01Z — thirteen in a row. Each run is the whole chain (install, `tsc -b`, tests, build, validate, secret-scan, smoke, rehearse, headless-Chrome e2e, perf probe) on Linux from a checkout with no `data_raw/`; the three runs before those failed at `npm run rehearse`, which is how the drill's stale four-file list was found. `8da97f8` is the run that carried the 104-check sweep and `3fc39a5` the 105-check one, so territory reachability and the pasted-border-link assertion are verified on Linux and not only on this machine |

Repository now also holds: `server/api.mjs` + `scripts/build-api.mjs` (read-only API over the
browser's own analytics bundle), `.github/workflows/ci.yml`, `Makefile`, `LICENSE`, `NOTICE`,
`.env.example`, `.gitattributes`, `render.yaml` (the Render blueprint: build, start, health path and
the four env vars a deploy needs), and the docs set `api.md`, `validation.md`, `provenance.md`,
`runbooks.md`, `decisions.md`. Not published: `data_raw/` (see Reproducibility above), `dist/`,
`dist-server/`, `backups/`, the requirement PDFs and every scratch capture — all of them in
`.gitignore`, so `npm run secret-scan` and the published tree see the same set of files.

## 2. Production-ready gates (deployment PRD §2)

| Dimension | Gate | Status | Evidence / remaining gap |
| --- | --- | --- | --- |
| Functional | All Must requirements pass | **PASS on every locally testable Must FR** | 112/112 e2e. FR-01's drawing is now operable by pointer **and** keyboard, so no Must item is blocked on a local code path; what remains is host-bound (real devices, real deployment). Selection is no longer a curated shortlist: the world search reaches all 241 countries and any point on Earth resolves to an area — and the read-only API answers for the same 241 ids (`region_id: "country-<id>"`, indexed by `GET /meta`), so "selectable" means the same thing on screen and over HTTP. Coverage is proved exhaustively rather than
sampled: all 241 ids from `/meta` were requested over HTTP — 241/241 answered 200 with the full 9,498-day
series, 178 non-zero and 63 measured zeros, and every one of the 241 live-window sensor lanes equals the
point-in-polygon count in `data/country_fires.json` (`docs/validation.md`, 2026-11-03; re-asked at the
shipped rate limits on 2026-11-04T04:11Z against `104e58d` with the same result). The last hole in the
search index is closed: the 14 places 50m publishes no admin-0 polygon for — Tuvalu, Tokelau, Gibraltar,
Wake Island, Réunion, Mayotte, Canary Islands, Svalbard, Christmas Island, Cocos (Keeling), Bonaire, Ceuta,
Melilla, Hawaiʻi — are curated entries now, so each is reachable by typing its name and opens as a named
custom AOI; the sweep types all fourteen and asserts a result for every one |
| Scientific | Acceptance tests + written validation | **PASS (local form)** | `npm run validate` 23/23 + `npm test` 74/74 + `npm run smoke` 49/49 + `e2e` 112/112 at bundle `continuum-2026-11-02-954f24dbc630`; `docs/validation.md` records every gate and the restore drill with commands and results. The raw-archive comparison is measured, not pending: 30,529 observed sensor-days (21,863 distinct area-days) / 4,066,557 detections pulled from the keyed LANCE Area API over 9,822 requests; Chilecito and Pantanal are 100% observed (9,498 days each, zero modelled) with 5,401 and 2,441 shared MODIS/VIIRS days, so both bridges and both 2012 breaks are measured on archive days. The other five are partial — California 41.2%, Greece 33.0%, Southeast Australia 15.9%, Amazon 11.4%, Nepal 9.4% — and keep their calibrated bridges until the lanes share a full annual cycle; deeper SP lanes need the key's remaining 5,000-transaction/10-minute budget |
| Performance | Latency + web-vitals under load | **MEASURED — every §2 objective met locally; §9.2 initial JS inside budget on every view; not a load test** | `npm run perf` → `docs/perf-report.json` (2026-11-03T12:14, one loopback origin, Node v24.19.0, 8 CPUs, headless Chrome 1440×900 — re-run after the search-reachability commit so the figures match the shipped chunk). API p95 over 18 endpoints (216 measured requests) with 0 server errors: summary 16.5 ms, status 16.3 ms, calendar 16.5 ms, month-compare 16.1 ms, twin 15.8 ms, worst export 94.2 ms (GeoJSON) — against 2 s / 3 s / 10 s objectives. The two world-layer endpoints are in the same probe now, so a country is measured rather than assumed: `country-summary` (Kenya, the live window) p95 15.9 ms, and the worst case in the gazetteer, `country-calendar` (Russia, 2000-01-01 → 2026-11-02, 9,498 rows), p95 37.0 ms. Web vitals: LCP 1 404 / 1 072 / 796 ms vs 2 500; INP 1 / 2 / 1 ms vs 200 (processing component only, maximum over observed events, not p75); CLS 0.0003 / 0.0003 / 0.0003 vs 0.1. Initial JS is judged per view on the payload that view waits for (ADR-21, extended to all six routes on 2026-11-03): Orbital Watch **224.48 KiB = 229.87 kB gzipped**, Atlas **102.07 KiB = 104.52 kB**, Method **84.69 KiB = 86.72 kB** — inside the §9.2 "250 kB" budget on either unit reading. A sweep that visits every route downloads 262.3–270.5 KiB in total; that session figure is printed as a near-miss, never as the budgeted initial payload. Data lag 12.2 h vs 48 h. Not measurable here: 99 % availability (one local process), concurrency, TLS/CDN, real devices — and TBT (2.9–5.8 s per observed run) is inflated by software WebGL under `--disable-gpu`, which the static Method control view separates from app work. Closing this row needs a deployed target plus field data, not a better probe |
| Reliability | Graceful degradation, backup/restore rehearsed | **PARTIAL — restore rehearsed locally, not against a host** | degradation verified (FR-37 path, weather failure notice, `e2e` network audit); `docs/runbooks.md` has five incident playbooks. The restore drill ran: 12/12, `/ready` flips 200 → 503 on a one-byte change and a deleted file, `npm run validate` refuses the same bytes, recovery lands on byte-identical responses without a restart (`docs/rehearsal-report.json`, runbook §8). What is still not proven: restoring a *host* volume from a provider snapshot and re-deploying — nothing is deployed |
| Security | Checklist, dependency + secret scans clean | **PASS (dev advisories documented)** | headers + traversal + rate-limit asserted in `npm run smoke`; `npm run secret-scan` clean; prod audit 0. CSP allow-list matches the app's only external call (NASA POWER) — textures, TLE and data are same-origin |
| Privacy & legal | No personal data; LICENSE, NOTICE, provenance | **PASS (licence pending ratification)** | `LICENSE` (MIT, proposed), `NOTICE`, `docs/provenance.md`; no accounts, no cookies, no analytics (`ANALYTICS_ENABLED=false`); share links carry only view state |
| Accessibility | Automated audit clean of serious findings | **PARTIAL — structural sweep green on all six views** | A dependency-free sweep in `npm run e2e` asserts, on every view: accessible names for all focusable controls, labelled form controls, no positive `tabindex`, no skipped heading rank, every image named or decorative, every `role="img"` graphic named, one `main` + a `nav`, `<html lang>` declared, and a polite live region on the views that update asynchronously. FR-32 keyboard sweep (navigation **and** the draw canvas), FR-33 table alternatives and FR-34 toggles are also verified in-browser. Still missing: an axe/pa11y engine run, contrast ratios, and a manual screen-reader pass — see §6 |
| Observability | Logs, metrics, uptime, alerts live | **PARTIAL — exporter verified, collector needs a host** | `LOG_FORMAT=json` structured access log, `/health`, `/ready` and a Prometheus text `/metrics` are implemented and smoke-tested (11 checks: token gate, `404` when disabled, bounded labels, counters that match the run's own traffic). `deploy/prometheus-scrape.example.yml` supplies a scrape job and six alert rules, **authored not executed** — no Prometheus/Alertmanager was installed or run here, so no alert is live and no dashboard exists |
| Operability | Runbooks written and rehearsed, rollback tested | **PARTIAL** | `docs/runbooks.md` written, every command in it was executed except the container ones and the Render dashboard import — the chain a Render deploy runs (`npm ci` → `api:build` → `build` → the gates → `node server/api.mjs`) was executed instead against a fresh clone of the published `main`, §6.1; rollback = redeploy previous image, not drilled |
| Documentation | README, method card, API docs, decisions log | **PASS** | `README.md`, `/method-card` endpoint + `src/pages/Method.tsx`, `docs/api.md` (18 declared paths + Observability section), `docs/decisions.md` (24 ADRs), `docs/runbooks.md` §7 monitoring + §8 restore drill + §6.1 Render deploy, `deploy/prometheus-scrape.example.yml`, `docs/perf-report.json` + the probe's own caveat list |
| Reproducibility | One command rebuilds the bundle | **PASS on this machine / PARTIAL from a clone** | Here: `npm run data` → `npm run countries` → `npm run bundle` → `npm run validate`, no download needed, because `data_raw/` holds the four global FIRMS CSVs. Those 94 MB of CSVs are **not published** — the backfill logs beside them carry download URLs, and `data_raw` is the one directory a secret could leak into — so a fresh clone ships the bundle, not its inputs. What a clone can still do is verify it: `public/data/bundle_manifest.json` carries the sha256 and row count of every CSV that was consumed, `npm run validate` checks all 16 shipped entries and names the four inputs it could not open, and `npm run live` re-downloads exactly those files so the same check tightens to full coverage without any code change. Measured on a fresh clone of `main` (2026-11-03): build exit 0 with the same content-hashed assets, `npm test` 70/70, `npm run validate` 23/23 ("16 files verified, 4 data_raw build inputs absent"), `npm run smoke` 49/49, `npm run e2e` 100/100, `GET /ready` 200 — see `docs/runbooks.md` §6.1 |

## 3. Must requirements (product PRD §7)

| ID | Requirement (abridged) | Status | Evidence |
| --- | --- | --- | --- |
| FR-01 | Define area by drawing polygon/rectangle/circle | **PASS** | `src/components/DrawArea.tsx`, opened from `AreaBar`. Two e2e blocks drive it. Pointer: a dragged rectangle validates, reports km²/vertices/data-volume with its measured basis, and becomes the analysed AOI. Keyboard (trusted key events): Enter sets the first corner, shifted arrows drag it into a valid 4,120 km² shape resolved to a 36 km radius at −18.10°, −56.60°, Enter on the focused *Analyze this shape* resolves it, and a four-vertex polygon built with Enter + arrows closes with `C` (1,541 km²) and resolves like a pointer shape. Closing now repeats the first vertex, which is what `inspectGeometry` requires — before it every drawn polygon was rejected as `RING_NOT_CLOSED` |
| FR-02 | Define area by lat/lon/radius | PASS | `AreaBar.apply()` → `store.selectCustom()`, radius clamped 20–800 km |
| FR-05 | Validate geometry, show area + data-volume estimate, reject oversize | **PASS** | `inspectGeometry` + `simplifyRing` + `MAX_VERTICES`; area from `polygonAreaKm2`; volume from `estimateDataVolume` with a density measured on **the drawn area itself** (its own bbox × live-window days), the assumed floor labelled as not-a-measurement when no live point falls inside, and stable across
*Analyze* (`e2e`: *"Data-volume estimate is measured on the drawn area and is unchanged by Analyze"*); >250,000 km² rejected with a reason badge; `npm test` geometry cases |
| FR-06 | Date range + metric | PASS | Atlas range controls, 3 metrics (`e2e`) |
| FR-07 | Shareable link, no personal data | PASS | `e2e` share + restore round-trip; hash routing carries view state only |
| FR-08 | Calendar heatmap 2000-11-01 → latest | PASS | `e2e` |
| FR-09 | Fire-days / hotspot-equivalents / FRP, views update together | PASS | `e2e` |
| FR-10 | Hover: value, interval, per-sensor, trust, provisional | **PASS** | `e2e` hover checks assert `VIIRS-eq` value, `90% CI`, the four-sensor mix and the trust label in `.calendar-readout`; a second check asserts the interval is **hidden** when the displayed metric is fire-days/FRP, because `lo/hi` are intervals on the harmonized hotspot count (see `docs/decisions.md` ADR-13); provisional/LIVE badges asserted on the day inspector |
| FR-11 | Day panel with hotspot map + table | PASS | `e2e` four-sensor table |
| FR-12 | Month comparison with median/anomalies/top years | PASS | `e2e` |
| FR-13 | Raw vs harmonized toggle + split with axis lock | PASS | `e2e` compare mode |
| FR-14 | No-data ≠ zero | PASS | `cal-nodata` state distinct from zero; `npm run validate` gap assertions |
| FR-15 | Bias X-ray waterfall with intervals | PASS | `biasXray()` + `e2e` |
| FR-16 | Phantom-trend meter for the 2012 break | PASS | Diagnosis page; default area raw 136.5% → corrected −45.6% (66.6% of the step removed, measured on archive observation days since the MODIS lane reached 2022), computed at render time |
| FR-18 | Provisional marking + data-through date | PASS | `snapshot.json` per-sensor freshness (all four sensors current to 2026-11-02 → `provisional_from` 2026-11-03, whole rolling window still labelled), lag branch proven on a truncated snapshot in `tests/science.test.mjs`, `e2e` |
| FR-19 | Status card (percentile, band, difference, sentence) | PASS | `statusFor()` + `e2e` |
| FR-26 | CSV export with raw + harmonized + sensor/quality columns | PASS | `exportCSV`; `e2e` asserts a >20 kB download |
| FR-27 | One-page PDF brief | **PASS** | `src/lib/pdf.ts` + `Brief.tsx` *Download PDF*; `e2e` waits for a real `*advisory*.pdf` download and asserts `%PDF-1.4` header, `%%EOF` trailer, size > 900 B; API route `POST /brief` returns the same document (smoke: 1,537 B) |
| FR-29 | Data and Methods page with equations, validation, limits, version | PASS | Method page; equations now match the implemented estimator (`docs/decisions.md` ADR-04) |
| FR-32 | All core functions operable by keyboard | **PASS — verified for the paths tested** | `e2e` keyboard blocks use trusted CDP key events. Navigation: calendar takes focus and announces its contract, cursor clamps at today, arrows move between days, Enter opens the day under the cursor, Space activates a toggle, Enter expands a table alternative, skip link focuses `#main` without resetting the hash-routed view. Drawing (12 checks): the canvas is focusable with `role="application"`, an exhaustive `aria-label` and an `aria-live` status; Enter/Space place, shifted arrows move four steps, `C` closes a polygon, Backspace undoes, Escape clears, `F` fits and `R` resets the view, and Enter activates *Analyze this shape* from focus. Not covered: a full tab-order review of every panel and a screen-reader pass (§6) |
| FR-33 | Table alternative for every chart | **PASS** | `TableAlt`/`ChartTable` in `src/components/ui.tsx`; `e2e` asserts every `svg.chart` has a sibling `.table-alt` (3/3 on Atlas) plus a 13-column year×month calendar table, and the hour-by-hour table on Watch; collapse, scroll and print rules in `src/styles.css` |
| FR-34 | Color-blind-safe, high-contrast, texture options | PASS | accessibility toggles + `e2e` |
| FR-37 | Failures degrade to cache or clear notice | PASS | `e2e` network audit; weather 503 path keeps a labelled offline strip |
| FR-40 | Responsible-use statement + known limits | PASS | Method page `responsible-block`, `limits-list` |

Should-level items already present: place search (FR-04), season clock (FR-20), Fire Twin analogs
(FR-21), weather strip (FR-22), sandbox (FR-24), PNG/GeoJSON export (FR-28), ES language (FR-35),
read-only API with OpenAPI (FR-31).

## 4. Deployment-PRD architecture status

| Component | PRD section | Status |
| --- | --- | --- |
| FIRMS/GOES/POWER ingest, harmonization pipeline (Phases 1–11) | 3, 7 | Not present by scope — the app generates the 2000→today record deterministically, calibrated to the live FIRMS window, labelled RECONSTRUCTION on every surface (`docs/provenance.md`, ADR-05) |
| Versioned data bundle + integrity checks | 7.2, 7.5 | **Present** — `scripts/bundle.mjs` manifest with per-file sha256; `scripts/validate.mjs` 23/23; content-derived `bundle_version` (ADR-06) |
| Read-only API + OpenAPI + contract tests | 8 | **Present** — `server/api.mjs` (zero runtime deps), 18 declared paths, §8.3 error model, body/vertex/area limits, rate classes A/B/C applied identically to bare and prefixed paths; `docs/api.md`; 49/49 smoke |
| CI with typecheck/test/build/audit/secret-scan/e2e | 11 | **Present and running** — `.github/workflows/ci.yml`, 15 steps, executed on `ubuntu-latest` from a fresh checkout of the published `main` on **every push since `ab3e0c0`** (twelve consecutive successes measured through `104e58d` at 2026-11-04T04:09:20Z, thirteen through `56625a9` at 04:20:01Z; this row used to read "the workflow itself has not run", which stopped being true the moment the remote existed). `npm run rehearse` runs there as a blocking step (it corrupts a temp copy only). `npm run perf` runs as a **non-blocking measurement** with `docs/perf-report.json` uploaded as an artifact, because a loopback probe on a CI runner is not a gate — it is a trend line. The two assumptions this row used to flag are now measured, not assumed: the run's job lists **all 20 steps success on a checkout with no `data_raw/`** — the 15 authored in `ci.yml` plus the runner's own housekeeping steps — including *"Integrity gate on the committed bundle"* (`npm run validate`) and *"Browser sweep against the production build"*, so a clone verifies the shipped entries and tolerates the four raw inputs being absent exactly as §6.1 records locally |
| Containers, staging, IaC | 10, 13 | **Authored, not executed** — `Dockerfile`, `docker-compose.yml`, `deploy/static-headers.example` (ADR-10). No Docker engine here |
| Security headers + app controls | 12 | **Present** in the origin, asserted by smoke; edge equivalents documented |
| Observability, alerts, dashboards | 13 | Metrics exporter **present and smoke-verified** (token-gated `/metrics`, bounded labels); scrape job + 6 alert rules authored in `deploy/prometheus-scrape.example.yml`; the collector, routing and dashboard themselves are blocked on hosting |
| Load testing | 14.3 | Not run — needs a target |
| Release/rollback drills | 15, 21 | Blocked on hosting; 8-step checklist written in `docs/runbooks.md` |

## 5. What "verified" means in this file

Every PASS above is backed by a command that was run on this machine against this tree, with the
machine-readable report committed next to the docs. Nothing is marked PASS because the code "looks
right", and nothing that needs a network ingest, a container engine, or a cloud account is marked
PASS at all. Where an assertion is only as broad as the test behind it, the row says so (Reliability,
Accessibility, and FR-32's "paths tested").

## 6. Remaining work, split by what unblocks it

**Needs an owner decision (no code):**
- Ratify the licence (currently MIT as a proposal, ADR-12).
- Approve spending the remaining FIRMS quota to deepen the archive. The keyed backfill is attached and
  paused at a clean checkpoint after 9,822 requests; what is left is standard-processing depth for
  California, Greece, Amazon, Nepal and Southeast Australia (their MODIS/SNPP lanes are partial; the
  near-real-time tail is complete for all seven areas). The key's 5,000-transaction/10-minute budget is
  shared, so the writer waits on `mapkey_status` rather than tripping the limit. Each pass re-promotes
  and re-runs the chain — hours of wall-clock, not a code change.
- Choose a host and approve deployment, TLS, and alerting.

**Needs a machine with an engine/host (artefacts already written):**
- `docker build .` → `docker compose up` → run the container sequence in `docs/runbooks.md` §6.2.
  `npm run smoke` cannot target a container — it spawns its own API on `SMOKE_PORT`.
- Apply `deploy/static-headers.example` at the edge and verify with the `curl -sI` checks in that file.
- ~~Run the CI workflow once on a remote~~ — done: `ubuntu-latest` has concluded **success** on five
  consecutive pushes, latest `f5b3abc`, on every gate (§1). What remains host-bound is loading a deployed target and load-testing it.
- Point a real Prometheus at the token-gated `/metrics` with `deploy/prometheus-scrape.example.yml`,
  run `promtool check config` / `promtool check rules`, and tune the six alert thresholds against a
  week of traffic. The exporter is verified; the collector, alert routing and dashboard are not.

**Closable locally, not yet done (next-sprint size):**
- Accessibility beyond structure: an axe/pa11y engine run in CI (axe-core itself cannot be installed
  offline), measured colour-contrast ratios, and one manual screen-reader pass with a tab-order review
  of every panel. The structural half of this is now automated in `npm run e2e`.
- Declare `esbuild` as an explicit devDependency once a registry is reachable (ADR-09).
- Re-run `npm run perf` on the target and compare against these loopback numbers, then add field-data
  collection (the PRD's p75s need real users, and no collector exists in this tree).

**Closed locally since the first pass at this list:**
- §9.2 initial JS is inside budget on **every** view. ADR-21's route split was extended on 2026-11-03 to
  all six pages, and SGP4 propagation was moved behind the globe, so `npm run perf` measures 220.05 KiB
  (225.34 kB) on Orbital Watch, 98.34 KiB (100.70 kB) on Atlas and 81.18 KiB (83.13 kB) on the static
  Method view — all under 250,000 bytes on either unit reading. The probe now reports the per-view
  initial payload and the whole-session download separately instead of summing every chunk a browsing
  session touches. Same sweep: `npm run e2e` 92/92, CLS 0.0003 on all three probes, INP 1–2 ms.
- The backup/restore rehearsal is done, and it earned its keep: it found that `/ready` and
  `npm run validate` certified `public/data` even when `DATA_BUNDLE_PATH` pointed elsewhere, and that a
  fallback made a *missing* file in a mounted bundle invisible (a deleted basemap simply resolved from
  the repo copy and hashed correct). Both gates now follow the variable, with no fallback when it is set
  (ADR-20). 12/12 steps in `docs/rehearsal-report.json`, procedure in `docs/runbooks.md` §8.

## 7. Known dependency exposure (dev-only)

`npm audit` (dev included) reports 2 advisories, both in the build toolchain, neither in shipped
code:

- `esbuild <= 0.24.2` — dev-server request-forgery advisory; used only by `scripts/build-api.mjs`.
- `vite <= 6.4.3` — dev-server path-traversal / `launch-editor` advisories; used for `dev`,
  `build` and `preview` only.

Mitigation in force: the production runtime is `node server/api.mjs` with **zero** runtime
dependencies, and the app never runs a Vite dev server — so `npm audit --omit=dev` is clean and the
container has no `node_modules` at all (`Dockerfile` copies only `dist/`, `dist-server/`,
`public/data`, `server/`). Operational rule: never expose `npm run dev` or `vite preview` on a
public interface. Upgrading Vite here would require re-resolving `package-lock.json`, which this
offline workspace cannot produce or verify; CI (`npm ci`) on a networked runner can.
