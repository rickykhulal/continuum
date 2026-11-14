# Continuum — Security and Evidence Preservation Follow-up (2026-11-14)

**Scope**: narrowly scoped follow-up to `CONTINUUM_MASTER_TECHNICAL_AUDIT_2026-11-14.md`.
**Mode**: read-only for source, data and Git state. No credential was used, printed, copied or tested.
**Evidence classes**: `[EXEC]` executed this session · `[SRC]` source inspection · `[ART]` artifact inspection.

---

## 1. FIRMS credential exposure

### 1.1 Correction to the prior count

The master audit reported **7** literal occurrences. The measured figure is **8**, plus **10** non-credential
mentions of the variable name — **18 keyword hits across 4 files**. All 8 literal occurrences hold
**one and the same value** (each 32-hex token was compared in memory by SHA-256; the digest is withheld).
`[EXEC]`

### 1.2 Inventory — every occurrence, classified

Classification: **LITERAL** = the 32-hex credential value is present on the line.
**ENV-REF** = the line refers to the variable by name only (`process.env`, `$FIRMS_MAP_KEY`, or prose).
**NAME-ONLY** = the line names the variable without a value or a shell reference.

| # | File | Line | Class | Context (value masked) |
|---|---|---|---|---|
| 1 | `docs/DATA_FRESHNESS_REPORT.md` | 9 | **LITERAL** | command example `FIRMS_MAP_KEY=<REDACTED> node scripts/fetch-live.mjs` |
| 2 | `docs/DATA_FRESHNESS_REPORT.md` | 15 | **LITERAL** | command example for `scripts/backfill-archive.mjs` |
| 3 | `docs/DATA_FRESHNESS_REPORT.md` | 23 | **LITERAL** | bare command line |
| 4 | `docs/DATA_FRESHNESS_REPORT.md` | 71 | ENV-REF | prose about the variable |
| 5 | `docs/DATA_FRESHNESS_REPORT.md` | 139 | NAME-ONLY | prose about the variable |
| 6 | `docs/COMPLETION_BASELINE.md` | 97 | ENV-REF | prose ("not set") |
| 7 | `docs/COMPLETION_BASELINE.md` | 102 | ENV-REF | prose |
| 8 | `docs/COMPLETION_BASELINE.md` | 166 | **LITERAL** | prose "Must set `FIRMS_MAP_KEY=<REDACTED>`" |
| 9 | `docs/COMPLETION_BASELINE.md` | 190 | ENV-REF | prose |
| 10 | `docs/COMPLETION_BASELINE.md` | 197 | **LITERAL** | numbered command example |
| 11 | `docs/COMPLETION_REPORT.md` | 51 | **LITERAL** | prose "with MAP_KEY `<REDACTED>`" |
| 12 | `docs/COMPLETION_REPORT.md` | 55 | **LITERAL** | bare command line |
| 13 | `docs/COMPLETION_REPORT.md` | 130 | NAME-ONLY | prose |
| 14 | `docs/COMPLETION_REPORT.md` | 132 | NAME-ONLY | prose |
| 15 | `docs/COMPLETION_REPORT.md` | 142 | NAME-ONLY | prose |
| 16 | `docs/TEST_RESULTS.md` | 88 | **LITERAL** | numbered command example (states 4 CSVs downloaded) |
| 17 | `docs/TEST_RESULTS.md` | 102 | NAME-ONLY | prose |
| 18 | `docs/TEST_RESULTS.md` | 127 | ENV-REF | prose |

### 1.3 Tracking status and blast radius

| File | Git status | In HEAD? |
|---|---|---|
| `docs/DATA_FRESHNESS_REPORT.md` | `??` untracked | no |
| `docs/COMPLETION_BASELINE.md` | `??` untracked | no |
| `docs/COMPLETION_REPORT.md` | `??` untracked | no |
| `docs/TEST_RESULTS.md` | `??` untracked | no |

`git ls-files` returns nothing for all four, and `git log --all` does not contain them. **The credential has
never entered Git history.** `[EXEC]`

A repository-wide sweep for the exact value (all text files, `node_modules`/`.git` excluded, including
`src/`, `server/`, `scripts/`, `tests/`, `public/data/`, `dist/`, `dist-server/`, `data_raw/`) returned
**exactly these 8 hits and no others**. The built bundle and the shipped data do not carry it. `[EXEC]`

### 1.4 Recommended rotation and redaction procedure (not executed)

Order matters: **rotate first, redact second**. Redacting before rotation leaves a live credential exposed
in any copy of these files (chat transcript, editor backups, shared screens, CI logs).

1. **Rotate** the FIRMS MAP key at `firms.modaps.eosdis.nasa.gov/api/` (owner action). Treat the old key as
   compromised: it has existed in plaintext on a workstation and in four report files.
