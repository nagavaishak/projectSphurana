/**
 * PostHog-backed {@link FlagProvider} adapter.
 *
 * The concrete backend for the flag seam: a thin wrapper over the observability
 * package's existing server-side flag helpers
 * ({@link ../posthog/client.getFeatureFlag} / `isFeatureEnabled`). It carries NO
 * config of its own — it reads through the already-initialized `posthog-node`
 * singleton, whose key/host come from `POSTHOG_API_KEY` / `POSTHOG_HOST` via
 * `initPostHog({ apiKey, host })` (see `posthog/client.ts` `initPostHog` and the
 * `observabilityEnv` wiring in the package root `index.ts`). There is therefore
 * no new env to invent here.
 *
 * Because the underlying helpers already degrade to `undefined`/`false` when the
 * client isn't initialized (no live keys), this adapter is a no-op-safe drop-in:
 * dropped into {@link resolveFlag}, an unconfigured PostHog "just works" and
 * resolves to the caller's safe default.
 *
 * Defensiveness: although the helpers don't currently throw, the adapter wraps
 * the call so any future/internal SDK error surfaces as `undefined` (no opinion)
 * rather than propagating — the {@link resolveFlag}/{@link resolveKillSwitch}
 * layer then degrades to the safe path. A flag-eval blip must never take down
 * the code path it guards.
 */

import { type FeatureFlagOptions, getFeatureFlag } from '../posthog/index.js';
import type { FlagContext, FlagProvider } from './provider.js';

/** The two helper shapes the adapter can delegate to; injectable for tests. */
export interface PostHogFlagDeps {
  /** Mirrors {@link getFeatureFlag} — may return a multivariate string. */
  getFeatureFlag: (
    distinctId: string,
    featureKey: string,
    options?: FeatureFlagOptions
  ) => Promise<string | boolean | undefined>;
}

/**
 * Map a {@link FlagContext} to posthog-node's {@link FeatureFlagOptions}. Only
 * `groups` (e.g. `{ organization: orgId }`) and `properties` are forwarded;
 * `unitId` becomes the distinct id, not an option.
 */
const toFlagOptions = (
  context?: FlagContext
): FeatureFlagOptions | undefined => {
  if (!context) return undefined;
  const options: FeatureFlagOptions = {};
  if (context.groups) options.groups = context.groups;
  if (context.properties) options.personProperties = context.properties;
  return Object.keys(options).length > 0 ? options : undefined;
};

/**
 * Coerce a raw PostHog flag value to the {@link FlagProvider} contract
 * (`boolean | undefined`). A multivariate string (or any non-boolean) is treated
 * as "no boolean opinion" → `undefined`, which resolves to the safe default.
 * The flag mechanisms in this package (gradual rollout, kill-switch) are
 * boolean; multivariate flags are out of scope.
 */
const toBoolean = (value: string | boolean | undefined): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

/**
 * A PostHog-backed {@link FlagProvider}.
 *
 * `getFlag(key, context)` calls {@link getFeatureFlag} with the context's
 * `unitId` as the distinct id (the stable per-user/per-org id used for
 * bucketing) and forwards `groups`/`properties` for targeted release conditions.
 *
 * - Returns the boolean flag value when the client resolves one.
 * - Returns `undefined` when the flag is multivariate, unconfigured, the client
 *   isn't initialized, `unitId` is missing, or the SDK errors — i.e. it never
 *   throws to the caller and never invents a definitive answer. The caller's
 *   {@link resolveFlag}/{@link resolveKillSwitch} owns the safe-default policy.
 *
 * @param deps optional dependency override (used by tests). Defaults to the
 * package's real {@link getFeatureFlag} singleton helper.
 */
export const postHogFlagProvider = (
  deps: PostHogFlagDeps = { getFeatureFlag }
): FlagProvider => ({
  async getFlag(
    key: string,
    context?: FlagContext
  ): Promise<boolean | undefined> {
    // Without a stable unit id PostHog can't bucket — treat as "no opinion"
    // rather than passing an empty/undefined distinct id to the SDK.
    const distinctId = context?.unitId;
    if (!distinctId) return undefined;

    try {
      const raw = await deps.getFeatureFlag(
        distinctId,
        key,
        toFlagOptions(context)
      );
      return toBoolean(raw);
    } catch {
      // Defensive: an SDK/internal error is "no opinion", never a throw. The
      // resolveFlag/resolveKillSwitch layer degrades to the safe default.
      return undefined;
    }
  },
});
