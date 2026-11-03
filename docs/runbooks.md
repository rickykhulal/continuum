# Runbooks

Everything here was executed on this machine. Anything that needs a network ingest or a cloud
provider is marked as not run.

## 1. Run the app locally

```bash
npm ci            # offline-capable: node_modules is already locked
npm run build     # tsc -b && vite build → dist/
npm run serve     # API on :8787, also serves dist/ as a static origin
```

Open `http://localhost:8787/`. The API and the UI read the same bundle, so the numbers on screen are
the numbers the API returns.

Hot-reload development: `npm run dev` (Vite on :5173). Data-driven pages need `public/data/`
present; it is committed, so a fresh clone works without any ingest.

One exception on a fresh clone: `npm run validate` also checksums the four `data_raw/*.csv` build
inputs, and those are gitignored. Without them the gate reports **20/21** with the four sources named
`missing` (measured by moving `data_raw/` aside) — run `npm run data` first, or accept that the served
bundle itself is fine, because `/ready` deliberately skips `data_raw/`. Nothing else in the shipped path
needs the CSVs.

## 2. Run the gates

```bash
npm run audit     # validate → test → secret-scan → smoke
npm run build
npx vite preview --port 4174 --strictPort &   # serve the built app
npm run e2e       # 100 checks in headless Chrome
npm run perf      # latency + web-vitals probe; spawns its own API on :4182
npm run rehearse  # backup/restore drill; spawns its own API on :4198
```

