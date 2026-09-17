# syntax=docker/dockerfile:1.6
# =============================================================================
# Borradh API Dockerfile
# Multi-stage build using Turborepo prune for minimal build context
# BuildKit cache mounts used on pnpm store + turbo cache for fast rebuilds
# =============================================================================

# Builder uses Debian-slim (glibc) so native modules — specifically sharp
# (via @borradh-workspace/rekognition) — install with the glibc prebuilts
# that match the distroless Debian production stage. An Alpine (musl)
# builder pulled @img/sharp-libvips-linuxmusl-x64, which failed at runtime
# with "libvips-cpp.so.42: cannot open shared object file" on distroless.
FROM node:22.22.0-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate \
    && npm install turbo@2.7.5 --global

# -----------------------------------------------------------------------------
# Stage 1: Prune monorepo to API dependencies only
# turbo prune removes all packages the API doesn't depend on
# -----------------------------------------------------------------------------
FROM base AS pruner
WORKDIR /app
COPY . .
RUN turbo prune @borradh-workspace/api --docker

# Strip heavy root workspace deps (Expo, React Native, Next.js, etc.) from pruned output.
# These leak through pnpm lockfile resolution adding ~800MB of unused packages.
# We strip only known-heavy packages and keep everything else (build tools, NestJS, etc.).
RUN node -e " \
  const fs = require('fs'); \
  const pkg = JSON.parse(fs.readFileSync('out/json/package.json','utf8')); \
  const strip = [ \
    'expo', 'next', 'react-dom', 'react-native', 'react-native-web', \
    'react-native-svg', 'react-native-svg-transformer', 'react-router-dom', \
    '@expo/metro-config', '@expo/metro-runtime', \
  ]; \
  const stripDev = [ \
    '@expo/cli', '@testing-library/react-native', 'jest-expo', \
    'babel-preset-expo', '@babel/runtime', \
    '@pmmmwh/react-refresh-webpack-plugin', 'react-refresh', \
    'tailwindcss', 'postcss', 'autoprefixer', \
    'webpack', 'webpack-cli', '@svgr/webpack', \
  ]; \
  const stripPrefixes = ['expo-', 'react-native-', 'metro-']; \
  const keep = new Set(['expo-server-sdk']); \
  const shouldStrip = (name, list) => !keep.has(name) && (list.includes(name) || stripPrefixes.some(p => name.startsWith(p))); \
  /* The keep-set exception is for the JS strip on out/json/package.json (workspace-root \
     deps trimmed before install). The .pnpm/ strip later in the builder uses a \
     pnpm-instance walker (scripts/strip-unused-pnpm.mjs), not a regex, so it \
     correctly preserves anything reachable from the deployed bundle. */ \
  if (pkg.dependencies) { for (const k of Object.keys(pkg.dependencies)) { if (shouldStrip(k, strip)) delete pkg.dependencies[k]; } } \
  if (pkg.devDependencies) { for (const k of Object.keys(pkg.devDependencies)) { if (shouldStrip(k, stripDev)) delete pkg.devDependencies[k]; } } \
  fs.writeFileSync('out/json/package.json', JSON.stringify(pkg, null, 2));"

# -----------------------------------------------------------------------------
# Stage 2: Install dependencies and build
# out/json/ has pruned lockfile + package.json files (cached install layer)
# out/full/ has source code for relevant packages only
# -----------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app

# Turbo remote cache credentials (optional, speeds up builds).
# Build args aren't visible to RUN as env vars — must promote them to ENV
# so `pnpm turbo build` below can authenticate with the remote cache.
ARG TURBO_TOKEN
ARG TURBO_TEAM
ENV TURBO_TOKEN=$TURBO_TOKEN
ENV TURBO_TEAM=$TURBO_TEAM

# Install dependencies from pruned lockfile (--no-frozen-lockfile because
# we stripped root workspace deps in the pruner stage)
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm install --no-frozen-lockfile

# Copy source and root configs
COPY --from=pruner /app/out/full/ .
COPY --from=pruner /app/tsconfig.base.json ./

