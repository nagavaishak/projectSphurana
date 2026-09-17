import type { AssistantRecommendationKind } from '@borradh-workspace/database';
import type { GeneratedPayload } from './generate-recommendation-payload.schema.js';

/**
 * Generic, pre-reviewed fallback copy used when the LLM is unavailable or
 * when its output fails the D2b regex validator after retries. Every active
 * `prompt_*` kind has a fallback so the trigger still ships a safe (if
 * generic) recommendation.
 *
 * Only `prompt_create_first_ad` has a fallback in v2. The others (offer,
 * video, graphic, post) land in v2.1/v2.2 with their own triggers.
 */
export const STATIC_FALLBACKS: Partial<
  Record<AssistantRecommendationKind, GeneratedPayload>
> = {
  prompt_create_first_ad: {
    title: 'Ready to create your first ad',
    body: "Let's get your first campaign live. I'll walk you through it.",
  },
  prompt_create_first_offer: {
    title: 'Set up your first offer',
    body: "Offers help fill quiet slots and build loyalty. I'll walk you through creating one.",
  },
  prompt_record_first_video: {
    title: 'Create your first video',
    body: "Video is the highest-converting format for clinic marketing. I'll walk you through making one.",
  },
  prompt_create_first_post: {
    title: 'Schedule your first social post',
    body: "Consistent posting keeps your clinic visible between appointments. I'll walk you through scheduling one.",
  },
  no_show_surge: {
    title: 'No-show rate is up this week',
    body: "More clients didn't turn up this week than last. Worth a look at your reminder cadence and deposit policy.",
  },
  offer_expiring_soon: {
    title: 'Offers expiring this week',
    body: 'You have offers ending in the next 7 days. Decide whether to extend them, replace them, or let them lapse.',
  },
  cpl_spike: {
    title: 'Your CPL is climbing',
    body: 'One of your campaigns is paying more per lead than it was last week. Worth a look — open me and I can walk you through what changed.',
  },
  creative_burnout: {
    title: 'Time to refresh your ad creative',
    body: "Your audience is seeing the same ad too often. Swap in a fresh video or image and frequency comes back down. I'll help you pick where to start.",
  },
  lead_volume_drop: {
    title: 'Lead volume dropped this week',
    body: "Fewer leads came in this week than last. Could be spend, could be the audience, could be seasonal. Open me and we'll check.",
  },
};

export function getStaticFallback(
  kind: AssistantRecommendationKind
): GeneratedPayload {
  return (
    STATIC_FALLBACKS[kind] ?? {
      title: 'Something to look at',
      body: "I've got a suggestion for you — tap to start.",
    }
  );
}
