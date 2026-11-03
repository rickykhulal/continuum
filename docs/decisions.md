# Decisions log (ADRs)

Each entry records a choice that a reader of the code or of the API would otherwise have to guess,
with the alternative that was rejected and what the choice costs. Status is one of **accepted**
(implemented and verified locally), **accepted, not executed** (written, but the environment here
cannot run it), or **open** (needs an owner decision).

Nothing in this file claims a deployment, a hosted service, or a paid dependency was used.

---

## ADR-01 · Drawn geometry resolves to an equal-area circle

**Status:** accepted — verified by `npm run e2e` (draw block) and `npm test` (geometry cases).

**Context.** FR-01 lets a user draw a rectangle, circle, or free polygon. The record builder, the
API and every estimate downstream are driven by one center plus a radius: `customRegion(lat, lon,
radiusKm)` and the row filter in `src/lib/data.ts`. Rewriting the whole 26-year daily pipeline to
test arbitrary polygons per row would multiply cost and create a second, subtly different code path
for the same question.

**Decision.** Any valid drawn shape is reduced to the circle with the same area
(`geometryToCircle` in `src/lib/geometry.ts`), centred on the polygon's area-weighted centroid. The
UI says so in plain text on the readout (`≈… km radius AOI`) and in `draw-note`.

**Rejected.** (a) Ray-casting every hotspot against the raw polygon — accurate, but the harmonized
record is generated per region from a circular AOI, so a polygon would have to be *approximated* by
the generator anyway; (b) silently using the bounding box, which inflates area up to 4× for
elongated shapes and would overstate counts.

**Cost.** A drawn shape and the same shape's equal-area circle give identical numbers, but a
non-convex polygon loses its holes and concavities. Documented in `docs/api.md` and on the Method
page rather than hidden.

## ADR-02 · The API imports the browser's own analytics bundle

**Status:** accepted — `npm run smoke` 44/44 includes cross-checks that API responses equal the
values the same bundle produces for the same region.

**Context.** PRD §8 wants a read-only API, and the product must not show one number on screen and
another at `/api/v1/*`. Two implementations of the harmonizer would guarantee drift.

**Decision.** `scripts/build-api.mjs` runs esbuild over `src/lib` and emits
`dist-server/analytics.mjs`; `server/api.mjs` imports it and nothing else for computation. The
server has zero runtime dependencies (`node:http`, `node:fs`, `node:crypto`), so there is no
server-side package that could disagree with the client.

**Rejected.** A Python/FastAPI reimplementation of the estimator (the deployment PRD's illustrative
stack). Correct in principle, but it would put the scientific model in two languages with no test
that could prove they agree on every region.

**Cost.** The server cannot scale the computation independently (e.g. a Postgres-backed aggregation)
without breaking the single-source property. Accepted: the bundle is small enough to compute in
memory.

## ADR-03 · NOAA-20 and NOAA-21 never enter the harmonized series

**Status:** accepted — asserted in `npm test` and visible in `snapshot.json` per-sensor freshness.

**Context.** The harmonized series must be comparable from 2000 to today. `k_area` is calibrated
from the S-NPP VIIRS/MODIS overlap window. NOAA-20 (2018) and NOAA-21 (2021+) have no MODIS partner
and a different overpass geometry; scaling them by an S-NPP-derived factor and adding them would
create fresh phantom steps at their launch dates.

**Decision.** `H` uses MODIS before the break and S-NPP VIIRS after. NOAA-20/21 counts are reported
as extra information (day inspector, CSV, per-sensor freshness, provisional flags) but are excluded
from `H`, from `raw`, and from every delta.

**Rejected.** Summing all VIIRS satellites — the obvious reading of "hotspot count" and exactly the
thing that makes a trend chart lie at 2018 and 2021.

**Cost.** Absolute counts are lower than a "all sensors" headline number. Stated on the Method page
so a reader cannot mistake `H` for a total detection count.

## ADR-04 · MODIS-only days are rescaled, not added

**Status:** accepted — this is the estimator described in README and `src/pages/Method.tsx`.

**Context.** The 2012 Terra/Aqua afternoon coverage change is the phantom break FR-16 exists to
expose. A series that adds MODIS and VIIRS counts per day steps upward the moment a second sensor
appears.

**Decision.** One value per day, from whichever sensor defines the regime for that day:
`H = V_day` when S-NPP VIIRS is live, otherwise `H = k_area · M_day` with
`k_area = ΣV/ΣM` measured over the overlap days. `raw` is the naive single-sensor pick that the
toggle is meant to contrast against.

**Rejected.** `H = M + k·V`, which the earlier draft of this repo's documentation described. The
code never did that; the docs were wrong and were corrected rather than the model being changed to
match prose.

**Cost.** Days when both sensors are useful (e.g. one instrument degraded) are represented by VIIRS
alone; the confidence interval carries the counting error plus the `k_area` variance term on
rescaled days, so those days are wider, not silently averaged.

## ADR-05 · Reconstruction is labelled, not backfilled

**Status:** accepted for this scope; **open** as a product decision.

**Context.** PRD Phases 1–2 want a raw FIRMS archive ingest. That needs `FIRMS_MAP_KEY`,
multi-hour downloads, and storage — none of which are inside the approved scope of "verify locally,
no downloads, no credentials".

**Decision.** The 2000→today record is generated deterministically in `src/lib/data.ts`, calibrated
to the live FIRMS window that is actually fetched, and every surface that displays it labels it as
a reconstruction. `docs/provenance.md` separates the measured counts from the modelled ones and
gives the commands to re-derive both.

