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
import { adjustGiftCard } from './adjust-gift-card.service.js';

describe('adjustGiftCard', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const card = {
    id: 'gc_1',
    organizationId: 'org_123',
    balanceCents: 3000,
  };

  const validInput = {
    organizationId: 'org_123',
    giftCardId: 'gc_1',
    amountCents: 2000,
    reason: 'goodwill top-up',
  };

  it('adjusts the balance and appends a signed ledger row', async () => {
    mockDb.query.giftCard.findFirst.mockResolvedValueOnce(card);
    mockDb.returning.mockResolvedValueOnce([{ ...card, balanceCents: 5000 }]);

    await expectResult(
      adjustGiftCard(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.balanceCents).toBe(5000);
    });
    const ledgerRow = mockDb.values.mock.calls[0][0];
    expect(ledgerRow.type).toBe('adjust');
    expect(ledgerRow.amountCents).toBe(2000);
  });

  it('allows negative adjustments down to zero', async () => {
    mockDb.query.giftCard.findFirst.mockResolvedValueOnce(card);
    mockDb.returning.mockResolvedValueOnce([{ ...card, balanceCents: 0 }]);

    await expectResult(
      adjustGiftCard(mockDb as never, { ...validInput, amountCents: -3000 })
    ).toSucceedWith((data) => {
      expect(data.balanceCents).toBe(0);
    });
  });

  it('rejects adjustments that would go negative', async () => {
    mockDb.query.giftCard.findFirst.mockResolvedValueOnce(card);
    const result = await adjustGiftCard(mockDb as never, {
      ...validInput,
      amountCents: -4000,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
  });

  it('rejects a zero adjustment', async () => {
    const result = await adjustGiftCard(mockDb as never, {
      ...validInput,
      amountCents: 0,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns NOT_FOUND when the card is missing', async () => {
    mockDb.query.giftCard.findFirst.mockResolvedValueOnce(undefined);
    const result = await adjustGiftCard(mockDb as never, validInput);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.giftCard.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );
    const result = await adjustGiftCard(mockDb as never, validInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
