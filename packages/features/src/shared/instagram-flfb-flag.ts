import { apiEnv } from '@borradh-workspace/env/api';
import { isFeatureEnabled } from '@borradh-workspace/observability';

/**
 * PostHog kill-switch for routing Instagram operations through the Facebook
 * Page's FLfB **system-user** token (graph.facebook.com / Messenger Platform)
 * instead of the legacy standalone Instagram-Login token (graph.instagram.com).
 *
 * Resolution order:
 *  1. `INSTAGRAM_FLFB_ROUTING=true` env override → on for ALL orgs. Used to
 *     demo IG publishing locally without per-org PostHog targeting.
 *  2. Otherwise the PostHog flag, targetable per-org via the `organization`
 *     group for gradual rollout.
 *
 * Default-OFF: when the override is unset and the flag is absent / PostHog is
 * unreachable, `isFeatureEnabled` returns false → the legacy path runs
 * unchanged. Flip the flag OFF in PostHog to instantly roll back with no deploy.
 */
export const INSTAGRAM_FLFB_ROUTING_FLAG = 'instagram-flfb-routing';

export const isInstagramFlfbRoutingEnabled = (
  organizationId: string
): Promise<boolean> => {
  if (apiEnv.INSTAGRAM_FLFB_ROUTING) return Promise.resolve(true);
  return isFeatureEnabled(organizationId, INSTAGRAM_FLFB_ROUTING_FLAG, {
    groups: { organization: organizationId },
  });
};
