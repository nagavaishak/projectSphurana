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
import { deleteServiceVariant } from './delete-service-variant.service.js';

describe('deleteServiceVariant', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('deletes a variant whose parent service belongs to the org', async () => {
    mockDb.query.organizationServiceVariant.findFirst.mockResolvedValueOnce({
      id: 'var_1',
      serviceId: 'svc_123',
      service: { organizationId: 'org_123' },
    });

    const result = await deleteServiceVariant(mockDb as never, {
      id: 'var_1',
      organizationId: 'org_123',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.id).toBe('var_1');
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the variant belongs to another org', async () => {
    mockDb.query.organizationServiceVariant.findFirst.mockResolvedValueOnce({
      id: 'var_1',
      serviceId: 'svc_123',
      service: { organizationId: 'other_org' },
    });

    await expectResult(
      deleteServiceVariant(mockDb as never, {
        id: 'var_1',
        organizationId: 'org_123',
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for a missing id', async () => {
    await expectResult(
      deleteServiceVariant(
        mockDb as never,
        {
          organizationId: 'org_123',
        } as never
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
