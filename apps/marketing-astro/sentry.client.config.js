import * as Sentry from '@sentry/astro';

// The DSN is delivered at request time via the window.__CONFIG__ head
// script, so a single build artifact works across environments.
const config = typeof window !== 'undefined' ? window.__CONFIG__ : undefined;

Sentry.init({
  dsn: config?.marketingSentryDsn ?? undefined,

  // Route events through our own origin (see src/pages/monitoring.ts) so
  // content blockers that match sentry.io don't drop them.
  tunnel: '/monitoring',

  enabled: import.meta.env.PROD,

  environment: config?.appEnv ?? 'production',

  tracesSampleRate: 0.1,

  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
    Sentry.browserTracingIntegration(),
  ],

  ignoreErrors: [
    /^chrome-extension:\/\//,
    /^moz-extension:\/\//,
    'Hydration failed',
    'Text content did not match',
    'ResizeObserver loop',
  ],

  beforeSend(event) {
    if (event.request?.headers) {
      // biome-ignore lint/performance/noDelete: header values are typed as string; delete is required to drop them
      delete event.request.headers.cookie;
      // biome-ignore lint/performance/noDelete: header values are typed as string; delete is required to drop them
      delete event.request.headers.authorization;
    }
    return event;
  },
});
