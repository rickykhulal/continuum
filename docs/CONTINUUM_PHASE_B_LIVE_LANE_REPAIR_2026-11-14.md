# Continuum — Phase B: Live-Lane Type Repair (2026-11-14)

Status: **verified** for the six diagnostics, the production build, and the transport
contract tests. **Not verified**: the keyed upstream path (`FIRMS_MAP_KEY` is not
configured in this environment, so the four keyed live tests skip). **Not run**: archive
promotion, backfill, `--heal`, dataset/bundle generation, deployment, commit, push.

Scope: resolve the six remaining TypeScript diagnostics in the live lane without touching
the reconstruction, the science layer, or the archive backfill staging. No dataset,
bundle, staging, checkpoint, lock, `dist/**`, `dist-server/**`, or evidence file was
written.

---

## 1. Before diagnostics

Command: `npx tsc -p tsconfig.app.json --noEmit --incremental false`
Exit code: **2** (six diagnostics, unchanged from the handover report):

```
src/components/LiveMap.tsx(54,11): error TS2339: Property 'status' does not exist on type 'void'.
src/components/LiveMap.tsx(54,32): error TS2339: Property 'data' does not exist on type 'void'.
src/components/LiveMap.tsx(57,18): error TS2367: This comparison appears to be unintentional because the types 'DataSource' and '"stale"' have no overlap.
src/components/LiveMap.tsx(58,21): error TS2345: Argument of type 'DataSource' is not assignable to parameter of type '"loading" | "live" | "stale" | "offline" | "not_configured"'.
src/lib/liveClient.ts(94,19): error TS2345: Argument of type 'string' is not assignable to parameter of type 'DataSource'.
src/lib/liveClient.ts(130,32): error TS2580: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node`.
```

Root cause was one contract mismatch, not six independent bugs:

1. `useLiveFirms` returned nothing (`void`) but `LiveMap` destructured `{ status, data }`.
2. The hook conflated **transport state** (`live`/`stale`/…, the request outcome) with
   **provenance** (`DataSource`, where the numbers came from) by passing a `DataSource`
   into a transport-state setter and into `onUpdate(msg: string)`.
3. The mock flag read `process.env`, which does not exist in the browser bundle.
4. The hook also polled `/api/live-firms`, a path the SPA fallback answers with `200
   text/html`; the canonical route is `/api/v1/live-firms`.

## 2. After diagnostics

`npx tsc -p tsconfig.app.json --noEmit --incremental false` → exit **0**, no output.
`npx tsc -b` → exit **0**.

## 3. Implementation

### `src/lib/liveClient.ts`

- **Three concepts, kept separate**:
  - `TransportStatus = 'loading' | 'live' | 'stale' | 'offline' | 'not_configured'`
  - `DataSource = 'model' | 'live' | 'blend' | 'archive'` (provenance, unchanged)
  - freshness is the payload's own `stale` flag plus `fetchedAt`
- `LiveWindowMeta.generatedAt` is now optional (the server does not emit it;
  `fetchedAt` is authoritative).
- `LiveFirmsResponse` matches the real server envelope: `data`/`fires`, `count?`,
  `fetchedAt?`, `perSatelliteCounts?`, `stale?`, `meta`. `LiveFirmsErrorBody` types the
  503 envelope.
- New `classifyLiveResponse(httpStatus, body, previous)` — a pure function so the rules
  are testable without React:

  | Input | Result |
  | --- | --- |
  | 503 `error: 'not_configured'` | `not_configured`, no payload, no provenance |
  | 503 other, no last-good | `offline`, error message |
  | 503 other, with last-good | `stale`, prior payload + provenance retained, error message |
  | other non-2xx, no last-good | `offline` |
  | other non-2xx, with last-good | `stale`, prior payload retained |
  | 2xx, unparseable/missing `meta` | `offline`, or `stale` with prior payload |
  | 2xx valid, `stale: false` | `live`, provenance `live`, `fetchedAt` |
  | 2xx valid, `stale: true` | `stale`, provenance `live` (freshness ≠ provenance) |

- `useLiveFirms(intervalMs?)` now returns
  `LivePayload & { refresh: () => void }` — `{ status, data, meta, provenance,
  fetchedAt, error, refresh }` — and fetches `/api/v1/live-firms` with
  `Accept: application/json`. It retains the last good payload in a ref so a failed or
  malformed poll degrades to `stale` with its data, never to a fabricated success.
- `ALLOW_MOCK_LIVE` reads `import.meta.env.VITE_ALLOW_MOCK_LIVE` through a guarded cast,
  matching the project's Vite convention; it is `false` in a Node/test bundle.
- No placeholder data and no synthetic success path were added.

### `src/components/LiveMap.tsx`

- `const live = useLiveFirms();` replaces the old callback-style call and removes the
  now-dead `lastUpdated`, `liveStatus`, `firmsStatus`, and `liveFires` bindings.
- The status badge is truthful: `LIVE` / `LIVE STALE` / `LIVE OFFLINE` /
  `LIVE NOT CONFIGURED` (nothing while loading), with `live.error` as the tooltip. It no
  longer prints `LIVE` while the endpoint is offline or stale.
- The 10-minute bundled-snapshot reachability check remains, but now only sets the
  separate "Telemetry Stale" badge; it no longer implies the live endpoint is fresh.
- `regionPoints` still derives from the `fires` prop. Wiring live detections into the
  footprint is the separate Q-04 item and was deliberately not changed here.

## 4. Tests

### Added — `tests/live-transport.test.mjs` (new)

Bundles the real `src/lib/liveClient.ts` in memory with esbuild and asserts the
classifier against the exact `server/live.mjs` envelopes: fresh 200, `stale: true`,
`fires`-only, empty array, 503 `not_configured`, 503 offline with/without last-good,
500 with/without last-good, malformed 200 with/without history, non-JSON body, and
`ALLOW_MOCK_LIVE === false` without the VITE flag.

`node --test tests/live-transport.test.mjs` → **13 pass, 0 fail**, exit **0**.

### Adjusted — `tests/coder-live.test.mjs`

Three defects in the pre-existing file, all test-side:

1. `test.skip(cond, msg)` registers an anonymous skipped test; it does not skip the
   enclosing suite, so the keyed assertions ran without a key and failed. Replaced with
   per-test `{ skip: !HAS_KEY }`.
2. The 130-request rate-limit loop ran mid-file and exhausted class A, turning every
   later assertion into a 429. Rate-limit suites now run last.
3. It defaulted to port 4191, which `tests/api.test.mjs` already owns; under
   `node --test`'s concurrent file execution one shared server answered both files.
   Default is now 4192.

Also made the JSON-shape assertion envelope-aware (`200` → `data` array; non-2xx →
`error` code) instead of assuming the no-key body.

`node --test tests/coder-live.test.mjs` → **5 pass, 4 skipped (keyed), 0 fail**, exit
**0**.

### Full suite

`node scripts/test.mjs` (the runner behind `npm test`) → **171 tests, 167 pass, 4
skipped, 0 fail**, exit **0**. The 4 skips are the keyed live assertions.

## 5. Verification evidence

| Check | Command | Exit |
| --- | --- | --- |
| App type-check | `npx tsc -p tsconfig.app.json --noEmit --incremental false` | 0 |
| Project references | `npx tsc -b` | 0 |
| Production bundle | `npx vite build --outDir <Temp>/continuum-build-check --emptyOutDir` | 0 (`✓ built in 6.92s`) |
| Live transport contract | `node --test tests/live-transport.test.mjs` | 0 (13/13) |
| Live API contract | `node --test tests/coder-live.test.mjs` | 0 (5 pass, 4 skip) |
| Full unit/contract suite | `node scripts/test.mjs` | 0 (167 pass, 4 skip) |
| Server syntax | `node --check server/live.mjs` | 0 |
| Whitespace check | `git diff --check` | 0 |

`npm run build` was **not** executed literally: its `vite build` step writes the
protected `dist/**`. The same two steps were run with `tsc -b` and a `vite build`
redirected to a directory outside the repository, so both gates are evidenced without
touching `dist/`. `npm test` was likewise not run literally because it begins with
`node scripts/build-api.mjs`, which writes the protected `dist-server/**`; its second
step, `node scripts/test.mjs`, was run directly against the existing
`dist-server/analytics.mjs`.

## 6. Protected artifacts — verified untouched

Measured after every command above (sizes and mtimes identical to the Phase A handover
baseline):

| Artifact | Size | mtime |
| --- | --- | --- |
| `data_raw/firms_archive/archive_staging.json` | 1,337,993 B | 2026-11-13 21:53:22 |
| `data_raw/firms_archive/archive_staging.json.lock` | 5 B (PID 30648) | 2026-11-13 15:51:37 |
| `data_raw/firms_archive/state-archive_staging.json` | 4,712 B | 2026-11-13 21:53:22 |
| `public/data/live_fires.json` | 2,724,470 B | 2026-11-02 21:03:25 |
| `public/data/snapshot.json` | 16,281 B | 2026-11-02 21:03:25 |
| `dist/` | — | 2026-11-13 17:38:22 |
| `dist-server/` | — | 2026-11-01 12:27:40 |
| `src/lib/data.ts` | — | 2026-11-14 14:13:50 |
| `src/pages/Brief.tsx` | — | 2026-11-14 13:58:20 |
| `tests/b1-science.test.mjs` | — | 2026-11-14 14:13:51 |

`git status` shows no changes under `data_raw/`, `public/data/`, `dist/`, or
`dist-server/`. The backfill daemon was not contacted; the stale lock was not replaced;
no promotion, backfill, `--heal`, dataset, or bundle command was run.

## 7. Modified files in this phase

| File | Change |
| --- | --- |
| `src/lib/liveClient.ts` | hook contract, classifier, Vite env flag, canonical route (untracked file) |
| `src/components/LiveMap.tsx` | consume the new hook; truthful transport badge; snapshot check no longer touches live status. The file already carried uncommitted live-map work from the prior session; only the listed blocks were changed here. |
| `tests/coder-live.test.mjs` | skip semantics, suite order, isolated port, envelope-aware assertion (untracked file) |
| `tests/live-transport.test.mjs` | **new** focused contract test |
| `docs/CONTINUUM_PHASE_B_LIVE_LANE_REPAIR_2026-11-14.md` | this report |

No other file was edited. Antigravity's `tests/b1-science.test.mjs`, `src/lib/data.ts`,
`src/pages/Brief.tsx`, `server/live.mjs`, `server/api.mjs`, and all existing reports were
left byte-for-byte as found.

## 8. Unresolved / not verified

- **Keyed upstream path — not verified.** `FIRMS_MAP_KEY` is absent here, so the four
  keyed assertions (payload shape, per-satellite counts, fresh `stale: false`, 429
  `Retry-After` against real data) skip. Their code paths are unchanged and the
  classifier accepts the documented envelope, but no live FIRMS response was exercised
  in this phase.
- **First-poll timing under a cold server** was not observed; `server/live.mjs` starts
  its upstream fetch on first request, so the very first response can legitimately be
  `503 offline` before data arrives. The UI now reports that as `LIVE OFFLINE` rather
  than `LIVE`.
- **Live detections are not yet plotted on the map.** `LiveMap` still renders the `fires`
  prop; the hook's payload is exposed but unused for geometry. That is the separate
  Q-04 integration item and was out of scope for a type repair.
- The browser UI was not re-exercised with a browser this phase (no bundle was served
  from `dist/`); the badge logic is covered by the type-check and the transport tests,
  not by a rendered-page check.

## 9. Stop point

Phase B ends here. No commit, no push, no archive resumption, no promotion, no dataset
or bundle regeneration.
