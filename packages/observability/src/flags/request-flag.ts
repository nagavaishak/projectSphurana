/**
 * Request-scoped server-side flag accessor — the one-call way to read a flag in
 * the API. Combines the per-request user/org context (AsyncLocalStorage, set by
 * the RLS interceptor) with the PostHog adapter + the safe-fallback resolver, so
 * a service/controller just writes `await isFeatureOn('my-flag')`.
 *
 * Rollout unit precedence: organization id (so "10% of orgs" is the default,
 * coherent rollout unit) → user id. The org is also sent as a PostHog `group`.
 * Outside a request context (no org/user) it resolves to the safe default (off)
 * without throwing — a flag-eval miss must never crash a request.
 *
 * Global killswitch: if the `global-killswitch` flag is ON (rollout_percentage >
 * 0), ALL isFeatureOn() calls return false immediately — a single PostHog toggle
 * reverts every flag-gated code path without touching individual flags.
 */
import { getCurrentOrganizationId, getCurrentUserId } from '../context.js';
import { postHogFlagProvider } from './posthog-provider.js';
import { type FlagProvider, resolveFlag } from './provider.js';

export interface IsFeatureOnOptions {
  /** Safe default when the flag has no opinion / eval fails. Default: false. */
  defaultEnabled?: boolean;
  /** Override the provider (tests inject `withFlags`/`staticProvider`). */
  provider?: FlagProvider;
  /** Override the rollout unit (defaults to current org → user). */
  unitId?: string;
}

export const GLOBAL_KILLSWITCH_KEY = 'global-killswitch';

// The real PostHog-backed provider is constructed once, lazily — it reads no
// config itself (it goes through the already-initialized posthog-node client).
let defaultProvider: FlagProvider | undefined;
const getDefaultProvider = (): FlagProvider => {
  defaultProvider ??= postHogFlagProvider();
  return defaultProvider;
};

/**
 * Resolve a feature flag for the current request. Always returns a definitive
 * boolean (never throws): on a missing unit, a no-opinion flag, or an eval
 * error it returns `options.defaultEnabled ?? false`.
 *
 * Skips evaluation and returns `false` if the global killswitch is active.
 */
export const isFeatureOn = async (
  key: string,
  options: IsFeatureOnOptions = {}
): Promise<boolean> => {
  // The global killswitch bypasses individual flag checks — skip for the
  // killswitch itself to avoid infinite recursion.
  const provider = options.provider ?? getDefaultProvider();
  if (key !== GLOBAL_KILLSWITCH_KEY) {
    const orgId = getCurrentOrganizationId();
    const currentUserId = getCurrentUserId();
    const userId = currentUserId === 'anonymous' ? undefined : currentUserId;
    const unitId = options.unitId ?? orgId ?? userId;
    const killswitchActive = await resolveFlag(
      provider,
      GLOBAL_KILLSWITCH_KEY,
      { unitId, groups: orgId ? { organization: orgId } : undefined },
      { defaultEnabled: false }
    );
    if (killswitchActive) return false;
  }

  const orgId = getCurrentOrganizationId();
  const currentUserId = getCurrentUserId();
  const userId = currentUserId === 'anonymous' ? undefined : currentUserId;
  const unitId = options.unitId ?? orgId ?? userId;

  return resolveFlag(
    provider,
    key,
    {
      unitId,
      groups: orgId ? { organization: orgId } : undefined,
    },
    { defaultEnabled: options.defaultEnabled ?? false }
  );
};
