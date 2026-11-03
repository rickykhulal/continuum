# Continuum API contract

Read-only JSON/GeoJSON API over the same science code the browser runs. The analytics are bundled
from `src/lib` by `scripts/build-api.mjs` into `dist-server/analytics.mjs`, which `server/api.mjs`
imports. There is no second implementation, so an API answer and an on-screen number cannot diverge.

- Base path: `/api/v1`
- Every analytic endpoint is `POST` with a JSON body (GeoJSON in the body, not in the URL).
- Zero runtime dependencies: `node:http`, `node:fs`, `node:path`, `node:crypto`.
- Started with `npm run serve` (builds the bundle, then listens). Default port `8787`.

## Response envelope

Every non-streaming response carries:

```json
{
  "method_version": "continuum-harmonize-v1",
  "bundle_version": "continuum-2026-11-02-84eefe748d50",
  "data_through": "2026-11-02",
  "provisional_from": "2026-11-03"
}
```

`provisional_from` is derived from `snapshot.json` sensor coverage: it is the first day the newest
sensor in the bundle no longer fully covers. Those days are labelled, never silently blended.

## Area resolution

Each analytic call accepts exactly one of these, in this precedence:

1. `geometry` — a closed `Polygon` or `MultiPolygon` in `[lon, lat]` order. Resolved to an
   equal-area circle, `area_resolution: "geometry-equivalent circle"`.
2. `lat` + `lon` (+ optional `radius_km`, clamped 20–800, default 140).
3. `region_id` — one of the seven pilot regions returned by `GET /meta`, or **any country on Earth**
   as `country-<id>`. `GET /meta → world_layer.countries` lists all 241 ids with the detections
   measured inside each border for the shipped window, so the whole gazetteer is discoverable from
   the API itself. A country area reports `area_resolution: "country border (Natural Earth 50m)"`
   and every number in the response comes from that border's own measurements — the same Region
   object and the same calibration lookup the browser builds, installed by `installWorldLayer()` in
   `src/lib/countries.ts` (ADR-22). `detections: 0` is a measurement, not a missing value.

Limits: ≤ 5,000 vertices (`MAX_VERTICES`), ≤ `API_MAX_AREA_KM2` (default 250,000 km²) for
*ad-hoc* geometry, body ≤ `API_MAX_UPLOAD_MB` (default 2 MB). The area cap bounds the cost of a
drawn polygon; a country id is a pre-indexed border with a pre-computed daily series, so Russia
(16.9 M km²) is answerable at the same cost as a pilot region and is measured as such below.

## Endpoints

| Route | Class | Purpose |
| --- | --- | --- |
| `GET /health` | A | Liveness only; no data access. |
| `GET /ready` | A | Bundle loaded **and** manifest checksums verified. `503` when not ready. |
| `GET /meta` | A | Record start, live window, sensors, pilot regions, the 241-area world index (`world_layer`), limits, flags. |
| `GET /method-card` | A | Equations as implemented, stated limits, provenance of every bundled file. |
| `GET /metrics` | A | Prometheus text scrape. `404` when `METRICS_TOKEN` is unset, `401` when the token is missing or wrong. See Observability. |
| `GET /openapi.json` | A | OpenAPI 3.1 description (18 paths). |
| `POST /area/summary` | B | Total, mean per day, provisional days, per-sensor counts for a metric/mode/window. |
| `POST /area/calendar` | B | Daily rows: value, `lower`/`upper` 90% interval, trust, provisional, source. |
| `POST /area/month-compare` | B | One month across all comparable years, with percentile and partial-year handling. |
| `POST /area/day` | B | One record day joined to live FIRMS points in the area. |
| `POST /area/bias` | B | Measured `k_area`, its 90% interval, the 2012 raw break and the corrected break. |
| `POST /area/status` | C | Band, percentile, ratio to median, season clock. |
| `POST /area/twin` | C | Analog seasons plus a leave-one-out backtest hit rate. |
| `POST /area/weather` | C | NASA POWER stress fit. `503 UPSTREAM_UNAVAILABLE` if POWER does not answer. |
| `POST /sandbox/run` | C | Deterministic sensor-corruption resample; correction on or off. |
| `POST /export/csv` | B | Streamed CSV of the daily record for the window. |
| `POST /export/geojson` | B | FeatureCollection of live hotspots for a date or window. |
| `POST /brief` | B | One-page advisory as `text/plain` or `application/pdf` (FR-27), `format: "pdf"`, `language: "es"`. |

Rate classes are per minute per client: A = 120, B = 60, C = 20. Override with
`API_RATE_LIMITS="classA:120/min;classB:60/min;classC:20/min"`. Exceeding a class returns `429`
with `Retry-After`. A route classifies the same whether it is requested bare (`/health`) or under
the prefix (`/api/v1/health`), so a liveness probe or a scrape is never charged against the page
traffic budget.