2. **Update the host environment** for whoever runs `npm run live`, `npm run archive`, `npm run countries`.
   Never place it in `.env` inside the repo — the scanner flags `.env` presence, but `.env` contents would
   still be plaintext on disk.
3. **Redact all 8 LITERAL lines** to one of two safe forms, chosen per line:
   - documentation: `FIRMS_MAP_KEY=<REDACTED>` (explicit placeholder), or
   - runnable example: `FIRMS_MAP_KEY=$FIRMS_MAP_KEY node scripts/fetch-live.mjs`.
   Redaction is a **deliberate, owner-approved edit** of four untracked docs; it is not a code change.
4. **Do not require a history rewrite.** Because the files are untracked, rotation + redaction closes the
   exposure. A rewrite would only be needed if the files are ever committed with the value still in them —
   so redact **before** the next `git add`.
5. **Sweep the secondary copies** after rotation: agent transcripts/JSONL logs, terminal scrollback, editor
   local history, screenshots, and any pasted submission text. The transcript for this session contains the
   value only inside the two report files, never in command output.
6. **Verify** with a corrected scanner rule (see §2), not with the current one, which cannot see this shape.
7. **Add a guard**: the four files should either be redacted or added to `.gitignore`-adjacent review notes;
   a pre-commit hook running the corrected scanner is the durable control.

---

## 2. Secret scanner audit — `scripts/secret-scan.mjs`

### 2.1 Why `FIRMS_MAP_KEY` is missed — root cause

The scanner's generic pattern (`scripts/secret-scan.mjs:28`) is:

```
/(secret|token|password|passwd|api[_-]?key|access[_-]?key)["'\s:=]{1,4}[0-9A-Za-z+/_=\-]{24,}/i
```

Lower-cased, `FIRMS_MAP_KEY` is `firms_map_key`. It contains `_key` but **not** `api_key` and **not**
`access_key`, so the keyword alternation never matches. The `ALLOW` list is not involved — the line is never
considered. The scanner has **no pattern for a bare 32-hex token**, and FIRMS keys are exactly 32 hex
characters, so both the anchored and the contextual route fail.

### 2.2 Structural blind spots found while reading the file

| # | Location | Gap |
|---|---|---|
| 1 | `secret-scan.mjs:28` | keyword list omits `map_key`, `_key`, `key=` in URLs and bare 32-hex values |
| 2 | `secret-scan.mjs:15` | `data_raw` is a `SKIP_DIR` — CSVs, the live cache JSON and any staging archive are unscanned |
| 3 | `secret-scan.mjs:63` | files over 6 MB are skipped **silently**; the three `data_raw/*_7d.csv` files exceed this `[EXEC]` |
| 4 | `secret-scan.mjs:72` | `dist/` and `dist-server/` are skipped here; the separate pass (`:97-111`) reads only `dist/assets/*.js|css` — `dist/data/*.json` is never scanned |
| 5 | `secret-scan.mjs:82` | finding evidence prints the first 60 characters of the offending line — a **secondary leak into CI logs** for any value the scanner does catch |
| 6 | `secret-scan.mjs:106-107` | bundle findings print the first 24 characters of the matched secret |
| 7 | `secret-scan.mjs:16-19` | `.csv`, `.jsonl`, `.log`, `.map`, `.ipynb` are not in `SCAN_EXT` |
| 8 | `tests/` | **no test file references `secret-scan`** — the scanner has zero regression coverage `[EXEC]` |

### 2.3 Proposed additional patterns (not implemented)

| Name | Shape | Suggested regex (sketch) | False-positive control |
|---|---|---|---|
| FIRMS Area URL key | `/api/area/csv/<32hex>/` | `/api\/area\/csv\/[0-9a-f]{32}\//i` | none needed — path is NASA-specific |
| Generic `*_KEY=` literal | `ANY_KEY=<value>` | `/^[A-Z][A-Z0-9_]*_KEY\s*=\s*[^\s$`"']{8,}/` | require non-`$`, non-backtick value; keep empty/placeholder allowlist |
| Map-key assignment | `map_key=`, `MAP_KEY:` | `/\b(map[_-]?key|mapkey)\b["'\s:=]{1,4}[0-9a-f]{32}/i` | 32-hex requirement |
| Bare 32-hex in URL/query | `?key=<32hex>` | `/[?&](key|api_?key|token)=[0-9a-f]{32}/i` | query anchor |
| NASA Earthdata token | `EARTHDATA_TOKEN=<value>` | `/\bEARTHDATA_TOKEN\b["'\s:=]{1,4}[A-Za-z0-9._\-]{20,}/` | allow empty + `$VAR` |
| Bearer header | `Authorization: Bearer …` | `/Authorization\s*:\s*Bearer\s+[A-Za-z0-9._\-]{20,}/i` | none |
| OpenAI/Anthropic keys | `sk-…`, `sk-ant-…` | `/\bsk-(ant-)?[A-Za-z0-9_\-]{20,}/` | none |
| GitHub fine-grained PAT | `github_pat_…` | `/github_pat_[A-Za-z0-9_]{20,}/` | none |
| GitLab token | `glpat-…` | `/glpat-[A-Za-z0-9_\-]{20,}/` | none |
| npm auth token | `_authToken=` | `/_authToken\s*=\s*\S{20,}/` | none |
| Sentry DSN key part | `https://<32hex>@o…` | `/https:\/\/[0-9a-f]{32}@[a-z0-9.]+/i` | none |
| Encrypted private key | `BEGIN ENCRYPTED PRIVATE KEY` | extend existing block regex | none |
| GCP OAuth access token | `ya29.…` | `/\bya29\.[A-Za-z0-9_\-]{20,}/` | none |

