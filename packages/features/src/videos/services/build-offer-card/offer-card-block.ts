import type { GeneratedOfferCopy } from '../../../ai-content/services/generate-offer-copy/generate-offer-copy.schema.js';

/**
 * The `offerCard` block of a video draft config. Shape matches
 * `offerCardDraftConfigSchema` in `create-video.schema.ts` and the worker's
 * offer overlay (`apps/video-worker/src/main.ts`), so it can be spread
 * straight onto the draft config.
 */
export interface OfferCardConfig {
  serviceName: string;
  serviceDescription?: string;
  headline?: string;
  originalPriceCents?: number;
  offerPriceCents?: number;
  discountPercent?: number;
  bulletPoints?: string[];
  ctaText: string;
  urgencyText?: string;
  audienceText?: string;
  logoUrl?: string;
  businessName?: string;
  primaryColor?: string;
  secondaryColor?: string;
  currencyCode?: string;
}

export interface OfferCardBlock {
  offerCard: OfferCardConfig;
}

/** Pricing fields carried straight through from the offer row. */
export interface OfferPricing {
  originalPriceCents?: number | null;
  offerPriceCents?: number | null;
  discountPercent?: number | null;
}

export interface BuildOfferCardBlockInput {
  /** AI-generated (or fallback) offer copy. */
  copy: GeneratedOfferCopy;
  /** Pricing read from the offer row — rendered by the offer card template. */
  pricing: OfferPricing;
  /** Service the offer is about; falls back to the copy headline. */
  serviceName?: string | null;
  serviceDescription?: string | null;
  /** Brand colours + logo for the card chrome. */
  brand?: {
    primaryColor?: string | null;
    secondaryColor?: string | null;
    logoUrl?: string | null;
  } | null;
  businessName?: string | null;
  currencyCode?: string | null;
}

/** Fallback brand colours when the org hasn't set any. Matches the wizard. */
const DEFAULT_PRIMARY_COLOR = '#007AFF';
const DEFAULT_SECONDARY_COLOR = '#FFFFFF';

/**
 * Assemble a draft `offerCard` from generated copy + the offer's pricing + the
 * org's branding. Pure + deterministic so the one-prompt creation path (the
 * videos controller, used by Claire) builds the same card the wizard does.
 *
 * Coerces `null` pricing/brand fields → `undefined` so the model/DB nulls
 * never leak into the renderer. Empty `urgencyText` / `audienceText` (the
 * offer-copy schema allows `''`) are dropped rather than rendered blank.
 */
export function buildOfferCardBlock(
  input: BuildOfferCardBlockInput
): OfferCardBlock {
  const {
    copy,
    pricing,
    serviceName,
    serviceDescription,
    brand,
    businessName,
    currencyCode,
  } = input;

  return {
    offerCard: {
      serviceName: serviceName?.trim() || copy.headline,
      ...(serviceDescription?.trim()
        ? { serviceDescription: serviceDescription.trim() }
        : {}),
      headline: copy.headline,
      ...(pricing.originalPriceCents != null
        ? { originalPriceCents: pricing.originalPriceCents }
        : {}),
      ...(pricing.offerPriceCents != null
        ? { offerPriceCents: pricing.offerPriceCents }
        : {}),
      ...(pricing.discountPercent != null
        ? { discountPercent: pricing.discountPercent }
        : {}),
      bulletPoints: copy.bulletPoints,
      ctaText: copy.ctaText || 'Book now',
      ...(copy.urgencyText?.trim() ? { urgencyText: copy.urgencyText } : {}),
      ...(copy.audienceText?.trim() ? { audienceText: copy.audienceText } : {}),
      ...(brand?.logoUrl ? { logoUrl: brand.logoUrl } : {}),
      ...(businessName?.trim() ? { businessName: businessName.trim() } : {}),
      primaryColor: brand?.primaryColor || DEFAULT_PRIMARY_COLOR,
      secondaryColor: brand?.secondaryColor || DEFAULT_SECONDARY_COLOR,
      ...(currencyCode?.trim() ? { currencyCode: currencyCode.trim() } : {}),
    },
  };
}
