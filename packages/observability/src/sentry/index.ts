// Sentry exports
export {
  initSentry,
  isSentryInitialized,
  captureException,
  captureMessage,
  setUser,
  addBreadcrumb,
  flush,
  logError,
  logWarning,
} from './client.js';

export type { SentryConfig, SentryContext } from './types.js';
export type { LogErrorContext } from './client.js';

// BetterStack Errors ingestion. `forwardEventToBetterStack` is the Sentry
// `beforeSend` bridge; `forwardErrorToBetterStack` is the Sentry-INDEPENDENT
// path used when Sentry is not initialized, so BetterStack survives Sentry being
// demoted or removed.
export {
  forwardEventToBetterStack,
  forwardErrorToBetterStack,
} from './betterstack-forwarder.js';

// PostHog OTEL exporter (Sentry → PostHog dual export)
export {
  setupPostHogOtelExport,
  flushPostHogOtelExport,
} from './posthog-otel-exporter.js';
