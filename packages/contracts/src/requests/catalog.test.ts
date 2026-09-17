import { describe, expect, it } from 'vitest';
import {
  createCategoryRequestSchema,
  createOfferRequestSchema,
  createServiceRequestSchema,
  updateCategoryRequestSchema,
  updateOfferRequestSchema,
  updateServiceRequestSchema,
} from './catalog.js';

// ============================================================================
// SERVICES
// ============================================================================

/** The minimum a `POST /organization-services` body needs. */
const validServiceBody = { name: 'Deep Cleanse Facial' };

describe('createServiceRequestSchema', () => {
  it('accepts a minimal service-create body', () => {
    expect(createServiceRequestSchema.safeParse(validServiceBody).success).toBe(
      true
    );
  });

  it('materialises the server defaults into the parsed body', () => {
    const parsed = createServiceRequestSchema.parse(validServiceBody);
    expect(parsed).toMatchObject({
      category: 'treatment',
      sortOrder: 0,
      isCustom: true,
      isActive: true,
      requiresDeposit: false,
    });
  });

  it('leaves priceType UNSET when omitted — the service infers it', () => {
    // A `.default()` here would silently change SERVER behaviour, because the
    // feature schema IS this object plus `organizationId`. See the file header.
    const parsed = createServiceRequestSchema.parse(validServiceBody);
    expect('priceType' in parsed).toBe(false);
  });

  it('accepts the locked pricing pair (priceType + priceCents)', () => {
    const result = createServiceRequestSchema.safeParse({
      ...validServiceBody,
      priceType: 'from',
      priceCents: 8500,
      appointmentDuration: 45,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a Stripe tax-code override or an explicit return to the clinic default', () => {
    expect(
      createServiceRequestSchema.safeParse({
        ...validServiceBody,
        taxCode: 'txcd_99999999',
      }).success
    ).toBe(true);
    expect(
      updateServiceRequestSchema.safeParse({ taxCode: null }).success
    ).toBe(true);
    expect(
      createServiceRequestSchema.safeParse({ ...validServiceBody, taxCode: '' })
        .success
    ).toBe(false);
  });

  it('REJECTS a body with an unknown / extra field (proves .strict())', () => {
    const result = createServiceRequestSchema.safeParse({
      ...validServiceBody,
      // Server-injected — must never appear in the body.
      organizationId: 'org_1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.code === 'unrecognized_keys')
      ).toBe(true);
    }
  });

  it('rejects a body missing the required name', () => {
    expect(createServiceRequestSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a blank name and a fractional priceCents', () => {
    expect(createServiceRequestSchema.safeParse({ name: '' }).success).toBe(
      false
    );
    expect(
      createServiceRequestSchema.safeParse({
        ...validServiceBody,
        priceCents: 12.5,
      }).success
    ).toBe(false);
  });

  it('rejects a deposit below the €1 floor', () => {
    expect(
      createServiceRequestSchema.safeParse({
        ...validServiceBody,
        requiresDeposit: true,
        depositAmountCents: 99,
      }).success
    ).toBe(false);
  });
});

describe('updateServiceRequestSchema', () => {
  it('accepts an empty body (PATCH semantics — every key optional)', () => {
    expect(updateServiceRequestSchema.safeParse({}).success).toBe(true);
  });

  it('distinguishes ABSENT from CLEARED on a nullable key', () => {
    const cleared = updateServiceRequestSchema.parse({ categoryId: null });
    expect(cleared.categoryId).toBeNull();
    expect('categoryId' in updateServiceRequestSchema.parse({})).toBe(false);
  });

  it('REJECTS the route param `id` and the session `organizationId`', () => {
    expect(updateServiceRequestSchema.safeParse({ id: 'svc_1' }).success).toBe(
      false
    );
    expect(
      updateServiceRequestSchema.safeParse({ organizationId: 'org_1' }).success
    ).toBe(false);
  });

  it('REJECTS isCustom — creation-only, the update service does not take it', () => {
    expect(
      updateServiceRequestSchema.safeParse({ isCustom: false }).success
    ).toBe(false);
  });

  it('rejects an out-of-range appointmentDuration', () => {
    expect(
      updateServiceRequestSchema.safeParse({ appointmentDuration: 4 }).success
    ).toBe(false);
    expect(
      updateServiceRequestSchema.safeParse({ appointmentDuration: 481 }).success
    ).toBe(false);
  });
});

// ============================================================================
// SERVICE CATEGORIES
// ============================================================================

describe('createCategoryRequestSchema', () => {
  it('accepts a minimal body and materialises its defaults', () => {
    const parsed = createCategoryRequestSchema.parse({ name: 'Facials' });
    expect(parsed).toEqual({ name: 'Facials', sortOrder: 0, isActive: true });
  });

  it('REJECTS an unknown field (proves .strict())', () => {
    const result = createCategoryRequestSchema.safeParse({
      name: 'Facials',
      organizationId: 'org_1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.code === 'unrecognized_keys')
      ).toBe(true);
    }
  });

  it('rejects a missing / blank name', () => {
    expect(createCategoryRequestSchema.safeParse({}).success).toBe(false);
    expect(createCategoryRequestSchema.safeParse({ name: '' }).success).toBe(
      false
    );
  });
});

describe('updateCategoryRequestSchema', () => {
  it('accepts an empty body and a description clear', () => {
    expect(updateCategoryRequestSchema.safeParse({}).success).toBe(true);
    expect(updateCategoryRequestSchema.parse({ description: null })).toEqual({
      description: null,
    });
  });

  it('REJECTS the route param `id`', () => {
    expect(updateCategoryRequestSchema.safeParse({ id: 'cat_1' }).success).toBe(
      false
    );
  });
});

// ============================================================================
// OFFERS
// ============================================================================

/** A valid percentage offer as the offer-form dialog sends it. */
const validOfferBody = {
  name: 'Summer 20% off',
  discountType: 'percentage' as const,
  discountPercent: 20,
};

describe('createOfferRequestSchema', () => {
  it('accepts a valid percentage offer and materialises its defaults', () => {
    const parsed = createOfferRequestSchema.parse(validOfferBody);
    expect(parsed).toMatchObject({
      state: 'active',
      limitPerClient: false,
      serviceIds: [],
      locationIds: [],
      // `code` is `.optional().nullable().transform(…)`, so an ABSENT code
      // still lands as an explicit null.
      code: null,
    });
  });

  it('trims a code and collapses a blank one to null (no normaliser needed)', () => {
    expect(
      createOfferRequestSchema.parse({ ...validOfferBody, code: '  SUMMER  ' })
        .code
    ).toBe('SUMMER');
    expect(
      createOfferRequestSchema.parse({ ...validOfferBody, code: '   ' }).code
    ).toBeNull();
  });

  it('takes ISO STRING dates, not Date objects (wire shape)', () => {
    expect(
      createOfferRequestSchema.safeParse({
        ...validOfferBody,
        validFrom: '2026-08-01T00:00:00.000Z',
        validUntil: '2026-08-31T00:00:00.000Z',
      }).success
    ).toBe(true);
    expect(
      createOfferRequestSchema.safeParse({
        ...validOfferBody,
        validFrom: new Date(),
      }).success
    ).toBe(false);
  });

  it('REJECTS an unknown field (proves .strict())', () => {
    const result = createOfferRequestSchema.safeParse({
      ...validOfferBody,
      organizationId: 'org_1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.code === 'unrecognized_keys')
      ).toBe(true);
    }
  });

  it('rejects a body missing the required discountType', () => {
    expect(
      createOfferRequestSchema.safeParse({ name: 'Nameless shape' }).success
    ).toBe(false);
  });

  // ── discount-shape discriminant ────────────────────────────────────────────

  it('requires discountPercent for a percentage offer', () => {
    const result = createOfferRequestSchema.safeParse({
      name: 'Summer',
      discountType: 'percentage',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path[0] === 'discountPercent')
      ).toBe(true);
    }
  });

  it('requires discountAmountCents for a fixed_amount offer', () => {
    expect(
      createOfferRequestSchema.safeParse({
        name: 'Tenner off',
        discountType: 'fixed_amount',
      }).success
    ).toBe(false);
  });

  it('requires buy AND get quantities for a buy_x_get_y offer', () => {
    expect(
      createOfferRequestSchema.safeParse({
        name: '3 for 2',
        discountType: 'buy_x_get_y',
        buyQuantity: 3,
      }).success
    ).toBe(false);
    expect(
      createOfferRequestSchema.safeParse({
        name: '3 for 2',
        discountType: 'buy_x_get_y',
        buyQuantity: 3,
        getQuantity: 1,
      }).success
    ).toBe(true);
  });

  it('requires a fixed_price offer to UNDERCUT the original price', () => {
    expect(
      createOfferRequestSchema.safeParse({
        name: 'Bundle',
        discountType: 'fixed_price',
        originalPriceCents: 10_000,
        offerPriceCents: 7500,
      }).success
    ).toBe(true);
    expect(
      createOfferRequestSchema.safeParse({
        name: 'Bundle',
        discountType: 'fixed_price',
        originalPriceCents: 10_000,
        offerPriceCents: 10_000,
      }).success
    ).toBe(false);
  });

  it('enforces the numeric bounds the server enforces', () => {
    expect(
      createOfferRequestSchema.safeParse({
        ...validOfferBody,
        discountPercent: 120,
      }).success
    ).toBe(false);
    expect(
      createOfferRequestSchema.safeParse({
        ...validOfferBody,
        discountPercent: 20.5,
      }).success
    ).toBe(false);
    expect(
      createOfferRequestSchema.safeParse({
        ...validOfferBody,
        redemptionLimit: 0,
      }).success
    ).toBe(false);
  });
});

describe('updateOfferRequestSchema', () => {
  it('accepts a sparse Claire draft edit (name + validUntil only)', () => {
    const result = updateOfferRequestSchema.safeParse({
      name: 'Renamed offer',
      validUntil: '2026-09-30T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('does NOT fire the discount-shape rule without an explicit discountType', () => {
    // A partial update carrying just `state` must not be forced to resend the
    // discount fields.
    expect(
      updateOfferRequestSchema.safeParse({ state: 'paused' }).success
    ).toBe(true);
  });

  it('DOES fire the discount-shape rule once discountType is present', () => {
    expect(
      updateOfferRequestSchema.safeParse({ discountType: 'percentage' }).success
    ).toBe(false);
    expect(
      updateOfferRequestSchema.safeParse({
        discountType: 'percentage',
        discountPercent: 15,
      }).success
    ).toBe(true);
  });

  it('does NOT compare offer/original price on update', () => {
    // The stored original is invisible to a body-level refinement, so unlike
    // create this pair is accepted. Mirrors `update-offer.schema.ts`.
    expect(
      updateOfferRequestSchema.safeParse({
        discountType: 'fixed_price',
        originalPriceCents: 10_000,
        offerPriceCents: 10_000,
      }).success
    ).toBe(true);
  });

  it('distinguishes ABSENT code from CLEARED code', () => {
    expect('code' in updateOfferRequestSchema.parse({})).toBe(false);
    expect(updateOfferRequestSchema.parse({ code: null }).code).toBeNull();
    expect(updateOfferRequestSchema.parse({ code: '  ' }).code).toBeNull();
  });

  it('REJECTS the route param `id` and the session `organizationId`', () => {
    expect(updateOfferRequestSchema.safeParse({ id: 'off_1' }).success).toBe(
      false
    );
    expect(
      updateOfferRequestSchema.safeParse({ organizationId: 'org_1' }).success
    ).toBe(false);
  });
});