Deliberately **not** proposed: a blanket "any 32+ hex string" rule. The repo carries 12-hex bundle
version ids and many SHA hashes; an unanchored rule would either bury real findings or force a wide
allowlist that re-blinds the scanner. Anchor on context (`_KEY=`, `/api/area/csv/`, query params).

### 2.4 Proposed test cases (for a future `tests/secret-scan.test.mjs`)

Positives — each must produce exactly one finding:
1. `FIRMS_MAP_KEY` + `=` + 32 hex (this incident, verbatim shape).
2. `https://firms.modaps.eosdis.nasa.gov/api/area/csv/<32hex>/VIIRS_SNPP_NRT/world/7` inside a markdown table.
3. `?key=<32hex>` in a JSON fixture.
4. `export EARTHDATA_TOKEN=<40-char opaque>`.
5. `Authorization: Bearer <40-char>` in a `.mjs` file.
6. `sk-` + 32 chars, `github_pat_` + 30 chars, `glpat-` + 24 chars.

Negatives — each must stay clean:
7. `FIRMS_MAP_KEY=` (empty), `FIRMS_MAP_KEY=$FIRMS_MAP_KEY`, `FIRMS_MAP_KEY=<REDACTED>`.
8. `.env.example` with placeholders.
9. `continuum-2026-11-02-920de0617606` (12-hex bundle id).
10. `sha256:…` manifest lines and base64 sha512 entries in `package-lock.json`.
11. `postgres://localhost:5432/db` (no userinfo).
12. A 32-hex value in `data_raw/*.csv` with the size cap disabled — currently the cap hides it; the test
    should assert the cap is **reported**, not silently applied.

Also assert: findings never print more than a fixed prefix (or print a masked form), so the scanner cannot
leak the secret it catches.

---

## 3. Evidence preservation — current state

Measured 2026-11-14, after this audit. `[EXEC]`

| File | Size | mtime (+0545) | Git status | HEAD version | Working version | Changed by |
|---|---|---|---|---|---|---|
| `docs/validation-report.json` | 3,383 B | 2026-11-14 11:17:37 | `M` | `generated_at` 2026-11-12T14:16:26Z, **23/23** | `generated_at` 2026-11-14T05:32:37Z, **23/23** | this audit (`npm run validate`) |
| `docs/api-smoke-report.json` | 276 B | 2026-11-14 11:18:16 | `M` | `generated_at` 2026-11-12T14:16:40Z, **49/49** named checks | `generated_at` 2026-11-14T05:33:16Z, **0/1**, failure text: SPA fallback returned `<!doctype …` instead of JSON | this audit (`npm run smoke` against the preview server on :4181) |
| `docs/validation.md` | 95,425 B | 2026-11-13 21:42:03 | `M` | 1,102 lines | 1,125 lines — **+23 appended**, no deletion | prior agent (2026-11-13 audit section) |
| `docs/e2e-report.json` | 25,599 B | 2026-11-13 21:14:29 | `M` | 6 results, `fatal: TypeError: Illegal invocation` | 102 results (80 pass / 22 fail), `fatal: TypeError: Cannot read properties of null (reading 'focus')` | prior agent (before this audit) |

### 3.1 What was overwritten

- **`api-smoke-report.json`** — the only genuinely destructive loss. The committed artifact records 49 passing
  named checks (`GET /health`, route-by-route responses). The working copy retains **none of that evidence**:
  it holds one failed check because the smoke runner pointed at `:4181` (Vite preview), which has no API, so
  the SPA fallback answered with HTML. The information is reproducible by re-running `npm run smoke` against a
  live API on :4181, but the recorded evidence itself is gone until restored.
- **`validation-report.json`** — no informational loss. The diff is a single line: `generated_at`. All 23 checks
  and both counts are identical.
- **`validation.md`** — nothing overwritten; 23 lines were appended by the 2026-11-13 audit. The working copy is
  a strict superset of HEAD.
