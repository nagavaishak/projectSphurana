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
  markWorkspaceFramesInApp,
} from './client.js';
export {
  getPostHogClient,
  getEnvProps,
  getDeployEnvironment,
} from './client.js';
export type { TrackEventOptions, FeatureFlagOptions } from './client.js';

// Backend PostHog-telemetry liveness heartbeat (Better Stack dead-man's switch)
export { startPostHogHeartbeat } from './heartbeat.js';
export type { PostHogHeartbeatOptions } from './heartbeat.js';

// LLM observability ($ai_generation / $ai_embedding)
export { captureAiGeneration, captureAiEmbedding } from './ai.js';
export type { AiGenerationEvent, AiEmbeddingEvent } from './ai.js';

export type {
  PostHogConfig,
  PostHogEventProperties,
  PostHogUserProperties,
} from './types.js';

// Fallback grouping for $exception events with no in-app stack frame (ENG-851)
export {
  hasAppStackFrame,
  buildFallbackFingerprint,
  isAppCodeStackLine,
} from './exception-fingerprint.js';
