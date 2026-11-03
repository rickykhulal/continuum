# AGENTS.md — Continuum working agreement

Read `docs/production-readiness.md` before changing anything: it maps every PRD gate to current
evidence and lists what is still a gap.

## Order of work

1. Reproduce the baseline: `npm ci`, `npm run build`, `npm test`, `npm run e2e` against a running
   preview.
2. Change one layer at a time — data bundle (`scripts/build-data.mjs`), analytics (`src/lib/`),
   UI (`src/pages`, `src/components`), API (`server/`).
3. Prove it before you claim it. Every gate in this file needs a command and its output.

## Chain order

`npm run live` → `npm run countries` → `npm run data` → `npm run api:build` → `npm run bundle` → **`npm run build`** →
`npm test` → `npm run validate` → `npm run smoke` → `npm run secret-scan` → API on :8787 → `npm run e2e`.

`bundle` must come *before* `build`: `vite build` copies `public/data` into `dist/data`, so a bundle
run after the build leaves `dist/` serving the previous manifest while the on-disk manifest moves.
Measured 2026-11-02 (API served `…-107911de714d`, disk said `…-84cea7615e37`). `npm run validate`
now fails on that drift, and re-capture the goldens with `node scripts/capture-analogs.mjs --write`
whenever a rebuild legitimately moves them — record why in the test header instead of loosening a
tolerance. `countries` must come after `live`: it re-reads the same four global FIRMS CSVs in
`data_raw` and its per-country totals are tied to the bundle manifest row counts by
`tests/world-layer.test.mjs`, so a world layer built from a stale window fails `npm test`.

## Non-negotiables

- Never present the 2000→today series as a raw archive re-download. It is a deterministic
  reconstruction calibrated to the live FIRMS window and must stay labelled that way.
- Never let a model output, sandbox result, or synthetic series inherit the LIVE label.
- No secrets in the repository, the bundle, or the logs. `FIRMS_MAP_KEY` and `EARTHDATA_TOKEN`
  live only in the environment of whoever runs a backfill.
- No runtime dependency on CelesTrak — it blocks browser and cloud networks; refresh
  `public/tle/satellites.txt` offline with `npm run tle` before a release.
- Numbers shown in the UI are computed from the selected area's record at render time. If you add
  a number, add the function that derives it.
- Do not soften a failing check. Fix the code, or record the failure in `docs/validation.md`.

## Commands

| Purpose | Command |
| --- | --- |
| Install | `npm ci` |
| Typecheck + build | `npm run build` |
| Unit + contract tests | `npm test` |
| Rebuild data bundle from raw CSVs | `npm run data` |
| Rebuild the world layer (241 countries + their measured window) | `npm run countries` |
| Refresh the live 7-day FIRMS window | `npm run live` |
| Backfill the keyed FIRMS archive (needs `FIRMS_MAP_KEY`) | `npm run archive -- --out=data_raw/firms_archive/archive_staging.json` |
| Promote a staged archive into `public/data` (integrity-gated) | `npm run archive:promote` |
| Rebuild the real MERRA-2 weather driver | `npm run climate` |
| Bundle manifest (hashes, counts, version) | `npm run bundle` |
| Read-only API locally | `npm run api` |
| Static app dev server | `npm run dev` |
| Full browser sweep | `npm run e2e` (needs `npm run preview`) |
| Dependency audit | `npm run audit` |

## Verification status vocabulary

Use exactly these words in reports and docs: **verified** (command run, output recorded),
**partial** (some cases covered, gap named), **not verified** (no evidence yet), **blocked**
(needs a host, a key, or a decision). Do not upgrade a label because the code looks right.
