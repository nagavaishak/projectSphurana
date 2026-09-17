# syntax=docker/dockerfile:1.6
# =============================================================================
# Borradh Video Worker Dockerfile
# Multi-stage build using Turborepo prune + pnpm deploy for minimal image
# BuildKit cache mounts used on pnpm store + turbo cache for fast rebuilds
#
# This worker requires:
# - FFmpeg for audio extraction and video processing (system package)
# - Access to Remotion Lambda for rendering
# - Transcription via OpenAI Whisper API (cloud mode)
#
# Size optimizations:
# - `turbo prune` extracts only workspace packages needed by video-worker
# - `pnpm deploy --prod` creates a self-contained bundle without devDependencies
# - No build tools (python3/g++/make) — no native compilation at runtime
#
# Root workspace deps (Expo, React Native, Next.js) are stripped in the pruner
# stage to prevent ~800MB of unused packages from leaking through pnpm's lockfile.
# =============================================================================

FROM node:22.22.0-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate \
    && npm install turbo@2.7.5 --global

# -----------------------------------------------------------------------------
# Stage 1: Prune monorepo to video-worker dependencies only
# -----------------------------------------------------------------------------
FROM base AS pruner
WORKDIR /app
COPY . .
RUN turbo prune @borradh-workspace/video-worker --docker

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
  if (pkg.dependencies) { for (const k of Object.keys(pkg.dependencies)) { if (shouldStrip(k, strip)) delete pkg.dependencies[k]; } } \
  if (pkg.devDependencies) { for (const k of Object.keys(pkg.devDependencies)) { if (shouldStrip(k, stripDev)) delete pkg.devDependencies[k]; } } \
  fs.writeFileSync('out/json/package.json', JSON.stringify(pkg, null, 2));"

# -----------------------------------------------------------------------------
# Stage 2: Install dependencies and build
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

# Install dependencies from pruned lockfile (better layer caching).
# Using --no-frozen-lockfile because we stripped root workspace deps in the pruner
# stage to avoid installing ~800MB of unrelated packages (Expo, Next.js, etc.).
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm install --no-frozen-lockfile

# Copy source and root configs
COPY --from=pruner /app/out/full/ .
COPY --from=pruner /app/tsconfig.base.json ./

# Build video worker and all its dependencies
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
    pnpm turbo build --filter=@borradh-workspace/video-worker...

# Create a self-contained production bundle.
# Sharp's platform-specific deps (@img/sharp-linux-x64, @img/sharp-libvips-linux-x64)
# are declared in apps/video-worker/package.json so pnpm deploy hoists them to
# top-level node_modules/, mirroring the api Dockerfile pattern. No `pnpm rebuild
# sharp` needed.
# sharing=shared (not locked): `pnpm deploy` only READS/hardlinks out of the
# store — install already populated it, deploy writes nothing. The api + worker
# images build concurrently on the same Depot builder and share this cache-mount
# target; sharing=locked serialised their deploy steps so one waited out the
# other's copy (observed 60s+ stalls; deploy layers of 97s/116s). A read-only
# mount is safe to share concurrently.
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
    pnpm --filter=@borradh-workspace/video-worker deploy --prod --ignore-scripts /app/deployed

# See apps/api/Dockerfile for the rationale. Same leak (better-auth optional
# peers fulfilled by workspace-root deps), same strip via pnpm-instance walk.
COPY scripts/strip-unused-pnpm.mjs /tmp/strip-unused-pnpm.mjs
RUN node /tmp/strip-unused-pnpm.mjs /app/deployed

