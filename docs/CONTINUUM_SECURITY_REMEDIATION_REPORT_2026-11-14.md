# Continuum — Security Remediation Report (2026-11-14)

**Scope**: the cleanup authorized by `CONTINUUM_SECURITY_AND_EVIDENCE_FOLLOWUP_2026-11-14.md` — preserve
evidence, redact credential literals, repair the secret scanner, add tests, verify, report.
**Not in scope**: application, backend, frontend, science or deployment repair. None was attempted.
**Value handling**: no credential value, partial value or digest appears in this report. The value supplied
in the request was not written to any file, not logged, and never used against a network service.

---

## 1. Initial state

| Item | Value |
|---|---|
| Branch | `coder/live-data` |
| Modified tracked files (pre-existing, untouched by this phase) | 7 — `docs/api-smoke-report.json`, `docs/e2e-report.json`, `docs/validation-report.json`, `docs/validation.md`, `server/api.mjs`, `src/components/LiveMap.tsx`, `src/lib/data.ts` |
| Untracked entries before this phase | 22 |
| Affected credential files | `docs/DATA_FRESHNESS_REPORT.md`, `docs/COMPLETION_BASELINE.md`, `docs/COMPLETION_REPORT.md`, `docs/TEST_RESULTS.md` — all `??` untracked, none in `HEAD` |
| Literal occurrences re-confirmed before editing | 8 — DATA_FRESHNESS 9/15/23, COMPLETION_BASELINE 166/197, COMPLETION_REPORT 51/55, TEST_RESULTS 88 |

Line numbers had not shifted since the follow-up audit.

---

## 2. Evidence backup — PASS

Created `C:\Users\Ricky\continuum-evidence-2026-11-14\` **before** any repository write. Working and `HEAD`
versions copied separately; `HEAD` copies taken with `git show` (index and working tree untouched).

| Original | Working copy | HEAD copy | Verified |
|---|---|---|---|
| `docs/api-smoke-report.json` (276 B) | `api-smoke-report.WORKING.json` | `api-smoke-report.HEAD.json` (6,978 B) | ✅ |
| `docs/validation-report.json` (3,383 B) | `validation-report.WORKING.json` | `validation-report.HEAD.json` (3,383 B) | ✅ |
| `docs/validation.md` (95,425 B) | `validation.WORKING.md` | `validation.HEAD.md` (92,608 B) | ✅ |
| `docs/e2e-report.json` (25,599 B) | `e2e-report.WORKING.json` | `e2e-report.HEAD.json` (682 B) | ✅ |

`SHA256-MANIFEST.txt` records `sha256 · bytes · kind · copy · original` for all eight copies. Every copy was
re-read and re-hashed after writing: **8/8 verified, 0 mismatches**. No repository report was restored,
overwritten or regenerated.

---

## 3. Credential redaction — PASS

Every literal was replaced with the exact token `[REDACTED]`, preserving the surrounding command text.
Environment-variable references (`$FIRMS_MAP_KEY`, prose mentions) were left untouched.

| File | Occurrences removed | Remaining 32-hex literals |
|---|---|---|
| `docs/DATA_FRESHNESS_REPORT.md` | 3 | 0 |
| `docs/COMPLETION_BASELINE.md` | 2 | 0 |
| `docs/COMPLETION_REPORT.md` | 2 | 0 |
| `docs/TEST_RESULTS.md` | 1 | 0 |
| **Total** | **8** | **0** |

Representative post-edit lines (values already removed):

- `FIRMS_MAP_KEY=[REDACTED] node scripts/fetch-live.mjs`
- `Must set \`FIRMS_MAP_KEY=[REDACTED]\``
- `The user executed these three commands (with MAP_KEY \`[REDACTED]\`)`

No other documentation file was edited.

---

## 4. Scanner repair — PASS

Root cause removed: the old generic rule keyed on `api_key`/`access_key`, which `firms_map_key` never
matched, and there was no rule for the FIRMS URL or query shapes.

### 4.1 New rules (`scripts/secret-scan.mjs`)

