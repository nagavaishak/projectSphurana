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
import { getGiftCard } from './get-gift-card.service.js';

describe('getGiftCard', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('returns the card with transactions by id', async () => {
    mockDb.query.giftCard.findFirst.mockResolvedValueOnce({
      id: 'gc_1',
      code: 'GC-AAAA-BBBB-CCCC',
      balanceCents: 3000,
      transactions: [{ id: 'txn_1', type: 'issue', amountCents: 5000 }],
    });

    await expectResult(
      getGiftCard(mockDb as never, {
        organizationId: 'org_123',
        giftCardId: 'gc_1',
      })
    ).toSucceedWith((data) => {
      expect(data.id).toBe('gc_1');
      expect(data.transactions).toHaveLength(1);
    });
  });

  it('returns the card by code', async () => {
    mockDb.query.giftCard.findFirst.mockResolvedValueOnce({
      id: 'gc_1',
      code: 'GC-AAAA-BBBB-CCCC',
      transactions: [],
    });

    await expectResult(
      getGiftCard(mockDb as never, {
        organizationId: 'org_123',
        code: 'GC-AAAA-BBBB-CCCC',
      })
    ).toSucceedWith((data) => {
      expect(data.code).toBe('GC-AAAA-BBBB-CCCC');
    });
  });

  it('returns NOT_FOUND when missing', async () => {
    mockDb.query.giftCard.findFirst.mockResolvedValueOnce(undefined);
    const result = await getGiftCard(mockDb as never, {
      organizationId: 'org_123',
      giftCardId: 'missing',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR when both id and code are given', async () => {
    const result = await getGiftCard(mockDb as never, {
      organizationId: 'org_123',
      giftCardId: 'gc_1',
      code: 'GC-AAAA-BBBB-CCCC',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
