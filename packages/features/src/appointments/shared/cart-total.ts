/**
 * Pure cart-total arithmetic for a multi-service appointment (the Fresha "cart").
 *
 * Prices are per-line snapshots (`appointment_service.priceCents`) and any line
 * MAY be unpriced (`priceCents = null`) — a "POA"/consultation service, or a
 * catalog row that only carries a freeform `priceText`. The total is therefore
 * only ever EXACT when every line is priced; otherwise we mirror Fresha's
 * "from £X" display, summing just the known lines.
 */

/** The only field of a line item this helper reads. */
export interface CartLineItemPrice {
  priceCents?: number | null;
}

export interface CartTotal {
  /**
   * The exact grand total in cents, or `null` when at least one line is
   * unpriced (an exact total cannot be claimed).
   */
  totalCents: number | null;
  /** True only when EVERY line has a `priceCents`. */
  isExact: boolean;
  /**
   * Sum of the KNOWN line prices — the "from £X" figure. `null` only when no
   * line carries a price at all (nothing to show a "from" for).
   */
  fromCents: number | null;
}

/**
 * Compute the cart total from line-item prices.
 *
 * - All lines priced → `{ totalCents: S, isExact: true, fromCents: S }`.
 * - Some priced      → `{ totalCents: null, isExact: false, fromCents: sumKnown }`.
 * - None priced (or empty) → `{ totalCents: null, isExact: false, fromCents: null }`.
 */
export function computeCartTotal(
  items: ReadonlyArray<CartLineItemPrice>
): CartTotal {
  const knownPrices = items
    .map((item) => item.priceCents)
    .filter((price): price is number => price != null);

  const knownSum = knownPrices.reduce((sum, price) => sum + price, 0);

  // Vacuous truth guard: an empty cart is NOT an exact £0.00 total.
  const isExact = items.length > 0 && knownPrices.length === items.length;

  if (isExact) {
    return { totalCents: knownSum, isExact: true, fromCents: knownSum };
  }

  return {
    totalCents: null,
    isExact: false,
    fromCents: knownPrices.length > 0 ? knownSum : null,
  };
}
