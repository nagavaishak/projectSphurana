export { getAppVersion } from './app-version.js';
// @borradh-workspace/observability
// Centralized observability utilities for error tracking, logging, and product analytics

// Logger exports (Pino + Better Stack)
export {
  initLogger,
  getLogger,
  createLogger,
  flushLogs,
  getTelemetryStats,
} from './logger.js';

export type {
  Logger,
  LoggerConfig,
  LogContext,
  LogLevel,
  TelemetryStats,
} from './logger.js';

// Telemetry self-check: proves BOTH the Better Stack and PostHog paths are
// alive every minute, so a dead path is detectable instead of looking quiet.
export { startTelemetryCanary } from './telemetry-canary.js';
export type {
  TelemetryCanaryOptions,
  TelemetryCanarySnapshot,
} from './telemetry-canary.js';

// NestJS logger adapter
export { NestLogger, createNestLogger } from './nest-logger.js';

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
  setupPostHogOtelExport,
  flushPostHogOtelExport,
} from './sentry/index.js';

export type {
  SentryConfig,
  SentryContext,
  LogErrorContext,
} from './sentry/index.js';

// PostHog exports
export {
  initPostHog,
  isPostHogInitialized,
  trackEvent,
  trackOrgEvent,
  capturePostHogException,
  identifyUser,
  setGroup,
  identifyOrganization,
  isFeatureEnabled,
  getFeatureFlag,
  shutdown,
  getPostHogClient,
  getEnvProps,
  getDeployEnvironment,
  startPostHogHeartbeat,
  captureAiGeneration,
  captureAiEmbedding,
} from './posthog/index.js';

export type {
  PostHogConfig,
  PostHogEventProperties,
  PostHogUserProperties,
  TrackEventOptions,
  FeatureFlagOptions,
  AiGenerationEvent,
  AiEmbeddingEvent,
} from './posthog/index.js';

// Generic Better Stack heartbeat ping (dead-man's switch for scheduled jobs).
export { pingHeartbeat } from './heartbeat.js';

// Feature-flag decision core (progressive delivery — Pillar 1).
// Pure logic for gradual rollout + kill-switch with a safe fallback, plus an
// adapter seam (FlagProvider). No PostHog SDK import here; a real adapter is
// injected at the call site.
export {
  resolveKillSwitch,
  isInRollout,
  rolloutBucket,
  staticProvider,
  resolveFlag,
  // PostHog-backed concrete adapter (defensive; no live keys required to import).
  postHogFlagProvider,
  // Flag-aware test-execution helpers (for other packages'/apps' tests).
  withFlags,
  allFlagsOff,
  allFlagsOn,
  // Request-scoped server accessor: `await isFeatureOn('my-flag')`.
  isFeatureOn,
} from './flags/index.js';
export type {
  KillSwitchState,
  ResolveKillSwitchOptions,
  FlagProvider,
  FlagContext,
  PostHogFlagDeps,
  IsFeatureOnOptions,
} from './flags/index.js';

// PII redaction for log payloads
export { redactPII } from './redact-pii.js';

// Mirrors NATIVE crashes/ANRs out of Sentry into PostHog. Native events never
// enter JavaScript (the @sentry/capacitor bridge is one-way for events), so this
// server-side mirror is the only way to see them in PostHog.
export {
  mirrorSentryNativeEvents,
  isNativeOriginEvent,
  toPostHogException,
} from './sentry-mirror/index.js';
export type {
  MirrorDeps,
  MirrorResult,
  SentryApiEvent,
} from './sentry-mirror/index.js';

// Kernel TCP timeout tuning (Fly NAT dead-socket resilience)
export { applyTcpResilienceTuning } from './tcp-tuning.js';
export type { TcpTuningResult, TcpTuningDeps } from './tcp-tuning.js';

// Tracked wrapper exports
export { tracked, trackedSafe, trackedResult } from './tracked.js';
export type {
  TrackedOptions,
  TrackedResult,
  TrackedResultOptions,
  ResultShape,
} from './tracked.js';

// Context exports for request-scoped user tracking
export {
  getObservabilityContext,
  getCurrentUserId,
  getCurrentUserSetProps,
  getCurrentOrganizationId,
  setContextUserId,
  setContextUser,
  setContextOrganization,
  runWithContext,
  withObservabilityContext,
  // Flag-context helpers: wrap flag-gated code with withFlag() so every
  // trackedResult/tracked call inside auto-stamps feature_flag_key.
  withFlag,
  getActiveFlags,
} from './context.js';
export type { ObservabilityContext } from './context.js';

import type { LoggerConfig } from './logger.js';
import { initLogger as _initLogger } from './logger.js';
import type { PostHogConfig } from './posthog/index.js';
import { initPostHog } from './posthog/index.js';
// Convenience initialization function
import type { SentryConfig } from './sentry/index.js';
import {
  setupPostHogOtelExport as _setupPostHogOtelExport,
  initSentry,
} from './sentry/index.js';

export interface ObservabilityConfig {
  sentry?: SentryConfig;
  posthog?: PostHogConfig;
  /**
   * Logger/Better Stack config. Omitting this leaves the logger uninitialized:
   * the first `getLogger()` lazily calls `initLogger()` with no token, so pino
   * writes to stdout and the process looks healthy while NOTHING ever reaches
   * Better Stack. Pass it whenever the caller isn't already calling
   * `initLogger()` itself.
   */
  logger?: LoggerConfig;
}

/**
 * Initialize all observability services at once
 *
 * @example
 * ```ts
 * import { initObservability } from '@borradh-workspace/observability';
 * import { observabilityEnv } from '@borradh-workspace/env/observability';
 *
 * initObservability({
 *   sentry: {
 *     dsn: observabilityEnv.SENTRY_DSN,
 *     environment: observabilityEnv.SENTRY_ENVIRONMENT,
 *   },
 *   posthog: {
 *     apiKey: observabilityEnv.POSTHOG_API_KEY,
 *     host: observabilityEnv.POSTHOG_HOST,
 *   },
 * });
 * ```
 */
export const initObservability = (config: ObservabilityConfig): void => {
  // Init the logger FIRST so Sentry/PostHog startup problems are themselves
  // logged through a live forwarding path rather than into a null client.
  if (config.logger) {
    _initLogger(config.logger);
  }

  if (config.sentry) {
    initSentry(config.sentry);
  }

  if (config.posthog) {
    initPostHog(config.posthog);
  }

  if (config.sentry && config.posthog?.apiKey) {
    const posthogHost: string =
      config.posthog.host ?? 'https://eu.i.posthog.com';
    _setupPostHogOtelExport(config.posthog.apiKey, posthogHost);
  }
};