# Inject chunk IDs into the tsup bundle (/app/deployed/dist, built with
# --sourcemap) + any externalized workspace packages under
# node_modules/@borradh-workspace (tsc maps with sourcesContent), so worker
# stack traces symbolicate to original TypeScript with code context. Chunk IDs
# are baked into the shipped JS here at build time.
#
# UPLOADING the maps to PostHog is decoupled from this build (off the image-build
# critical path): the `sourcemaps` stage below captures the injected JS+maps and
# build-artifacts.yml's `upload-sourcemaps` job uploads them concurrently.
# Symbolication is correct regardless of upload timing — only that this exact
# build's maps reach PostHog, keyed by chunk ID. The `.map` files never ship in
# the runtime image: the `runtime-bundle` stage strips them before the
# production COPY. See apps/api/Dockerfile for the full rationale.
#
# `POSTHOG_SKIP_UPLOAD` opts into the decoupling (set by the Depot CI path). When
# unset (local builds, the Fly-remote-builder fallback, forks) the upload happens
# inline as before. Gated on the build secret (no-op without it) and non-fatal.
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

# See apps/api/Dockerfile for rationale.
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
# `scratch` stage with just the injected chunks (.js) + their `.map` siblings so
# a separate CI job uploads them off the critical path (build-artifacts.yml,
# `upload-sourcemaps`). Upload needs BOTH files together (it reads the chunk ID
# from the .js, resolves the map via `sourceMappingURL`). Built only when
# targeted with `--target sourcemaps --output type=local,dest=...`; a normal
# image build (target `production`, last stage) never references it. See
# apps/api/Dockerfile for the full rationale.
# -----------------------------------------------------------------------------
FROM scratch AS sourcemaps
COPY --from=builder /app/deployed/dist /dist
COPY --from=builder /app/deployed/node_modules/@borradh-workspace /node_modules/@borradh-workspace

# -----------------------------------------------------------------------------
# Stage 2c: Runtime bundle — builder's /app/deployed with every `.map` removed,
# so source maps NEVER ship in the runtime image. Preserves the property the old
# inline `--delete-after` gave us now that upload moved off the build; on the
# inline-upload path the maps are already gone, so this is a harmless superset.
# The injected `.js` (chunk IDs baked in) is untouched.
# -----------------------------------------------------------------------------
FROM base AS runtime-bundle
COPY --from=builder /app/deployed /app/deployed
RUN find /app/deployed -type f -name '*.map' -delete

# -----------------------------------------------------------------------------
# Stage 3: Production
# -----------------------------------------------------------------------------
FROM node:22.22.0-bookworm-slim AS production

WORKDIR /app

# Runtime system dependencies only:
# - ffmpeg: audio extraction, remuxing, and video processing
# - libvips42: shared library required by sharp for image processing
# - libfreetype6/fontconfig: font resolution for sharp text rendering
#
# node-canvas's cairo/pango/rsvg/pixman libs were dropped along with the
# `fabric` dependency that was the sole path pulling node-canvas into the
# bundle (fabric had zero imports; its only consumer was deleted). That also
# removed the build-essential/python3 + dev-header toolchain and the
# `npm rebuild canvas` step from the builder stage.
# (no curl: the worker is a BullMQ consumer with no HTTP server / health probe,
#  so curl would only add attack surface in a compromised container.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libvips42 \
    libfreetype6 \
    fontconfig \
    && rm -rf /var/lib/apt/lists/*

# Copy the self-contained deployment bundle, owned by the built-in unprivileged
# `node` user (UID 1000) so the worker doesn't run as root. Transient render
# work goes to the OS temp dir (/tmp), not /app, so the bundle can stay
# owned-but-not-writable-critical here. Source maps already stripped in the
# runtime-bundle stage — none reach this image.
COPY --from=runtime-bundle --chown=node:node /app/deployed /app

# The one release version, from the repo-root VERSION file, passed in by
# the image build. Without it the app reports version "unknown": the code
# reads npm_package_version, which only exists when node is launched via an
# npm/pnpm script, and distroless runs `node dist/main.js` directly.
ARG APP_VERSION=unknown
ENV APP_VERSION=$APP_VERSION
ENV NODE_ENV=production

USER node

CMD ["node", "dist/main.js"]
