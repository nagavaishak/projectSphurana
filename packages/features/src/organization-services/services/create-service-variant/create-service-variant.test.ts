import { drizzleUniqueViolation } from '@borradh-workspace/database';
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
import { createServiceVariant } from './create-service-variant.service.js';

describe('createServiceVariant', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    serviceId: 'svc_123',
    name: '1 Area',
    priceCents: 16000,
    durationMinutes: 30,
  };

  it('creates a variant when the parent service belongs to the org', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc_123',
    });
    mockDb.returning.mockResolvedValueOnce([
      { id: 'var_1', serviceId: 'svc_123', name: '1 Area', priceCents: 16000 },
    ]);

    const result = await createServiceVariant(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe('1 Area');
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceId: 'svc_123',
        name: '1 Area',
        priceCents: 16000,
        durationMinutes: 30,
      })
    );
  });

  it('defaults priceCents/durationMinutes to null when omitted', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc_123',
    });
    mockDb.returning.mockResolvedValueOnce([{ id: 'var_2' }]);

    await createServiceVariant(mockDb as never, {
      organizationId: 'org_123',
      serviceId: 'svc_123',
      name: 'Base',
    });

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ priceCents: null, durationMinutes: null })
    );
  });

  it('returns NOT_FOUND when the service is not in the org', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      createServiceVariant(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for a missing name', async () => {
    await expectResult(
      createServiceVariant(
        mockDb as never,
        {
          organizationId: 'org_123',
          serviceId: 'svc_123',
        } as never
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('maps a unique-violation to ALREADY_EXISTS', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc_123',
    });
    mockDb.returning.mockRejectedValueOnce(
      drizzleUniqueViolation('organization_service_variant_name_unique')
    );

    await expectResult(
      createServiceVariant(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.ALREADY_EXISTS);
  });
});
