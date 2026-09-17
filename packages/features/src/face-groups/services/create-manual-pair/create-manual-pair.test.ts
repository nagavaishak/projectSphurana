import { drizzleUniqueViolation } from '@borradh-workspace/database';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { createManualPair } from './create-manual-pair.service.js';

describe('createManualPair', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    batchId: 'batch_123',
    beforeAssetId: 'asset_before',
    afterAssetId: 'asset_after',
  };

  it('should create a manual pair with valid input', async () => {
    // Mock asset verification: both assets found
    mockDb.where.mockResolvedValueOnce([
      { id: 'asset_before' },
      { id: 'asset_after' },
    ]);

    const mockGroup = {
      id: 'group_123',
      organizationId: 'org_123',
      clientName: null,
      serviceId: null,
    };
    // First returning: face group insert
    mockDb.returning.mockResolvedValueOnce([mockGroup]);
    // Second returning: junction records insert
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'fga_1',
        faceGroupId: 'group_123',
        assetId: 'asset_before',
        role: 'before',
      },
      {
        id: 'fga_2',
        faceGroupId: 'group_123',
        assetId: 'asset_after',
        role: 'after',
      },
    ]);

    const result = await createManualPair(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.faceGroup).toBeDefined();
      expect(result.data.assets).toHaveLength(2);
    }
  });

  it('should create a manual pair with optional clientName and serviceId', async () => {
    const inputWithOptionals = {
      ...validInput,
      clientName: 'Jane Doe',
      serviceId: 'svc_123',
    };

    mockDb.where.mockResolvedValueOnce([
      { id: 'asset_before' },
      { id: 'asset_after' },
    ]);

    const mockGroup = {
      id: 'group_123',
      organizationId: 'org_123',
      clientName: 'Jane Doe',
      serviceId: 'svc_123',
    };
    mockDb.returning.mockResolvedValueOnce([mockGroup]);
    mockDb.returning.mockResolvedValueOnce([
      { id: 'fga_1', role: 'before' },
      { id: 'fga_2', role: 'after' },
    ]);

    const result = await createManualPair(mockDb as never, inputWithOptionals);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.faceGroup.clientName).toBe('Jane Doe');
    }
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = { ...validInput, organizationId: '' };

    await expectResult(
      createManualPair(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing batchId', async () => {
    const invalidInput = { ...validInput, batchId: '' };

    await expectResult(
      createManualPair(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing beforeAssetId', async () => {
    const invalidInput = { ...validInput, beforeAssetId: '' };

    await expectResult(
      createManualPair(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing afterAssetId', async () => {
    const invalidInput = { ...validInput, afterAssetId: '' };

    await expectResult(
      createManualPair(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR when before and after assets are the same', async () => {
    const sameAssetInput = {
      ...validInput,
      beforeAssetId: 'same_asset',
      afterAssetId: 'same_asset',
    };

    await expectResult(
      createManualPair(mockDb as never, sameAssetInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return NOT_FOUND when assets do not belong to the organization', async () => {
    // Only one asset found (should be 2)
    mockDb.where.mockResolvedValueOnce([{ id: 'asset_before' }]);

    await expectResult(
      createManualPair(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return NOT_FOUND when no assets are found', async () => {
    mockDb.where.mockResolvedValueOnce([]);

    await expectResult(
      createManualPair(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return ALREADY_EXISTS on duplicate constraint violation', async () => {
    mockDb.where.mockResolvedValueOnce([
      { id: 'asset_before' },
      { id: 'asset_after' },
    ]);

    mockDb.returning.mockRejectedValueOnce(
      drizzleUniqueViolation('face_group_asset_face_group_id_asset_id_unique')
    );

    await expectResult(
      createManualPair(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.ALREADY_EXISTS);
  });

  it('should return INTERNAL_ERROR on unexpected database error', async () => {
    mockDb.where.mockResolvedValueOnce([
      { id: 'asset_before' },
      { id: 'asset_after' },
    ]);

    mockDb.returning.mockRejectedValueOnce(new Error('Connection timeout'));

    await expectResult(
      createManualPair(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
