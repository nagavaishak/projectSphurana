/**
 * Feature-flag decision core for progressive delivery (Pillar 1 of the
 * release-safety strategy). Pure, dependency-light logic for the two flag
 * mechanisms — gradual per-user/org rollout and operational kill-switch — plus
 * an adapter seam so a real PostHog client can be injected later.
 *
 * Deliberately does NOT import the PostHog SDK or implement a PostHog adapter:
 * that (and the auto-rollback guardrail) is infra/secret-gated work.
 */

// Kill-switch resolution with a safe fallback (default-off).
export { resolveKillSwitch } from './kill-switch.js';
export type {
  KillSwitchState,
  ResolveKillSwitchOptions,
} from './kill-switch.js';

// Deterministic gradual-rollout bucketing ("10% of users").
export { isInRollout, rolloutBucket } from './rollout.js';

// Adapter seam + the shipped static provider + the combined resolver.
export { staticProvider, resolveFlag } from './provider.js';
export type { FlagProvider, FlagContext } from './provider.js';

// PostHog-backed concrete adapter (thin wrapper over the package's existing
// server-side flag helpers; defensive — never throws to callers).
export { postHogFlagProvider } from './posthog-provider.js';
export type { PostHogFlagDeps } from './posthog-provider.js';

// Flag-aware test-execution helpers for other packages'/apps' tests.
export { withFlags, allFlagsOff, allFlagsOn } from './testing.js';

// Request-scoped server accessor: `await isFeatureOn('my-flag')` reads the
// per-request org/user context + the PostHog adapter with a safe fallback.
// GLOBAL_KILLSWITCH_KEY: set rollout_percentage > 0 on this PostHog flag to
// instantly revert ALL isFeatureOn() calls to false.
export { isFeatureOn, GLOBAL_KILLSWITCH_KEY } from './request-flag.js';
export type { IsFeatureOnOptions } from './request-flag.js';
