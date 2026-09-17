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
import { createSale } from './create-sale.service.js';

describe('createSale', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    createdById: 'user_1',
  };

  it('creates an open sale with currency from the primary location country', async () => {
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce({
      id: 'loc_1',
      country: 'us',
      isPrimary: true,
    });
    const mockSale = {
      id: 'sale_1',
      organizationId: 'org_123',
      status: 'open',
      currency: 'usd',
    };
    mockDb.returning.mockResolvedValueOnce([mockSale]);

    await expectResult(createSale(mockDb as never, validInput)).toSucceedWith(
      (data) => {
        expect(data.status).toBe('open');
        expect(data.currency).toBe('usd');
      }
    );
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('falls back to eur when there is no primary location', async () => {
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce(
      undefined
    );
    mockDb.returning.mockResolvedValueOnce([{ id: 'sale_1', currency: 'eur' }]);

    const result = await createSale(mockDb as never, validInput);
    expect(result.success).toBe(true);
    const inserted = mockDb.values.mock.calls[0][0];
    expect(inserted.currency).toBe('eur');
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await createSale(mockDb as never, {
      organizationId: '',
      createdById: 'user_1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.organizationLocation.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );
    const result = await createSale(mockDb as never, validInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
