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
import { updateFaceGroupAssetRole } from './update-face-group-asset-role.service.js';

describe('updateFaceGroupAssetRole', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    faceGroupId: 'fg_123',
    assetId: 'asset_123',
    organizationId: 'org_123',
    role: 'before' as const,
  };

  it('should update asset role to before', async () => {
    mockDb.query.faceGroup.findFirst.mockResolvedValueOnce({
      id: 'fg_123',
      organizationId: 'org_123',
    });

    const updatedAsset = {
      id: 'fga_123',
      faceGroupId: 'fg_123',
      assetId: 'asset_123',
      role: 'before',
    };
    mockDb.returning.mockResolvedValueOnce([updatedAsset]);

    const result = await updateFaceGroupAssetRole(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe('before');
    }
  });

  it('should update asset role to after', async () => {
    mockDb.query.faceGroup.findFirst.mockResolvedValueOnce({
      id: 'fg_123',
      organizationId: 'org_123',
    });

    const updatedAsset = {
      id: 'fga_123',
      faceGroupId: 'fg_123',
      assetId: 'asset_123',
      role: 'after',
    };
    mockDb.returning.mockResolvedValueOnce([updatedAsset]);

    const result = await updateFaceGroupAssetRole(mockDb as never, {
      ...validInput,
      role: 'after',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe('after');
    }
  });

  it('should update asset role to untagged', async () => {
    mockDb.query.faceGroup.findFirst.mockResolvedValueOnce({
      id: 'fg_123',
      organizationId: 'org_123',
    });

    const updatedAsset = {
      id: 'fga_123',
      faceGroupId: 'fg_123',
      assetId: 'asset_123',
      role: 'untagged',
    };
    mockDb.returning.mockResolvedValueOnce([updatedAsset]);

    const result = await updateFaceGroupAssetRole(mockDb as never, {
      ...validInput,
      role: 'untagged',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe('untagged');
    }
  });

  it('should return NOT_FOUND when face group does not exist', async () => {
    mockDb.query.faceGroup.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      updateFaceGroupAssetRole(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return NOT_FOUND when face group asset association does not exist', async () => {
    mockDb.query.faceGroup.findFirst.mockResolvedValueOnce({
      id: 'fg_123',
      organizationId: 'org_123',
    });

    // Update returns empty array (no rows affected)
    mockDb.returning.mockResolvedValueOnce([]);

    await expectResult(
      updateFaceGroupAssetRole(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return VALIDATION_ERROR for missing faceGroupId', async () => {
    await expectResult(
      updateFaceGroupAssetRole(mockDb as never, {
        ...validInput,
        faceGroupId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing assetId', async () => {
    await expectResult(
      updateFaceGroupAssetRole(mockDb as never, { ...validInput, assetId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      updateFaceGroupAssetRole(mockDb as never, {
        ...validInput,
        organizationId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for invalid role', async () => {
    await expectResult(
      updateFaceGroupAssetRole(mockDb as never, {
        ...validInput,
        role: 'invalid_role' as never,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
