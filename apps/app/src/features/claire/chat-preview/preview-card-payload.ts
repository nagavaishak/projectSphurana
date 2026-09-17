import type { AdPreviewCardState } from './ad-preview-card';
import type { OfferPreviewCardState } from './offer-preview-card';

/**
 * The Window-6 → Window-7 contract: `show_ad_preview` and
 * `show_offer_preview` tools emit a `presentation` envelope on the
 * tool output. The chat-rendering layer keys off `type === 'preview_card'`
 * to mount the right card here.
 *
 * Kept narrowly typed against the cards' state shapes so the renderer
 * fails noisily if Window 6 starts emitting fields the cards don't
 * know about.
 */
export type PreviewCardPayload =
  | {
      type: 'preview_card';
      kind: 'ad';
      draftId: string;
      state: AdPreviewCardState;
    }
  | {
      type: 'preview_card';
      kind: 'offer';
      draftId: string;
      state: OfferPreviewCardState;
    };

const offerDiscountTypes = new Set([
  'percentage',
  'fixed_price',
  'buy_x_get_y',
]);
const offerStates = new Set(['draft', 'active', 'paused', 'expired']);

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

/**
 * Decode a tool-output blob into a typed preview-card payload.
 * Returns `null` if the blob isn't a preview card, or if the shape
 * doesn't validate — keeps the renderer defensive against partial
 * outputs during streaming and against legacy/future tool variants.
 */
export function asPreviewCardPayload(
  output: unknown
): PreviewCardPayload | null {
  if (!output || typeof output !== 'object') return null;
  const presentation = (output as { presentation?: unknown }).presentation;
  if (!presentation || typeof presentation !== 'object') return null;
  const envelope = presentation as Record<string, unknown>;
  if (envelope.type !== 'preview_card') return null;

  const draftId = envelope.draftId;
  if (typeof draftId !== 'string' || draftId.length === 0) return null;

  const state = envelope.state;
  if (!state || typeof state !== 'object') return null;
  const s = state as Record<string, unknown>;

  if (envelope.kind === 'ad') {
    if (typeof s.name !== 'string') return null;
    if (!isStringOrNull(s.headline)) return null;
    if (!isStringOrNull(s.primaryText)) return null;
    if (!isStringOrNull(s.videoId)) return null;
    return {
      type: 'preview_card',
      kind: 'ad',
      draftId,
      state: {
        draftId,
        name: s.name,
        headline: s.headline,
        primaryText: s.primaryText,
        videoId: s.videoId,
      },
    };
  }

  if (envelope.kind === 'offer') {
    if (typeof s.name !== 'string') return null;
    if (!isStringOrNull(s.code)) return null;
    if (typeof s.state !== 'string' || !offerStates.has(s.state)) return null;
    if (
      typeof s.discountType !== 'string' ||
      !offerDiscountTypes.has(s.discountType)
    )
      return null;
    if (!isStringOrNull(s.validFrom)) return null;
    if (!isStringOrNull(s.validUntil)) return null;
    if (!isNumberOrNull(s.discountPercent)) return null;
    if (!isNumberOrNull(s.originalPriceCents)) return null;
    if (!isNumberOrNull(s.offerPriceCents)) return null;
    if (!isNumberOrNull(s.buyQuantity)) return null;
    if (!isNumberOrNull(s.getQuantity)) return null;
    if (typeof s.limitPerClient !== 'boolean') return null;
    if (!isNumberOrNull(s.redemptionLimit)) return null;
    if (!Array.isArray(s.serviceIds)) return null;
    if (!Array.isArray(s.locationIds)) return null;

    return {
      type: 'preview_card',
      kind: 'offer',
      draftId,
      state: {
        draftId,
        name: s.name,
        code: s.code,
        state: s.state as OfferPreviewCardState['state'],
        discountType: s.discountType as OfferPreviewCardState['discountType'],
        validFrom: s.validFrom,
        validUntil: s.validUntil,
        discountPercent: s.discountPercent,
        originalPriceCents: s.originalPriceCents,
        offerPriceCents: s.offerPriceCents,
        buyQuantity: s.buyQuantity,
        getQuantity: s.getQuantity,
        limitPerClient: s.limitPerClient,
        redemptionLimit: s.redemptionLimit,
        serviceIds: s.serviceIds.filter(
          (x): x is string => typeof x === 'string'
        ),
        locationIds: s.locationIds.filter(
          (x): x is string => typeof x === 'string'
        ),
      },
    };
  }

  return null;
}
