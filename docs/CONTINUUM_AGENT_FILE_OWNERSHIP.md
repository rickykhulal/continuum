# Continuum — Agent File Ownership

**Phase**: 0 output, for owner approval
**Prepared**: 2026-11-14
**Frozen baseline**: HEAD `b81a57d13f9129d09df65b6474fe78dab1458d2f`

Two agents write code. **Qoder** owns software correctness; **Codex** owns
scientific methodology, calculations, data integrity and scientific validation.
This document makes the rule "never edit a file currently owned by Codex" concrete
and gives every shared file a single active writer.

Ownership is by **symbol**, not only by path, for the few files that contain both
software and science. When an issue requires crossing an ownership line, the
handoff in §5 is mandatory.

---

## 1. Ownership classes

| Class | Meaning |
| --- | --- |
| **Q** | Qoder is the only writer. Codex may read and file findings. |
| **C** | Codex is the only writer. Qoder may read and file findings. |
| **Q-lead** | Shared file; Qoder holds the write lock; Codex reviews the result. |
| **C-lead** | Shared file; Codex holds the write lock; Qoder implements the interface. |
| **Split** | One file, symbol-level ownership (§3). One writer at a time. |
| **Frozen** | No agent edits. Owner instruction only. |

---

## 2. File ownership table

### 2.1 Application source

| File | Class | Owner | Issues |
| --- | --- | --- | --- |
| `src/lib/liveClient.ts` | Q | Qoder | Q-01, Q-02, Q-03, Q-04 |
| `src/components/LiveMap.tsx` | Q | Qoder | Q-01, Q-04, Q-07 (verify) |
| `server/live.mjs` | Q | Qoder | Q-05 |
| `server/api.mjs` | Q-lead | Qoder writes; Codex reviews cache/date semantics | Q-02, Q-06, Q-07, S-01, Q-16 |
| `src/lib/store.tsx` | Q | Qoder | S-01, S-03 |
| `src/lib/countries.ts` | Q | Qoder | S-01 |
| `src/lib/archive.ts` | C | Codex | C-01, C-07, S-01 |
| `src/lib/weather.ts` | C | Codex | C-06 |
| `src/lib/geometry.ts` | C-lead | Codex writes; Qoder consumes | C-09, C-11, Q-16 |
| `src/lib/export.ts` | C-lead | Codex defines semantics; Qoder implements columns | C-10 |
| `src/pages/Brief.tsx` | C | Codex | C-08 |
| `src/data/places.ts` | Q | Qoder | Q-16 |
| `src/lib/data.ts` | Split | see §3 | C-01…C-11, Q-12, S-01 |
| `src/App.tsx`, `src/main.tsx` | Q | Qoder | as needed |
| `src/pages/*` other than `Brief.tsx` | Q | Qoder | as needed |
| `src/components/*` other than `LiveMap.tsx` | Q | Qoder | as needed |

### 2.2 Scripts, tests, configuration

| File | Class | Owner | Issues |
| --- | --- | --- | --- |
| `scripts/e2e.mjs` | Q | Qoder | Q-08 |
| `scripts/test.mjs` | Q | Qoder | Q-09 |
| `scripts/bundle.mjs` | Q | Qoder (do not run to "fix" a gate) | Q-10 |
| `scripts/secret-scan.mjs` | Q | Qoder | Q-14 |
| `scripts/build-data.mjs`, `scripts/countries.mjs`, `scripts/live.mjs`, `scripts/archive*.mjs` | Q-lead | Qoder writes; Codex reviews scientific rules | C-01, C-07 |
| `tests/api.test.mjs` | Q | Qoder | Q-02, Q-09 |
| `tests/bundle.test.mjs` | Q | Qoder | Q-10 |
| `tests/secret-scan.test.mjs` | Q | Qoder | Q-14 |
| `tests/world-layer.test.mjs` | Q | Qoder | S-01 |
| `tests/coder-live.test.mjs` | Q | Qoder | Q-01, Q-09 |
| `tests/*science*.test.mjs`, calibration/analog/weather fixtures | C | Codex | C-01…C-11 |
| `package.json` | Q | Qoder (dependency changes need owner approval) | Q-11 |
| `tsconfig.json`, `tsconfig.app.json` | Q | Qoder | Q-11 |
| `vite.config.*`, `index.html` | Q | Qoder | Q-07 |
| `render.yaml`, `Dockerfile` | Q | Qoder (owner approval before change) | Q-13 |
| `.env`, host secrets | Frozen | Owner only — agents do not read or write | — |