**Rejected.** Quietly shipping synthetic data that looks like an archive extract, and committing a
one-off downloaded archive (a licence and freshness problem, plus it would go stale immediately).

**Cost.** Scientific gate T-0x "validated against raw archive" cannot be marked passed. It is
listed as blocked in `docs/production-readiness.md`, not as done.

## ADR-06 · `bundle_version` is content-derived

**Status:** accepted — `scripts/bundle.mjs`; checked by `npm run validate` integrity pass.

**Context.** A version that changes every build makes `/ready`, the API envelope and the manifest
impossible to compare, and makes a "rollback" meaningless.

**Decision.** `bundle_version = continuum-<windowEnd>-<sha256 of the sorted per-file digests>`,
computed over file hashes only; `created_at` is deliberately excluded from the digest. The manifest
records each file's sha256, byte length, and the raw CSV digests the bundle was built from.

**Rejected.** A git SHA (the repo is not a git repository in this workspace) and a timestamp
(churns on identical content).

**Cost.** A content-identical rebuild at a different time yields the same version, which is the
point, but it also means a fix that changes no bytes cannot be versioned — provenance then has to
come from the code revision, which this deliverable documents in `docs/provenance.md`.

## ADR-07 · Default-deny CORS, no auth, read-only

**Status:** accepted — `server/api.mjs` (CORS list from `API_CORS_ORIGINS`), verified by
`npm run smoke`.

**Context.** The API serves derived public statistics; there are no accounts and PRD's privacy
gate forbids personal data. Rate limiting is a fairness measure, not an access control.

**Decision.** `API_CORS_ORIGINS` must name each origin explicitly; with no configuration the API
emits no `Access-Control-Allow-*` header, so browser callers from unknown origins fail closed.
Methods are GET plus POST-for-GeoJSON-on-the-same-payload class; there is no mutation endpoint, so
no authentication layer exists to leak. Rate classes A 120 / B 60 / C 20 per minute per client
keyed in memory.

**Rejected.** `Access-Control-Allow-Origin: *` (trivial, but lets any page hammer the service) and
JWT/API keys (they would need a secret store, a user, and a privacy statement this project does not
have).

**Cost.** The limiter is per-process and in-memory: it resets on restart and does not coordinate
across replicas. `docs/runbooks.md` records this as a known limitation of the local form.

## ADR-08 · Weather is fetched at runtime and never blocks a screen

**Status:** accepted — `e2e` network audit; `docs/runbooks.md` incident 3.

**Context.** FR-22 wants meteorology alongside burning. NASA POWER is keyless, but it is an
external dependency and PRD §2 reliability demands graceful degradation.

**Decision.** Runtime fetch from the browser, with the fetch source, timestamp and fit statistics
carried into the UI and into the FR-33 table notes. When it fails, the outlook screen renders the
labelled offline path instead of an empty panel.

**Rejected.** Prefetching weather into the bundle (the bundle would go stale daily and the manifest
would need a second refresh path) and a proxy endpoint with a stored credential (out of scope, no
secrets).

## ADR-09 · esbuild is used from the existing dependency tree, not declared

**Status:** accepted, **with a known wart**.

**Context.** `scripts/build-api.mjs` needs esbuild to produce `dist-server/analytics.mjs`. Vite
already ships it inside `node_modules`, and this workspace has no network access to regenerate
`package-lock.json` for a new top-level dependency.

