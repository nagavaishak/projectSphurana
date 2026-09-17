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
import { deleteService } from './delete-service.service.js';

// Mock database exports to provide the tables used in eq() / select() calls.

describe('deleteService', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'svc_123',
    organizationId: 'org_123',
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

  it('should delete service when it exists and has no linked assets', async () => {
    // Mock: service exists
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      existingService
    );
    // Mock: no linked assets
    mockDb.query.assetService.findFirst.mockResolvedValueOnce(null);

    const result = await deleteService(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
    }

    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('should return NOT_FOUND when service does not exist', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(null);

    await expectResult(deleteService(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(error.message).toContain('not found');
      }
    );

    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('should return CONFLICT when service is linked to assets', async () => {
    // Mock: service exists
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      existingService
    );
    // Mock: linked asset found
    mockDb.query.assetService.findFirst.mockResolvedValueOnce({
      id: 'as_123',
      serviceId: 'svc_123',
      assetId: 'asset_123',
    });

    await expectResult(deleteService(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.CONFLICT);
        expect(error.message).toContain('linked to assets');
      }
    );

    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    const invalidInput = {
      organizationId: 'org_123',
    };

    await expectResult(
      deleteService(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.organizationService.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      id: 'svc_123',
    };

    await expectResult(
      deleteService(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.organizationService.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty id', async () => {
    const invalidInput = {
      id: '',
      organizationId: 'org_123',
    };

    await expectResult(
      deleteService(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    const invalidInput = {
      id: 'svc_123',
      organizationId: '',
    };

    await expectResult(
      deleteService(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      existingService
    );
    mockDb.query.assetService.findFirst.mockResolvedValueOnce(null);
    mockDb.delete.mockImplementationOnce(() => {
      throw new Error('Database connection failed');
    });

    await expect(deleteService(mockDb as never, validInput)).rejects.toThrow(
      'Database connection failed'
    );
  });
});
