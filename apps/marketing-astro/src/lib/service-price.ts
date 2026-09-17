/**
 * Service price display — inlined mirror of `formatServicePrice` from
 * `@borradh-workspace/labels`.
 *
 * The marketing app deliberately depends on NO `@borradh-workspace/*` package
 * (importing api-client would pull in the whole backend features + database
 * tree), so this small pure formatter is duplicated here rather than imported.
 * Keep it in lockstep with the labels package — it is the ONE way marketing
 * renders a service price, replacing the deprecated freeform `pricingDescription`.
 */

import type {
  ServicePriceType,
  ServiceVariant,
} from '@/features/booking-forms';

const PRICE_TYPE_LABELS: Record<ServicePriceType, string> = {
  fixed: 'Fixed price',
  from: 'From',
  free: 'Free',
  poa: 'Price on consultation',
};

/** "€50" for a whole amount, "€12.50" otherwise. */
function formatMoneyCents(cents: number, currencySymbol: string): string {
  const whole = cents % 100 === 0;
  return `${currencySymbol}${(cents / 100).toFixed(whole ? 0 : 2)}`;
}

export interface ServicePriceDisplayInput {
  priceType: ServicePriceType;
  priceCents: number | null;
  currencySymbol: string;
  hasVariants?: boolean;
}

/**
 *   fixed → "€50"    from → "From €50"    free → "Free"    poa → "Price on consultation"
 * `hasVariants` (≥1 priced option) forces a "From X" display.
 */
export function formatServicePrice({
  priceType,
  priceCents,
  currencySymbol,
  hasVariants,
}: ServicePriceDisplayInput): string {
  if (priceType === 'free') return PRICE_TYPE_LABELS.free;
  if (priceType === 'poa') return PRICE_TYPE_LABELS.poa;
  if (priceCents == null) return PRICE_TYPE_LABELS.poa;

  const money = formatMoneyCents(priceCents, currencySymbol);
  return priceType === 'from' || hasVariants ? `From ${money}` : money;
}

/** Whether a service carries ≥1 pricing option. */
export function hasServiceVariants(variants: ServiceVariant[]): boolean {
  return variants.length > 0;
}