### Measured latency

`npm run perf` samples every route against the shipped same-origin topology and writes
`docs/perf-report.json`. The run recorded here is loopback, one client, sequential, uncached, with rate
limits raised — service time on that machine (Node v24.19.0, 8 CPUs), not capacity:

| Route | p50 | p95 | max |
| --- | --- | --- | --- |
| `POST /area/summary` (pilot region) | 15.7 ms | 16.3 ms | 16.3 ms |
| `POST /area/summary` (country border, Kenya) | 16.0 ms | 16.5 ms | 16.5 ms |
| `POST /area/summary` (drawn polygon) | 15.8 ms | 17.1 ms | 17.1 ms |
| `POST /area/status` | 13.4 ms | 17.4 ms | 17.4 ms |
| `POST /area/calendar` (pilot, 10 months) | 15.3 ms | 16.9 ms | 16.9 ms |
| `POST /area/calendar` (Russia, 2000→today, 9,498 rows) | 34.2 ms | 63.1 ms | 63.1 ms |
| `POST /area/month-compare` | 15.2 ms | 16.6 ms | 16.6 ms |
| `POST /area/twin` | 16.0 ms | 17.5 ms | 17.5 ms |
| `POST /export/csv` | 15.3 ms | 16.2 ms | 16.2 ms |
| `POST /export/geojson` | 75.1 ms | 126.4 ms | 126.4 ms |
| `POST /brief` (PDF) | 14.9 ms | 19.4 ms | 19.4 ms |
| `GET /meta` (with the 241-area index) | 15.7 ms | 16.5 ms | 16.5 ms |
| `GET /ready` (re-hashes the bundle) | 45.6 ms | 62.9 ms | 62.9 ms |

Recorded 2026-11-03T09:11Z at bundle `continuum-2026-11-02-954f24dbc630`; the two country rows were
added with the world layer, so a border is measured on the same footing as a pilot area rather than
asserted to be as fast.

`GET /ready` is 45.6 ms p50 / 62.9 ms p95 — it re-hashes every bundled file on each call on purpose, because
a stale readiness verdict is worse than a slow one. `/metrics` caches that verdict for at most 10 s.

- GeoJSON is the only export whose cost is the payload: it serialises every live hotspot in the window.
  It is still an order of magnitude inside the PRD's 10 s export objective.
- `/area/twin` used to be the slowest route in the API at roughly 2.3 s, because its leave-one-out
  backtest re-filtered the daily record for every window it touched. The window sums now go through a
  per-record prefix-sum index (ADR-18); the first call for a region pays ~15 ms to build it and every
  later call is the arithmetic.
- Nothing here is cached. The PRD states its 2 s objective for *cached* summary/status responses, so
  these numbers are stricter than the objective assumes rather than helped by it.

## Observability

The API keeps its own request counters and exposes them in the Prometheus text exposition format at
`GET /metrics` (also `/api/v1/metrics`), served as `text/plain; version=0.0.4; charset=utf-8`.

| Family | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `continuum_http_requests_total` | counter | `route`, `status` (`2xx`…`5xx`) | Finished requests. |
| `continuum_http_request_duration_ms_sum` / `_count` | counter | `route` | Server-side milliseconds, measured from request entry to `res.finish`. |
| `continuum_http_request_duration_ms_max` | gauge | `route` | Longest request since process start — deliberately not a sliding window. |
| `continuum_http_rate_class_requests_total` | counter | `class` | Requests per rate class, so a `429` wave is attributable to A/B/C. |
| `continuum_http_error_codes_total` | counter | `code` | Responses carrying `X-Error-Code`, including `RATE_LIMITED`. |
| `continuum_bundle_ready` | gauge | — | Last bundle readiness verdict (loaded + checksums verified). |
| `continuum_bundle_version` | gauge | `version` | Which data bundle this process serves. |
| `continuum_process_uptime_seconds`, `continuum_process_resident_memory_bytes` | gauge | — | Process state from the runtime. |

Design rules, each enforced by a smoke check:

- **Bounded cardinality.** `route` is only ever a name from the declared endpoint table plus a
  single `static` bucket, so probing 40 random paths adds no series and cannot grow the scrape.
  Nothing per-IP, per-client or per-region is exported — an operator cannot be surveilled by the
  metrics endpoint, and a client cannot make the payload expensive to serve.
- **Token-gated, and absent by default.** The value lives only in the operator's environment as
  `METRICS_TOKEN`; it is never in the repository, never in a response body, and never logged. Unset
  means `/metrics` answers `404` exactly like an unknown path. Authorization is compared as a
  SHA-256 digest with `crypto.timingSafeEqual`, accepting either
  `Authorization: Bearer <token>` or `X-Metrics-Token: <token>`.
