/**
 * Service pricing — SOURCE OF TRUTH. Pure TypeScript, no Drizzle/DB imports.
 *
 * Replaces the freeform `organization_service.price_text`. A service's price is
 * a `priceType` + a `priceCents` anchor (all-in, tax-inclusive, in the org's
 * currency); the human display string is DERIVED here via `formatServicePrice`,
 * never stored freeform. See docs/plans/service-pricing-model.md.
 */

export const servicePriceTypeLabels = {
  /** One set price. `priceCents` is that price. */
  fixed: 'Fixed price',
  /** A floor ("From €50"). `priceCents` is the floor; the real price varies. */
  from: 'From',
  /** No charge. */
  free: 'Free',
  /** Price on consultation — unknown/variable, quoted in person. */
  poa: 'Price on consultation',
} as const;

export const servicePriceTypeValues = Object.keys(servicePriceTypeLabels) as [
  keyof typeof servicePriceTypeLabels,
  ...(keyof typeof servicePriceTypeLabels)[],
];

export type ServicePriceType = keyof typeof servicePriceTypeLabels;

/** "€50" for a whole amount, "€12.50" otherwise — no needless trailing .00. */
export const formatMoneyCents = (
  cents: number,
  currencySymbol: string
): string => {
  const whole = cents % 100 === 0;
  return `${currencySymbol}${(cents / 100).toFixed(whole ? 0 : 2)}`;
};

export interface ServicePriceDisplayInput {
  priceType: ServicePriceType;
  /** The anchor. For a variant service the caller passes the min variant price. */
  priceCents: number | null;
  currencySymbol: string;
  /** True when the service has ≥1 priced variant — forces a "From X" display. */
  hasVariants?: boolean;
}

/**
 * The single canonical price string. EVERY surface (booking wizard, venue page,
 * cart, Claire, marketing) derives its display from this — there is no other
 * source of truth for what a price reads as.
 *
 *   fixed  → "€50"
 *   from   → "From €50"   (also when the service has variants)
 *   free   → "Free"
 *   poa    → "Price on consultation"
 *   (no priceCents where one is needed) → falls back to the poa label
 */
export const formatServicePrice = ({
  priceType,
  priceCents,
  currencySymbol,
  hasVariants,
}: ServicePriceDisplayInput): string => {
  if (priceType === 'free') return servicePriceTypeLabels.free;
  if (priceType === 'poa') return servicePriceTypeLabels.poa;

  if (priceCents === null || priceCents === undefined) {
    return servicePriceTypeLabels.poa;
  }

  const money = formatMoneyCents(priceCents, currencySymbol);
  return priceType === 'from' || hasVariants ? `From ${money}` : money;
};
