# Continuum — Live Data, Freshness and Provenance Audit (2026-11-14)

**Scope**: The full NASA FIRMS path server → API → browser → hook → map; timestamps and
provenance; API/security/deployment configuration.
**Mode**: Read-only. One API instance was started on an unused port (`8899`) with no credentials,
probed, and stopped; it wrote nothing.

---

## 1. Architecture as built

```
NASA FIRMS 7-day global CSVs (4 products)
        │  server/live.mjs  (https GET, 10-min TTL, disk cache)
        ▼
GET /live-firms            (server/api.mjs:491, also /api/v1/live-firms)
        │
        ▼
useLiveFirms()             (src/lib/liveClient.ts:61)
        │
        ▼
LiveMap                    (src/components/LiveMap.tsx:54)
        │
        ▼
MapLibre points            ← actually fed by the BUNDLE, not the hook (Atlas.tsx:27,292)
```

---

## 2. Server side (A)

### 2.1 Provider implementation

`[SRC]` `server/live.mjs` (354 lines):

| Concern | Implementation | Line |
| --- | --- | --- |
| Sources | four FIRMS CSVs: MODIS C6.1, S-NPP C2, NOAA-20 C2, NOAA-21 C2 | 38-43 |
| Transport | `https.get`, redirects to 4 hops, **300 s socket timeout** | 63-82 |
| Retry | 3 attempts, 5 s linear backoff | 84-95 |
| Key handling | `FIRMS_MAP_KEY` or `MAP_KEY`, appended as `map_key=…` only; never logged or persisted | 101, 180, 252 |
| Key absent | sets `error='not_configured'`; serves 503, does not fetch | 252-256, 306 |
| Upstream non-200 | marks that source not-ok and continues with the others | 185 |
| Parsing | header-driven column lookup; rejects files without `acq_date/latitude/confidence` | 105-120 |
| Cache | 10-minute TTL (`CACHE_TTL_MS`), `stale` computed as age ≥ TTL | 45, 231 |
| Durability | best-effort `persist()` to `data_raw/live_fires_cache.json`; corrupt cache ignored | 216-217 |
| Offline | last-good with `stale=true`, else 503 `offline` | 306-313 |
| Test seams | `inject()`, `resetForTest()` (single declaration) | 330, 352 |

**Gaps**: no explicit `429`/`Retry-After` handling (the generic retry covers it only by accident);
no schema validation beyond header presence; no per-source timeout shorter than the whole-request
300 s; `perSatelliteCounts` is mutated before the `ok` decision (`[SRC]` around 180-200) so a failed
refresh can leave partial per-sensor counts — worth verifying before trusting the counters.

**Classification**: server provider **IMPLEMENTED**; **NOT VERIFIED against upstream** (no key, no
cache file on disk, raw CSVs dated 2026-11-02).

### 2.2 Runtime probe

`[EXEC]` `PORT=8899 node server/api.mjs` (no key), then `curl`:

| Path | Status | Content |
| --- | --- | --- |
| `/health` | 200 | JSON, bundle `continuum-2026-11-02-920de0617606` |
| `/ready` | 200 | JSON, integrity pass |
| `/live-firms` | 503 | `{"error":"not_configured","message":"live data not configured","stale":false}` |
| `/api/v1/live-firms` | 503 | same |
| `/meta` | 200 | JSON |
| `/api/live-firms` | **200** | **`text/html` — the SPA `index.html`** |
| `/metadata` | 200 | `text/html` (static fallback) |

Server log:

```
[live] FIRMS_MAP_KEY not set — live data not configured
Continuum API on http://localhost:8899 — bundle continuum-2026-11-02-920de0617606, integrity PASS …
```

Two conclusions:

1. The API **does start** and the earlier "duplicate `resetForTest` blocks startup" defect is fixed
   (`[EXEC]`; `grep` finds exactly one `export function resetForTest` at `live.mjs:330`).
2. `/api/live-firms` is **not a route**. The SPA fallback (`api.mjs:613-618`) answers it with
   `index.html` and **status 200**, which is the worst possible failure for the browser client: it
   looks like success until `res.json()` throws.

---

## 3. Client side (B)

`[SRC]` `src/lib/liveClient.ts` (242 lines, **untracked**).

