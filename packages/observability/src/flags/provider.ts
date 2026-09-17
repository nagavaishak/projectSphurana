/**
 * Flag-provider adapter seam.
 *
 * The core decision logic ({@link ../kill-switch} and {@link ../rollout}) is
 * pure and has **no PostHog dependency**. This module defines the thin contract
 * a concrete backend implements so a real client (e.g. posthog-node via the
 * observability package's existing `getFeatureFlag`) can be *injected* at the
 * call site without the core knowing about it.
 *
 * A PostHog adapter is intentionally NOT implemented here — wiring it to a live
 * project is infra/secret-gated and out of scope for the verifiable core. The
 * shipped concrete provider is {@link staticProvider}, used by tests and local
 * defaults. See the "Flag mechanics" section of the release-safety strategy.
 */

import { resolveKillSwitch } from './kill-switch.js';

/**
 * Targeting context for a flag lookup. `unitId` is the stable per-user or
 * per-org id used for percentage bucketing (never per-request). `groups`
 * mirrors posthog-node's group targeting (e.g. `{ organization: orgId }`).
 */
export interface FlagContext {
  unitId?: string;
  groups?: Record<string, string>;
  properties?: Record<string, string>;
}

/**
 * The adapter a concrete flag backend implements. Mirrors the shape of the
 * existing `getFeatureFlag(distinctId, key, options)` helper so a PostHog
 * adapter is a thin wrapper. Returns the raw provider state:
 *
 * - `boolean` — definitive on/off (or a resolved percentage rollout).
 * - `undefined` — flag not configured / no opinion.
 *
 * Implementations should let exceptions propagate (or return `undefined`); the
 * **caller** decides the safe fallback via {@link resolveKillSwitch}. A
 * provider must NOT invent a default — that policy lives with the consumer.
 */
export interface FlagProvider {
  /**
   * Look up a single flag. May be async (network) or sync (static/local).
   * May throw — callers wrap with {@link resolveKillSwitch} to degrade safely.
   */
  getFlag(
    key: string,
    context?: FlagContext
  ): boolean | undefined | Promise<boolean | undefined>;
}

/**
 * A synchronous, in-memory {@link FlagProvider} backed by a plain map of
 * `key → boolean`. The shipped concrete provider — used in unit tests, local
 * dev, and as a deterministic default when no live backend is wired.
 *
 * Unknown keys return `undefined` (not configured), which resolves to the safe
 * default through {@link resolveKillSwitch}.
 */
export const staticProvider = (
  map: Record<string, boolean> = {}
): FlagProvider => ({
  getFlag(key: string): boolean | undefined {
    return Object.prototype.hasOwnProperty.call(map, key)
      ? map[key]
      : undefined;
  },
});

/**
 * Convenience: look a flag up through any {@link FlagProvider} and resolve it
 * to a definitive boolean with a safe fallback, even if the provider throws or
 * rejects. This is the one place the adapter seam and the kill-switch resolver
 * meet — a real PostHog adapter dropped into `provider` "just works" here.
 *
 * @param provider any FlagProvider (static, or a future PostHog adapter)
 * @param key flag key
 * @param context targeting context (unit id / groups)
 * @param options `{ defaultEnabled }` — the safe value on no-opinion / failure
 */
export const resolveFlag = async (
  provider: FlagProvider,
  key: string,
  context?: FlagContext,
  options?: { defaultEnabled?: boolean }
): Promise<boolean> => {
  try {
    const state = await provider.getFlag(key, context);
    return resolveKillSwitch(state, options);
  } catch (err) {
    // Provider threw/rejected → degrade to the safe default. Never propagate.
    return resolveKillSwitch(err as Error, options);
  }
};
