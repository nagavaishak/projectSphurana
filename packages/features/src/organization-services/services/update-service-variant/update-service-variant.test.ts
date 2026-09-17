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
import { updateServiceVariant } from './update-service-variant.service.js';

describe('updateServiceVariant', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('updates a variant whose parent service belongs to the org', async () => {
    mockDb.query.organizationServiceVariant.findFirst.mockResolvedValueOnce({
      id: 'var_1',
      serviceId: 'svc_123',
      service: { organizationId: 'org_123' },
    });
    mockDb.returning.mockResolvedValueOnce([
      { id: 'var_1', name: '2 Areas', priceCents: 19000 },
    ]);

    const result = await updateServiceVariant(mockDb as never, {
      id: 'var_1',
      organizationId: 'org_123',
      name: '2 Areas',
      priceCents: 19000,
    });

    expect(result.success).toBe(true);
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ name: '2 Areas', priceCents: 19000 })
    );
  });

  it('returns NOT_FOUND when the variant belongs to another org', async () => {
    mockDb.query.organizationServiceVariant.findFirst.mockResolvedValueOnce({
      id: 'var_1',
      serviceId: 'svc_123',
      service: { organizationId: 'other_org' },
    });

    await expectResult(
      updateServiceVariant(mockDb as never, {
        id: 'var_1',
        organizationId: 'org_123',
        name: 'x',
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the variant does not exist', async () => {
    mockDb.query.organizationServiceVariant.findFirst.mockResolvedValueOnce(
      null
    );

    await expectResult(
      updateServiceVariant(mockDb as never, {
        id: 'missing',
        organizationId: 'org_123',
        name: 'x',
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for a missing id', async () => {
    await expectResult(
      updateServiceVariant(
        mockDb as never,
        {
          organizationId: 'org_123',
        } as never
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