### 2.3 Generated artifacts and evidence — Frozen

No agent edits these during repair. They are regenerated only by their designated
script, only when an approved batch requires it, and only with the before/after
hash recorded.

| Path | Why frozen |
| --- | --- |
| `public/data/**` | Shipped bundle and per-source data |
| `dist/**`, `dist-server/**` | Build outputs |
| `data_raw/**` | Raw inputs; never rewritten to make a test pass |
| `docs/validation-report.json` | Generated evidence |
| `docs/api-smoke-report.json` | Generated evidence |
| `docs/e2e-report.json` | Generated evidence |
| `docs/validation.md` | Evidence log |
| `public/tle/satellites.txt` | Refreshed offline via `npm run tle` before release only |
| Every `docs/*_2026-11-14.md` audit/report | Historical record; supersede, never rewrite |

---

## 3. `src/lib/data.ts` — symbol-level split

This is the single most contested file (89,341 B, modified in the working tree).
Treat it as two libraries in one path.

### 3.1 Codex-owned symbols (science)

| Symbol / region | Lines (frozen) | Issues |
| --- | --- | --- |
| `statusFor` | 1366 | C-07 |
| `monthComparison` | ~1340 | C-04 |
| `twinAnalogs` | ~1563 | C-03 |
| `analogDeparture` | ~1688 | C-08 |
| `generateValidationReport` | 1901–2035 | C-01, C-02 |
| `observeArea` | ~613 | C-11 |
| `runSandbox` and sandbox result types | search `runSandbox` | C-05 |
| calibration / constellation consumers | wherever they call `archive.ts` | C-07 |
| reconstruction labelling and ratios | wherever the series is built | C-01 |

### 3.2 Qoder-owned symbols (plumbing)

| Symbol / region | Lines (frozen) | Issues |
| --- | --- | --- |
| Re-export block from `./archive` | 51–53 | C-01 decides, Qoder wires |
| `alignLiveToRealtime` | 233–287 | Q-12, S-01 |
| `loadLiveBundle` | 295–320 | S-01 |
| `emptyMeta` | 326–340 | S-01 |
| Shared result/meta types | top of file | Q-01, Q-04 |

### 3.3 Write-lock rule

1. Only one agent edits `data.ts` at a time.
2. The active agent announces the exact symbol and line range it will touch.
3. The other agent does not edit any part of the file until the handoff note is
   acknowledged.
4. A change that alters a Codex-owned symbol's **meaning** is a Codex decision even
   if Qoder types the diff.

---

## 4. New files

- A file created by an agent is owned by that agent until the owner reassigns it.
- New scientific test files and fixtures are Codex-owned from creation.
- New software test files are Qoder-owned from creation.
- New docs that are not one of the four Phase 0 outputs require owner approval.

---

## 5. Handoff note format

Paste this into the issue thread (or a new doc named
`docs/handoff-<ISSUE>-<date>.md` only if the owner approves new docs):

```
HANDOFF <ISSUE-ID>
from: <agent>  to: <agent>
file: <path>
lines/symbols: <exact ranges>
change: <what was added/removed/renamed>
proof: <command + exit code + result>
re-run before editing: <commands>
evidence moved: <none | path + reason + before/after hash>
ack: <receiving agent + timestamp>
```

No editing of the handed-off file by the receiver until `ack` is present.

---

## 6. Escalation

Stop and ask the owner when:

- an issue needs to touch a file the other agent is actively holding,
- a fix would change a metric's meaning or a displayed label's claim,
- a scientific threshold would move,
- generated evidence would change,
- a credential, host secret or deployment setting is involved,
- a file outside this ownership table must be modified.

Owner decisions required at Phase 0 close are listed in
`docs/CONTINUUM_FINAL_IMPLEMENTATION_ROADMAP.md` and the final Phase 0 response.
