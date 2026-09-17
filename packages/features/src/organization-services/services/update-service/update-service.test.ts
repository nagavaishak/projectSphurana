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
import { updateService } from './update-service.service.js';

// Mock database exports to provide serviceCategoryValues for z.enum()

describe('updateService', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'svc_123',
    organizationId: 'org_123',
    name: 'Updated Haircut',
    category: 'treatment' as const,
  };

  const existingService = {
    id: 'svc_123',
    organizationId: 'org_123',
    name: 'Haircut',
    description: 'A standard haircut',
    category: 'treatment',
    sortOrder: 0,
    isCustom: true,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('should update service with valid input', async () => {
    const updatedService = {
      ...existingService,
      name: validInput.name,
    };

    // Mock: service exists
    mockDb.query.organizationService.findFirst
      .mockResolvedValueOnce(existingService)
      // Mock: no duplicate name found
      .mockResolvedValueOnce(null);
    // Mock: update returns updated service
    mockDb.returning.mockResolvedValueOnce([updatedService]);

    const result = await updateService(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Updated Haircut');
    }

    expect(mockDb.update).toHaveBeenCalled();
  });

  it('persists a selected Stripe tax code and can clear it back to the default', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      existingService
    );
    mockDb.returning.mockResolvedValueOnce([
      { ...existingService, taxCode: 'txcd_99999999' },
    ]);

    await updateService(mockDb as never, {
      id: 'svc_123',
      organizationId: 'org_123',
      taxCode: 'txcd_99999999',
    });

    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ taxCode: 'txcd_99999999' })
    );

    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      existingService
    );
    mockDb.returning.mockResolvedValueOnce([
      { ...existingService, taxCode: null },
    ]);

    await updateService(mockDb as never, {
      id: 'svc_123',
      organizationId: 'org_123',
      taxCode: null,
    });

    expect(mockDb.set).toHaveBeenLastCalledWith(
      expect.objectContaining({ taxCode: null })
    );
  });

  // Claire and any direct API caller still patch the pre-policy flag on its
  // own. `payment_policy` is what the booking resolver reads, so a flag-only
  // patch has to move it.
  it('turns a requiresDeposit-only patch into paymentPolicy=deposit', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      existingService
    );
    mockDb.returning.mockResolvedValueOnce([
      { ...existingService, requiresDeposit: true },
    ]);

    await updateService(mockDb as never, {
      id: 'svc_123',
      organizationId: 'org_123',
      requiresDeposit: true,
    });

    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        requiresDeposit: true,
        paymentPolicy: 'deposit',
      })
    );
  });

  it('clears the policy back to the org default when the flag goes off', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      existingService
    );
    mockDb.returning.mockResolvedValueOnce([
      { ...existingService, requiresDeposit: false },
    ]);

    await updateService(mockDb as never, {
      id: 'svc_123',
      organizationId: 'org_123',
      requiresDeposit: false,
    });

    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ paymentPolicy: null })
    );
  });

  it('lets an explicit paymentPolicy in the same patch win', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      existingService
    );
    mockDb.returning.mockResolvedValueOnce([existingService]);

    await updateService(mockDb as never, {
      id: 'svc_123',
      organizationId: 'org_123',
      requiresDeposit: true,
      paymentPolicy: 'in_clinic',
    });

    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ paymentPolicy: 'in_clinic' })
    );
  });

  it('leaves paymentPolicy alone when neither field is in the patch', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      existingService
    );
    mockDb.returning.mockResolvedValueOnce([existingService]);

    await updateService(mockDb as never, {
      id: 'svc_123',
      organizationId: 'org_123',
      priceCents: 1000,
    });

    expect(mockDb.set).toHaveBeenCalledWith(
      expect.not.objectContaining({ paymentPolicy: expect.anything() })
    );
  });

  it('persists a priceCents update', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      existingService
    );
    mockDb.returning.mockResolvedValueOnce([
      { ...existingService, priceCents: 4200 },
    ]);

    const result = await updateService(mockDb as never, {
      id: 'svc_123',
      organizationId: 'org_123',
      priceCents: 4200,
    });

    expect(result.success).toBe(true);
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ priceCents: 4200 })
    );
  });

  it('sets priceType and keeps priceCents for fixed', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      existingService
    );
    mockDb.returning.mockResolvedValueOnce([
      { ...existingService, priceType: 'fixed', priceCents: 6000 },
    ]);

    await updateService(mockDb as never, {
      id: 'svc_123',
      organizationId: 'org_123',
      priceType: 'fixed',
      priceCents: 6000,
    });

    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ priceType: 'fixed', priceCents: 6000 })
    );
  });

  it('clears priceCents when switching to poa (even without sending it)', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      existingService
    );
    mockDb.returning.mockResolvedValueOnce([
      { ...existingService, priceType: 'poa', priceCents: null },
    ]);

    await updateService(mockDb as never, {
      id: 'svc_123',
      organizationId: 'org_123',
      priceType: 'poa',
    });

    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ priceType: 'poa', priceCents: null })
    );
  });

  it('can clear priceCents by passing null', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      existingService
    );
    mockDb.returning.mockResolvedValueOnce([
      { ...existingService, priceCents: null },
    ]);

    await updateService(mockDb as never, {
      id: 'svc_123',
      organizationId: 'org_123',
      priceCents: null,
    });

    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ priceCents: null })
    );
  });

  it('leaves priceCents untouched when not provided', async () => {
    mockDb.query.organizationService.findFirst
      .mockResolvedValueOnce(existingService)
      .mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([existingService]);

    await updateService(mockDb as never, {
      id: 'svc_123',
      organizationId: 'org_123',
      name: 'Renamed',
    });

    const setArg = mockDb.set.mock.calls[0][0] as Record<string, unknown>;
    expect('priceCents' in setArg).toBe(false);
  });

  it('should update service without changing name (no duplicate check)', async () => {
    const inputWithoutNameChange = {
      id: 'svc_123',
      organizationId: 'org_123',
      description: 'Updated description',
      isActive: false,
    };

    const updatedService = {
      ...existingService,
      description: 'Updated description',
      isActive: false,
    };

    // Mock: service exists (only one findFirst call needed, no duplicate check)
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      existingService
    );
    mockDb.returning.mockResolvedValueOnce([updatedService]);

    const result = await updateService(mockDb as never, inputWithoutNameChange);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe('Updated description');
      expect(result.data.isActive).toBe(false);
    }

    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should return NOT_FOUND when service does not exist', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(null);

    await expectResult(updateService(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(error.message).toContain('not found');
      }
    );

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return ALREADY_EXISTS if updated name conflicts with another service', async () => {
    const duplicateService = {
      id: 'svc_other',
      organizationId: 'org_123',
      name: 'Updated Haircut',
    };

    // Mock: service exists
    mockDb.query.organizationService.findFirst
      .mockResolvedValueOnce(existingService)
      // Mock: duplicate found
      .mockResolvedValueOnce(duplicateService);

    await expectResult(updateService(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.ALREADY_EXISTS);
        expect(error.message).toContain('Updated Haircut');
      }
    );

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should allow updating to the same name (no conflict with self)', async () => {
    const inputWithSameName = {
      id: 'svc_123',
      organizationId: 'org_123',
      name: 'Haircut',
      description: 'Updated description',
    };

    const updatedService = {
      ...existingService,
      description: 'Updated description',
    };

    // Mock: service exists - name unchanged so no duplicate check
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      existingService
    );
    mockDb.returning.mockResolvedValueOnce([updatedService]);

    const result = await updateService(mockDb as never, inputWithSameName);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe('Updated description');
    }
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    const invalidInput = {
      organizationId: 'org_123',
      name: 'Updated Haircut',
    };

    await expectResult(
      updateService(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.organizationService.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      id: 'svc_123',
      name: 'Updated Haircut',
    };

    await expectResult(
      updateService(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.organizationService.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty id', async () => {
    const invalidInput = {
      id: '',
      organizationId: 'org_123',
    };

    await expectResult(
      updateService(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    const invalidInput = {
      id: 'svc_123',
      organizationId: '',
    };

    await expectResult(
      updateService(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for name exceeding 100 characters', async () => {
    const invalidInput = {
      ...validInput,
      name: 'A'.repeat(101),
    };

    await expectResult(
      updateService(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for description exceeding 500 characters', async () => {
    const invalidInput = {
      ...validInput,
      description: 'A'.repeat(501),
    };

    await expectResult(
      updateService(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for invalid category', async () => {
    const invalidInput = {
      ...validInput,
      category: 'invalid_category',
    };

    await expectResult(
      updateService(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should update only provided fields', async () => {
    const partialUpdate = {
      id: 'svc_123',
      organizationId: 'org_123',
      sortOrder: 5,
    };

    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      existingService
    );
    mockDb.returning.mockResolvedValueOnce([
      { ...existingService, sortOrder: 5 },
    ]);

    const result = await updateService(mockDb as never, partialUpdate);

    expect(result.success).toBe(true);
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        sortOrder: 5,
      })
    );
  });

  it('should allow setting description to null', async () => {
    const inputWithNullDesc = {
      id: 'svc_123',
      organizationId: 'org_123',
      description: null,
    };

    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      existingService
    );
    mockDb.returning.mockResolvedValueOnce([
      { ...existingService, description: null },
    ]);

    const result = await updateService(mockDb as never, inputWithNullDesc);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeNull();
    }
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      existingService
    );
    mockDb.returning.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expect(updateService(mockDb as never, validInput)).rejects.toThrow(
      'Database connection failed'
    );
  });
});
