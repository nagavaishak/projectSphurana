import type { RankedService } from '@borradh-workspace/database';

/**
 * Where Window-6 chat tools source the per-field defaults that pre-fill a
 * brand-new draft ad/offer. Callers pass the LIVE ranked list (from
 * `recomputeRanking(profile, services)`) so the chat surface and the
 * `/ads/new` widget always agree AND reflect the current ranking code, not a
 * frozen classification snapshot.
 *
 * If the recommendation engine ranked nothing (empty list), returns null and
 * the caller must surface a "no first-treatment pick available" message — we
 * do NOT fabricate defaults from nothing.
 */
export const pickDefaultRankedService = (
  ranked: RankedService[],
  serviceId?: string
): RankedService | null => {
  if (ranked.length === 0) return null;
  if (serviceId) {
    const match = ranked.find((r) => r.serviceId === serviceId);
    if (match) return match;
  }
  // sort ascending by rank so [0] is the top pick.
  return [...ranked].sort((a, b) => a.rank - b.rank)[0] ?? null;
};

/**
 * Default ad-name template. Internal label only — operators rename it in
 * the preview card if they want.
 */
export const buildDefaultAdName = (input: {
  serviceName: string;
}): string => {
  const date = new Date().toISOString().slice(0, 10);
  return `Claire draft — ${input.serviceName} (${date})`;
};

/**
 * Default offer name template, used when the user hasn't picked a name
 * themselves.
 */
export const buildDefaultOfferName = (input: {
  serviceName: string;
}): string => `${input.serviceName} intro`;

/**
 * 60-second-decision defaults for the offer copy stretch — a 30-day intro
 * window starting today. The owner can override either end of the window
 * via `set_pending_offer_validity`.
 */
export const buildDefaultValidity = (): {
  validFrom: Date;
  validUntil: Date;
} => {
  const validFrom = new Date();
  const validUntil = new Date(validFrom);
  validUntil.setDate(validUntil.getDate() + 30);
  return { validFrom, validUntil };
};

/**
 * Hard fallback intro price (in currency units) used only when the ranked
 * service carries no `suggestedIntroPrice` AND no
 * `ownerEstimatedCompetitorPrice` to derive one from. Deliberately concrete
 * so a brand-new draft always has a "Just €X" anchor the owner can correct,
 * rather than a vague percentage that "feels cheap".
 */
export const FALLBACK_INTRO_PRICE = 49;

/**
 * Fraction of the "was" anchor used to derive an intro ("now") price when the
 * ranked service has a competitor-price anchor but no explicit intro price.
 */
const INTRO_DISCOUNT_FACTOR = 0.8;

/**
 * Multiplier applied to a known intro price to synthesise a "was" anchor when
 * the ranked service gives us an intro price but no original/competitor price.
 * Keeps a visible was→now gap without inventing percentages.
 */
const ANCHOR_MARKUP_FACTOR = 1.25;

const toCents = (amount: number): number => Math.round(amount * 100);

/**
 * Per Decision #15 + the discount-format spec ("Was €X → now €X" / "Just €X",
 * never "% off"): every default draft offer is a **fixed-price intro**, never
 * a percentage. We always populate both `offerPriceCents` (the "now"/just
 * price) and `originalPriceCents` (the "was" anchor) so the was→now framing
 * can render. Inputs are sourced strictly from the ranked service:
 *
 * - `suggestedIntroPrice` → the "now" price when present.
 * - `ownerEstimatedCompetitorPrice` → the "was" anchor when present.
 *
 * When only one is known we derive the other; when neither is known we fall
 * back to `FALLBACK_INTRO_PRICE`. We never fabricate a percentage.
 */
export const buildDefaultOfferPricing = (
  ranked: RankedService
): {
  discountType: 'fixed_price';
  offerPriceCents: number;
  originalPriceCents: number;
  discountPercent: null;
  buyQuantity: null;
  getQuantity: null;
} => {
  const intro =
    typeof ranked.suggestedIntroPrice === 'number'
      ? ranked.suggestedIntroPrice
      : typeof ranked.ownerEstimatedCompetitorPrice === 'number'
        ? ranked.ownerEstimatedCompetitorPrice * INTRO_DISCOUNT_FACTOR
        : FALLBACK_INTRO_PRICE;

  // The "was" anchor: prefer the owner's competitor estimate; otherwise mark
  // up the intro price so a was→now gap still exists.
  const rawAnchor =
    typeof ranked.ownerEstimatedCompetitorPrice === 'number'
      ? ranked.ownerEstimatedCompetitorPrice
      : intro * ANCHOR_MARKUP_FACTOR;

  // Guarantee the anchor sits strictly above the intro price so "Was €X → now
  // €Y" always reads as a genuine reduction.
  const anchor = rawAnchor > intro ? rawAnchor : intro * ANCHOR_MARKUP_FACTOR;

  return {
    discountType: 'fixed_price',
    offerPriceCents: toCents(intro),
    originalPriceCents: toCents(anchor),
    discountPercent: null,
    buyQuantity: null,
    getQuantity: null,
  };
};
