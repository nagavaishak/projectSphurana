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
import { queueAssetAnalysis } from './queue-asset-analysis.service.js';

describe('queueAssetAnalysis', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    assetId: 'asset_123',
    organizationId: 'org_123',
  };

  const mockAsset = {
    id: 'asset_123',
    name: 'Test Video',
    blobUrl: 'https://storage.example.com/video.mp4',
    type: 'video',
    source: 'upload',
    organizationId: 'org_123',
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('should queue analysis for valid video asset (new analysis)', async () => {
    const mockAnalysis = {
      id: 'analysis_123',
      assetId: 'asset_123',
      status: 'queued',
      queuedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Asset exists
    mockDb.query.asset.findFirst.mockResolvedValueOnce(mockAsset);
    // No existing analysis
    mockDb.query.assetAnalysis.findFirst.mockResolvedValueOnce(null);
    // Insert new analysis
    mockDb.returning.mockResolvedValueOnce([mockAnalysis]);

    const result = await queueAssetAnalysis(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('analysis_123');
      expect(result.data.status).toBe('queued');
    }

    expect(mockDb.query.asset.findFirst).toHaveBeenCalled();
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('should return NOT_FOUND when asset does not exist', async () => {
    mockDb.query.asset.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      queueAssetAnalysis(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for edited assets', async () => {
    const editedAsset = {
      ...mockAsset,
      source: 'edited',
    };

    mockDb.query.asset.findFirst.mockResolvedValueOnce(editedAsset);

    await expectResult(
      queueAssetAnalysis(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return CONFLICT when analysis is already processing', async () => {
    const processingAnalysis = {
      id: 'analysis_123',
      assetId: 'asset_123',
      status: 'processing',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.query.asset.findFirst.mockResolvedValueOnce(mockAsset);
    mockDb.query.assetAnalysis.findFirst.mockResolvedValueOnce(
      processingAnalysis
    );

    await expectResult(
      queueAssetAnalysis(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.CONFLICT);

    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should re-queue analysis for failed analysis (updates existing)', async () => {
    const failedAnalysis = {
      id: 'analysis_123',
      assetId: 'asset_123',
      status: 'failed',
      errorMessage: 'Previous error',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const updatedAnalysis = {
      ...failedAnalysis,
      status: 'queued',
      errorMessage: null,
      queuedAt: new Date(),
    };

    mockDb.query.asset.findFirst.mockResolvedValueOnce(mockAsset);
    mockDb.query.assetAnalysis.findFirst.mockResolvedValueOnce(failedAnalysis);
    mockDb.returning.mockResolvedValueOnce([updatedAnalysis]);

    const result = await queueAssetAnalysis(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('queued');
      expect(result.data.errorMessage).toBeNull();
    }

    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty assetId', async () => {
    const invalidInput = {
      assetId: '',
      organizationId: 'org_123',
    };

    await expectResult(
      queueAssetAnalysis(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.asset.findFirst).not.toHaveBeenCalled();
  });
});
