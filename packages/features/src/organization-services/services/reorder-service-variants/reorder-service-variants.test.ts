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
import { reorderServiceVariants } from './reorder-service-variants.service.js';

describe('reorderServiceVariants', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('renumbers sortOrder to the given order', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc_123',
    });
    // current variant ids for the service
    mockDb.query.organizationServiceVariant.findMany
      .mockResolvedValueOnce([{ id: 'var_1' }, { id: 'var_2' }])
      // final re-read after reorder
      .mockResolvedValueOnce([
        { id: 'var_2', sortOrder: 0 },
        { id: 'var_1', sortOrder: 1 },
      ]);

    const result = await reorderServiceVariants(mockDb as never, {
      organizationId: 'org_123',
      serviceId: 'svc_123',
      orderedIds: ['var_2', 'var_1'],
    });

    expect(result.success).toBe(true);
    // one UPDATE per variant
    expect(mockDb.update).toHaveBeenCalledTimes(2);
    expect(mockDb.set).toHaveBeenCalledWith({ sortOrder: 0 });
    expect(mockDb.set).toHaveBeenCalledWith({ sortOrder: 1 });
  });

  it('rejects an orderedIds that does not match the service variants', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc_123',
    });
    mockDb.query.organizationServiceVariant.findMany.mockResolvedValueOnce([
      { id: 'var_1' },
      { id: 'var_2' },
    ]);

    await expectResult(
      reorderServiceVariants(mockDb as never, {
        organizationId: 'org_123',
        serviceId: 'svc_123',
        orderedIds: ['var_1', 'foreign_id'],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the service is not in the org', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      reorderServiceVariants(mockDb as never, {
        organizationId: 'org_123',
        serviceId: 'svc_123',
        orderedIds: ['var_1'],
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });
});
