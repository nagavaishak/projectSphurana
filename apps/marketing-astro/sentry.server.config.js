import * as Sentry from '@sentry/astro';

// Server-side errors from the SSR routes (/blog, /book, /ingest, /dashboard).
Sentry.init({
  dsn: process.env.PUBLIC_SENTRY_DSN || undefined,

  enabled: import.meta.env.PROD,

  // Falls back to Vercel's own VERCEL_ENV before defaulting to production.
  // PUBLIC_APP_ENV is not configured per-environment on this project, so the
  // previous `|| 'production'` filed PREVIEW server errors under
  // environment=production in Sentry — the same bug src/lib/config.ts had for
  // PostHog. Kept inline rather than importing resolveAppEnv() because this file
  // is loaded by the Sentry integration outside the `@/` alias graph.
  environment:
    process.env.PUBLIC_APP_ENV || process.env.VERCEL_ENV || 'production',

  tracesSampleRate: 0.1,
});