| Item | Value | Line |
| --- | --- | --- |
| URL fetched | `/api/live-firms` | 72 |
| Server route | `/live-firms` (and `/api/v1/live-firms`) | `api.mjs:491` |
| Expected response | `LiveFirmsResponse { data: LiveFire[]; meta: LiveWindowMeta }` | 37-41 |
| Actual response (200) | `{ fires, data, count, fetchedAt, perSatelliteCounts, stale, meta }` | `live.mjs:313` |
| Actual response (503) | `{ error, message, stale }` — no `data`, no `meta` | `live.mjs:306-309` |
| Success status | hard-coded `'live'` regardless of `stale` | 87-89 |
| Error path | keeps last-good, else `'offline'` | 92-101 |
| Polling | 10-minute interval | 66, 105 |
| Browser env | `export const ALLOW_MOCK_LIVE = process.env.ALLOW_MOCK_LIVE === '1';` | 130 |

Consequences:

* **URL mismatch** — `/api/live-firms` returns HTML 200. `res.ok` is true, `res.json()` throws
  `SyntaxError`, the catch keeps last-good or sets `offline`. The client therefore never reaches the
  real endpoint even when the key is present.
* **Shape mismatch** — even with the URL corrected, `json.data` is `undefined` on the real 200
  shape and the hook would pass `undefined` to the map.
* **`stale` is never surfaced** — the client marks every 200 as `'live'`; a stale last-good served
  with `stale:true` would be labelled LIVE.
* **`process.env` in a Vite SPA** — `process` is not defined in the browser. Because this is a
  module-level `const`, importing `liveClient.ts` throws `ReferenceError: process is not defined`
  before React renders. `tsc` catches it as TS2580 (`[EXEC]`). This is a hard runtime break, not a
  cosmetic one.

---

## 4. React hook (C)

`[SRC]` `useLiveFirms(onUpdate, onError, intervalMs)`:

* Signature takes three callbacks and **returns nothing** (no `return` statement anywhere in
  61-114). Return type inferred as `void`.
* `LiveMap.tsx:54` does `const { status: firmsStatus, data: liveFires } = useLiveFirms(...)`.
  Destructuring `undefined` throws `TypeError: Cannot destructure property 'status' of 'undefined'`.
  The component cannot render at all once the module loads.
* `setStatus(status)` at line 94 passes a `DataSource` (`'model'|'live'|'blend'|'archive'`) into a
  state typed `'loading'|'live'|'stale'|'offline'|'not_configured'`. The two unions share only
  `'live'`, so the compiler rejects the assignment (TS2345).
* Because `useLiveFirms` is a hook, calling it conditionally or ignoring its return would normally
  be harmless; here the *caller* assumes a return that does not exist.

---

## 5. Map (D)

`[SRC]`

* `Atlas.tsx:27` `const fires = live?.fires ?? []` — `live` is the **bundle** from `useStore`.
* `Atlas.tsx:292` `<LiveMap region={region} fires={fires} … />`.
* `LiveMap.tsx:30` accepts `fires: LiveFire[]` and builds `regionPoints` from it (67-69).
* The hook's `liveFires` is destructured but effectively unusable, and is **not** passed to the map.

Therefore:

* Map points come from `public/data/live_fires.json` (71,882 points, 2026-10-26→11-02), filtered by
  region bbox and by the cumulative day slider (91-95).
* Coordinates are used as-is; no validation layer beyond the bbox filter.
* Timestamps exist (`f[5]`) and are used by the day slider, after `alignLiveToRealtime` has shifted
  them.
* **No live observation reaches a map point.**

**Full-path verdict**: server implemented, API route works, browser client disconnected at five
independent points, map fed by the bundle. The pipeline is **not** genuinely working.

---

## 6. Freshness, timestamps and provenance (Phase 5)

### 6.1 Four distinct times

| Time | Where it lives | Current value |
| --- | --- | --- |
| Acquisition (observation) | `fires[i][5]` unix seconds; `regionDays[*].firstT/lastT` | 2026-10-26 … 2026-11-02 |
| Bundle generation | `live_fires.json.meta.generatedAt` | 2026-11-02T15:18:25Z |
| Archive build | `archive_daily.json.generated_at` | 2026-11-02T15:18:09Z |
| Cache retrieval | `api.live.mjs` `fetchedAt` | n/a (no cache) |

### 6.2 The date-shifting functions

`[SRC]` `data.ts:233-290` `alignLiveToRealtime(bundle, targetDate?)`:

```ts
const daysDiff = daysBetween(bundle.meta.windowEnd, today);
const secondsOffset = daysDiff * 86400;
const newFires = bundle.fires.map(f => [f0, f1, f2, f3, f4, f[5] + secondsOffset]);
return { meta: { ...bundle.meta, generatedAt: new Date().toISOString(),
                 windowStart: newWindowStart, windowEnd: newWindowEnd, … }, fires: newFires };
```

Applied on every load (`data.ts:313`). On 2026-11-14, `daysDiff = 12`.

`[SRC]` `countries.ts:74-117` `alignCountryFiresToRealtime(...)` does the same for per-country day
buckets (`perDay`, `perDaySensors`, `perDayFrp` keys are all re-dated forward).

