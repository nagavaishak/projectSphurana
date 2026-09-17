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
import { seedDefaultServices } from './seed-default-services.service.js';

// `defaultServicesByBusinessType` comes from the canonical database mock
// (vite.config.ts alias -> src/__mocks__/database.ts), which re-exports the REAL
// schema constants. We derive expected counts from that real data so this file
// needs no local database module override — such an override leaks across the
// shared worker graph under `isolate: false`. See
// docs/plans/features-test-suite-speedup.md.
import { defaultServicesByBusinessType } from '@borradh-workspace/database';

const hairdresserDefaults = defaultServicesByBusinessType.hairdresser;
const spaDefaults = defaultServicesByBusinessType.spa;
const emptyBusinessType = (
  Object.keys(defaultServicesByBusinessType) as Array<
    keyof typeof defaultServicesByBusinessType
  >
).find((t) => defaultServicesByBusinessType[t].length === 0);

describe('seedDefaultServices', () => {
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
    businessType: 'hairdresser' as const,
  };

  it('should create all default services for a business type with no existing services', async () => {
    // Mock: no existing services
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([]);

    const result = await seedDefaultServices(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(hairdresserDefaults.length);
      expect(result.data.skipped).toBe(0);
    }

    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('should skip services that already exist (case-insensitive)', async () => {
    // Mock: one service already exists (lower-cased to prove case-insensitivity)
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([
      { name: hairdresserDefaults[0].toLowerCase() },
    ]);

    const result = await seedDefaultServices(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(hairdresserDefaults.length - 1);
      expect(result.data.skipped).toBe(1);
    }

    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('should skip all services if they all already exist', async () => {
    // Mock: all services already exist
    mockDb.query.organizationService.findMany.mockResolvedValueOnce(
      hairdresserDefaults.map((name) => ({ name }))
    );

    const result = await seedDefaultServices(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(0);
      expect(result.data.skipped).toBe(hairdresserDefaults.length);
    }

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  // Defensive branch: a business type whose default list is empty should early
  // return without touching the DB. No real business type currently ships empty
  // defaults, so this is skipped unless/until one does (kept for coverage).
  it.skipIf(!emptyBusinessType)(
    'should return created 0 and skipped 0 for business type with no defaults',
    async () => {
      const inputWithNoDefaults = {
        organizationId: 'org_123',
        businessType: emptyBusinessType as NonNullable<
          typeof emptyBusinessType
        >,
      };

      const result = await seedDefaultServices(
        mockDb as never,
        inputWithNoDefaults
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.created).toBe(0);
        expect(result.data.skipped).toBe(0);
      }

      expect(mockDb.query.organizationService.findMany).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
    }
  );

  it('should seed spa defaults correctly', async () => {
    const spaInput = {
      organizationId: 'org_456',
      businessType: 'spa' as const,
    };

    mockDb.query.organizationService.findMany.mockResolvedValueOnce([]);

    const result = await seedDefaultServices(mockDb as never, spaInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(spaDefaults.length);
      expect(result.data.skipped).toBe(0);
    }

    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      businessType: 'hairdresser' as const,
    };

    await expectResult(
      seedDefaultServices(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing businessType', async () => {
    const invalidInput = {
      organizationId: 'org_123',
    };

    await expectResult(
      seedDefaultServices(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    const invalidInput = {
      organizationId: '',
      businessType: 'hairdresser' as const,
    };

    await expectResult(
      seedDefaultServices(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for invalid businessType', async () => {
    const invalidInput = {
      organizationId: 'org_123',
      businessType: 'invalid_type',
    };

    await expectResult(
      seedDefaultServices(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([]);
    mockDb.insert.mockImplementationOnce(() => {
      throw new Error('Database connection failed');
    });

    await expect(
      seedDefaultServices(mockDb as never, validInput)
    ).rejects.toThrow('Database connection failed');
  });
});