| Rule id | Catches |
|---|---|
| `firms-area-url` | `/api/area/csv/<32 hex>/` |
| `firms-query-key` | `?key=` / `?map_key=` + 32 hex |
| `env-secret-assignment` | any `*_KEY`, `*_TOKEN`, `*_SECRET`, `*_PASSWORD`, `*_PASSWD`, `*_CREDENTIAL`, `*_DSN` assigned a literal (case-insensitive, multi-underscore names) |
| `generic-secret-assignment` | `secret`/`token`/`password`/`credential`/`api_key`/`access_key`/`map_key`/`private_key` + long literal |
| `aws-access-key`, `google-api-key`, `google-oauth-token`, `slack-token`, `github-token`, `gitlab-token`, `openai-or-anthropic-key`, `npm-auth-token`, `sentry-dsn-key`, `private-key-block`, `jwt`, `basic-auth-url` | provider shapes carried over and extended |

### 4.2 Structural fixes

- `data_raw/` is scanned (it was a `SKIP_DIR`); the three >6 MB CSVs are **streamed**, not skipped.
- `dist/` and `dist-server/` are scanned in the main walk — `dist/data/*.json` is now covered (the old
  separate pass read only `dist/assets/*.js|css`).
- Files above the 6 MB threshold are read with `readline`; a binary probe refuses NUL-containing files.
- Any file that cannot be read, statted or streamed is printed as `UNSCANNED <file> — <reason>` and fails the
  gate (exit 1). None occurred in this run.
- Findings print only `file:line — ruleId name [redacted]`. Line content and matched values are never echoed.
- Relative paths are normalized to `/` so output is stable across platforms.
- `SECRET_SCAN_ROOT` lets tests point the scanner at a temporary fixture tree; the default remains the repo.
- Allowlist kept for documented empty assignments (`FIRMS_MAP_KEY=`, `EARTHDATA_TOKEN=`, …). The old
  `/sha256/i` and `/continuum-harmonize-v1/` line-level entries were dropped: no rule matches those shapes
  now, and a line-level entry would mask a real secret sharing the line.

### 4.3 False positives found on the real tree and guarded

First full run flagged two non-secrets: `scripts/smoke.mjs:18`
(`METRICS_TOKEN = crypto.randomBytes(32).toString('hex')`) and a minified MapLibre assignment
`token: <dotted identifier>` in `dist/assets/Atlas-*.js`. Both are expressions, not literals. Guard added:
a dotted identifier chain, or a value immediately followed by `(`, is rejected. No blanket 32-hex rule was
introduced — bundle ids (12-hex) and checksums (64-hex) stay clean.

---

## 5. Scanner tests — PASS (2/2)

New file `tests/secret-scan.test.mjs`, run with `node --test tests/secret-scan.test.mjs`.

| Required case | Fixture | Result |
|---|---|---|
| `FIRMS_MAP_KEY` assignment | `docs/report.md:3` | detected |
| `NASA_FIRMS_API_KEY` assignment | `config/app.json:1` | detected |
| generic API token assignment | `config/token.json:1` | detected |
| credential in JSON config | `data_raw/cache.json:1` | detected |
| credential in a file >6 MB | `big/payload.log` (last line) | detected |
| credential under `data_raw` | `data_raw/cache.json` | detected |
| credential in `dist/data` | `dist/data/bundle.json:1` | detected |
| credential in Markdown / FIRMS URL | `docs/notes.md:1`, `docs/url.md:1` | detected |
| negative: bundle identifier | `continuum-2026-11-02-920de0617606` | clean |
| negative: SHA-256 hash | 64-hex after `sha256:` | clean |
| negative: `$FIRMS_MAP_KEY` reference and `[REDACTED]` | docs fixture | clean |
| negative: ordinary variable mention | prose fixture | clean |

Result: **tests 2, pass 2, fail 0, cancelled 0, skipped 0** (~0.31 s). The suite also asserts the scanner
output never contains any synthetic secret and never echoes file content.

