# syntax=docker/dockerfile:1.6
# =============================================================================
# webhook-router Dockerfile — small Hono app, distroless runtime.
# =============================================================================

FROM node:22.22.0-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate \
    && npm install turbo@2 --global

# Stage 1: Prune monorepo to webhook-router deps
FROM base AS pruner
WORKDIR /app
COPY . .
RUN turbo prune @borradh-workspace/webhook-router --docker

# Stage 2: Install + build
FROM base AS builder
WORKDIR /app

# Build args aren't visible to RUN as env vars — must promote them to ENV
# so `pnpm turbo build` below can authenticate with the remote cache.
ARG TURBO_TOKEN
ARG TURBO_TEAM
ENV TURBO_TOKEN=$TURBO_TOKEN
ENV TURBO_TEAM=$TURBO_TEAM

COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm install --no-frozen-lockfile

COPY --from=pruner /app/out/full/ .
COPY --from=pruner /app/tsconfig.base.json ./

RUN --mount=type=cache,target=/app/.turbo,sharing=locked \
    pnpm turbo build --filter=@borradh-workspace/webhook-router...

# sharing=shared (not locked): `pnpm deploy` only READS out of the store, which
# install already populated. Sharing the read-only mount avoids serialising
# against concurrent image builds on the same Depot builder. See apps/api/Dockerfile.
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
    pnpm --filter=@borradh-workspace/webhook-router deploy --prod --ignore-scripts /app/deployed

# Stage 3: Production — distroless Node 22
FROM gcr.io/distroless/nodejs22-debian12 AS production

WORKDIR /app
COPY --from=builder /app/deployed /app

# The one release version, from the repo-root VERSION file, passed in by
# the image build. Without it the app reports version "unknown": the code
# reads npm_package_version, which only exists when node is launched via an
# npm/pnpm script, and distroless runs `node dist/main.js` directly.
ARG APP_VERSION=unknown
ENV APP_VERSION=$APP_VERSION
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["dist/main.js"]