- **Cheap readiness.** `/ready` re-verifies every checksum on each call; the `continuum_bundle_ready`
  gauge reuses a cached verdict for at most 10 s so a 15 s scrape interval cannot turn every poll into
  a full integrity sweep. It verifies the bundle the process actually loaded — with `DATA_BUNDLE_PATH`
  set, the `data/` manifest entries resolve inside that directory and nothing falls back to
  `public/data`, so a half-copied mount reports `missing` instead of being certified from bytes nobody
  serves (`docs/runbooks.md` §8, ADR-20). `tle/` and `textures/` stay repo-relative: they ship from
  `dist/` as static assets and are not part of a relocated bundle.
- **Scrape is class A**, so a burst of page traffic cannot starve monitoring of its own budget.

Not provided: distributed tracing, push gateways, alerting rules, and any metric about *which*
area a user analysed — those need a host and a collector, which are outside the approved scope.
`docs/runbooks.md` shows the scrape, and structured logs remain available through `LOG_FORMAT=json`,
which writes `ts`, `level`, `request_id`, `route`, `status`, `code`, `rate_class`, `duration_ms` and
the client `ip` per request. The IP is in the *log* only — metrics never carry it.

## Errors

```json
{ "error": { "code": "AREA_TOO_LARGE", "message": "…", "hint": "…", "request_id": "req_1a2b3c4d" } }
```

Codes: `INVALID_GEOMETRY`, `AREA_TOO_LARGE`, `OUT_OF_COVERAGE`, `DATE_RANGE_INVALID`,
`PARAMETER_INVALID`, `INVALID_JSON`, `BODY_TOO_LARGE`, `RATE_LIMITED`, `UPSTREAM_UNAVAILABLE`,
`UNAUTHORIZED`, `METHOD_NOT_ALLOWED`, `NOT_FOUND`, `INTERNAL`. Every 4xx
carries a `hint` that names a valid input shape. `request_id` is generated per call and appears in
JSON logs (`LOG_FORMAT=json`).

## Examples

```bash
curl -s localhost:8787/api/v1/meta

curl -s -X POST localhost:8787/api/v1/area/summary \
  -H 'content-type: application/json' \
  -d '{"region_id":"chilecito","metric":"hotspots","mode":"harmonized","start":"2026-10-01","end":"2026-10-31"}'

# Any country on Earth — the id index is in GET /meta → world_layer.countries
curl -s -X POST localhost:8787/api/v1/area/summary \
  -H 'content-type: application/json' \
  -d '{"region_id":"country-kenya","start":"2026-10-26","end":"2026-11-02"}'

curl -s -X POST localhost:8787/api/v1/brief \
  -H 'content-type: application/json' \
  -d '{"lat":-29.15,"lon":-67.5,"radius_km":120,"format":"pdf"}' \
  --output brief.pdf

# Scrape (404 unless the operator set METRICS_TOKEN; the value stays in the shell, never in a file)
curl -s -H "Authorization: Bearer $METRICS_TOKEN" localhost:8787/metrics | head
```

## Security posture

- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, and a `Content-Security-Policy`
  (`default-src 'self'`) on every response.
- CORS is default-deny. `Access-Control-Allow-*` is emitted only when the request `Origin` is
  listed in `API_CORS_ORIGINS` or the list contains `*`.
- Static file serving rejects path traversal; the API never writes to disk.
- No authentication for data endpoints and no secret in the tree: the API is read-only over a public
  data bundle. The single exception is `/metrics`, which requires the operator-held `METRICS_TOKEN`
  and answers `404` when that variable is unset. If it is ever exposed to the internet, put it behind
  a TLS terminator, keep `API_CORS_ORIGINS` explicit, and give the scrape its own token — a bearer
  token over plain HTTP is a bearer of nothing.

## Verified behaviour

`npm run smoke` boots this server and asserts 49 checks (all three area-resolution paths, every
endpoint, six rejection cases, the PDF brief, security headers, traversal, a real `429`, three
country-border behaviours — a `country-kenya` summary whose lanes equal its measured border count, a
`country-antarctica` summary that prints 0, and the `/meta` world-layer index adding back to
`rows_in_countries` — two behaviours a TLS terminator changes (HSTS follows
`x-forwarded-proto`, and `/openapi.json` publishes the host it answered on rather than localhost), and
eleven metrics behaviours: `401` with no or wrong token, `404` on a host without `METRICS_TOKEN`,
well-formed exposition with every family declared, counters that match the traffic the run itself
generated, the `static` bucket absorbing 40 random paths, and the token value absent from the body).
The current machine-readable result is `docs/api-smoke-report.json`; the run that produced it passed
49/49.
