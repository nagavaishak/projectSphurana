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
import { createService } from './create-service.service.js';

// Mock database exports to provide serviceCategoryValues for z.enum()

describe('createService', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // resolveCategoryIdForEnum: short-circuit by returning an existing category
    mockDb.query.organizationServiceCategory.findFirst.mockResolvedValue({
      id: 'cat_123',
      organizationId: 'org_123',
      name: 'Treatment',
    });
  });

  const validInput = {
    organizationId: 'org_123',
    name: 'Haircut',
    description: 'A standard haircut service',
    category: 'treatment' as const,
    sortOrder: 0,
    isCustom: true,
    isActive: true,
  };

  it('should create a service with valid input', async () => {
    const mockService = {
      id: 'svc_123',
      ...validInput,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock: no existing service found
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(null);
    // Mock: insert returns the created service
    mockDb.returning.mockResolvedValueOnce([mockService]);

    const result = await createService(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe(validInput.name);
      expect(result.data.organizationId).toBe(validInput.organizationId);
      expect(result.data.category).toBe('treatment');
    }

    expect(mockDb.insert).toHaveBeenCalled();
  });

  // The booking resolver reads `payment_policy` and nothing else. Onboarding
  // Step 7 and Claire's create-service tool send only `requiresDeposit`, so
  // without this translation a new clinic that asked for a deposit would
  // inherit its org default (`in_clinic`) and collect nothing.
  it('stores paymentPolicy=deposit for a legacy requiresDeposit-only create', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([{ id: 'svc_dep', ...validInput }]);

    await createService(mockDb as never, {
      ...validInput,
      requiresDeposit: true,
      depositAmountCents: 5000,
    });

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        requiresDeposit: true,
        paymentPolicy: 'deposit',
      })
    );
  });

  it('leaves paymentPolicy null (inherit the org) when no deposit is asked for', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([
      { id: 'svc_nodep', ...validInput },
    ]);

    await createService(mockDb as never, {
      ...validInput,
      requiresDeposit: false,
    });

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ paymentPolicy: null })
    );
  });

  it('lets an explicit paymentPolicy beat the legacy flag', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([{ id: 'svc_exp', ...validInput }]);

    await createService(mockDb as never, {
      ...validInput,
      requiresDeposit: true,
      paymentPolicy: 'in_clinic',
    });

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ paymentPolicy: 'in_clinic' })
    );
  });

  it('persists priceCents alongside the freeform priceText', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'svc_priced',
        ...validInput,
        priceText: 'From £25',
        priceCents: 2500,
      },
    ]);

    const result = await createService(mockDb as never, {
      ...validInput,
      priceText: 'From £25',
      priceCents: 2500,
    });

    expect(result.success).toBe(true);
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ priceText: 'From £25', priceCents: 2500 })
    );
  });

  it('persists the selected Stripe tax code', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([{ id: 'svc_tax', ...validInput }]);

    await createService(mockDb as never, {
      ...validInput,
      taxCode: 'txcd_99999999',
    });

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ taxCode: 'txcd_99999999' })
    );
  });

  it('defaults priceCents to null when omitted', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([{ id: 'svc_np', ...validInput }]);

    await createService(mockDb as never, validInput);

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ priceCents: null })
    );
  });

  it('infers priceType=poa when no price is given', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([{ id: 'svc_poa', ...validInput }]);

    await createService(mockDb as never, validInput);

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ priceType: 'poa', priceCents: null })
    );
  });

  it('infers priceType=fixed from a bare priceCents (back-compat)', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([{ id: 'svc_fx', ...validInput }]);

    await createService(mockDb as never, { ...validInput, priceCents: 5000 });

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ priceType: 'fixed', priceCents: 5000 })
    );
  });

  it('persists an explicit priceType=from with its anchor', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([{ id: 'svc_from', ...validInput }]);

    await createService(mockDb as never, {
      ...validInput,
      priceType: 'from',
      priceCents: 15000,
    });

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ priceType: 'from', priceCents: 15000 })
    );
  });

  it('nulls priceCents for free/poa even when one is sent', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([{ id: 'svc_free', ...validInput }]);

    await createService(mockDb as never, {
      ...validInput,
      priceType: 'free',
      priceCents: 9999,
    });

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ priceType: 'free', priceCents: null })
    );
  });

  it('should create a service with minimal input (defaults applied)', async () => {
    const minimalInput = {
      organizationId: 'org_123',
      name: 'Blow Dry',
    };

    const mockService = {
      id: 'svc_124',
      organizationId: 'org_123',
      name: 'Blow Dry',
      description: undefined,
      category: 'treatment',
      sortOrder: 0,
      isCustom: true,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([mockService]);

    const result = await createService(mockDb as never, minimalInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category).toBe('treatment');
      expect(result.data.sortOrder).toBe(0);
      expect(result.data.isCustom).toBe(true);
      expect(result.data.isActive).toBe(true);
    }

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'treatment',
        sortOrder: 0,
        isCustom: true,
        isActive: true,
      })
    );
  });

  it('should return ALREADY_EXISTS if service with same name exists in organization', async () => {
    const existingService = {
      id: 'svc_existing',
      organizationId: 'org_123',
      name: 'Haircut',
    };

    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      existingService
    );

    await expectResult(createService(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.ALREADY_EXISTS);
        expect(error.message).toContain('Haircut');
      }
    );

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return ALREADY_EXISTS when a concurrent insert wins the race', async () => {
    // The findFirst pre-check and the INSERT are not atomic: a concurrent
    // request can create the same (organizationId, name) in between. The
    // INSERT then loses on organization_service_name_unique.
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(null);

    const pgError = Object.assign(new Error('Failed query: insert into ...'), {
      cause: Object.assign(
        new Error(
          'duplicate key value violates unique constraint "organization_service_name_unique"'
        ),
        { code: '23505', constraint_name: 'organization_service_name_unique' }
      ),
    });
    mockDb.returning.mockRejectedValueOnce(pgError);

    await expectResult(createService(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.ALREADY_EXISTS);
        expect(error.message).toContain('Haircut');
      }
    );
  });

  it('should not swallow a unique violation on a different constraint', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(null);

    const pgError = Object.assign(new Error('Failed query: insert into ...'), {
      cause: Object.assign(
        new Error(
          'duplicate key value violates unique constraint "some_other_unique"'
        ),
        { code: '23505', constraint_name: 'some_other_unique' }
      ),
    });
    mockDb.returning.mockRejectedValueOnce(pgError);

    // Rethrown, not mapped — same contract as any other unexpected DB error.
    await expect(createService(mockDb as never, validInput)).rejects.toThrow(
      'Failed query'
    );
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      name: 'Haircut',
    };

    await expectResult(
      createService(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing name', async () => {
    const invalidInput = {
      organizationId: 'org_123',
    };

    await expectResult(
      createService(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty name', async () => {
    const invalidInput = {
      organizationId: 'org_123',
      name: '',
    };

    await expectResult(
      createService(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    const invalidInput = {
      organizationId: '',
      name: 'Haircut',
    };

    await expectResult(
      createService(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for name exceeding 100 characters', async () => {
    const invalidInput = {
      organizationId: 'org_123',
      name: 'A'.repeat(101),
    };

    await expectResult(
      createService(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for description exceeding 500 characters', async () => {
    const invalidInput = {
      ...validInput,
      description: 'A'.repeat(501),
    };

    await expectResult(
      createService(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for invalid category', async () => {
    const invalidInput = {
      ...validInput,
      category: 'invalid_category',
    };

    await expectResult(
      createService(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expect(createService(mockDb as never, validInput)).rejects.toThrow(
      'Database connection failed'
    );
  });

  it('reports a missing organization as NOT_FOUND, not an unexpected error', async () => {
    const fkError = Object.assign(
      new Error('Failed query: insert into organization_service'),
      {
        cause: Object.assign(
          new Error(
            'insert or update on table "organization_service" violates foreign key constraint "organization_service_organization_id_organization_id_fk"'
          ),
          {
            code: '23503',
            constraint_name:
              'organization_service_organization_id_organization_id_fk',
          }
        ),
      }
    );
    mockDb.returning.mockRejectedValueOnce(fkError);

    const result = await createService(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    expect(result.error.message).toMatch(/no longer exists/i);
  });
});