- **`e2e-report.json`** — nothing overwritten by this audit. It was replaced on 2026-11-13 by a longer, more
  detailed sweep (6 → 102 results). HEAD's evidence is preserved in Git.

### 3.2 Safe backup procedure (described, not executed)

Goal: keep **four** distinct artifacts — committed and working, for the two JSON reports — plus hashes, with
zero mutation of the repository.

Store backups **outside** the repo (e.g. `%USERPROFILE%\continuum-evidence-2026-11-14\`), so no untracked files
enter the working tree and `git status` stays untouched:

```
mkdir  "%USERPROFILE%\continuum-evidence-2026-11-14"
cd     "C:\Users\Ricky\Desktop\NASA HACKATHON"
git show HEAD:docs/api-smoke-report.json   > "%USERPROFILE%\continuum-evidence-2026-11-14\api-smoke-report.HEAD.json"
git show HEAD:docs/validation-report.json  > "%USERPROFILE%\continuum-evidence-2026-11-14\validation-report.HEAD.json"
git show HEAD:docs/e2e-report.json         > "%USERPROFILE%\continuum-evidence-2026-11-14\e2e-report.HEAD.json"
git show HEAD:docs/validation.md           > "%USERPROFILE%\continuum-evidence-2026-11-14\validation.HEAD.md"
copy   docs\api-smoke-report.json   "%USERPROFILE%\continuum-evidence-2026-11-14\api-smoke-report.WORKING.json"
copy   docs\validation-report.json  "%USERPROFILE%\continuum-evidence-2026-11-14\validation-report.WORKING.json"
copy   docs\e2e-report.json         "%USERPROFILE%\continuum-evidence-2026-11-14\e2e-report.WORKING.json"
copy   docs\validation.md           "%USERPROFILE%\continuum-evidence-2026-11-14\validation.WORKING.md"
sha256sum "%USERPROFILE%\continuum-evidence-2026-11-14"\* > "%USERPROFILE%\continuum-evidence-2026-11-14\SHA256SUMS.txt"
```

Restoration later, **only on owner approval**, is two commands:

```
git checkout -- docs/api-smoke-report.json docs/validation-report.json   # restore committed evidence
# then re-run `npm run smoke` against a real API to refresh it legitimately
```

Notes:
- `git show` and `copy` are read-only; neither touches index, HEAD, or working files.
- Do not use `git stash` for this — stash mutates Git state and is destructive under concurrency.
- If backups must live inside the repo, add the directory to `.git/info/exclude` **first** (local, not
  committed) so the copies can never be swept in by `git add -A`.

---

## 4. Integrity of the six audit reports

All six exist, are untracked (`??`), and were not modified after creation. `[EXEC]`

| File | Bytes | mtime (+0545) | SHA-256 (first 16) | Tracking |
|---|---|---|---|---|
| `docs/CONTINUUM_MASTER_TECHNICAL_AUDIT_2026-11-14.md` | 23,478 | 2026-11-14 11:45:24 | `71a6de3ccb2e768c` | untracked |
| `docs/CONTINUUM_GIT_AND_FILE_INTEGRITY_2026-11-14.md` | 9,888 | 2026-11-14 11:45:41 | `992337813627eb9d` | untracked |
| `docs/CONTINUUM_LIVE_DATA_AUDIT_2026-11-14.md` | 12,593 | 2026-11-14 11:46:01 | `93848516e28c609e` | untracked |
| `docs/CONTINUUM_SCIENTIFIC_VALIDATION_AUDIT_2026-11-14.md` | 13,539 | 2026-11-14 11:46:23 | `86f2dd862f73d8d4` | untracked |
| `docs/CONTINUUM_RECONCILIATION_CORRECTIONS_2026-11-14.md` | 12,201 | 2026-11-14 11:46:46 | `3e4a38f36202676c` | untracked |
| `docs/CONTINUUM_IMPLEMENTATION_ROADMAP_2026-11-14.md` | 22,646 | 2026-11-14 11:47:21 | `3ce216b3403137aa` | untracked |

This follow-up document is a **seventh** file and is likewise untracked by construction.

---

## 5. Limitations and approval gate

**Not done, by design**: no credential was used against any NASA endpoint; no report was redacted or deleted;
no scanner change; no restore/checkout; no `git add`/`commit`/`stash`.

**Unresolved**:
- Rotation ownership — who holds the key and when it is rotated is an owner decision.
- Whether the four reports are ever intended to be committed; if yes, redaction must precede that commit.
- Whether the smoke artifact should be restored from HEAD or simply regenerated against a working API.

**State**: application source, datasets, bundles and Git history are unchanged. The only write in this
phase is `docs/CONTINUUM_SECURITY_AND_EVIDENCE_FOLLOWUP_2026-11-14.md`.

**Awaiting project-owner approval before any further action.**