Last recorded results on this machine (2026-11-03, world layer over HTTP): validate 23/23, tests 70/70,
secret-scan clean, smoke 49/49, build exit 0, e2e 100/100 with zero console errors,
`npm audit --omit=dev --audit-level=high` 0 vulnerabilities, perf 0 breaches over 240 API requests and
three rendered views, rehearsal 12/12 on all 9 bundle files (`npm run rehearse` re-run 2026-11-03 after
the drill's file list stopped following the manifest — see §6.1).
Machine-readable reports:
`docs/validation-report.json`, `docs/api-smoke-report.json`, `docs/e2e-report.json`,
`docs/perf-report.json`, `docs/rehearsal-report.json`.

Chrome location for the two browser gates: `CHROME_PATH=/path/to/chrome npm run e2e` (default
`C:/Program Files/Google/Chrome/Application/chrome.exe`). CI sets it to `/usr/bin/google-chrome-stable`
for both browser steps — without that, the scripts look for the Windows install path and fail on Linux.

`npm run perf` is a measurement, not a gate: its exit code tracks the PRD's numeric objectives rather
than an internal invariant, and its thresholds assume a deployed target. Read `verdict.breaches[]` and
`caveats[]` in the report before treating a red run as a regression — the probe runs against loopback
with rate limits raised, on software WebGL, with no field data behind it.

## 3. Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `PORT` | `8787` | API/static listener port. |
| `DATA_BUNDLE_PATH` | `public/data` | Flat directory holding `live_fires.json`, `snapshot.json`, `land-110m.json`, `bundle_manifest.json` (the `data/` prefix in manifest names is stripped, not joined). When set, `/ready` and `npm run validate` certify **only** that directory — no fallback to the repo copy, so a partially mounted bundle fails instead of being excused. `tle/` and `textures/` always come from the built site. |
| `DATA_BUNDLE_VERSION` | from manifest | Overrides the reported `bundle_version` (use when serving a versioned copy). |
| `API_MAX_AREA_KM2` | `250000` | Above this, `422 AREA_TOO_LARGE`. |
| `API_MAX_UPLOAD_MB` | `2` | Request body cap; over-sized bodies get a clean `413`, the socket stays open. |
| `API_RATE_LIMITS` | `classA:120/min;classB:60/min;classC:20/min` | Per-minute buckets per client. |
| `API_CORS_ORIGINS` | empty | Comma-separated allowlist, or `*`. Empty means no cross-origin access at all. |
| `API_METHOD_VERSION` | `continuum-harmonize-v1` | Echoed in every envelope. |
| `LOG_FORMAT` | off | `json` emits one structured line per request with `request_id`, route, status, rate class, duration, and the client IP. |
| `METRICS_TOKEN` | empty | Bearer value that unlocks `GET /metrics`. Empty means the endpoint answers `404`, as if it did not exist. Keep it in the host environment or a secret manager — never in the repository, `.env` committed files, or `docker compose config` output. |

No key is required by anything in the shipped path: FIRMS rolling CSVs, NASA POWER, and the bundled
TLEs are all keyless. A historical archive backfill would need a `FIRMS_MAP_KEY` and is not included.
`METRICS_TOKEN` is the only secret an operator can introduce, it is optional, and it protects nothing
the public already sees — it only hides the counters.

## 4. Incidents

**`/ready` returns 503.** Read `integrity.bad` — it names the file and the reason (`missing`,
`checksum mismatch`, `size mismatch`). Fix by re-copying that file from the release artefact, then
re-run `npm run validate`. Do not hand-edit the manifest. The recovery path is rehearsed, not assumed:
see §8 for the recorded drill that shows `/ready` flipping 200 → 503 → 200 around a one-byte change.

**API numbers disagree with the UI.** This should be structurally impossible — both import
`dist-server/analytics.mjs` / `src/lib`. If it happens, the bundle was built from a different tree
than the app: re-run `npm run api:build && npm run build` and re-run `npm test`, which asserts
API-to-app equality per endpoint.

**Weather panel is empty.** `POST /area/weather` returns `503 UPSTREAM_UNAVAILABLE` when NASA POWER
does not answer; the app falls back to an offline estimate and labels it `source: "offline estimate"`.
Nothing else breaks. Check `curl -s https://power.larc.nasa.gov/` reachability before escalating.

**Clients are getting 429.** Confirm the class from the response (`RATE_LIMITED` + `Retry-After`) and
the `rate_class` field in the JSON log. Raise the class with `API_RATE_LIMITS` only if the traffic is
legitimate; the C class deliberately protects the expensive status/weather/twin/sandbox calls.

**Stale data.** The UI badge `N d lag` is computed from `snapshot.windowEnd`. Re-ingest is
`npm run live` then `npm run data` (both need network), then `npm run countries` — the BORDER table
is derived from the same CSVs, so a refreshed window with an un-rebuilt `country_fires.json` would
give every country yesterday's count — then `npm run api:build`, `npm run bundle`, `npm run build`,
`npm run validate`. If validation fails on the freshness checks, the ingest is partial — do not ship it.

**A download button does nothing.** The brief/CSV/GeoJSON/PNG paths are client-side Blob downloads.
Clipboard failures already degrade to a toast that points at Print. The e2e gate waits for real files
in the download directory, so a regression here fails the gate rather than the user.

## 5. Release checklist

1. `npm run bundle` and confirm `bundle_version` changed only because content changed — only when the
   bundle itself moved and `data_raw/` is present; a clone without the raw CSVs must not re-run it,
   because the manifest would drop its four input rows and `bundle_version` would move with no change
   in what ships. It must come *before* the build: `vite build` copies `public/data` into `dist/data`,
   so a bundle run afterwards leaves `dist/` serving the previous manifest while the on-disk
   manifest moves.
2. `npm run build` exits 0 (this also typechecks the whole app).
3. `npm run validate` → 23/23.
4. `npm test` → 70/70.
5. `npm run secret-scan` → clean.
6. `npm run smoke` → 49/49.
7. Serve the build, `npm run e2e` → 100/100 with zero console errors and zero failed loads.
8. `npm run perf` → read `verdict.breaches[]`. Non-blocking by design: it measures loopback against
   targets written for a deployment, so a breach here is a question to answer before release, not proof
   the release is broken. Do treat a *new* breach as blocking until it is explained in
   `docs/production-readiness.md` §2.
9. `npm audit --omit=dev --audit-level=high` → 0 (dev-only advisories are listed in
   `docs/production-readiness.md` §7; the runtime has no dependencies to audit).
10. Record the report JSON files with the release; they carry the bundle version inside.
11. `npm run rehearse` → 12/12 (§8). Required before the first deployment and after any change to
    bundle loading, `/ready`, or the manifest — the recovery path is the one thing a static bundle
    release cannot prove by inspection.

## 6. Hosting

### 6.1 Render (one service, blueprint-driven)

`render.yaml` is the blueprint: a single Node web service, `npm ci --include=dev && npm run api:build
&& npm run build` then `npm start` (`node server/api.mjs`), health-checked at `/api/v1/health`, with
`NODE_VERSION`, `DATA_BUNDLE_PATH`, `LOG_FORMAT` and no secret variables — the app needs neither a key
nor a database, so nothing here is a credential.

Import it from the Render dashboard: **New → Blueprint → connect the repository → Render detects
`render.yaml` → Apply**. The build command must keep `--include=dev`: Render sets `NODE_ENV=production`
for Node services, which makes plain `npm ci` skip `vite` and `typescript`, and the build then fails on
a missing binary rather than on a missing dependency declaration.

Two behaviours only exist because Render terminates TLS in front of the process. The socket arrives as
plain HTTP, so `x-forwarded-proto` — not `req.socket.encrypted` — is what tells the API it is serving
over https. That single check now drives both the `Strict-Transport-Security` header and the
`servers[0].url` in `/openapi.json`; `npm run smoke` asserts each with a forged forwarded request,
because neither is observable on a local loopback origin.

Verified on the published tree (2026-11-03, `git clone --depth 1` of `main` at commit `da204c0` into a
clean directory, `npm ci`, then the full chain):

| Step | Result |
| --- | --- |
| `npm run api:build && npm run build` | exit 0, same content-hashed asset filenames as the working tree |
| `npm test` | 70 pass / 0 fail — the two bundle tests recognise the absent `data_raw/` and still verify every shipped byte |
| `npm run validate` | 23/23, "16 files verified, 4 data_raw build inputs absent (run npm run live to verify them)" |
| `npm run smoke` | 49/49 against the clone's own API |
| `npm run e2e` (`E2E_ORIGIN=http://127.0.0.1:4300`) | 100/100, `failed []` |
| `GET /ready` | 200 with `integrity {ok: true, bad: [], files: 20}` |
| `POST /api/v1/country/summary` (`country-kenya…` id from `/meta`) | live-window totals with per-sensor split (`by_sensor` modis 12 / viirs 78 / noaa20 81 / noaa21 74 = 233) |
| `POST /api/v1/country/calendar` (an unburnt country) | 9,498 days, total 0 — the full window is answered for a country with no detections |
| `GET /meta` | 241 countries, 178 with at least one detection in the window, 96.26 % of rows attributed |
| Every id in that index, requested over HTTP (same bundle, this machine, 2026-11-03) | **241/241** 200s with `counts.days = 9498`, 178 non-zero and 63 measured zeros, and each country's live-window VIIRS lanes equal to its point-in-polygon count in `data/country_fires.json` — p50 80 ms, p95 125 ms. The default `API_RATE_LIMITS` starts answering 429 after roughly a hundred calls, which is the class limit working as documented; the pass needed a throwaway instance with the limits raised |

The first clone of the published tree **failed** this: `GET /ready` answered 503 with
`integrity.bad = ["tle/satellites.txt: checksum mismatch", "tle/satellites.txt: size mismatch"]`.
`* text=auto` in `.gitattributes` had rewritten the committed CRLF line endings on checkout (845 bytes
→ 830), so the served file no longer matched the hash the manifest recorded. `public/data/**`,
`public/tle/**` and `public/textures/**` are now `-text` and the tree was renormalised (`e04bf7a`).
If a future deploy reports a checksum mismatch on a file that exists, check line-ending normalisation
before suspecting the bundle.

CI runs the same tree, and its first three pushes failed at one step the local chain had gone soft on:
`npm run rehearse` relocated a hand-written four-file bundle, which was the whole bundle when the drill
was written and is five files short of the one that ships now. The list comes from
`bundle_manifest.json` (`+ bundle_manifest.json` itself, which does not hash itself), so a file added to
the bundle cannot be left out of the drill. If a bundle file is added and the drill starts failing
`/ready → 503 … missing` on the relocated copy, that is the check doing its job.
**Verified on a remote:** `.github/workflows/ci.yml` on `ubuntu-latest` completed with conclusion
**success** at `ab3e0c0` and again at `ffbd990` — install, `tsc -b`, `npm test`, build, validate,
secret-scan, `npm run smoke`, `npm run rehearse`, the headless-Chrome sweep and the perf probe, on Linux,
from a checkout with no `data_raw/`. The three earlier runs on that branch failed at the rehearsal step
and are left in the history rather than deleted.

The repository is currently **private**. That does not block a Render deploy — the Blueprint import uses
the GitHub App/OAuth connection, and a private repo works as long as Render's installation is granted
access to it — but it does mean no anonymous reader can see the code, and a reviewer cannot open the
repo the way a public one is opened. Switching it back to public is an owner decision, not something this
runbook performs.

The Render free tier sleeps the service after inactivity; the first request after a sleep pays the cold
start, which is a host property and not something the perf probe measures. Nothing in this app needs a
persistent disk — `public/data` is baked into `dist/` at build time.

### 6.2 Container and static hosting (authored, not run here)

`Dockerfile` and `docker-compose.yml` are in the repository and describe a two-stage build
(`npm run api:build && npm run build` → `node server/api.mjs`, non-root, read-only rootfs, no
`node_modules` at runtime). They were **not executed**: no Docker engine is available in this
environment and running one was out of the approved scope. Treat them as reviewed text, not verified
artefacts, until this sequence succeeds somewhere with an engine:

```bash
docker build -t continuum:local .
docker compose up -d
curl -s localhost:8787/api/v1/ready      # must report ready with the manifest's bundle_version
curl -s -X POST localhost:8787/api/v1/area/summary \
  -H 'content-type: application/json' \
  -d '{"region_id":"chilecito","metric":"hotspots","mode":"harmonized"}'
curl -sI localhost:8787/ | grep -i content-security-policy   # headers survive the container
```

`npm run smoke` cannot target the container — it spawns its own API on `SMOKE_PORT` (default 4181) —
so use the calls above for the container path and keep `npm run smoke` for the local origin.

For a pure-static host (no API), the same security headers must be set at the edge:
`deploy/static-headers.example` shows the equivalent for a generic `_headers` file and nginx, plus the
per-path cache policy (`/data/*` revalidated so a new `bundle_version` reaches readers, hashed
`/assets/*` immutable). Without the API, `docs/api.md` endpoints are unavailable; every screen still
works because the app computes from the bundle in the browser.

## 7. Metrics and monitoring

The API exposes its own request counters in Prometheus text format. Enable them by giving the process
a token, and scrape with it:

```bash
# on the host, from a secret manager — never from a committed file
export METRICS_TOKEN="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
PORT=8787 LOG_FORMAT=json node server/api.mjs &

curl -s -o /dev/null -w '%{http_code}\n' localhost:8787/metrics                       # 401: no token sent
curl -s -H "Authorization: Bearer $METRICS_TOKEN" localhost:8787/metrics | head -20   # exposition
```

Read the exposition through either header; the value never appears in a response body, in the
repository, or in `npm run secret-scan` output, and `/metrics` is rate-class A so a traffic burst
cannot starve the monitor. Use these series:

| Question | Series |
| --- | --- |
| Is it up and serving? | `up{job="continuum"}`, backed by `GET /api/v1/health` |
| Is the data bundle usable? | `continuum_bundle_ready == 0` (re-checked at most every 10 s) and `GET /api/v1/ready` |
| Which bundle is live? | `continuum_bundle_version{version="…"}` — alert when two instances disagree |
| Are we erroring? | `rate(continuum_http_requests_total{status="5xx"}[5m])`, and `{code="RATE_LIMITED"}` for limit pain |
| Is it slow? | `rate(continuum_http_request_duration_ms_sum{route="/area/twin"}[5m]) / rate(continuum_http_request_duration_ms_count{route="/area/twin"}[5m])` |
| Is one client hammering us? | Logs carry the IP; the metrics deliberately do not |

`deploy/prometheus-scrape.example.yml` has a job file and four alert rules in the same shape. They
are **authored, not exercised**: no Prometheus or Alertmanager was installed or run here, because that
needs a host and was outside the approved scope. What *was* verified is the thing those rules consume
— the exposition itself, its label bounds, its token gate, and that its counters move with real
traffic (`npm run smoke`, 11 checks). Until a scrape runs somewhere, treat the alert thresholds as
first guesses to be tuned against a week of real traffic.

**No series to add without a decision.** Route, version, class and code are finite label sets on
purpose. Do not add `region`, `ip`, `user-agent`, or a full path label: each unknown-path request
would mint a new series, and the scrape would become the thing that takes the service down.

---

## 8. Backup and restore drill

`npm run rehearse` (`scripts/rehearse-restore.mjs`, 8 s on this machine). It is a drill, not a gate: it deliberately
breaks a bundle. Everything happens in a fresh scratch directory under the OS temp folder, relocated
into the API with `DATA_BUNDLE_PATH`; `public/data` is opened read-only and its checksums are re-verified
as the last step. The scratch directory is removed whether the drill passes or fails.

| # | Step | What it proves |
| --- | --- | --- |
| 1 | copy `public/data` → scratch | a backup exists and matches the source byte for byte |
| 2 | start the API on the scratch bundle, `GET /ready` | the relocated bundle is the one being certified (200, `integrity.ok=true`) |
| 3 | `POST /api/v1/area/summary` against it | the served numbers come from that directory, not from the repo copy |
| 4 | append **one byte** to `snapshot.json` | a change that stays valid JSON — only a checksum can see it — flips `/ready` to 503 naming `data/snapshot.json` |
| 5 | `npm run validate` on the same directory | the offline gate refuses what the live gate refused, same file, same reason |
| 6 | replace the file, delete `land-110m.json` | `/ready` follows the bundle in both directions: back to 200, then 503 with `data/land-110m.json: missing` |
| 7 | re-copy all four files from `public/data`, same process | recovery needs no restart and no redeploy; the summary response is byte-identical to step 3 |
| 8 | `npm run validate` twice (scratch, then `public/data`) | 23/23 on the recovered bundle, and `docs/validation-report.json` is left describing the repo bundle, not the scratch copy |

Recorded run: **12/12 PASS**, 2026-11-01 on this machine → `docs/rehearsal-report.json`.

Two properties the drill exists to hold, and that therefore must not be "simplified" away:

- **The gates certify the directory that is served.** `data/` manifest names are `public/`-relative
  while `DATA_BUNDLE_PATH` is flat, so the prefix is stripped (`server/api.mjs:68`,
  `scripts/validate.mjs:137`). When `DATA_BUNDLE_PATH` is set, nothing falls back to `public/data` —
  a mounted bundle missing a file is reported `missing`, not quietly borrowed from the repo and called
  ready. Without that, step 6 fails as a check: a deleted file still resolved, still hashed correct,
  and `/ready` stayed green on a bundle that could not serve the basemap.
- **`/ready` is uncached.** `/metrics` caches readiness for 10 s to keep a scraper from turning every
  poll into a full integrity sweep; `/ready` re-reads, so the 503→200 flip above is immediate.