**Decision.** Import the esbuild that is already present, and let CI (`npm ci`, which installs
Vite's tree) provide it.

**Rejected.** Adding `esbuild` to `devDependencies` here — an edit to `package.json` whose lockfile
entry could not be produced or verified offline, which would break `npm ci` for everyone.

**Cost.** The dependency is transitive, so a Vite major that stops shipping esbuild breaks
`npm run api:build`. Follow-up when a registry is reachable: declare `esbuild` explicitly and
commit the regenerated lock. Called out in `docs/validation.md` rather than left implicit.

## ADR-10 · Container and edge-header artefacts are authored, not run

**Status:** accepted, **not executed**.

**Status detail.** `Dockerfile`, `docker-compose.yml` and `deploy/static-headers.example` are in the
repository, but no Docker engine exists in this environment and running one was outside the approved
scope. Their headers and env defaults were written to match the values the *verified* Node server
already emits (`npm run smoke` asserts them), so a static host configured from the example cannot
be weaker than the tested origin.

**Decision.** Ship the text, label it unexecuted everywhere it appears (this file, the runbook,
`docs/production-readiness.md`), and treat the first successful `docker build && docker run` on a
machine with an engine as the acceptance test for these three files.

**Rejected.** Omitting them (PRD §10 asks for containers) and claiming they were tested (they were
not).

## ADR-11 · Every chart carries a table alternative, generated from the same array

**Status:** accepted — `e2e` FR-33 block asserts each `svg.chart` has a sibling `.table-alt`.

**Context.** FR-33 requires a tabular form for each visual, and a colour-only calendar heatmap is
inaccessible regardless of the palette. A hand-written table drifts from the chart above it.

**Decision.** `TableAlt` / `ChartTable` primitives in `src/components/ui.tsx` take the
`columns`/`rows` already computed for the chart. Charts are wrapped, not duplicated. Notes carry the
provenance strings (source, fetched-at, fit) so the table is citable on its own.

**Rejected.** A single "download all data" CSV (satisfies export, not the per-chart reading
requirement) and rendering tables only on the Diagnosis page.

**Cost.** Some tables are long (the calendar table is years × 13). They are collapsed by default,
`max-height` scrolled, and excluded from print — visible in the FR-33 CSS block.

## ADR-12 · Licence ships as a proposed default

**Status:** **open** — owner decision, PRD Phase 0/18.

`LICENSE` (MIT) and `NOTICE` are present so the privacy/legal gate is not empty, but the deployment
PRD lists the licence as a product-lead choice. This repo ships MIT as a **proposal**; changing it
is a one-file edit and does not affect any code path. Do not treat the presence of `LICENSE` as
ratification.

## ADR-13 · The 90% interval is only displayed in the unit it describes

**Status:** accepted — asserted by `npm run e2e` ("Interval is not shown in units it does not
describe").

**Context.** `DailyRecord.lo/hi` are the counting-error interval of the **harmonized hotspot
count** (VIIRS-equivalents). The calendar readout originally printed it next to whatever metric was
selected, so a fire-day view showed `1.0 fire-day · 90% CI 11.7–26.3` — two different quantities
that look like one measurement. On a product whose whole thesis is that misread sensor numbers
create phantom trends, this was the worst possible class of defect.

**Decision.** Show the interval only when the readout displays the harmonized hotspot count
(`metric === 'hotspots' && mode === 'harmonized'`) in `src/components/charts.tsx`, and qualify the
day inspector's copy as `90% CI (harmonized)` in `src/pages/Atlas.tsx`. Fire-day and FRP views show
the value, the unit, the four-sensor mix and the trust label, and no interval. The same readout now
names all four sensors separately instead of adding NOAA-20/21 into a single "VIIRS" figure, which
would have contradicted ADR-03 on screen.

**Rejected.** Rescaling the interval into fire-day or MW units — there is no defensible
transformation: a fire-day indicator is not a count whose Poisson interval can be re-expressed, and
FRP is a different physical measurement. Inventing one would manufacture uncertainty the model does
not have.

**Cost.** Two of the three metrics show no interval on hover. The per-sensor counts stay visible, so
a reader who wants uncertainty opens the day inspector, where the interval sits next to the quantity
it belongs to.

## ADR-14 · The area editor draws on a fixed window with an explicit pen and anchor

**Status:** accepted — asserted by `npm run e2e` ("No shape exists before the first keystroke",
"Shift plus arrows drag the opposite corner into a valid area", "C closes the polygon so it becomes
analysable").

**Context.** FR-32 requires the drawing to work without a mouse. The original canvas projected
coordinates through the **bounds of the shape being drawn**, which is self-referential: the step size
changed as the shape grew, so a keyboard user could not make predictable moves, and a shape larger
than the window could no longer be seen. Making the canvas keyboard-operable also exposed two latent
defects: a rectangle/circle had no stored corner, so the circle mode happily drew a default-radius
circle at the last stored centre before the user touched anything; and closing a polygon only set a
flag, while `inspectGeometry` requires the first vertex repeated — so every free polygon came back
`RING_NOT_CLOSED` and *Analyze* stayed permanently disabled.

**Decision.** Separate the view from the shape. `view` is a fixed 2.0° × 2.8° window centred on the
analysed region; a `pen` crosshair moves through it in 1/32-window steps (Shift multiplies by four),
and Enter/Space toggles an explicit `anchor`. Rectangle and circle geometry is always
`anchor → pen`, for the pointer and the keyboard alike, so both paths build the identical shape.
`C` closes a polygon by appending its first vertex, `Backspace` undoes one, `Escape` clears, `F`
fits the window to the shape and `R` resets it. The canvas is `role="application"`, focusable, with
the whole key contract in its `aria-label` and an `aria-live="polite"` status paragraph. Analysing a
shape re-centres the window on it and keeps it on screen: the editor records the centre it submitted,
so it can tell "the region moved because I drew it" from "the user picked another region".

**Rejected.** Painting the editor onto the 3D globe — the analyser works on a planar lat/lon
approximation (ADR-01), so a spherical canvas would show the user a shape the code cannot evaluate
the same way. Also rejected: driving the shape entirely from DOM focus order, which cannot express
two-dimensional movement.

**Cost.** The window is fixed, so a keyboard user pans with `F`/`R` rather than scrolling; a shape
that leaves the window is clamped to it. The canvas swallows arrow keys while focused, which is why
the status line repeats the current position and mode.

## ADR-15 · The data-volume estimate is measured on the area being drawn

**Status:** accepted — asserted by `npm run e2e` ("Data-volume estimate is measured on the drawn area
and is unchanged by Analyze").

**Context.** FR-05 asks for an estimate of *the drawn area*. The read-out computed detections/km²/day
from whichever region was selected before the draw (a preset the size of Pantanal, or a previous
custom AOI) and then applied it to the shape's bounding box. Pressing *Analyze* switched the density
source to the new region, and in the test run the same untouched polygon jumped from ≈312 to ≈38,205
detections/year between the read-out and the record — a number that moved because of a click rather
than because anything was measured.

**Decision.** When a shape exists, the density is measured over that shape's own circle region and its
own bounding box (`customRegion(shape)` → `livePointsForRegion` → `bboxAreaKm2`), and
`estimateDataVolume` is called on that same region, so density and volume cannot disagree. When no
shape exists the panel describes the selected region. If no live detection falls inside the drawn
area, the assumed floor is used and the note says so in words — "it is not a measurement". The
memo keys on the shape's numeric geometry rather than the object, because the geometry object is
rebuilt on every render and the pointer moves fire renders continuously.

**Rejected.** Keeping the previous region's density as a "regional prior" and showing both — two
numbers with one label invites exactly the misreading ADR-13 was written to prevent.

**Cost.** A small drawn area over a quiet window shows the floor rather than a measured rate, so its
estimate looks generic. The note names the basis, the detection count and the window length, so the
reader can tell measured from assumed.

## ADR-16 · Accessibility is proven structurally in-repo until an engine can be installed

**Status:** accepted — asserted by `npm run e2e` (nine structural checks, all six views).

**Context.** The deployment PRD asks for an automated accessibility audit with no serious findings.
The usual tools are axe-core or pa11y, both of which need a registry this offline workspace cannot
reach, and a dependency cannot be added and verified here without regenerating
`package-lock.json` — the same constraint as ADR-09. Shipping an unauditable claim ("accessibility
tested") would be worse than shipping the audit that *is* runnable.

**Decision.** Implement the structural half of an axe run inside the existing Chrome-DevTools-Protocol
sweep, with no new dependency: on every view, assert that all focusable controls carry an accessible
name (label, `aria-label`/`aria-labelledby`, `title`, `alt`, associated `<label>`, or visible text),
that every form control is labelled, that no element has a positive `tabindex`, that heading ranks
never skip, that every `img` either names itself or is marked decorative, that every `role="img"`
graphic has a name, that there is exactly one `main` and at least one `nav`, and that `<html>`
declares a language. Views whose content changes without user action must expose a polite live region.
`docs/production-readiness.md` §6 keeps the engine run, contrast measurement and screen-reader pass on
the open list, so the PASS claim does not exceed what is checked.

**Rejected.** Claiming an accessibility pass on the strength of the keyboard sweep alone. Adding a
hand-written `node_modules/axe.js` from memory — unverifiable, and it would fail the integrity gates.

**Cost.** Structure is not perception. A page can satisfy all nine checks and still read badly;
contrast ratios and announcement quality remain unmeasured until an engine can be installed, which is
one `npm i -D axe-core` and one extra block in the sweep away on a networked runner.

## ADR-17 · The metrics exporter is bounded, token-gated, and honest about what it cannot see

**Status:** accepted — asserted by `npm run smoke` (11 of its 44 checks).

**Context.** The deployment PRD wants logs, metrics, uptime and alerts. Logs, `/health` and `/ready`
already existed and were smoke-tested; metrics were listed as "blocked on hosting", which conflated
two different things. Producing an exposition does not need a host — *consuming* one does. The API is a
single zero-dependency Node process, so counters can live where the requests already end: the `log`
closure attached to `res.on('finish')`, which every response passes through exactly once.

**Decision.** Serve Prometheus text at `GET /metrics` (also `/api/v1/metrics`) from that accumulator,
with four rules, each covered by a check rather than by intent:

- **Finite labels.** `route` is only ever a name from the declared endpoint table or the single
  `static` bucket; `status` is a family (`2xx`…`5xx`); `class` is A/B/C; `code` is a declared error
  code. The harness requests 40 random paths and asserts the route-label count does not move. No IP,
  region, user-agent or full-path label is ever exported — the scrape must not become a surveillance
  surface or a self-inflicted DoS.
- **Absent unless configured.** `METRICS_TOKEN` in the process environment unlocks it. Unset ⇒ `404`
  identical to an unknown path; set ⇒ `401` for a missing or wrong token, compared as SHA-256 digests
  with `crypto.timingSafeEqual` so a short guess is not cheaper than a long one. The token never enters
  the repository, a response body, or a log line; the smoke run generates its own per execution and one
  check asserts the value is not in the exposition. `docker-compose.yml` keeps the entry commented out,
  because compose interpolates from a local `.env` and `docker compose config` echoes the result.
- **Cheap to poll.** `continuum_bundle_ready` reuses the readiness verdict for at most 10 s, since a
  true answer means hashing the whole bundle; `/ready` itself stays uncached so an operator corrupting a
  file sees the flip immediately (rehearsed — ADR-20, `docs/runbooks.md` §8).
- **Class A.** Scrapes and liveness probes share neither the page-traffic budget nor its exhaustion.

Scrape job and six alert rules are written to `deploy/prometheus-scrape.example.yml` and are marked
**authored, not executed**: no Prometheus or Alertmanager was installed here, so no threshold is tuned
and nothing pages.

**Rejected.** A `prom-client` dependency (offline registry, lockfile regeneration — ADR-09). An open
`/metrics` on the public origin, which would publish traffic shape to anyone who guesses the path.
Per-request histograms with quantiles, which need either sketches or retained samples this process
should not hold. Logging the token "for debugging" anywhere.

**Cost.** Writing this exposed a real classification bug: `rateClass()` replaced every `/` with `-`
before comparing, so unprefixed paths arrived as `-health`/`-metrics` and were limited as class B —
meaning a busy page could have starved the monitor and the liveness probe. The first run of the new
checks failed on exactly that, and the fix (strip the `/api/v1` prefix, then leading slashes) changes
the budget for bare probe paths. Still missing: exemplars, trace correlation beyond `request_id`, and
any measured alert behaviour. The counters are per-process, so a multi-instance deployment must
aggregate at the scrape layer, and a restart resets every series.

## ADR-18 · Analog window sums go through a cached prefix-sum index

**Status:** accepted — equivalence asserted by `npm test` (`tests/analog-index.test.mjs`, 9 checks) and
the before/after latency difference by `npm run perf` (`docs/perf-report.json`).

**Context.** The Fire Twin (FR-21) answers one primitive thousands of times: "sum the harmonized count
over this 7-day window". Its leave-one-out backtest is O(seasons × candidate-seasons × weeks) — the
loop in `src/lib/data.ts:706-717` asks for ~3,840 window sums for a single 8-week run — and the
original implementation answered each one by filtering and reducing the whole daily array
(`recordsInRange(...).reduce(...)`). With 9,496 rows per pilot that is tens of millions of comparisons
per call. Measured on this machine: one naive window sum costs 0.526 ms, so the backtest alone is
~2.0 s; the endpoint timed at ~2.3 s p50 and the Outlook page mount blocked the main thread for
1.7–2.1 s, which is why the click that navigates to it was the app's worst INP.

**Decision.** `rangeIndex()` (`src/lib/data.ts:383`) builds, once per `DailyRecord[]` and held in a
`WeakMap`, a sorted date array plus a `Float64Array` of prefix sums — for the whole series and per
year. ISO dates compare correctly as strings, so a window becomes two binary searches and one
subtraction (`spanOf`, `src/lib/data.ts:370`), and "how many days does this season actually have" costs
the same. On top of that, `twinAnalogs` memoises each week-aligned window it has already reduced
(`weeklyCache`, `src/lib/data.ts:654`), because the backtest re-asks for the same 8-week block for every
candidate year. Nothing about the *statistic* changed: same windows, same shapes, same ranking.

**Rejected.** (a) Caching whole `twinAnalogs` results by `bundle_version` — the answer also depends on
`today`, which moves daily, so the key would need an invalidation story the bundle cannot supply.
(b) Precomputing the index into `public/data/` at build time — the daily record is *derived* at runtime
from the live window (`regionRecord`), not stored, so a build-time table would be a second copy of a
series that can drift. (c) Adding a `cum` column to every row — would enlarge every shipped JSON for all
seven pilots to save work the browser can do in 15 ms.

**Cost.** Float re-association. A window is now `prefix[hi] - prefix[lo]` instead of a left-to-right
sum, so the last digits differ: the largest relative difference measured across all seven pilots was
2.102e-12 (the Amazon 2011 analog's correlation, 0.22662351706242786 → 0.22662351706195147). Analog
selection, ordering, hit rates and sample sizes were identical, structurally diff field by field. The
committed golden fixture asserts 1e-6 relative — nine orders of magnitude looser than the observed
drift, deliberately, because tightening it to 1e-12 would make the test fail on a different CPU rather
than on a real behaviour change. Memory is one sorted copy plus one `Float64Array` per record array
(~150 kB a pilot), collectible with the array it indexes. Cold cost moves from "free" to 15 ms the first
time a region is asked for anything.

## ADR-19 · A view mount is deferred out of the click task, not wrapped in a transition

**Status:** accepted — asserted by `npm run perf` (INP and `view_swap_ms` in `docs/perf-report.json`)
and by `npm run e2e` 79/79 unchanged after the switch.

**Context.** PRD §2 sets INP p75 ≤ 200 ms. React rendered the incoming page inside the click handler,
so the handler's own task contained the whole mount: ~1.7 s to ~2.1 s of processing for the two heaviest
pages. That is not a rendering problem, it is a scheduling one — the work has to happen, the question is
which task pays for it.

**Decision.** `setView` (`src/lib/store.tsx:242`) records the pending view on the document element
(`html[data-view-pending]`), lets the click task return, and commits the new view from a
`setTimeout(…, 0)` macrotask; the cue is cleared when the view actually commits (`src/lib/store.tsx:255`),
and CSS dims the outgoing page by 45 % in the meantime (`src/styles.css:182`). Two details are load-bearing:
the pending flag is **DOM state, not React state**, because a React flag would re-render the outgoing
page inside the very task the deferral exists to keep short; and the committed view is tracked in a ref
so a click on the already-active view does not queue a pointless second mount.

**Rejected — and measured.** `useTransition` was tried first, because it is the idiomatic answer. It is
worse here: the outgoing Atlas/Watch pages drive a `requestAnimationFrame` animation, and a low-priority
transition cannot get frame time from it. The mount got sliced across frames instead of moved out of the
task — commit latency 1,577 / 2,212 / 2,439 / 2,844 ms and TBT 9,206 ms, against 408 ms of blocking and
4,254 ms TBT for the deferred render. It also games the metric: Event Timing's
`processingEnd - processingStart` stops at the end of the handler's task, so a transition makes INP look
excellent while the user watches the old page animate for two and a half seconds.

**Cost.** The same accounting trick applies to the accepted design, so it has to be stated rather than
buried: deferring converts input delay into presentation delay. INP is genuinely lower because the
handler genuinely does less — but the user still waits for the mount, which is why the probe reports
`interactions[].view_swap_ms` beside every INP number (45–993 ms across the eleven swaps in the
2026-11-01T11:23 run — the upper half of that range is a click that opens the lazily loaded Watch route,
so it now includes fetching that chunk; ADR-21 — measured by a `MutationObserver` on `.app`'s class) and why the row is *disclosed* rather than
judged: PRD §2 has no swap objective. The half-opacity cue is the honest part of the trade — the screen
says work is pending.
Smooth-scroll and the pending attribute also fire before the guard, so a no-op click still scrolls to top;
kept because the alternative is a second branch to remember.

## ADR-20 · Integrity gates certify the bundle that is served, and recovery is drilled

**Status:** accepted — asserted by `npm run rehearse` (12/12, `docs/rehearsal-report.json`) and by the
unchanged `npm run audit` chain (validate 21/21, tests 48/48, secret-scan clean, smoke 44/44).

**Context.** `DATA_BUNDLE_PATH` lets a host mount the data bundle somewhere other than `public/data`.
`/ready` and `npm run validate` both read that variable for the files they *load*, but their checksum
loops resolved manifest entries against `public/` and the repo root — manifest names are `public`-relative
(`data/live_fires.json`) while the bundle directory is flat (`<dir>/live_fires.json`), so joining them
produced a path that never existed and every lookup fell through to the repo copy. A deployment pointing
at a corrupt or half-copied mount would have been reported ready, with a passing integrity check that
described bytes nobody was serving. The first rehearsal run caught it: a deleted `land-110m.json` in the
mounted bundle stayed off the failure list because the repo file was found and verified instead.

**Decision.** Both gates now strip the `data/` prefix and resolve inside the configured directory
(`server/api.mjs:68`, `scripts/validate.mjs:137`), and **when `DATA_BUNDLE_PATH` is set there is no
fallback at all** — a relocated bundle is judged on its own bytes. `tle/`, `textures/` and the `data_raw/`
build inputs keep their repo-relative resolution because they are never part of the mounted directory:
the first two ship from `dist/` as static assets, the third is a build input that the API does not serve.
The drill itself lives in `scripts/rehearse-restore.mjs` as a separate command rather than a fifth gate:
it deliberately corrupts files and spawns a server on its own port, so it belongs in the release
checklist (§5 step 11, §8) rather than in every `npm run audit`.

**Rejected.**
*Keeping the fallback* — it looks like robustness ("if the mount is odd, serve the repo copy") but it
certifies a bundle the process is not reading, which is the exact failure an integrity gate exists to
catch.
*Corrupting `public/data` for the drill* — the repo has no VCS safety net and the bundle is the only
copy on this machine; a crash mid-drill would leave a bundle nobody can serve. Every mutation therefore
happens in a temp directory, and step 12 re-asserts that `public/data` matches the backup taken at step 1.
*A unit test over `manifestCheck`* — it is exported, but importing `server/api.mjs` starts a listener, so
a test would need a second harness doing what the drill already does against a real process.

---

## ADR-21 · The WebGL route is loaded lazily, and the §9.2 budget is judged on the payload a view actually waits for

**Status:** accepted — asserted by `npm run perf` (`js_budget[]` in `docs/perf-report.json`,
2026-11-01T11:23 run), by `npm run e2e` 79/79 against the split build, and by the unchanged
`npm run audit` chain plus `npm run rehearse` 12/12 after it.

**Context.** PRD §9.2 budgets ≤ 250 kB of gzipped initial JS. Before this change every view shipped the
same 250,282 gzip bytes (244.42 KiB) in three chunks, because `src/App.tsx` imported all six pages
statically and `components/Globe.tsx` is the only consumer of `three` — 123,028 of those bytes, half the
payload, on views that never draw a globe. Two more facts had to be settled before touching the code:
*the unit* — Vite 5 divides its printed gzip figure by 1000 (it labels the 105,042-byte entry chunk
"105.04 kB"), so "250 kB" read strictly is 250,000 bytes and the bundle sat 282 bytes over it, not
"inside on the tool's own reading" as an earlier note here claimed; and *the tree-shaking question* —
rewriting `import * as THREE` into 38 named imports produced chunk hashes identical to the byte, so the
namespace form was already fully shaken and there is no free win there.

**Decision.** `Watch` became the one lazy route (`src/App.tsx`: `lazy(() => import('./pages/Watch'))`
inside a `Suspense` whose fallback reuses the `.watch` box so it cannot shift layout), because the route
boundary is exactly the `three` boundary. `npm run perf` then showed the instrument itself was wrong: it
summed *every* chunk seen in the session, and the sweep's own nav clicks fetch the Watch chunk 3.0–3.6 s
after load, so all three views still reported 245.71 KiB and the split appeared to do nothing. The probe
now splits the two quantities — `initial_payload_gzip_*` (chunks requested before the first dispatched
interaction, which is what §9.2 budgets and what gates breaches) and `session_total_gzip_*` (everything the
sweep downloaded, kept as the older `total_initial_*` keys and surfaced as a near-miss whenever a view
fetches more after first interaction). Measured after that: Atlas and Method ship **112.91 KiB /
115.62 kB decimal** — inside the budget on both readings, 54 % below the old payload — while the Orbital
Watch landing still needs `three` for its hero and ships **245.71 KiB / 251.60 kB decimal**, which is
1,322 gzip bytes *more* than the unsplit bundle and still over 250,000 bytes by 1.60 kB. Nothing else
moved materially: e2e 79/79, CLS identical (0.0951 / 0.0185 / 0.0185), INP 5 / 6 / 5 ms, Watch-from-another-view
swap 846 ms locally against 809 ms in the pre-split run, and LCP on the static control view rose more
than on Watch (504 → 580 ms vs 516 → 560 ms), so that drift is machine noise, not the split.

**Rejected.**
*Lazy-mounting `Globe` inside a static `Watch`* — the natural smaller boundary, but `Watch.tsx` drives the
globe through a `forwardRef` handle and React 18 does not carry a `ref` through `lazy()`, so it would need
the imperative handle re-plumbed as a callback prop to buy the same bytes.
*Leaving the probe summing the session* — it would have kept the old number as the reported result and
buried a 54 % improvement on five of six views; the fix reports both figures rather than picking one.
*Calling the landing view compliant* — the strict reading puts it 1.60 kB over. It stays in `README.md`
and `docs/production-readiness.md` §6 as an open item; the remaining honest levers are deleting real bytes
(replacing `OrbitControls`, ~7 kB gz, with a purpose-built drag/zoom controller) or shipping the record and
textures differently, not re-labelling the unit.

**Addendum 2026-11-03 — every route is now a boundary, and the budget is met everywhere.**
The re-run of `npm run perf` on the 2026-11-03 build reported the Watch landing at 263.28 KiB across
four chunks, over the budget again. The growth was not in the page code: `Diagnosis` and `Method`
statically imported `SATELLITE_SPECS` from `src/lib/satellites.ts`, which exported both the specs and
the SGP4 functions, so `satellite.js` (10.6 kB gz) had to load before any page could paint. Two changes
followed: propagation moved to `src/lib/sgp4.ts`, imported only by `Globe.tsx`, and all six pages
became `lazy()` boundaries in `src/App.tsx` with a shared `PageBoot` fallback that reuses the existing
boot-gate card. The entry chunk fell from 120.03 kB to 73.34 kB gzipped. Measured by `npm run perf`
(2026-11-03T07:03): Orbital Watch **220.05 KiB / 225.34 kB**, Atlas **98.34 / 100.70**, Method
**81.18 / 83.13** — inside 250 kB on both unit readings with ~25 kB of headroom on the landing. The
whole-session download of a sweep that visits every route is 257.60 KiB / 263.79 kB and is reported as
a near-miss, not as the §9.2 figure. `npm run e2e` 92/92, CLS 0.0003 on all three probes.

## ADR-22 · The whole world is an analysable area, and a country's measured border count outranks every estimate

**Status:** accepted — asserted by `npm test` 66/66 (six world-layer cases), by `npm run e2e` 100/100
against bundle `continuum-2026-11-02-954f24dbc630`, and by the geometry cross-checks recorded in
`docs/validation.md`.

**Context.** Seven pilot regions and a curated gazetteer were the only areas the app could name, and
the user asked for the world. Two things had to be settled before shipping 241 more areas. First, the
borders: a naive lat/lon point-in-polygon test over Natural Earth 50m makes Antarctica unselectable —
its mainland ring is stored *under* a degenerate −89.999° clip ring, and neither a ±180° wrap nor a
ring that closes only at the antimeridian can be ray-cast in planar coordinates. That same naive test
put Russia's Aleutians on the wrong side of the map and made its raster area 1.76× its polygon area.
Second, the numbers: outside a pilot bbox the bundle keeps a deterministic stride sample, so a
country's own readings measure the sampling rate. Attributing the four global CSVs to a border gives a
complete count for it, but the pipeline still preferred the sample: Kenya printed live days of 1, 2, 4,
2, 1 followed by three modelled days of 72, 54, 71 that kept `source: 'live'` with their instrument
columns blanked, and the "Live window" figure (209) matched neither the measured 245 nor the
calibrated 466. A country with *no* detections was worse — `countryStatsFor` rejected `total: 0`, so
Antarctica inherited the pooled pilot density and Atlas reported 26,671 detections on a continent
where the satellites measured none.

**Decision.** The world layer is built once, offline, by `npm run countries`, and mirrored in the
browser by `src/lib/countries.ts`. Geometry: each ring is re-expressed in its own unrolled longitude
frame whose seam is the widest circular gap, so a polygon that straddles ±180° stays contiguous; rings
are ordered by |spherical area| because the source does not guarantee the outer ring is first; a ring
spanning ≥ 350° of longitude is treated as a polar cap and resolved by meridian-crossing parity toward
the enclosed pole, with its area taken from a per-meridian integral rather than the planar shoelace.
Data: a country region calibrates from its own window and *only* its own window — `trustCountry` is
"an exact border row exists", not "the area is outside a pilot", because Brazil's centroid sits inside
an Amazon bbox and would otherwise be calibrated by that pilot's overlap. The live overlay takes its
days from the same row, allocating each sensor lane across the days by largest remainder so the days
add back to the border total exactly, and a day that produced nothing is an observed zero. A complete
pull is the precondition for blanking a day to zero at all: an area that is neither a country nor
inside a pilot bbox keeps its modelled days under the `'model'` label. And `total: 0` is a
measurement, so the 63 countries with no detections calibrate to their own zero instead of a pilot
average.

**Measured.** 574,242 raster cells filled and 929,967 of 966,066 quality rows attributed to a border,
96.26 % coverage, against 928,379 rows (96.1 %) for the naive planar test that could not close
Antarctica at all; Σ country area 148,686,163 km² against 148.9 M
published; Antarctica 14,311,067 km² against ~14.2 M published; Russia 16.88 M by polygon and 16.88 M
by raster against 17.10 M published. After the data fix, each probed country's record sums to its
measured detections exactly — Kenya 245, Brazil 102,684, Russia 23,983, Australia 64,226, Iceland 5 —
and `levelPerDay × 8` equals the record's harmonized sum (Kenya 233, Brazil 91,994); all eight window
days are real observations for every country; Antarctica prints 0. The pilot goldens did not move:
`npm test` 66/66, `npm run validate` 23/23, `npm run smoke` 44/44, and the calendar analogs are
unchanged because a pilot region never carries a `countryId`.

**Rejected.**
*Loosening the polygon-vs-raster tolerance instead of fixing the geometry* — the disagreement was not
noise, it was two continents being measured wrong; the check now passes at > 0.85 agreement for every
country above 20,000 km² and names the worst case when it fails.
*Keeping the stride sample as a country's evidence because it is "real detections too"* — it is real
but incomplete, and mixing a 7 % count with a modelled day in one series produces a number that is
neither, which is exactly what the LIVE label forbids.
*Synthesising the missing countries' counts from their neighbours* — it would have made all 241
countries look populated and would have been the dummy data the brief rules out; a border with no
fire is printed as zero because that is what was measured.

**Consequences.** The world layer is now a chain step with an ordering constraint: `npm run countries`
must run after `npm run live`, because its per-country totals are tied to the bundle manifest row
counts by `tests/world-layer.test.mjs` — a stale window fails `npm test`. A country's 2000 → window
history is still a labelled reconstruction (the keyed archive reaches only the pilot areas, and no
`FIRMS_MAP_KEY` exists in this environment), so the honest statement about a country is "measured
window, calibrated history", and that is what the UI prints.

## ADR-23 · The API answers for the same 241 areas, from the same installer

**Status:** accepted — asserted by `npm test` 70/70 (four cases over HTTP against a spawned server),
`npm run smoke` 47/47, `npm run validate` 23/23, `npm run e2e` 100/100 and `npm run perf`
(zero breaches) at bundle `continuum-2026-11-02-954f24dbc630`.

**Context.** ADR-22 gave the browser 241 analysable borders, but `server/api.mjs` still resolved only
seven `region_id`s: `requireArea()` looked in `A.REGIONS` and answered anything else with 422
`OUT_OF_COVERAGE`. So the same product claimed "every country" on screen and "pilot regions only" to a
programmatic caller — and the API is the surface a judge or an integrator checks. Leaving it was also
a scientific hazard in a different sense: the repo's own invariant is that the API and the UI cannot
disagree about a number, and a second, hand-written path for countries would have made that a hope.

**Decision.** One installer, two hosts. `src/lib/countries.ts` gains `hydrateWorldLayer(gazetteer,
windowFile)` (fills the tables from already-parsed JSON), `installWorldLayer()` (builds every Region
with the existing `countryRegion()` factory and registers the border calibration lookup) and
`uninstallWorldLayer()`. The browser calls it after its fetch; `server/api.mjs` calls it after reading
the two files from `dataDir` through the same `readJson` used for the live bundle. Nothing in either
host restates the rules — the 63 borders with no window row still get their measured zero from
`installWorldLayer`, not from a copy. `data.ts` keeps a second region table
(`registerCountryRegions` / `lookupRegion`) that `getRegion()` consults after the pilots, and clears
the record cache on registration so an id asked about before the layer landed cannot keep serving the
`REGIONS[0]` fallback. `requireArea()` resolves through `lookupRegion`, labels a border
`area_resolution: "country border (Natural Earth 50m)"`, and its error hint now teaches the
`country-<id>` form and the count. `GET /meta` publishes the whole index — id, name, area, detections,
per-sensor lanes, active days, plus the builder's own coverage percentages — so the surface is
self-describing rather than documented-only.
**Precedence refinement that made this safe:** `countryStatsFor()` now returns null for an area that
is *not* a border but *is* inside a pilot bbox. Registering the world layer in the API process put the
lookup in front of every caller, and a 60 km AOI in California would otherwise have been re-levelled to
the United States' whole-border density. The border outranks the area only where the border is the area,
or where the area's own rows are a stride sample.

**Measured.** Kenya: 8 days, `by_sensor {modis 12, viirs 78, noaa20 81, noaa21 74}`, total 233 = the
measured VIIRS lanes; calendar rows sum to the same 233 and every row is `source: live`;
Antarctica 0; Russia 22,830 = 7,568 + 7,714 + 7,548. California still answers 1,323, equal to the
in-app record with the layer installed (< 0.05). `country-atlantis` → 422 with the hint.
`country-summary` p50 16.0 / p95 16.5 ms; `country-calendar` for Russia over the full 9,498-row record
p50 34.2 / p95 63.1 ms — both endpoints added to the probe so the claim is re-measured on every run.

**Rejected.**
*Re-implementing the country lookup inside `server/api.mjs`* — two implementations drift, and the API
would have started disagreeing with the UI about the same border.
*A `/countries` index route* — `GET /meta` already carries the index, the route would need its own
rate class, OpenAPI path, smoke check and metrics label for no extra information.
*Applying `API_MAX_AREA_KM2` to country ids* — that limit exists to bound the cost of an arbitrary
drawn polygon; a border is a pre-indexed area whose record costs the same as a pilot's, and rejecting
Russia for being large would be a bug dressed as a guard.

**Consequences.** "Selectable" now means the same thing in the browser, on the wire and in the docs.
The API's coverage is only as fresh as the two world-layer files, so they share the bundle's ordering
constraint: `npm run live` → `npm run countries` before `npm run bundle`, which
`docs/runbooks.md` §"Stale data" now states. A country's *history* remains a labelled reconstruction
— the same blocked-on-`FIRMS_MAP_KEY` limit as ADR-22 — and the API says so in `provisional_from` and
in the per-day `source` field rather than in prose.
