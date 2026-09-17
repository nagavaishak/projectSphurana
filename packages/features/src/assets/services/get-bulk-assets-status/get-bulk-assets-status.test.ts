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
import { getBulkAssetsStatus } from './get-bulk-assets-status.service.js';

describe('getBulkAssetsStatus', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const mockAssets = [
    {
      id: 'asset_1',
      name: 'Video 1',
      type: 'video',
      blobUrl: 'https://storage.example.com/video1.mp4',
      tags: [],
    },
    {
      id: 'asset_2',
      name: 'Video 2',
      type: 'video',
      blobUrl: 'https://storage.example.com/video2.mp4',
      tags: [],
    },
    {
      id: 'asset_3',
      name: 'Image 1',
      type: 'image',
      blobUrl: 'https://storage.example.com/image1.jpg',
      tags: [],
    },
  ];

  it('should return status by batchId', async () => {
    const mockBatch = {
      id: 'batch_123',
      totalAssets: 3,
      completedAssets: 3,
      status: 'completed',
      organizationId: 'org_123',
    };

    const mockAnalysisRecords = [
      { id: 'analysis_1', assetId: 'asset_1', status: 'completed' },
      { id: 'analysis_2', assetId: 'asset_2', status: 'processing' },
    ];

    // Step 1: batch lookup
    mockDb.query.assetUploadBatch.findFirst.mockResolvedValueOnce(mockBatch);
    // Step 2: assets in batch
    mockDb.query.asset.findMany.mockResolvedValueOnce(mockAssets);
    // Step 3: analysis records
    mockDb.query.assetAnalysis.findMany.mockResolvedValueOnce(
      mockAnalysisRecords
    );

    const result = await getBulkAssetsStatus(mockDb as never, {
      organizationId: 'org_123',
      batchId: 'batch_123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.batch).toBeDefined();
      expect(result.data.batch?.id).toBe('batch_123');
      expect(result.data.assets).toHaveLength(3);
      expect(result.data.summary.total).toBe(3);
      expect(result.data.summary.videosTotal).toBe(2);
    }
  });

  it('should return status by assetIds', async () => {
    const mockAnalysisRecords = [
      { id: 'analysis_1', assetId: 'asset_1', status: 'completed' },
    ];

    // Step 1: assets by IDs
    mockDb.query.asset.findMany.mockResolvedValueOnce([mockAssets[0]]);
    // Step 2: analysis records
    mockDb.query.assetAnalysis.findMany.mockResolvedValueOnce(
      mockAnalysisRecords
    );

    const result = await getBulkAssetsStatus(mockDb as never, {
      organizationId: 'org_123',
      assetIds: ['asset_1'],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.batch).toBeNull();
      expect(result.data.assets).toHaveLength(1);
      expect(result.data.assets[0].analysisStatus).toBe('completed');
    }
  });

  it('returns the tags the worker persisted, so one poll answers both questions', async () => {
    // The upload UI polls this endpoint to learn when tagging finished. If the
    // tags did not come back with the status it would have to follow up with a
    // second request per asset, which is exactly the per-asset polling this
    // endpoint exists to replace.
    mockDb.query.asset.findMany.mockResolvedValueOnce([
      { ...mockAssets[0], tags: ['botox', 'clinic'] },
    ]);
    mockDb.query.assetAnalysis.findMany.mockResolvedValueOnce([
      { id: 'analysis_1', assetId: 'asset_1', status: 'completed' },
    ]);

    const result = await getBulkAssetsStatus(mockDb as never, {
      organizationId: 'org_123',
      assetIds: ['asset_1'],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assets[0].analysisStatus).toBe('completed');
      expect(result.data.assets[0].tags).toEqual(['botox', 'clinic']);
    }
  });

  it('should return NOT_FOUND when batch not found', async () => {
    mockDb.query.assetUploadBatch.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getBulkAssetsStatus(mockDb as never, {
        organizationId: 'org_123',
        batchId: 'nonexistent_batch',
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return VALIDATION_ERROR when neither batchId nor assetIds provided', async () => {
    await expectResult(
      getBulkAssetsStatus(mockDb as never, {
        organizationId: 'org_123',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.assetUploadBatch.findFirst).not.toHaveBeenCalled();
    expect(mockDb.query.asset.findMany).not.toHaveBeenCalled();
  });

  it('should return correct summary with mixed analysis statuses', async () => {
    const mockBatch = {
      id: 'batch_123',
      totalAssets: 3,
      status: 'completed',
      organizationId: 'org_123',
    };

    const videoAssets = [
      {
        id: 'asset_1',
        name: 'Video 1',
        type: 'video',
        blobUrl: 'https://storage.example.com/v1.mp4',
      },
      {
        id: 'asset_2',
        name: 'Video 2',
        type: 'video',
        blobUrl: 'https://storage.example.com/v2.mp4',
      },
      {
        id: 'asset_3',
        name: 'Video 3',
        type: 'video',
        blobUrl: 'https://storage.example.com/v3.mp4',
      },
      {
        id: 'asset_4',
        name: 'Video 4',
        type: 'video',
        blobUrl: 'https://storage.example.com/v4.mp4',
      },
    ];

    const mixedAnalysis = [
      { id: 'a1', assetId: 'asset_1', status: 'completed' },
      { id: 'a2', assetId: 'asset_2', status: 'processing' },
      { id: 'a3', assetId: 'asset_3', status: 'failed' },
      // asset_4 has no analysis record -> pending
    ];

    mockDb.query.assetUploadBatch.findFirst.mockResolvedValueOnce(mockBatch);
    mockDb.query.asset.findMany.mockResolvedValueOnce(videoAssets);
    mockDb.query.assetAnalysis.findMany.mockResolvedValueOnce(mixedAnalysis);

    const result = await getBulkAssetsStatus(mockDb as never, {
      organizationId: 'org_123',
      batchId: 'batch_123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.summary.total).toBe(4);
      expect(result.data.summary.videosTotal).toBe(4);
      expect(result.data.summary.analysisCompleted).toBe(1);
      expect(result.data.summary.analysisProcessing).toBe(1);
      expect(result.data.summary.analysisFailed).toBe(1);
      expect(result.data.summary.analysisPending).toBe(1);
    }
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    await expectResult(
      getBulkAssetsStatus(mockDb as never, {
        organizationId: '',
        batchId: 'batch_123',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
