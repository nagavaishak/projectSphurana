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
import { getSale } from './get-sale.service.js';

describe('getSale', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('returns the sale with items and payments', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce({
      id: 'sale_1',
      organizationId: 'org_123',
      items: [{ id: 'item_1' }],
      payments: [],
    });

    await expectResult(
      getSale(mockDb as never, { organizationId: 'org_123', saleId: 'sale_1' })
    ).toSucceedWith((data) => {
      expect(data.id).toBe('sale_1');
      expect(data.items).toHaveLength(1);
    });
  });

  it('returns NOT_FOUND when the sale is missing', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce(undefined);
    const result = await getSale(mockDb as never, {
      organizationId: 'org_123',
      saleId: 'missing',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for empty saleId', async () => {
    const result = await getSale(mockDb as never, {
      organizationId: 'org_123',
      saleId: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
