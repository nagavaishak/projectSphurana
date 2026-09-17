/**
 * THE booking payment resolver — what a customer is charged at booking time.
 *
 * This lives in web-shared, not in `features`, because BOTH sides need it: the
 * API computes the real charge, and the booking UI must show the customer the
 * same number before they commit. `features` cannot be bundled into the
 * marketing app (it pulls in the whole database package), so the alternative
 * was a copy — and this file was briefly copied during the Phase 2 booking
 * port.
 *
 * A copy is specifically dangerous HERE. A paraphrase of this logic is what
 * produced the "Pay deposit & book" button that charged nothing: the UI and the
 * server disagreed about the amount, and nothing failed. One implementation,
 * imported by both, is the only version of this that cannot drift.
 *
 * `features` re-exports it so existing imports and its test suite are
 * unchanged.
 */

import type {
  DepositAggregation,
  DepositBasis,
  ServicePaymentPolicy,
  ServicePriceType,
} from '@borradh-workspace/labels';

/**
 * Stripe rejects charges below roughly this in any supported currency, so a
 * computed deposit under it cannot be collected. Falling back to "no payment
 * online" beats failing the booking over 30 cents.
 */
export const MIN_CHARGEABLE_CENTS = 50;

/** The org-level defaults every service inherits when it sets none of its own. */
export interface BookingPaymentDefaults {
  defaultPaymentPolicy: ServicePaymentPolicy;
  defaultDepositBasis: DepositBasis;
  defaultDepositAmountCents: number | null;
  defaultDepositPercent: number | null;
  depositAggregation: DepositAggregation;
}

/** One booked service, as both the booking flow and Claire's quoting see it. */
export interface BookingPaymentService {
  priceType: ServicePriceType;
  priceCents: number | null;
  paymentPolicy: ServicePaymentPolicy | null;
  depositBasis: DepositBasis | null;
  depositAmountCents: number | null;
  depositPercent: number | null;
}

export interface ResolvedBookingPayment {
  /** What to charge online, in cents. 0 means "nothing due at booking". */
  amountCents: number;
  /**
   * Why. `mixed` means at least one service prepays in full and another takes a
   * deposit — the amount is the sum, and the remainder is still due at the POS.
   */
  reason: 'none' | 'deposit' | 'full' | 'mixed';
}

/**
 * `full` prepay needs the EXACT price — you cannot charge the whole of a number
 * you don't know. `from` is a floor and `poa` has none, so neither can prepay.
 */
export const canPrepayInFull = (service: BookingPaymentService): boolean =>
  service.priceType === 'fixed' &&
  service.priceCents !== null &&
  service.priceCents > 0;

/**
 * A percentage only needs SOME base, and a `from` floor is a legitimate one —
 * 20% of "from €150" is €30, which under-states the eventual deposit rather
 * than over-stating it. Under-charging is the safe direction: the booking is
 * still secured and nobody is asked for more than their share.
 *
 * That matters commercially — 801 of 1,717 active services are `from` or `poa`,
 * so refusing `from` would put percentage deposits out of reach for nearly half
 * the catalogue.
 *
 * `poa` still resolves to nothing: there is no number to take a percentage of.
 */
export const hasPercentBase = (service: BookingPaymentService): boolean =>
  (service.priceType === 'fixed' || service.priceType === 'from') &&
  service.priceCents !== null &&
  service.priceCents > 0;

/** A percentage deposit is always rounded UP to a whole multiple of this. */
export const DEPOSIT_ROUNDING_CENTS = 50;

/**
 * Round UP to the next whole 50 minor units, so a computed percentage always
 * lands on a round, sayable figure — €2.46 → €2.50, €2.52 → €3.00.
 *
 * Up rather than to-nearest on purpose: rounding down would let a percentage
 * deposit come out below the clinic's intent, and (at small prices) below the
 * amount Stripe will accept at all. An exact multiple is left alone.
 *
 * Applies to PERCENTAGE deposits only. A flat amount is a figure the clinic
 * typed and is charged exactly as entered, and `full` prepay is the real price —
 * rounding either up would overcharge.
 */
export const roundDepositUp = (cents: number): number =>
  Math.ceil(cents / DEPOSIT_ROUNDING_CENTS) * DEPOSIT_ROUNDING_CENTS;

/**
 * The deposit for ONE service, or null when it cannot be computed.
 *
 * Null is not zero: a service configured for a percentage deposit whose price
 * is `poa` yields null, and the caller treats that as "nothing collectable
 * online" rather than "a free booking".
 */
export const serviceDepositCents = (
  service: BookingPaymentService,
  defaults: BookingPaymentDefaults
): number | null => {
  const basis = service.depositBasis ?? defaults.defaultDepositBasis;

  if (basis === 'percent') {
    const pct = service.depositPercent ?? defaults.defaultDepositPercent;
    if (pct === null || pct <= 0) return null;
    if (!hasPercentBase(service)) return null;
    // priceCents is non-null by hasPercentBase. For a `from` service this is
    // the floor, so the deposit under-states rather than over-states.
    return roundDepositUp(((service.priceCents as number) * pct) / 100);
  }

  const fixed =
    service.depositAmountCents ?? defaults.defaultDepositAmountCents;
  return fixed !== null && fixed > 0 ? fixed : null;
};

/**
 * THE single answer to "what does this booking cost online?", shared by the
 * booking flow, Claire's quoting, and the public booking config.
 *
 * Sharing it is the point: these previously ran two different resolution chains
 * that agreed on one field, so Claire could quote €50 while the booking charged
 * €100. A quote that disagrees with the charge is worse than no quote.
 */
export const resolveBookingPayment = (
  services: readonly BookingPaymentService[],
  defaults: BookingPaymentDefaults
): ResolvedBookingPayment => {
  let fullCents = 0;
  const depositAmounts: number[] = [];

  for (const service of services) {
    const policy = service.paymentPolicy ?? defaults.defaultPaymentPolicy;

    if (policy === 'in_clinic') continue;

    if (policy === 'full') {
      // A service whose exact price is unknown cannot be prepaid. Rather than
      // refuse the booking, it falls back to its deposit — the service form
      // blocks this combination, so it only arises if a price was edited to
      // `from`/`poa` after the policy was set.
      if (canPrepayInFull(service)) {
        fullCents += service.priceCents as number;
        continue;
      }
      const fallback = serviceDepositCents(service, defaults);
      if (fallback !== null) depositAmounts.push(fallback);
      continue;
    }

    const deposit = serviceDepositCents(service, defaults);
    if (deposit !== null) depositAmounts.push(deposit);
  }

  // Deposits combine per the org's rule; prepaid-in-full services always sum,
  // because each is the whole price of a distinct piece of work.
  const depositCents =
    depositAmounts.length === 0
      ? 0
      : defaults.depositAggregation === 'sum'
        ? depositAmounts.reduce((sum, amount) => sum + amount, 0)
        : Math.max(...depositAmounts);

  const amountCents = fullCents + depositCents;

  // Below Stripe's floor there is nothing collectable; treat it as pay-in-clinic
  // rather than opening a checkout that will be declined.
  if (amountCents < MIN_CHARGEABLE_CENTS) {
    return { amountCents: 0, reason: 'none' };
  }

  const reason =
    fullCents > 0 && depositCents > 0
      ? 'mixed'
      : fullCents > 0
        ? 'full'
        : 'deposit';

  return { amountCents, reason };
};
