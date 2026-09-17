/**
 * Shared types for the Window-6 Claire chat tools.
 *
 * These tools wrap the recommendation engine + draft-state services and
 * surface their output to the assistant chat via `defineTool`'s
 * `presentation` channel. Window 7 reads the `preview_card` payload to
 * render the final preview UI; the shape here is the locked contract
 * between Window 6 and Window 7.
 */

/**
 * Preview-card payload — emitted by `show_ad_preview` / `show_offer_preview`.
 * The chat-rendering layer keys off `type` to mount Window 7's component.
 */
export interface PreviewCardPayload {
  // Index signature lets this satisfy `PresentationPayload`'s open variant
  // (Record<string, unknown> & { type: string }). All explicit fields below
  // are unknown-compatible.
  [key: string]: unknown;
  type: 'preview_card';
  kind: 'ad' | 'offer';
  draftId: string;
  /**
   * Snapshot of the draft row at the moment the preview was requested.
   * Window 7 uses this for the initial render; the card refetches via
   * the dedicated endpoint when the user edits a field.
   */
  state: Record<string, unknown>;
}

/**
 * Recommendation-result payload returned by `recommend_service_for_ads`,
 * `recommend_offer_for_service`, and `get_alternative_recommendation`.
 *
 * Strict-JSON output (Decision #11). Claire renders the title/body
 * conversationally; the structured fields drive subsequent tool calls.
 */
export interface ServiceRecommendationOutput {
  serviceId: string;
  serviceName: string;
  rank: number;
  title: string;
  body: string;
  offer: {
    strategy: string;
    suggestedIntroPrice?: number;
    title: string;
    body: string;
  };
  /** True when this is the top-ranked pick. */
  isTopPick: boolean;
  /** True when push memory recorded this as already pushed earlier. */
  alreadyPushed: boolean;
}

export interface OfferRecommendationOutput {
  serviceId: string;
  strategy: string;
  suggestedIntroPrice?: number;
  title: string;
  body: string;
}

/**
 * Draft snapshot returned by every per-field tool so the model can
 * verify the resulting state without an extra fetch.
 */
export interface DraftAdSnapshot {
  draftId: string;
  name: string;
  headline: string | null;
  primaryText: string | null;
  description: string | null;
  callToAction: string | null;
  destinationUrl: string | null;
  serviceIds: string[];
  followUpType: string;
  adPlacement: string;
  metaCampaignId: string | null;
  metaAdsPageId: string | null;
  videoId: string | null;
  targeting: unknown;
  status: string;
}

export interface DraftOfferSnapshot {
  draftId: string;
  name: string;
  code: string | null;
  state: string;
  discountType: string;
  discountPercent: number | null;
  offerPriceCents: number | null;
  originalPriceCents: number | null;
  buyQuantity: number | null;
  getQuantity: number | null;
  limitPerClient: boolean;
  redemptionLimit: number | null;
  validFrom: string | null;
  validUntil: string | null;
  serviceIds: string[];
  locationIds: string[];
}
