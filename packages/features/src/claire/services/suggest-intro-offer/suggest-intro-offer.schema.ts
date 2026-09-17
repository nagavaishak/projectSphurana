import { z } from 'zod';

/**
 * Input for `suggestIntroOffer`.
 *
 * The "intro offer" is the get-in-the-door, new-client-only price Claire builds
 * for the first campaign: 30–40% below the regular one-session price. The owner
 * may state the one-session price directly (Claire asks "what's a single
 * session of X?"); otherwise we parse it from the service's `priceText`.
 */
export const suggestIntroOfferSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  serviceId: z.string().min(1, 'Service ID is required'),
  /**
   * Owner-stated regular price for ONE session, in major currency units
   * (euros/pounds). Pass this when the owner gives a number in chat or when the
   * service's `priceText` can't be parsed.
   */
  oneSessionPrice: z.coerce.number().positive().optional(),
  /**
   * Owner-stated intro/offer price, in major currency units. Pass this when the
   * owner wants to set the first-visit price themselves instead of taking the
   * 30–40%-below suggestion. When given, it's used verbatim and the discount is
   * derived from `oneSessionPrice` (if known).
   */
  offerPrice: z.coerce.number().positive().optional(),
  /**
   * Target intro discount, clamped to the 30–40% "get in the door" band per
   * the offer-construction spec. Defaults to 35% (the middle of the band).
   * Ignored when `offerPrice` is supplied.
   */
  targetDiscountPercent: z.coerce
    .number()
    .int()
    .min(30)
    .max(40)
    .optional()
    .default(35),
});

// `z.input` (not `z.infer`/`z.output`) so the `.default()`-ed
// `targetDiscountPercent` stays OPTIONAL for callers — the service applies the
// default internally via `safeParse`. Using the output type would force every
// caller (e.g. the Claire tool) to supply it.
export type SuggestIntroOfferInput = z.input<typeof suggestIntroOfferSchema>;

/** A ready-to-create new-client intro offer. */
export interface SuggestedIntroOffer {
  name: string;
  discountType: 'fixed_price';
  /** The regular one-session price. Absent when only the offer price is known. */
  originalPriceCents?: number;
  offerPriceCents: number;
  /** Derived discount. Absent when the regular price isn't known. */
  discountPercent?: number;
  audienceText: string;
  limitPerClient: true;
  /** Plain-language "what this is + why we do it" for Claire to relay. */
  why: string;
}

/** An existing offer that already works as an intro offer. */
export interface ExistingIntroFit {
  offerId: string;
  name: string;
  originalPriceCents: number | null;
  offerPriceCents: number | null;
  discountPercent: number | null;
  /** Discount inferred from price pair when `discountPercent` is null. */
  impliedDiscountPercent: number | null;
  reason: string;
}

export interface SuggestIntroOfferOutput {
  serviceId: string;
  serviceName: string;
  /**
   * `false` for POM / surgical services — those don't get a cold-traffic price
   * offer (POM can't be advertised; surgical sells the consultation). Claire
   * explains via `advisoryReason` instead of proposing a price.
   */
  advisable: boolean;
  advisoryReason?: string;
  /** `true` → Claire should ask the owner the one-session price, then re-call. */
  needsPrice: boolean;
  oneSessionPriceCents?: number;
  /**
   * Where `oneSessionPriceCents` came from:
   *   - `'owner'`  — the owner stated it (passed `oneSessionPrice`/`offerPrice`).
   *   - `'parsed'` — pulled from the service's freeform `priceText`. Claire
   *     should PRESENT it for confirmation ("your regular price is €X, so I'd
   *     run the intro at €Y — happy with that?") rather than commit silently,
   *     because `priceText` can be noisy (per-area lists, "from €X", packages).
   * Absent when `needsPrice` is true (no price anywhere).
   */
  priceSource?: 'owner' | 'parsed';
  targetDiscountPercent: number;
  /** The best existing active offer that already works as an intro, if any. */
  existingFit: ExistingIntroFit | null;
  /** A fresh intro offer to create, when advisable and the price is known. */
  suggested: SuggestedIntroOffer | null;
}
