import { describe, expect, it } from '@borradh-workspace/testing';
import {
  type BookingPaymentDefaults,
  type BookingPaymentService,
  resolveBookingPayment,
} from './resolve-booking-payment.js';

const defaults = (
  overrides: Partial<BookingPaymentDefaults> = {}
): BookingPaymentDefaults => ({
  defaultPaymentPolicy: 'in_clinic',
  defaultDepositBasis: 'fixed',
  defaultDepositAmountCents: null,
  defaultDepositPercent: null,
  depositAggregation: 'largest',
  ...overrides,
});

const service = (
  overrides: Partial<BookingPaymentService> = {}
): BookingPaymentService => ({
  priceType: 'fixed',
  priceCents: 10_000,
  paymentPolicy: null,
  depositBasis: null,
  depositAmountCents: null,
  depositPercent: null,
  ...overrides,
});

describe('resolveBookingPayment', () => {
  it('charges nothing for a pay-at-the-clinic booking', () => {
    const result = resolveBookingPayment([service()], defaults());
    expect(result).toEqual({ amountCents: 0, reason: 'none' });
  });

  it('takes a flat per-service deposit', () => {
    const result = resolveBookingPayment(
      [service({ paymentPolicy: 'deposit', depositAmountCents: 5000 })],
      defaults()
    );
    expect(result).toEqual({ amountCents: 5000, reason: 'deposit' });
  });

  it('takes a percentage of the price', () => {
    const result = resolveBookingPayment(
      [
        service({
          paymentPolicy: 'deposit',
          depositBasis: 'percent',
          depositPercent: 20,
          priceCents: 12_500,
        }),
      ],
      defaults()
    );
    expect(result).toEqual({ amountCents: 2500, reason: 'deposit' });
  });

  describe('percentage rounding', () => {
    const atPrice = (priceCents: number) =>
      resolveBookingPayment(
        [
          service({
            paymentPolicy: 'deposit',
            depositBasis: 'percent',
            depositPercent: 20,
            priceCents,
          }),
        ],
        defaults()
      ).amountCents;

    it('rounds up to the next 50c', () => {
      // 20% of €12.30 = €2.46
      expect(atPrice(1230)).toBe(250);
    });

    it('rounds up even when it is only just past a boundary', () => {
      // 20% of €12.60 = €2.52 → €3.00, not €2.50. Up, never to-nearest:
      // rounding down would put the deposit below the clinic's intent.
      expect(atPrice(1260)).toBe(300);
    });

    it('leaves an exact multiple alone', () => {
      // 20% of €100 = €20.00
      expect(atPrice(10_000)).toBe(2000);
    });

    it('lifts a tiny percentage to a chargeable amount', () => {
      // 20% of €1 = 20c, which Stripe would decline. Rounding up to 50c makes
      // it collectable instead of silently dropping to pay-in-clinic.
      expect(atPrice(100)).toBe(50);
    });
  });

  it('inherits the org policy and amount when the service sets none', () => {
    const result = resolveBookingPayment(
      [service()],
      defaults({
        defaultPaymentPolicy: 'deposit',
        defaultDepositAmountCents: 3000,
      })
    );
    expect(result).toEqual({ amountCents: 3000, reason: 'deposit' });
  });

  it('lets a service opt OUT of an org-wide deposit', () => {
    // The thing today's `requiresDeposit: false` cannot express — it means
    // "don't add mine", after which the org default applies anyway.
    const result = resolveBookingPayment(
      [service({ paymentPolicy: 'in_clinic' })],
      defaults({
        defaultPaymentPolicy: 'deposit',
        defaultDepositAmountCents: 3000,
      })
    );
    expect(result).toEqual({ amountCents: 0, reason: 'none' });
  });

  describe('percentage needs a base to work from', () => {
    it('uses the floor of a `from`-priced service', () => {
      // 20% of "from €50" = €10. Under-states the eventual deposit rather than
      // over-stating it, which is the safe direction — and refusing `from`
      // would put percentages out of reach for ~half the catalogue.
      const result = resolveBookingPayment(
        [
          service({
            priceType: 'from',
            priceCents: 5000,
            paymentPolicy: 'deposit',
            depositBasis: 'percent',
            depositPercent: 20,
          }),
        ],
        defaults()
      );
      expect(result).toEqual({ amountCents: 1000, reason: 'deposit' });
    });

    it('collects nothing on a `poa` service', () => {
      const result = resolveBookingPayment(
        [
          service({
            priceType: 'poa',
            priceCents: null,
            paymentPolicy: 'deposit',
            depositBasis: 'percent',
            depositPercent: 20,
          }),
        ],
        defaults()
      );
      expect(result).toEqual({ amountCents: 0, reason: 'none' });
    });

    it('still takes the flat amount when one is configured', () => {
      const result = resolveBookingPayment(
        [
          service({
            priceType: 'poa',
            priceCents: null,
            paymentPolicy: 'deposit',
            depositAmountCents: 5000,
          }),
        ],
        defaults()
      );
      expect(result).toEqual({ amountCents: 5000, reason: 'deposit' });
    });
  });

  describe('several services on one appointment', () => {
    const three = [
      service({ paymentPolicy: 'deposit', depositAmountCents: 5000 }),
      service({ paymentPolicy: 'deposit', depositAmountCents: 5000 }),
      service({ paymentPolicy: 'deposit', depositAmountCents: 3000 }),
    ];

    it('charges the largest single deposit by default', () => {
      // One appointment is one no-show risk; €130 to hold a slot the
      // single-service customer holds for €50 penalises the best basket.
      const result = resolveBookingPayment(three, defaults());
      expect(result).toEqual({ amountCents: 5000, reason: 'deposit' });
    });

    it('sums them for an org still configured that way', () => {
      const result = resolveBookingPayment(
        three,
        defaults({ depositAggregation: 'sum' })
      );
      expect(result).toEqual({ amountCents: 13_000, reason: 'deposit' });
    });
  });

  describe('full prepay', () => {
    it('charges the whole price', () => {
      const result = resolveBookingPayment(
        [service({ paymentPolicy: 'full', priceCents: 8000 })],
        defaults()
      );
      expect(result).toEqual({ amountCents: 8000, reason: 'full' });
    });

    it('sums across several prepaid services', () => {
      // Unlike deposits these always sum: each is the whole price of a
      // distinct piece of work, not a repeated no-show charge.
      const result = resolveBookingPayment(
        [
          service({ paymentPolicy: 'full', priceCents: 8000 }),
          service({ paymentPolicy: 'full', priceCents: 2000 }),
        ],
        defaults()
      );
      expect(result).toEqual({ amountCents: 10_000, reason: 'full' });
    });

    it('adds a deposit alongside a prepaid service and reports `mixed`', () => {
      const result = resolveBookingPayment(
        [
          service({ paymentPolicy: 'full', priceCents: 8000 }),
          service({ paymentPolicy: 'deposit', depositAmountCents: 2000 }),
        ],
        defaults()
      );
      expect(result).toEqual({ amountCents: 10_000, reason: 'mixed' });
    });

    it('falls back to the deposit when the price stopped being resolvable', () => {
      // Reachable only if the price was edited to `poa` after the policy was
      // set — the service form blocks the combination up front.
      const result = resolveBookingPayment(
        [
          service({
            paymentPolicy: 'full',
            priceType: 'poa',
            priceCents: null,
            depositAmountCents: 2500,
          }),
        ],
        defaults()
      );
      expect(result).toEqual({ amountCents: 2500, reason: 'deposit' });
    });

    it('will not prepay a `from` price, even though a percentage would use it', () => {
      // The asymmetry is the point: a floor is a fine BASE for a percentage
      // (under-charges, safe) but charging "the whole price" of a number that
      // is only a lower bound would take the wrong amount outright.
      const result = resolveBookingPayment(
        [
          service({
            paymentPolicy: 'full',
            priceType: 'from',
            priceCents: 15_000,
            depositAmountCents: 3000,
          }),
        ],
        defaults()
      );
      expect(result).toEqual({ amountCents: 3000, reason: 'deposit' });
    });
  });

  it('collects nothing when a FLAT amount falls below the chargeable floor', () => {
    // Stripe would decline 30c, so the booking is pay-in-clinic rather than a
    // checkout that fails. Only flat amounts can land here — a percentage is
    // rounded up to a whole 50c and so is always chargeable.
    const result = resolveBookingPayment(
      [service({ paymentPolicy: 'deposit', depositAmountCents: 30 })],
      defaults()
    );
    expect(result).toEqual({ amountCents: 0, reason: 'none' });
  });

  it('charges nothing for an empty cart', () => {
    expect(resolveBookingPayment([], defaults())).toEqual({
      amountCents: 0,
      reason: 'none',
    });
  });
});
