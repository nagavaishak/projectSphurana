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
import { getDailySummary } from './get-daily-summary.service.js';

describe('getDailySummary', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { organizationId: 'org_123', date: '2026-07-06' };

  it('aggregates totals by method and item type', async () => {
    mockDb.query.sale.findMany.mockResolvedValueOnce([
      {
        id: 'sale_1',
        totalCents: 11000,
        tipCents: 1000,
        items: [
          { itemType: 'service', totalCents: 8000 },
          { itemType: 'product', totalCents: 2000 },
        ],
        payments: [
          { method: 'cash', status: 'succeeded', amountCents: 6000 },
          { method: 'card_terminal', status: 'succeeded', amountCents: 5000 },
          { method: 'gift_card', status: 'failed', amountCents: 999 },
        ],
      },
      {
        id: 'sale_2',
        totalCents: 3000,
        tipCents: 0,
        items: [{ itemType: 'service', totalCents: 3000 }],
        payments: [{ method: 'cash', status: 'succeeded', amountCents: 3000 }],
      },
    ]);

    await expectResult(
      getDailySummary(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.saleCount).toBe(2);
      expect(data.totalCents).toBe(14000);
      expect(data.tipCents).toBe(1000);
      expect(data.byMethod.cash).toBe(9000);
      expect(data.byMethod.card_terminal).toBe(5000);
      // failed tenders are excluded
      expect(data.byMethod.gift_card).toBeUndefined();
      expect(data.byItemType.service).toBe(11000);
      expect(data.byItemType.product).toBe(2000);
    });
  });

  it('returns zeros for a day with no completed sales', async () => {
    mockDb.query.sale.findMany.mockResolvedValueOnce([]);
    await expectResult(
      getDailySummary(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.saleCount).toBe(0);
      expect(data.totalCents).toBe(0);
    });
  });

  it('returns VALIDATION_ERROR for a malformed date', async () => {
    const result = await getDailySummary(mockDb as never, {
      ...validInput,
      date: '06/07/2026',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
