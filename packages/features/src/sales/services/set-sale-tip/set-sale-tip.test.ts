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
import { setSaleTip } from './set-sale-tip.service.js';

describe('setSaleTip', () => {
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
    subtotalCents: 10000,
    items: [{ id: 'item_1', totalCents: 10000 }],
    payments: [],
  };

  it('sets a percent tip and recomputes the settled tip amount', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce(openSale);
    mockDb.query.saleItem.findMany.mockResolvedValueOnce([
      { totalCents: 10000 },
    ]);
    mockDb.returning.mockResolvedValueOnce([
      { ...openSale, tipType: 'percent', tipPercent: 18, tipCents: 1800 },
    ]);
    mockDb.query.salePayment.findMany.mockResolvedValueOnce([]);

    await expectResult(
      setSaleTip(mockDb as never, {
        organizationId: 'org_123',
        saleId: 'sale_1',
        tipType: 'percent',
        tipPercent: 18,
      })
    ).toSucceedWith((data) => {
      expect(data.tipCents).toBe(1800);
    });

    // The recompute persisted tip_cents = round(10000 * 18%) = 1800
    const persisted = mockDb.set.mock.calls.at(-1)?.[0];
    expect(persisted.tipCents).toBe(1800);
    expect(persisted.totalCents).toBe(11800);
  });

  it('requires tipPercent for percent tips', async () => {
    const result = await setSaleTip(mockDb as never, {
      organizationId: 'org_123',
      saleId: 'sale_1',
      tipType: 'percent',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('requires tipAmountCents for amount tips', async () => {
    const result = await setSaleTip(mockDb as never, {
      organizationId: 'org_123',
      saleId: 'sale_1',
      tipType: 'amount',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('rejects tip changes on a non-open sale', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce({
      ...openSale,
      status: 'completed',
    });
    const result = await setSaleTip(mockDb as never, {
      organizationId: 'org_123',
      saleId: 'sale_1',
      tipType: 'none',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
  });
});
