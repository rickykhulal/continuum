# Provenance — where every number comes from

The shipped bundle version is `continuum-2026-11-02-84eefe748d50`. It is derived from file contents
(sha256 digests), not from a timestamp, so the same bytes always produce the same version string.

## Real inputs

| Input | Source | Carries |
| --- | --- | --- |
| MODIS C6.1 hotspots | NASA FIRMS 7-day rolling global CSV, keyless | `data_raw/MODIS_C6_1_Global_7d.csv` |
| VIIRS S-NPP C2 | NASA FIRMS 7-day rolling global CSV, keyless | `data_raw/SUOMI_VIIRS_C2_Global_7d.csv` |
| NOAA-20 VIIRS C2 | NASA FIRMS 7-day rolling global CSV, keyless | `data_raw/J1_VIIRS_C2_Global_7d.csv` |
| NOAA-21 VIIRS C2 | NASA FIRMS 7-day rolling global CSV, keyless | `data_raw/J2_VIIRS_C2_Global_7d.csv` |
| Orbital elements | CelesTrak TLEs, bundled at build time | `public/tle/satellites.txt` (epoch 2026-303) |
| Weather, live per area | NASA POWER daily MERRA-2 (`T2M`, `PRECTOTCORR`, `RH2M`), keyless, CORS | fetched at runtime, never stored |
| Weather, historical driver | NASA POWER daily MERRA-2 (`T2M_MAX`, `RH2M`, `WS10M_MAX`, `WS10M_MIN`, `PRECTOTCORR`), 2000-01-01 → build date, keyless, one request per pilot-region centre | `public/data/climate_daily.json` (`npm run climate`); raw responses in `data_raw/power/` |
| Basemap | Natural Earth 50m country topology; NASA GIBS day/night mosaics; baked 4096 px GIBS crops per pilot region | `public/data/countries-50m.json`, `public/textures/*.jpg`, `public/data/basemaps/` |
| Interface fonts | Space Grotesk + IBM Plex Mono, latin subset, SIL OFL 1.1 — vendored, not fetched | `src/fonts/*.woff2` (`npm run fonts`) |

The four FIRMS URLs and the retrieval timestamps are recorded verbatim in
`public/data/bundle_manifest.json` under `sources`. The app makes **no** request to CelesTrak at
runtime — the TLEs are static assets, and the e2e gate asserts that no CelesTrak request happens.

The only host the running app ever contacts is `power.larc.nasa.gov`. Everything else — detections,
orbital elements, imagery, fonts, topology — is served from the same origin as the app. The API's
Content-Security-Policy enforces that: `script-src 'self'`, `font-src 'self'`, and `img-src 'self'
data: blob:` (the `blob:` entry is what lets the PNG calendar export rasterize its own SVG).

## Derived products

```
data_raw/*.csv  →  scripts/build-data.mjs  →  public/data/live_fires.json + snapshot.json
                     (dedupe, region assignment, per-sensor freshness, quality counts)

public/**        →  scripts/bundle.mjs     →  public/data/bundle_manifest.json
                     (schema_version 1, bundle_version, window, data_through, provisional_from,
                      counts, sensor_meta, sources, reconstruction statement, files[] with sha256)

src/lib/*        →  scripts/build-api.mjs  →  dist-server/analytics.mjs
                     (the same estimator the browser runs, for Node)
```

## The honest split: measured vs reconstructed

**Measured, from real detections:** the rolling 7-day window (2026-10-26 → 2026-11-02 in this
bundle). 71,808 quality-passed rows: 50,070 inside the pilot regions plus a 21,738-row global
sample, kept from 963,038 detections. Per-sensor quality totals: MODIS 60,474 · VIIRS S-NPP
298,427 · NOAA-20 306,547 · NOAA-21 297,590.
These are the counts the app labels `source: "live"`, `live: true`.

**Reconstructed:** the 2000-11-01 → window-start daily series. It is a deterministic reconstruction
whose seasonal shape and level are calibrated so that the harmonized series matches the measured
live window. It is **not** a re-download of the historical FIRMS archive, and the app never presents
it that way. The disclaimer is carried in:

- the Brief advisory text and the printed/PDF sheet ("reference record calibrated to the live FIRMS
  window, not the official NASA archive");
- the CSV comment header (`# reference_record,…`);
- the GeoJSON `metadata.note` (geometry exists for the live window only);
- `GET /method-card` → `limits[0]`;
- `bundle_manifest.json` → `reconstruction`;
- `/ready`, `/meta` and the in-app Method and About panels.

**Labelled model choices** (not measurements): the stress weighting `0.46·heat + 0.38·dry +
0.16·dry_air`; the reconstruction sensitivities `exp(0.26·z_year)` and `exp(0.38·z_day)` and the BW
weighting `0.35·z(T2M_MAX) − 0.25·z(RH2M) + 0.20·z(WS10M) − 0.20·z(AP90)`; the analog window length;
the sandbox corruption priors; the attribution bands in the Bias X-ray (a prior, explicitly not a
sampling confidence interval).

**Not a free parameter** (measured, and said so in the UI): the daily level, the MODIS→VIIRS bridge
ratio `k_area`, the per-spacecraft split and the per-sensor FRP distributions, all from
`calibrationFor()` against the live window; the bridge ratio inside `biasXray()` is re-estimated from
the record itself (`Σ V_platform / Σ M` over the whole VIIRS era, zeros included) rather than taken
from the calibration. Where an area has too few shared days, `kSource` reports `pilot-regions` and the
pooled measurement is used — the fallback is labelled, not hidden.

**Custom AOIs**: `climateSourceFor()` resolves the daily driver to the nearest real MERRA-2 point and
reports `proxied` with the distance in km; the Outlook page shows a warn badge with that distance. The
AR(1) simulator is no longer used for a custom AOI's weather, season or regime term.

**Uncertainty:** intervals are counting-error (delta-method) 90% intervals on the detection counts,
widened by the uncertainty of `k_area` on MODIS-only days. They are not forecast intervals.

## Verifying the bundle yourself

```bash
npm run bundle      # regenerate the manifest from the files actually on disk
npm run validate    # recompute every sha256 and size; compares manifest to reality
curl -s localhost:8787/api/v1/ready | python -m json.tool   # integrity: {"ok": true, "bad": []}
curl -s localhost:8787/api/v1/method-card                   # provenance[] lists file, sha256, bytes
```

`GET /ready` returns `503` if any listed file is missing, has a different digest, or has a different
size — a partially deployed bundle cannot pass as ready.

## Staleness policy

Nothing refreshes itself. The UI shows `DATA THROUGH`, a computed freshness lag in days, and a
warning badge when the lag exceeds the threshold. The bundle shipped here was pulled from the NASA
FIRMS rolling archives on 2026-11-02 (`FIRMS_REFRESH=1 npm run data`), and all four sensors reported
through 2026-11-02, so `provisional_from` is 2026-11-03 — the day after the window, not a gap inside
it. The whole 7-day window is still labelled provisional, because a rolling archive is not a final
product; when a sensor does lag, the days after its last observation are labelled and never filled
(`tests/science.test.mjs` proves that branch on a NOAA-21-truncated snapshot). Re-ingest is a
deliberate, network-requiring step (`npm run data` then `npm run bundle`) and is not part of the
automated local pipeline in this environment.
