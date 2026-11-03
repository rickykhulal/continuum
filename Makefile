# Continuum — PRD Section 19 Phase 0 target list.
# Windows dev machines usually have no make; every target has an npm equivalent
# (documented in AGENTS.md) and CI runs the npm forms directly.

.PHONY: setup ingest build-data validate package api web test lint typecheck build smoke e2e audit secret-scan clean

setup:            ; npm ci
ingest:           ; npm run data           # downloads only the CSVs that are missing
build-data:       ; npm run data
package:          ; npm run bundle         # writes the bundle manifest with hashes
validate:         ; npm run validate       # integrity checks; exits non-zero on any failure
api:              ; npm run api
web:              ; npm run dev
typecheck:        ; npx tsc -b
lint:             ; npx tsc -b
build:            ; npm run build
test:             ; npm test
smoke:            ; npm run smoke
e2e:              ; npm run e2e
audit:            ; npm run audit
secret-scan:      ; npm run secret-scan
clean:            ; rm -rf dist dist-server .cache
