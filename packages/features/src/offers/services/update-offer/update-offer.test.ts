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
import { updateOffer } from './update-offer.service.js';

// `@borradh-workspace/labels` is aliased to its real (pure-constants) source in
// vite.config.ts — no file-local mock needed (it would leak under
// `isolate: false`). The real label values match what this suite asserts.

describe('updateOffer', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'offer-1',
    organizationId: 'org-1',
    name: 'Updated Sale',
  };

  const existingOffer = {
    id: 'offer-1',
    organizationId: 'org-1',
    name: 'Summer Sale',
    code: null,
    state: 'active',
    discountType: 'fixed_price',
    originalPriceCents: 10000,
    offerPriceCents: 5000,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('updates offer with valid input', async () => {
    mockDb.query.offer.findFirst.mockResolvedValueOnce(existingOffer);
    mockDb.returning.mockResolvedValueOnce([
      { ...existingOffer, name: 'Updated Sale' },
    ]);

    const result = await updateOffer(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('offer-1');
      expect(result.data.name).toBe('Updated Sale');
    }
    expect(mockDb.update).toHaveBeenCalled();
  });

  // Phase 3 time-correctness backstop, update side. The rule is "may not MOVE
  // the end into the past", NOT "validUntil must be future" — the offer edit
  // dialog round-trips the stored validUntil in a full-body PUT, so a blanket
  // rule would make an already-expired offer permanently uneditable.
  describe('past validUntil backstop', () => {
    const pastEnd = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const expiredOffer = {
      ...existingOffer,
      state: 'expired',
      validUntil: pastEnd,
    };

    it('allows editing an expired offer that echoes its own past validUntil', async () => {
      mockDb.query.offer.findFirst.mockResolvedValueOnce(expiredOffer);
      mockDb.returning.mockResolvedValueOnce([
        { ...expiredOffer, name: 'Renamed' },
      ]);

      const result = await updateOffer(mockDb as never, {
        ...validInput,
        name: 'Renamed',
        validUntil: pastEnd,
      });

      expect(result.success).toBe(true);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('rejects moving validUntil to a DIFFERENT past date', async () => {
      mockDb.query.offer.findFirst.mockResolvedValueOnce(existingOffer);

      const result = await updateOffer(mockDb as never, {
        ...validInput,
        validUntil: new Date('2020-08-07T00:00:00.000Z'),
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(JSON.stringify(result.error.details ?? {})).toContain(
          'in the past'
        );
      }
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('allows extending an expired offer into the future', async () => {
      mockDb.query.offer.findFirst.mockResolvedValueOnce(expiredOffer);
      const future = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      mockDb.returning.mockResolvedValueOnce([
        { ...expiredOffer, validUntil: future },
      ]);

      const result = await updateOffer(mockDb as never, {
        ...validInput,
        validUntil: future,
      });

      expect(result.success).toBe(true);
    });
  });

  it('returns NOT_FOUND when offer does not exist', async () => {
    mockDb.query.offer.findFirst.mockResolvedValueOnce(null);

    await expectResult(updateOffer(mockDb as never, validInput)).toFailWithCode(
      ErrorCodes.NOT_FOUND
    );

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing id', async () => {
    await expectResult(
      updateOffer(mockDb as never, { ...validInput, id: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('updates state independently of other fields', async () => {
    mockDb.query.offer.findFirst.mockResolvedValueOnce(existingOffer);
    mockDb.returning.mockResolvedValueOnce([
      { ...existingOffer, state: 'paused' },
    ]);

    const result = await updateOffer(mockDb as never, {
      id: 'offer-1',
      organizationId: 'org-1',
      state: 'paused',
    });

    expect(result.success).toBe(true);
  });

  it('returns INTERNAL_ERROR on DB failure', async () => {
    mockDb.query.offer.findFirst.mockResolvedValueOnce(existingOffer);
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(updateOffer(mockDb as never, validInput)).toFailWithCode(
      ErrorCodes.INTERNAL_ERROR
    );
  });

  it('maps duplicate-code DB errors to ALREADY_EXISTS', async () => {
    mockDb.query.offer.findFirst.mockResolvedValueOnce(existingOffer);
    mockDb.returning.mockRejectedValueOnce(
      drizzleUniqueViolation('idx_offer_org_code_unique')
    );

    await expectResult(
      updateOffer(mockDb as never, {
        id: 'offer-1',
        organizationId: 'org-1',
        code: 'WELCOME10',
      })
    ).toFailWithCode(ErrorCodes.ALREADY_EXISTS);
  });
});
