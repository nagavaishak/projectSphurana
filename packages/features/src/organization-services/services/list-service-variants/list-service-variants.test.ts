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
import { listServiceVariants } from './list-service-variants.service.js';

describe('listServiceVariants', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('lists a service variants when the service belongs to the org', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc_123',
    });
    mockDb.query.organizationServiceVariant.findMany.mockResolvedValueOnce([
      { id: 'var_1', serviceId: 'svc_123', name: '1 Area', sortOrder: 0 },
      { id: 'var_2', serviceId: 'svc_123', name: '2 Areas', sortOrder: 1 },
    ]);

    const result = await listServiceVariants(mockDb as never, {
      organizationId: 'org_123',
      serviceId: 'svc_123',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.items).toHaveLength(2);
  });

  it('returns NOT_FOUND when the service is not in the org', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      listServiceVariants(mockDb as never, {
        organizationId: 'org_123',
        serviceId: 'svc_123',
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for a missing serviceId', async () => {
    await expectResult(
      listServiceVariants(
        mockDb as never,
        {
          organizationId: 'org_123',
        } as never
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
