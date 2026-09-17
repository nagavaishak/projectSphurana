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
import { removeSaleItem } from './remove-sale-item.service.js';

describe('removeSaleItem', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const openSale = {
    id: 'sale_1',
    organizationId: 'org_123',
    status: 'open',
    tipType: 'none',
    tipPercent: null,
    tipCents: 0,
    items: [{ id: 'item_1', totalCents: 5000 }],
    payments: [],
  };

  const validInput = {
    organizationId: 'org_123',
    saleId: 'sale_1',
    itemId: 'item_1',
  };

  it('removes the item and recomputes totals', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce(openSale);
    mockDb.query.saleItem.findMany.mockResolvedValueOnce([]);
    mockDb.returning.mockResolvedValueOnce([
      { ...openSale, subtotalCents: 0, totalCents: 0, items: [] },
    ]);
    mockDb.query.salePayment.findMany.mockResolvedValueOnce([]);

    await expectResult(
      removeSaleItem(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.subtotalCents).toBe(0);
      expect(data.items).toHaveLength(0);
    });
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the item is not on the sale', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce({
      ...openSale,
      items: [],
    });
    const result = await removeSaleItem(mockDb as never, validInput);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('rejects removal on a non-open sale', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce({
      ...openSale,
      status: 'voided',
    });
    const result = await removeSaleItem(mockDb as never, validInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
  });

  it('returns VALIDATION_ERROR for missing itemId', async () => {
    const result = await removeSaleItem(mockDb as never, {
      ...validInput,
      itemId: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