---

## 6. Repository-wide verification — PASS

| Check | Result |
|---|---|
| Working-tree search, every file excluding only `node_modules`, `.git` | **0** files contain any 32-hex literal (a value-free census; the old value is 32 hex, so any surviving copy would show) |
| All Git objects (`git cat-file --batch-all-objects`) | **0** 32-hex segments — the credential was never committed |
| Four redacted reports | 0 literals, 0 32-hex tokens |
| `npm run secret-scan` | exit **0**; 207 files / 121.0 MB scanned, 3 streamed, 203 skipped by extension, 0 findings, 0 unscanned |
| Scanner output inspection | file, line, rule id and `[redacted]` only — no values |

---

## 7. Files that could not be scanned

- **Unscanned text files: 0.**
- **203 files skipped by extension** (images, fonts, WASM, TLE text under `public/tle`, GeoJSON artifacts in
  non-scanned extensions, binaries). These are out of scope by extension, not "unscanned" errors; the count is
  printed on every run for transparency.
- `node_modules/` and `.git/` are intentionally excluded from the walk; Git objects were checked separately
  (see §6).
- Files >6 MB are no longer skipped; the three `data_raw` CSVs (≈95 MB total) were streamed.

---

## 8. Remaining risks

1. **Rotation is unconfirmed.** Redaction removes the value from the working tree; it does not revoke it.
   Until the key is rotated at NASA FIRMS, the old credential may still be valid for anyone who saw it.
2. **Secondary copies outside the repo.** The four reports were untracked, but their contents exist in chat
   transcripts, editor histories and possibly screenshots. Those are outside this task's scope.
3. **Pattern-based detection.** The scanner matches known shapes; a novel credential layout would still pass.
   The 32-hex census is a heuristic: a key embedded inside a longer token would not be isolated by it.
4. **Untracked reports can be re-committed.** A future `git add -A` would commit the redacted versions — safe —
   but any other copy of the old text pasted back would reintroduce the literal. A pre-commit hook running the
   repaired scanner is the durable control.
5. **Allowlist is line-scoped.** A deliberately empty assignment and a real secret on the same line would be
   suppressed; the allowlist is kept to five documented entries to minimise this.

---

## 9. Credential rotation status

**NOT CONFIRMED.** The project owner has not reported rotating the FIRMS MAP key. This report does not infer
rotation from redaction, from the clean scan, or from the key being supplied in the request.

---

## 10. Change inventory

**Modified**
- `scripts/secret-scan.mjs` — rule set, streaming, coverage, redacted output, test root hook.
- `docs/DATA_FRESHNESS_REPORT.md` — 3 literals → `[REDACTED]`.
- `docs/COMPLETION_BASELINE.md` — 2 literals → `[REDACTED]`.
- `docs/COMPLETION_REPORT.md` — 2 literals → `[REDACTED]`.
- `docs/TEST_RESULTS.md` — 1 literal → `[REDACTED]`.

**Created**
- `tests/secret-scan.test.mjs`
- `docs/CONTINUUM_SECURITY_REMEDIATION_REPORT_2026-11-14.md` (this file)
- `C:\Users\Ricky\continuum-evidence-2026-11-14\` — 8 evidence copies + `SHA256-MANIFEST.txt` (outside the repo)

**Untouched**
- `src/**`, `server/**`, `public/**`, `dist/**`, `dist-server/**`, `data_raw/**` — no read-write access, no
  regenerated bundles, datasets, validation reports or smoke reports.
- `package.json`, lockfiles, TypeScript config, `.env.example`, deployment configuration.
- Git history, branches, index, stash — no `add`, `commit`, `checkout`, `reset`, `clean`, `stash`, `push`.
- The four evidence artifacts remain in their pre-existing `M` state; the external backups hold both versions.

---

**Gate**: evidence backup PASS; redaction PASS; scanner repair PASS; tests PASS (2/2); repository scan PASS;
rotation **unconfirmed**. Stopping here — no application work attempted, awaiting explicit owner authorization.
