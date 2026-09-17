/**
 * Tests for the sales / checkout request contracts.
 *
 * These bodies move money, so the cases below are deliberately weighted towards
 * the ways a wrong body could be ACCEPTED: a fractional "cents" amount, a zero
 * or negative tender, a gift-card tender with no code, a face value smuggled
 * onto a product line, an unknown key that a permissive object would silently
 * strip.
 */
import { describe, expect, it } from 'vitest';
import {
  addSaleItemRequestSchema,
  addSalePaymentRequestSchema,
  adjustGiftCardRequestSchema,
  createSaleFromAppointmentRequestSchema,
  createSaleRequestSchema,
  refundPaymentRequestSchema,
  setSaleClientRequestSchema,
  setSaleTipRequestSchema,
} from './sales.js';

describe('createSaleRequestSchema', () => {
  it('accepts an empty body (walk-in sale, no client, no location)', () => {
    expect(createSaleRequestSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a leadId', () => {
    const result = createSaleRequestSchema.safeParse({ leadId: 'lead_1' });
    expect(result.success).toBe(true);
  });

  /**
   * The money case. `locationId` used to be a body field that WON over the
   * guard-validated `X-Location-Id` header, so any authenticated member of org
   * A could open a sale stamped with org B's location id — and within an org, a
   * till could book its takings to another branch. The branch is server-
   * injected now; a body that still names one must be REJECTED, not ignored.
   */
  it('REJECTS a locationId in the body (the branch is header-injected)', () => {
    expect(
      createSaleRequestSchema.safeParse({ locationId: 'loc_other_branch' })
        .success
    ).toBe(false);
    expect(
      createSaleRequestSchema.safeParse({
        leadId: 'lead_1',
        locationId: 'loc_other_org',
      }).success
    ).toBe(false);
  });

  it('REJECTS server-injected context in the body (proves .strict())', () => {
    expect(
      createSaleRequestSchema.safeParse({ organizationId: 'org_1' }).success
    ).toBe(false);
    expect(
      createSaleRequestSchema.safeParse({ createdById: 'user_1' }).success
    ).toBe(false);
  });

  it('REJECTS an empty-string id', () => {
    expect(createSaleRequestSchema.safeParse({ leadId: '' }).success).toBe(
      false
    );
  });
});

describe('createSaleFromAppointmentRequestSchema', () => {
  it('accepts an appointment id', () => {
    const result = createSaleFromAppointmentRequestSchema.safeParse({
      appointmentId: 'appt_1',
    });
    expect(result.success).toBe(true);
  });

  it('REJECTS a missing appointmentId', () => {
    expect(createSaleFromAppointmentRequestSchema.safeParse({}).success).toBe(
      false
    );
  });

  it('REJECTS a client-proposed price (unknown field)', () => {
    const result = createSaleFromAppointmentRequestSchema.safeParse({
      appointmentId: 'appt_1',
      totalCents: 1,
    });
    expect(result.success).toBe(false);
  });
});

describe('addSaleItemRequestSchema', () => {
  const serviceLine = {
    itemType: 'service' as const,
    serviceId: 'svc_1',
    name: 'Haircut',
    unitPriceCents: 4500,
  };

  it('accepts a service line and MATERIALISES the quantity default', () => {
    const result = addSaleItemRequestSchema.safeParse(serviceLine);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.quantity).toBe(1);
  });

  it('accepts a comped line at 0 cents', () => {
    const result = addSaleItemRequestSchema.safeParse({
      ...serviceLine,
      unitPriceCents: 0,
    });
    expect(result.success).toBe(true);
  });

  it('REJECTS a fractional price (money is integer minor units)', () => {
    const result = addSaleItemRequestSchema.safeParse({
      ...serviceLine,
      unitPriceCents: 45.5,
    });
    expect(result.success).toBe(false);
  });

  it('REJECTS a negative price', () => {
    const result = addSaleItemRequestSchema.safeParse({
      ...serviceLine,
      unitPriceCents: -1,
    });
    expect(result.success).toBe(false);
  });

  it('REJECTS the wrong polymorphic FK for the item type', () => {
    const result = addSaleItemRequestSchema.safeParse({
      ...serviceLine,
      serviceId: undefined,
      productId: 'prod_1',
    });
    expect(result.success).toBe(false);
  });

  it('REJECTS two polymorphic FKs at once', () => {
    const result = addSaleItemRequestSchema.safeParse({
      ...serviceLine,
      productId: 'prod_1',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a gift-card line with a face value and expiry override', () => {
    const result = addSaleItemRequestSchema.safeParse({
      itemType: 'gift_card',
      name: 'Gift card',
      unitPriceCents: 5000,
      giftCardFaceValueCents: 5000,
      giftCardExpiry: 'never',
    });
    expect(result.success).toBe(true);
  });

  it('REJECTS a face value on a non-gift-card line (would mint free value)', () => {
    const result = addSaleItemRequestSchema.safeParse({
      ...serviceLine,
      giftCardFaceValueCents: 5000,
    });
    expect(result.success).toBe(false);
  });

  it('REJECTS a reference on a manual line', () => {
    const result = addSaleItemRequestSchema.safeParse({
      itemType: 'manual',
      name: 'Manual payment',
      unitPriceCents: 1000,
      serviceId: 'svc_1',
    });
    expect(result.success).toBe(false);
  });

  it('REJECTS server-injected context in the body (proves .strict())', () => {
    const result = addSaleItemRequestSchema.safeParse({
      ...serviceLine,
      saleId: 'sale_1',
    });
    expect(result.success).toBe(false);
  });
});

describe('setSaleTipRequestSchema', () => {
  it('accepts a percent tip', () => {
    const result = setSaleTipRequestSchema.safeParse({
      tipType: 'percent',
      tipPercent: 18,
    });
    expect(result.success).toBe(true);
  });

  it('accepts an amount tip', () => {
    const result = setSaleTipRequestSchema.safeParse({
      tipType: 'amount',
      tipAmountCents: 500,
    });
    expect(result.success).toBe(true);
  });

  it('REJECTS a percent tip with no percent', () => {
    const result = setSaleTipRequestSchema.safeParse({ tipType: 'percent' });
    expect(result.success).toBe(false);
  });

  it('REJECTS an amount tip with no amount', () => {
    const result = setSaleTipRequestSchema.safeParse({ tipType: 'amount' });
    expect(result.success).toBe(false);
  });

  it('REJECTS a percent above 100', () => {
    const result = setSaleTipRequestSchema.safeParse({
      tipType: 'percent',
      tipPercent: 101,
    });
    expect(result.success).toBe(false);
  });

  it('REJECTS a fractional tip amount', () => {
    const result = setSaleTipRequestSchema.safeParse({
      tipType: 'amount',
      tipAmountCents: 5.5,
    });
    expect(result.success).toBe(false);
  });
});

describe('setSaleClientRequestSchema', () => {
  it('accepts a lead id', () => {
    expect(
      setSaleClientRequestSchema.safeParse({ leadId: 'lead_1' }).success
    ).toBe(true);
  });

  it('accepts null to clear the client (walk-in)', () => {
    expect(setSaleClientRequestSchema.safeParse({ leadId: null }).success).toBe(
      true
    );
  });

  it('REJECTS an omitted leadId — clearing must be explicit', () => {
    expect(setSaleClientRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('addSalePaymentRequestSchema', () => {
  const cash = { method: 'cash' as const, amountCents: 1000 };

  it('accepts a cash tender and MATERIALISES autoComplete', () => {
    const result = addSalePaymentRequestSchema.safeParse(cash);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.autoComplete).toBe(true);
  });

  it('honours an explicit autoComplete: false (interactive checkout)', () => {
    const result = addSalePaymentRequestSchema.safeParse({
      ...cash,
      autoComplete: false,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.autoComplete).toBe(false);
  });

  it('REJECTS a zero-amount tender', () => {
    expect(
      addSalePaymentRequestSchema.safeParse({ ...cash, amountCents: 0 }).success
    ).toBe(false);
  });

  it('REJECTS a negative tender (a refund is not a negative payment here)', () => {
    expect(
      addSalePaymentRequestSchema.safeParse({ ...cash, amountCents: -500 })
        .success
    ).toBe(false);
  });

  it('REJECTS a fractional amount (money is integer minor units)', () => {
    expect(
      addSalePaymentRequestSchema.safeParse({ ...cash, amountCents: 10.5 })
        .success
    ).toBe(false);
  });

  it('accepts a gift-card tender with a code (this is redemption)', () => {
    const result = addSalePaymentRequestSchema.safeParse({
      method: 'gift_card',
      amountCents: 2500,
      giftCardCode: 'ABCD-1234',
    });
    expect(result.success).toBe(true);
  });

  it('REJECTS a gift-card tender with no code', () => {
    const result = addSalePaymentRequestSchema.safeParse({
      method: 'gift_card',
      amountCents: 2500,
    });
    expect(result.success).toBe(false);
  });

  it('accepts readerType on a card_terminal tender', () => {
    const result = addSalePaymentRequestSchema.safeParse({
      method: 'card_terminal',
      amountCents: 2500,
      readerType: 'tap_to_pay',
    });
    expect(result.success).toBe(true);
  });

  it('REJECTS readerType on a non-terminal tender', () => {
    const result = addSalePaymentRequestSchema.safeParse({
      ...cash,
      readerType: 'tap_to_pay',
    });
    expect(result.success).toBe(false);
  });

  it('REJECTS a client-supplied createdById (proves .strict())', () => {
    const result = addSalePaymentRequestSchema.safeParse({
      ...cash,
      createdById: 'user_other',
    });
    expect(result.success).toBe(false);
  });
});

describe('adjustGiftCardRequestSchema', () => {
  it('accepts a top-up', () => {
    const result = adjustGiftCardRequestSchema.safeParse({
      amountCents: 1000,
      reason: 'Goodwill',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a negative adjustment (this field is signed, unlike a tender)', () => {
    expect(
      adjustGiftCardRequestSchema.safeParse({ amountCents: -1000 }).success
    ).toBe(true);
  });

  it('REJECTS a zero adjustment', () => {
    expect(
      adjustGiftCardRequestSchema.safeParse({ amountCents: 0 }).success
    ).toBe(false);
  });

  it('REJECTS a fractional adjustment', () => {
    expect(
      adjustGiftCardRequestSchema.safeParse({ amountCents: 10.5 }).success
    ).toBe(false);
  });

  it('REJECTS a client-supplied createdById (proves .strict())', () => {
    const result = adjustGiftCardRequestSchema.safeParse({
      amountCents: 1000,
      createdById: 'user_other',
    });
    expect(result.success).toBe(false);
  });
});

describe('refundPaymentRequestSchema', () => {
  it('accepts an empty body (full refund, no reason)', () => {
    expect(refundPaymentRequestSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a Stripe refund reason', () => {
    const result = refundPaymentRequestSchema.safeParse({
      reason: 'requested_by_customer',
    });
    expect(result.success).toBe(true);
  });

  it('REJECTS an unknown reason', () => {
    expect(
      refundPaymentRequestSchema.safeParse({ reason: 'changed_mind' }).success
    ).toBe(false);
  });

  it('REJECTS a client-proposed refund amount (there is no amount here)', () => {
    expect(
      refundPaymentRequestSchema.safeParse({ amountCents: 100 }).success
    ).toBe(false);
  });
});
