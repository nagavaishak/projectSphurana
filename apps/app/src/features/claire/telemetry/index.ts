import { trackEvent } from '@/components/posthog-provider';

/**
 * Window 8 — client-side recommendation funnel events.
 *
 * Mirrors `packages/features/src/claire/telemetry` (server side). Use this
 * module in the `/ads/new` widget + chat preview cards where the impression
 * and edit signals don't naturally pass through a server tool.
 *
 * No PII: pass IDs and enums only. The wrapper is non-blocking — `trackEvent`
 * itself silently drops the call when PostHog isn't initialised.
 */

export type ClaireSurface = 'ads_new' | 'chat';
export type ClaireRecommendationKind =
  | 'ad_flow_service_pick'
  | 'ad_flow_offer_pick';

interface BaseRecommendationProps {
  surface: ClaireSurface;
  kind: ClaireRecommendationKind;
  rankedServiceId: string;
  rank: number;
  marketPosition?: 'below' | 'at' | 'above' | 'unknown';
  offerStrategy?:
    | 'price_visible_intro'
    | 'switch_service'
    | 'price_hidden_conversation'
    | 'consultation_led'
    | 'do_not_advertise';
}

const flatten = (props: object): Record<string, unknown> => ({
  ...(props as Record<string, unknown>),
});

export const trackRecommendationImpression = (
  props: BaseRecommendationProps
): void => {
  trackEvent('claire.recommendation.impression', flatten(props));
};

export const trackRecommendationAccepted = (
  props: BaseRecommendationProps & { acceptedAtRank: number }
): void => {
  trackEvent('claire.recommendation.accepted', flatten(props));
};

export const trackRecommendationDismissed = (
  props: BaseRecommendationProps & {
    dismissReason: 'show_alternative' | 'skipped' | 'override';
  }
): void => {
  trackEvent('claire.recommendation.dismissed', flatten(props));
};

export const trackRecommendationEdited = (
  props: BaseRecommendationProps & {
    acceptedAtRank: number;
    editedFields: string[];
  }
): void => {
  // Arrays don't survive PostHog's event-properties schema cleanly; project
  // to a comma-joined string + a count for dashboard filtering.
  trackEvent('claire.recommendation.edited', {
    ...flatten({
      ...props,
      editedFields: props.editedFields.slice().sort().join(','),
    }),
    editedFieldCount: props.editedFields.length,
  });
};

export const trackRecommendationAbandoned = (
  props: BaseRecommendationProps & {
    state: 'never_accepted' | 'accepted_not_published';
  }
): void => {
  trackEvent('claire.recommendation.abandoned', flatten(props));
};

export const trackRecommendationPublished = (
  props: BaseRecommendationProps & {
    acceptedAtRank: number;
    publishedAdId?: string;
    publishedOfferId?: string;
    secondsFromImpression: number;
  }
): void => {
  trackEvent('claire.recommendation.published', flatten(props));
};
