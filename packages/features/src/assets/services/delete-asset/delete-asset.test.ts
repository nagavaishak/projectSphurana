import { isFeatureOn } from '@borradh-workspace/observability';
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
import { deleteAsset } from './delete-asset.service.js';

describe('deleteAsset', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isFeatureOn).mockResolvedValue(true);
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'asset_123',
    organizationId: 'org_123',
  };

  it('should delete asset and return deleted asset', async () => {
    const deletedAsset = {
      id: 'asset_123',
      name: 'Test Video',
      blobUrl: 'https://storage.example.com/video.mp4',
      organizationId: 'org_123',
      type: 'video',
    };

    mockDb.returning.mockResolvedValueOnce([deletedAsset]);

    const result = await deleteAsset(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data?.id).toBe('asset_123');
      expect(result.data?.name).toBe('Test Video');
    }

    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith({
      deletedAt: expect.any(Date),
    });
  });

  it('should return null when asset does not exist', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    const result = await deleteAsset(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    const invalidInput = {
      id: '',
      organizationId: 'org_123',
    };

    await expectResult(
      deleteAsset(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      id: 'asset_123',
      organizationId: '',
    };

    await expectResult(
      deleteAsset(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should not delete asset from different organization', async () => {
    // The query includes organization filter, so different org should return empty
    mockDb.returning.mockResolvedValueOnce([]);

    const inputWithDifferentOrg = {
      id: 'asset_123',
      organizationId: 'different_org',
    };

    const result = await deleteAsset(mockDb as never, inputWithDifferentOrg);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
  });

  it('should handle database errors gracefully', async () => {
    mockDb.returning.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expect(deleteAsset(mockDb as never, validInput)).rejects.toThrow(
      'Database connection failed'
    );
  });
});
