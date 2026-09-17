import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const observabilityEnv = createEnv({
  server: {
    // Sentry error tracking
    SENTRY_DSN: z.string().url().optional(),
    SENTRY_ENVIRONMENT: z
      .enum(['development', 'preview', 'staging', 'production'])
      .default('development'),
    SENTRY_RELEASE: z.string().optional(),

    // Read-only Sentry API access, used ONLY by the native-crash mirror
    // (packages/observability/src/sentry-mirror). Native crashes and ANRs are
    // captured by sentry-cocoa / sentry-android and shipped by the native layer
    // — they never enter JavaScript, so they cannot be re-routed client-side.
    // Mirroring them out of Sentry's API is the only way to see them in PostHog.
    // Absent → the mirror is skipped, which is the correct default everywhere
    // that is not the API/worker.
    SENTRY_AUTH_TOKEN: z.string().optional(),
    SENTRY_ORG: z.string().default('borradh-production'),
    // The Sentry project that receives apps/app — browser AND native, since
    // they are one codebase on one DSN.
    SENTRY_MOBILE_PROJECT: z.string().default('web'),

    // PostHog analytics
    POSTHOG_API_KEY: z.string().optional(),
    POSTHOG_HOST: z.string().url().default('https://eu.i.posthog.com'),

    // Logging configuration
    LOG_LEVEL: z
      .enum(['debug', 'info', 'warn', 'error', 'fatal'])
      .default('info'),

    // Better Stack (Logtail) for centralized logging
    // Get token from: Better Stack → Logs → Sources → Your Source → Source Token
    LOGTAIL_TOKEN: z.string().optional(),

    // Better Stack ingesting host for the source above, e.g.
    // https://s2623988.eu-central-1a.betterstackdata.com. Optional — when
    // unset, @logtail/node uses its default endpoint (in.logs.betterstack.com).
    // A source token is only accepted by its OWN ingesting host: newer sources
    // in other data regions 401 on the default endpoint. Prod's token works on
    // the default so prod leaves this unset; the preview API source sets it.
    LOGTAIL_ENDPOINT: z.string().url().optional(),

    // Better Stack Uptime webhook for incoming alerts (optional)
    // Get from: Better Stack → Uptime → Integrations → Incoming Webhooks
    BETTERSTACK_HEARTBEAT_URL: z.string().url().optional(),

    // Better Stack heartbeat dedicated to backend PostHog telemetry liveness.
    // The API/worker ping this ONLY while the PostHog client is live, so if
    // backend product events (tracked/trackedResult) stop flowing the pings
    // stop and Better Stack raises an incident. Separate from the process
    // liveness heartbeat (BETTERSTACK_HEARTBEAT_URL) on purpose.
    BETTERSTACK_POSTHOG_HEARTBEAT_URL: z.string().url().optional(),

    // Better Stack heartbeat for the NestJS scheduler engine. Pinged every
    // metrics-collector tick (~60s); if the cron/interval engine stops firing,
    // EVERY scheduled job dies at once and this goes red. Broadest coverage of
    // the "silent cron death" failure class.
    BETTERSTACK_SCHEDULER_HEARTBEAT_URL: z.string().url().optional(),

    // Better Stack heartbeat for the daily analytics export (5 AM UTC) that
    // feeds the PostHog Data Warehouse. Pinged on successful export; a silent
    // failure means stale warehouse data.
    BETTERSTACK_ANALYTICS_HEARTBEAT_URL: z.string().url().optional(),

    // Better Stack heartbeat for Claire's proactive triggers. Pinged each time
    // the 15-min lead-unreplied trigger runs; if Claire's scheduled brain stops
    // firing, proactive recommendations silently cease.
    BETTERSTACK_CLAIRE_HEARTBEAT_URL: z.string().url().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
