# Continuum — read-only API + static app, single origin.
#
# AUTHORED, NOT EXECUTED. No Docker engine exists in the environment that produced this file, and
# running one was outside the approved scope. Treat `docker build .` on a machine with an engine as
# the acceptance test for this Dockerfile. See docs/decisions.md ADR-10.
#
# Why node:22-bookworm-slim and not -alpine: package-lock.json locks the glibc esbuild binary
# (@esbuild/linux-x64) that scripts/build-api.mjs needs for `npm run api:build`; a musl base would
# require re-resolving optional dependencies, which cannot be done offline here.

# ------------------------------------------------------------------ build
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Install from the lockfile before copying sources so the layer caches.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY server ./server

# 1) API bundle (src/lib → dist-server/analytics.mjs — the browser's own analytics code).
# 2) Production app bundle → dist/  (base:'./', so it is host-path agnostic).
RUN npm run api:build && npm run build

# ------------------------------------------------------------------ run
FROM node:22-bookworm-slim AS run
WORKDIR /app

# Runtime needs only node + the three artefacts. node_modules is NOT copied: server/api.mjs has
# zero runtime dependencies (node:http, node:fs, node:crypto).
ENV NODE_ENV=production \
    PORT=8787 \
    DATA_BUNDLE_PATH=public/data \
    API_MAX_AREA_KM2=250000 \
    API_MAX_UPLOAD_MB=2 \
    API_RATE_LIMITS=classA:120/min;classB:60/min;classC:20/min \
    API_METHOD_VERSION=continuum-harmonize-v1 \
    LOG_FORMAT=json

COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/public/data ./public/data
COPY --from=build /app/server ./server

# Non-root: the process only reads files and binds an unprivileged port.
RUN useradd --create-home --shell /usr/sbin/nologin continuum \
 && chown -R continuum:continuum /app
USER continuum

EXPOSE 8787

# /ready fails closed if the bundle manifest is missing, so the container refuses traffic then.
# /health answers without touching the bundle, so it is the liveness half of the pair.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const p=8787;fetch('http://127.0.0.1:'+p+'/api/v1/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# No shell-only middleman: node directly, so SIGTERM reaches the server and it can drain.
CMD ["node", "server/api.mjs"]
