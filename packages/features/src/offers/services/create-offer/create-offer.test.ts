import { drizzleUniqueViolation } from '@borradh-workspace/database';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { createOffer } from './create-offer.service.js';

// `@borradh-workspace/labels` is aliased to its real (pure-constants) source in
// vite.config.ts — no file-local mock needed (it would leak under
// `isolate: false`). The real label values match what this suite asserts.

describe('createOffer', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validFixedPriceInput = {
    organizationId: 'org-1',
    name: 'Summer Sale',
    discountType: 'fixed_price' as const,
    originalPriceCents: 10000,
    offerPriceCents: 5000,
  };

  it('creates offer with valid fixed_price input', async () => {
    const mockOffer = {
      id: 'offer-1',
      ...validFixedPriceInput,
      state: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockDb.returning.mockResolvedValueOnce([mockOffer]);

    const result = await createOffer(mockDb as never, validFixedPriceInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('offer-1');
      expect(result.data.name).toBe('Summer Sale');
    }
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('creates offer with serviceIds and locationIds', async () => {
    const input = {
      ...validFixedPriceInput,
      serviceIds: ['service-1', 'service-2'],
      locationIds: ['loc-1'],
    };
    const mockOffer = {
      id: 'offer-1',
      ...validFixedPriceInput,
      state: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockDb.returning.mockResolvedValueOnce([mockOffer]);

    const result = await createOffer(mockDb as never, input);

    expect(result.success).toBe(true);
    // insert called for offer + offerService + offerLocation
    expect(mockDb.insert).toHaveBeenCalledTimes(3);
  });

  it('rejects a validUntil in the past, quoting today (Phase 3 backstop)', async () => {
    const result = await createOffer(mockDb as never, {
      ...validFixedPriceInput,
      validUntil: '2020-08-07T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      const issues = JSON.stringify(result.error.details ?? {});
      expect(issues).toContain('in the past');
      expect(issues).toContain('today is');
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('rejects a validFrom more than 13 months out (Phase 3 backstop)', async () => {
    const farFuture = new Date(Date.now() + 420 * 24 * 60 * 60 * 1000);
    const result = await createOffer(mockDb as never, {
      ...validFixedPriceInput,
      validFrom: farFuture.toISOString(),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(JSON.stringify(result.error.details ?? {})).toContain('13 months');
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('accepts a future validity window', async () => {
    const mockOffer = { id: 'offer-1', state: 'active' };
    mockDb.returning.mockResolvedValueOnce([mockOffer]);
    const inTwoWeeks = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const result = await createOffer(mockDb as never, {
      ...validFixedPriceInput,
      validUntil: inTwoWeeks.toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it('returns VALIDATION_ERROR for missing name', async () => {
    await expectResult(
      createOffer(mockDb as never, { ...validFixedPriceInput, name: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for fixed_price without offerPriceCents', async () => {
    const input = {
      organizationId: 'org-1',
      name: 'Summer Sale',
      discountType: 'fixed_price' as const,
      originalPriceCents: 5000,
    };

    await expectResult(createOffer(mockDb as never, input)).toFailWithCode(
      ErrorCodes.VALIDATION_ERROR
    );

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for percentage without discountPercent', async () => {
    const input = {
      organizationId: 'org-1',
      name: 'Percent',
      discountType: 'percentage' as const,
    };

    await expectResult(createOffer(mockDb as never, input)).toFailWithCode(
      ErrorCodes.VALIDATION_ERROR
    );

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for buy_x_get_y without quantities', async () => {
    const input = {
      organizationId: 'org-1',
      name: 'BOGO',
      discountType: 'buy_x_get_y' as const,
      buyQuantity: 2,
    };

    await expectResult(createOffer(mockDb as never, input)).toFailWithCode(
      ErrorCodes.VALIDATION_ERROR
    );

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('rejects fixed_price when offerPrice >= originalPrice', async () => {
    const input = {
      organizationId: 'org-1',
      name: 'Bad pricing',
      discountType: 'fixed_price' as const,
      originalPriceCents: 1000,
      offerPriceCents: 1200,
    };

    await expectResult(createOffer(mockDb as never, input)).toFailWithCode(
      ErrorCodes.VALIDATION_ERROR
    );

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('maps duplicate-code DB errors to ALREADY_EXISTS', async () => {
    mockDb.returning.mockRejectedValueOnce(
      drizzleUniqueViolation('idx_offer_org_code_unique')
    );

    await expectResult(
      createOffer(mockDb as never, {
        ...validFixedPriceInput,
        code: 'WELCOME10',
      })
    ).toFailWithCode(ErrorCodes.ALREADY_EXISTS);
  });

  it('returns INTERNAL_ERROR on generic DB failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      createOffer(mockDb as never, validFixedPriceInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
