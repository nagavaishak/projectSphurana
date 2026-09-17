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
import { updateAssetContentType } from './update-asset-content-type.service.js';

describe('updateAssetContentType', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    assetId: 'asset_123',
    organizationId: 'org_123',
    contentType: 'testimonial' as const,
  };

  const mockAsset = {
    id: 'asset_123',
    name: 'Test Video',
    blobUrl: 'https://storage.example.com/video.mp4',
    organizationId: 'org_123',
    type: 'video',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('should update content type successfully', async () => {
    const updatedAnalysis = {
      id: 'analysis_123',
      assetId: 'asset_123',
      status: 'completed',
      contentType: 'testimonial',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.query.asset.findFirst.mockResolvedValueOnce(mockAsset);
    mockDb.returning.mockResolvedValueOnce([updatedAnalysis]);

    const result = await updateAssetContentType(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contentType).toBe('testimonial');
      expect(result.data.assetId).toBe('asset_123');
    }

    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith({ contentType: 'testimonial' });
  });

  it('should return NOT_FOUND when asset does not exist', async () => {
    mockDb.query.asset.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      updateAssetContentType(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return NOT_FOUND when analysis does not exist', async () => {
    mockDb.query.asset.findFirst.mockResolvedValueOnce(mockAsset);
    // returning returns empty array (no analysis record)
    mockDb.returning.mockResolvedValueOnce([]);

    await expectResult(
      updateAssetContentType(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return VALIDATION_ERROR for invalid contentType', async () => {
    const invalidInput = {
      assetId: 'asset_123',
      organizationId: 'org_123',
      contentType: 'invalid_type' as never,
    };

    await expectResult(
      updateAssetContentType(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.asset.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty assetId', async () => {
    const invalidInput = {
      assetId: '',
      organizationId: 'org_123',
      contentType: 'testimonial' as const,
    };

    await expectResult(
      updateAssetContentType(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.asset.findFirst).not.toHaveBeenCalled();
  });

  it('should return INTERNAL_ERROR on db failure', async () => {
    mockDb.query.asset.findFirst.mockResolvedValueOnce(mockAsset);
    mockDb.returning.mockRejectedValueOnce(new Error('Database error'));

    await expectResult(
      updateAssetContentType(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