This is the exact behaviour `docs/project-audit-2026-11-13.md` described as "a browser loader
rewrites old acquisition dates to today".

### 6.3 Consequences

| Question | Answer | Evidence |
| --- | --- | --- |
| Can historical observations appear current? | **Yes** — by exactly the gap in days | `data.ts:254-264` |
| Can static snapshot data be presented as live? | **Yes** — `generatedAt` is overwritten with now, and LIVE badges print unconditionally | `data.ts:283`, `AreaBar.tsx:177`, `Atlas.tsx:87` |
| Is "today" wall-clock or snapshot end? | **Snapshot end**, which alignment has already set to wall-clock | `store.tsx:256` |
| Do failed requests produce misleading empty data? | **Yes** — `emptyMeta()` sets `windowStart`, defeating the only error guard | `data.ts:326-338`, `store.tsx:276` |
| Can API and browser disagree? | **Yes** — API reports `data_through: 2026-11-02`; browser prints today | `[EXEC]` `/health`; `store.tsx:256` |

### 6.4 What is *honest* in the same area

* The footer on the map was corrected in `b81a57d` to say "Bundled FIRMS NRT snapshot" rather than
  claiming a live endpoint (`LiveMap.tsx:521-525`). That copy is accurate.
* The archive's `generated_at` and `sources[].max` are untouched by alignment.
* `/meta` and `/health` report the true `data_through: 2026-11-02`.

The problem is not missing metadata; it is that the UI overwrites it after load.

---

## 7. API, security and deployment (Phase 8)

| Item | Finding | Evidence |
| --- | --- | --- |
| Route table | `GET_ROUTES` includes `/live-firms`; no `/api/live-firms` alias | `api.mjs:489-496, 881` |
| Envelope | `/live-firms` bypasses `envelope()` and returns the provider body verbatim → inconsistent with every other GET | `api.mjs:491-496` vs `202-210` |
| Rate limiting | class A for health/ready/meta/live-firms | `api.mjs:660` |
| CORS | allow-list from `API_CORS_ORIGINS`, default same-origin | `api.mjs:21-25` |
| CSP | `default-src 'self'; script-src 'self'; …` — **no `worker-src`** → MapLibre blob workers blocked | `api.mjs:587-588` |
| Static fallback | unknown paths return `index.html` with 200 (masks API typos) | `api.mjs:613-618` |
| Startup import | top-level `import './live.mjs'` | `api.mjs:11` |
| Render | `branch: main`, `autoDeploy: true`, free plan, **no disk** | `render.yaml` |
| Cache durability | cache file lives under `data_raw/`, not persisted on Render | `live.mjs:46` |
| Docker | authored-not-executed; run stage copies `dist`, `dist-server`, `public/data`, `server` | `Dockerfile` |
| Secret scan | passes (178 files) but **misses** a bare FIRMS hex key | `scripts/secret-scan.mjs:21-29` |

`[EXEC]`/`[SRC]` credential finding: a 32-hex FIRMS key is written verbatim in four untracked
reports (7 occurrences across `DATA_FRESHNESS_REPORT.md`, `COMPLETION_BASELINE.md`,
`COMPLETION_REPORT.md`, `TEST_RESULTS.md`). The value is deliberately not reproduced here. The key
must be rotated and the files purged before any commit.

---

## 8. Findings summary

| ID | Finding | Class |
| --- | --- | --- |
| L-01 | Client URL `/api/live-firms` does not exist; returns HTML 200 | CONFIRMED |
| L-02 | Response-shape mismatch (`data` vs `fires`) | CONFIRMED |
| L-03 | `useLiveFirms` returns `void`; caller destructures it | CONFIRMED |
| L-04 | `process.env` in browser module scope | CONFIRMED |
| L-05 | Live modules untracked → absent from deployment | CONFIRMED |
| L-06 | Map renders bundle, not hook data | CONFIRMED |
| L-07 | Snapshot timestamps shifted forward; `generatedAt` overwritten | CONFIRMED |
| L-08 | LIVE labels shown for offline/stale and at snapshot level | CONFIRMED |
| L-09 | Empty-bundle error guard unreachable | CONFIRMED |
| L-10 | CSP missing `worker-src` | CONFIRMED |
| L-11 | API starts and serves health/ready/live-firms correctly | CONFIRMED (verified) |
| L-12 | Provider has never been observed fetching upstream in this environment | NOT TESTED (no key) |
| L-13 | 429 handling | PARTIALLY CONFIRMED (generic retry only) |
| L-14 | Plaintext key in four reports; scanner false negative | CONFIRMED |
