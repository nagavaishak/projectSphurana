import { describe, expect, it } from '@borradh-workspace/testing';
import {
  toBookingPaymentDefaults,
  toBookingPaymentService,
} from './booking-payment-adapters.js';

/**
 * A defect in these adapters does not fail loudly — it silently stops (or
 * starts) charging real customers.
 */
describe('toBookingPaymentService', () => {
  const service = {
    priceType: 'fixed' as const,
    priceCents: 10_000,
    paymentPolicy: null,
    depositBasis: null,
    depositAmountCents: 5000,
    depositPercent: null,
  };

  it('passes an explicit deposit policy through', () => {
    const result = toBookingPaymentService({
      ...service,
      paymentPolicy: 'deposit',
    });
    expect(result.paymentPolicy).toBe('deposit');
  });

  it('leaves an unset policy null so the org default still applies', () => {
    // null = inherit, NOT "pay in clinic" — an org-wide deposit must reach a
    // service that has never set a policy itself.
    expect(toBookingPaymentService(service).paymentPolicy).toBeNull();
  });

  it('passes an explicit in_clinic opt-out through', () => {
    // The service form writes this when the deposit toggle is OFF, so it has to
    // survive the trip and beat an org default that says otherwise.
    const result = toBookingPaymentService({
      ...service,
      paymentPolicy: 'in_clinic',
    });
    expect(result.paymentPolicy).toBe('in_clinic');
  });
});

describe('toBookingPaymentDefaults', () => {
  const org = {
    defaultPaymentPolicy: 'in_clinic' as const,
    defaultDepositBasis: 'fixed' as const,
    defaultDepositPercent: null,
    depositAggregation: 'sum' as const,
    depositEnabled: false,
    depositAmount: null as number | null,
  };

  it('carries the org-wide default amount while deposits are on', () => {
    const result = toBookingPaymentDefaults({
      ...org,
      defaultPaymentPolicy: 'deposit',
      depositEnabled: true,
      depositAmount: 2500,
    });
    expect(result.defaultPaymentPolicy).toBe('deposit');
    expect(result.defaultDepositAmountCents).toBe(2500);
  });

  it('ignores a leftover amount when deposits are switched off', () => {
    // The defect this guards: an org that turned deposits OFF but left an
    // amount behind, reached by a service whose own policy says 'deposit',
    // would start charging that stale figure.
    const result = toBookingPaymentDefaults({
      ...org,
      depositEnabled: false,
      depositAmount: 2500,
    });
    expect(result.defaultDepositAmountCents).toBeNull();
  });

  it('passes a full-prepayment policy through untouched', () => {
    const result = toBookingPaymentDefaults({
      ...org,
      defaultPaymentPolicy: 'full',
      depositEnabled: true,
      depositAmount: 2500,
    });
    expect(result.defaultPaymentPolicy).toBe('full');
  });

  it('degrades a partially-populated row to today’s behaviour, not to charging', () => {
    const result = toBookingPaymentDefaults({
      ...org,
      defaultPaymentPolicy: undefined as never,
      defaultDepositBasis: undefined as never,
      depositAggregation: undefined as never,
    });
    expect(result.defaultPaymentPolicy).toBe('in_clinic');
    expect(result.defaultDepositBasis).toBe('fixed');
    // `sum` is today's cart behaviour; defaulting to `largest` here would
    // quietly reduce what an org collects.
    expect(result.depositAggregation).toBe('sum');
  });
});