# Build API and all its dependencies
# CAP the compiler's heap rather than letting it run unbounded.
#
# `tsc` on packages/features peaks at ~2.3GB RSS left to itself, and the
# builder answers that by having the KERNEL kill it: exit 137, SIGKILL, which
# BuildKit surfaces only as "did not complete successfully". That is an
# out-of-memory MACHINE, not an exhausted V8 heap — V8 aborts differently, with
# "JavaScript heap out of memory" — so RAISING the limit is the wrong move. It
# would let V8 defer collection longer and push the peak the kernel sees higher.
#
# 2048MB is measured: the build completes at that cap and fails at 1536MB, on
# main and on feature branches alike. Bounding V8 makes it collect against the
# ceiling instead of against the machine's.
#
# This is the package's steady-state cost, not a regression. It stays hidden
# because turbo replays a cached `features` build on every PR that does not
# touch that package; the first PR that does touch it pays the full compile.
ENV NODE_OPTIONS=--max-old-space-size=2048
RUN --mount=type=cache,target=/app/.turbo,sharing=locked \
    pnpm turbo build --filter=@borradh-workspace/api...

# Create a self-contained production bundle at /app/deployed.
# Includes only the API package + its transitive production deps, with workspace
# packages resolved to their built outputs. No pnpm/lockfile in the bundle.
#
# Sharp's platform-specific native deps (@img/sharp-linux-x64,
# @img/sharp-libvips-linux-x64) are declared as direct deps in apps/api/package.json
# so pnpm deploy hoists them to top-level node_modules/, where Node resolution
# finds them when sharp does `require('@img/sharp-linux-x64')`. Without that,
# they sit in the .pnpm/ subtree and sharp fails with:
#   ERR_DLOPEN_FAILED: libvips-cpp.so.42: cannot open shared object file
# sharing=shared (not locked): `pnpm deploy` only READS/hardlinks out of the
# store — install already populated it, deploy writes nothing (downloaded=0 in
# every observed build). The api + worker images build concurrently on the same
# Depot builder and share this cache-mount target; sharing=locked serialised
# their deploy steps so one waited out the other's copy (observed 60s+ stalls;
# deploy layers of 136s/228s). A read-only mount is safe to share concurrently.
# Drop type declarations from the workspace packages before deploying them.
# Nothing at runtime reads a .d.ts, but `pnpm deploy` faithfully copies every
# one — and the workspace packages are the bulk of the bundle. @borradh-workspace/
# features alone was 16,171 files, 6x the next largest package, and it is the
# straggler the deploy step waits on: 882 of 883 packages land in ~20s, then that
# one takes 100-175s on its own.
#
# Paired with the `files` allow-list in packages/*/package.json (which keeps src/
# and its 812 test files out of the bundle), this takes the workspace dist file
# count from 14,423 to 7,213 and the api bundle from 81,189 files/919MB to
# 68,971/803MB. Measured on Depot (amd64), the deploy layer below drops from a
# median 131s to 61s (n=12 vs n=3, t=5.1), and its run-to-run spread collapses
# with it (sd 61.6 -> 9.9).
#
# Safe for source maps: tsconfig.base.json sets inlineSources, so every .js.map
# carries its own sourcesContent and Sentry/PostHog traces are unaffected.
RUN find /app/packages/*/dist \( -name '*.d.ts' -o -name '*.d.ts.map' \) -delete

RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=shared \
    pnpm --filter=@borradh-workspace/api deploy --prod --ignore-scripts /app/deployed

# Strip unreachable packages from the deployed bundle's .pnpm store.
#
# `better-auth` declares next, react-native, expo, vitest, drizzle-kit, mongodb,
# mysql2, and others as `peerDependenciesMeta.optional: true`. pnpm auto-fulfills
# any optional peer it can satisfy from the workspace; since web/mobile have these
# as direct deps at the workspace root, pnpm includes them in the api's install
# graph and `pnpm deploy --prod` faithfully copies them into /app/deployed.
#
# strip-unused-pnpm.mjs walks pnpm's symlink graph instance by instance,
# starting from the bundle's top-level node_modules. What it reaches is exactly
# what the bundle can resolve at runtime. Correct by construction — unlike a
# regex denylist, which is brittle (a regex meant to strip web's tailwindcss
# also strips the tailwindcss that @react-email/tailwind needs at runtime).
#
# It used to walk by package NAME and keep every version variant of a reachable
# name — including variants required only by packages it had already stripped
# (3 copies of @opentelemetry/semantic-conventions, 2 of rxjs, 5 of
# @aws-sdk/nested-clients: ~168MB on the api graph). Walking instances drops
# those without changing a single resolved version.
COPY scripts/strip-unused-pnpm.mjs /tmp/strip-unused-pnpm.mjs
RUN node /tmp/strip-unused-pnpm.mjs /app/deployed

# Inject chunk IDs into the bundled JS + source maps so backend stack traces
# symbolicate to original TypeScript with surrounding code context (parity with
# Sentry's contextLines). The chunk ID is content-hashed and environment-
# independent, so it's baked into the shipped JS here at build time; at runtime a
# stack trace carries the chunk ID and PostHog looks up the map by it. This
# "build once, deploy many" image resolves errors in every environment it's
# promoted to (preview + prod).
#
# Covers the API's own code (/app/deployed/dist) and the workspace packages
# bundled under node_modules/@borradh-workspace (features, auth, integrations,
# observability, …) — both emit external `.js.map` with `sourcesContent`
# (swc `sourceMaps` for the API; tsc `sourceMap`+`inlineSources` for libs).
#
# The slow part — UPLOADING the `.map` files to PostHog (~28s of network on the
# API image, 929 maps) — is decoupled from this build so it no longer sits on
# the image-build critical path. The `sourcemaps` stage below captures the
# injected JS+maps, and .github/workflows/build-artifacts.yml's `upload-sourcemaps`
# job uploads them concurrently, off the critical path. Symbolication is correct
# regardless of upload TIMING — only that the SAME injected build's maps reach
# PostHog, keyed by chunk ID. The `.map` files never ship in the runtime image:
# the `runtime-bundle` stage strips them before the production COPY.
#
# `POSTHOG_SKIP_UPLOAD` opts INTO this decoupling; the Depot CI path sets it. When
# unset (local builds, the Fly-remote-builder fallback, forks) the upload happens
# inline as before — those paths have no separate CI job to hand it off to, so we
# keep the old behaviour (with `--delete-after` removing the maps post-upload).
#
# Gated on the `posthog_cli_token` build secret: when it's absent (local builds,
# forks, or before the GitHub secret is set) inject AND upload are a no-op so the
# build still succeeds — and the `sourcemaps` stage is then empty, making the CI
# upload job a clean no-op too.
#
# The install is retried because @posthog/cli's postinstall pulls a binary
# from GitHub releases, and that fetch has thrown ECONNRESET in CI. Here it
# would fail the IMAGE build, not just the source-map upload.
ARG POSTHOG_CLI_ENV_ID
ARG POSTHOG_CLI_HOST=https://eu.posthog.com
ARG POSTHOG_SKIP_UPLOAD
RUN --mount=type=secret,id=posthog_cli_token \
    if [ -s /run/secrets/posthog_cli_token ] && [ -n "$POSTHOG_CLI_ENV_ID" ]; then \
      export POSTHOG_CLI_TOKEN="$(cat /run/secrets/posthog_cli_token)" \
             POSTHOG_CLI_ENV_ID="$POSTHOG_CLI_ENV_ID" \
             POSTHOG_CLI_HOST="$POSTHOG_CLI_HOST"; \
      for i in 1 2 3; do \
        npm install -g @posthog/cli@0.7.21 && break; \
        if [ "$i" = 3 ]; then echo ">>> posthog-cli install failed 3x"; exit 1; fi; \
        echo ">>> posthog-cli install failed, retry $i in $((i * 5))s"; sleep $((i * 5)); \
      done; \
      for dir in /app/deployed/dist /app/deployed/node_modules/@borradh-workspace; do \
        [ -d "$dir" ] || continue; \
        posthog-cli sourcemap inject --directory "$dir"; \
        if [ -z "$POSTHOG_SKIP_UPLOAD" ]; then \
          posthog-cli sourcemap upload --directory "$dir" --delete-after --skip-on-conflict; \
        fi; \
      done; \
      if [ -n "$POSTHOG_SKIP_UPLOAD" ]; then \
        echo ">>> PostHog source maps injected (upload deferred to CI job)"; \
      else \
        echo ">>> PostHog source maps injected + uploaded"; \
      fi; \
    else \
      echo ">>> skipping PostHog source maps (POSTHOG_CLI_TOKEN/ENV_ID not set)"; \
    fi

# Smoke-test the deployed bundle: boot the app with dummy env, fail the
# build if any MODULE_NOT_FOUND appears (matches both the ESM
# `ERR_MODULE_NOT_FOUND` and the CJS `MODULE_NOT_FOUND` — the latter is what a
# missing native binding like canvas.node throws). Catches cases where the
# strip (or a dep change) silently removes a runtime requirement.
#
# We provide enough dummy env to pass zod validation (most env modules don't
# honor SKIP_ENV_VALIDATION). With validation passing, NestJS bootstraps and
# instantiates every @Module in AppModule, which imports every workspace
# package the app uses — that's the path that exercises the ESM resolver.
# The app eventually fails trying to connect to dummy DB/Redis; that's the
# expected end state. We only fail the build on MODULE_NOT_FOUND.
RUN cd /app/deployed && \
    OUTPUT=$(timeout 20 env \
      NODE_ENV=development \
      SKIP_ENV_VALIDATION=1 \
      DATABASE_URL=postgres://x:x@127.0.0.1:5432/x \
      REDIS_URL=redis://127.0.0.1:6379 \
      BETTER_AUTH_SECRET=smoke-test-secret-thirty-two-chars-or-more \
      BETTER_AUTH_URL=http://localhost:3000 \
      NEXT_PUBLIC_APP_URL=http://localhost:3000 \
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_smoke \
      RESEND_API_KEY=smoke \
      EMAIL_FROM_ADDRESS=smoke@example.com \
      SEQUENCE_FROM_ADDRESS=smoke@example.com \
      STRIPE_SECRET_KEY=sk_smoke \
      STRIPE_WEBHOOK_SECRET=whsec_smoke \
      STRIPE_PRICE_ID_PRO=price_smoke \
      S3_PUBLIC_ASSETS_BUCKET=smoke \
      S3_ORG_ASSETS_BUCKET=smoke \
      node dist/main.js 2>&1; true) && \
    if echo "$OUTPUT" | grep -qE "MODULE_NOT_FOUND"; then \
      echo "::: SMOKE TEST FAILED — MODULE_NOT_FOUND in deployed bundle :::"; \
      echo "$OUTPUT" | grep -B 2 -A 8 MODULE_NOT_FOUND | head -60; \
      exit 1; \
    fi && \
    echo ">>> smoke test passed (no MODULE_NOT_FOUND during boot)"

# -----------------------------------------------------------------------------
# Stage 2b: Source-map export (Depot CI path only).
# A `scratch` stage holding just the injected chunks (.js) + their `.map`
# siblings, in the same relative layout, so a separate CI job can run
# `posthog-cli sourcemap upload` off the image-build critical path (see
# build-artifacts.yml, `upload-sourcemaps`). posthog-cli's upload reads the
# chunk ID from the .js and resolves the map via its `sourceMappingURL`, so BOTH
# files must travel together. Built only when explicitly targeted with
# `--target sourcemaps --output type=local,dest=...`; a normal image build
# (target `production`, the last stage) never references this stage, so BuildKit
# skips it. When the posthog token is absent, inject was a no-op above and this
# stage still exports the (un-injected, map-less) JS — the CI upload job then
# finds no chunk-id pairs and is a clean no-op.
# -----------------------------------------------------------------------------
FROM scratch AS sourcemaps
COPY --from=builder /app/deployed/dist /dist
COPY --from=builder /app/deployed/node_modules/@borradh-workspace /node_modules/@borradh-workspace

# -----------------------------------------------------------------------------
# Stage 2c: Runtime bundle — builder's /app/deployed with every `.map` removed,
# so source maps NEVER ship in the runtime image (they leak original source and
# are useless at runtime). This preserves the property the old inline
# `--delete-after` gave us, now that upload (and its delete) moved off the build.
# On the inline-upload path `--delete-after` already stripped the injected maps,
# so this is a harmless superset. A shelled base is required — the production
# stage is distroless and has no `find`. The injected `.js` (chunk IDs baked in)
# is untouched.
# -----------------------------------------------------------------------------
FROM base AS runtime-bundle
COPY --from=builder /app/deployed /app/deployed
RUN find /app/deployed -type f -name '*.map' -delete

# -----------------------------------------------------------------------------
# Stage 3: Production — distroless Node 22.
# No shell, no package manager, no curl — only /nodejs/bin/node and our bundle.
# Container HEALTHCHECK dropped; ALB target group health check at /health/live
# is the authoritative liveness signal.
# -----------------------------------------------------------------------------
FROM gcr.io/distroless/nodejs22-debian12:nonroot AS production

WORKDIR /app

# Copy the self-contained deployment bundle (source maps already stripped in
# the runtime-bundle stage — none reach this image).
COPY --from=runtime-bundle /app/deployed /app

# The one release version, from the repo-root VERSION file, passed in by
# the image build. Without it the app reports version "unknown": the code
# reads npm_package_version, which only exists when node is launched via an
# npm/pnpm script, and distroless runs `node dist/main.js` directly.
ARG APP_VERSION=unknown
ENV APP_VERSION=$APP_VERSION
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Distroless nodejs images have /nodejs/bin/node as ENTRYPOINT, so CMD is just the script path.
# pnpm deploy flattens the package to /app, so dist is at /app/dist.
CMD ["dist/main.js"]
