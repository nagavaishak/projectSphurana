import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import * as queueAssetAnalysisModule from '../queue-asset-analysis/queue-asset-analysis.service.js';
import { createBulkAssets } from './create-bulk-assets.service.js';

// Restored `vi.spyOn`, NOT `vi.mock` — under `isolate: false` all files in a
// worker share one module graph, so a hoisted bare-factory mock of an internal
// module leaks outward (deleting the exports it omits) and silently misses
// whenever an earlier file already imported the real module. Only
// `getAssetAnalysisQueue` needs stubbing (it would otherwise build a real
// BullMQ queue); the `ANALYSIS_PRIORITY` schema mock was pure data identical to
// the real export, so it is DELETED rather than converted.
let mockGetAssetAnalysisQueue: MockInstance;

describe('createBulkAssets', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockGetAssetAnalysisQueue = vi
      .spyOn(queueAssetAnalysisModule, 'getAssetAnalysisQueue')
      .mockReturnValue({ add: async () => ({}) } as never);
  });

  afterEach(() => {
    mockGetAssetAnalysisQueue.mockRestore();
  });

  const validInput = {
    assets: [
      {
        name: 'Video 1',
        blobUrl: 'https://storage.example.com/video1.mp4',
      },
      {
        name: 'Video 2',
        blobUrl: 'https://storage.example.com/video2.mp4',
      },
    ],
    organizationId: 'org_123',
    uploadedById: 'user_123',
    autoAnalyze: true,
  };

  it('should create assets with valid input', async () => {
    const mockBatch = {
      id: 'batch_123',
      totalAssets: 2,
      completedAssets: 0,
      failedAssets: 0,
      status: 'processing',
      organizationId: 'org_123',
      createdById: 'user_123',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockAssets = [
      {
        id: 'asset_1',
        name: 'Video 1',
        blobUrl: 'https://storage.example.com/video1.mp4',
        type: 'video',
        organizationId: 'org_123',
      },
      {
        id: 'asset_2',
        name: 'Video 2',
        blobUrl: 'https://storage.example.com/video2.mp4',
        type: 'video',
        organizationId: 'org_123',
      },
    ];

    // Transaction: first returning() for batch, second for assets
    mockDb.returning
      .mockResolvedValueOnce([mockBatch])
      .mockResolvedValueOnce(mockAssets)
      // Analysis record inserts (one per video asset)
      .mockResolvedValueOnce([
        { id: 'analysis_1', assetId: 'asset_1', status: 'queued' },
      ])
      .mockResolvedValueOnce([
        { id: 'analysis_2', assetId: 'asset_2', status: 'queued' },
      ]);

    const result = await createBulkAssets(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assets).toHaveLength(2);
      expect(result.data.batch.status).toBe('completed');
      expect(result.data.assets[0].name).toBe('Video 1');
      expect(result.data.assets[1].name).toBe('Video 2');
    }

    expect(mockDb.transaction).toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty assets array', async () => {
    const invalidInput = {
      ...validInput,
      assets: [],
    };

    await expectResult(
      createBulkAssets(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      ...validInput,
      organizationId: '',
    };

    await expectResult(
      createBulkAssets(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for invalid blobUrl in asset', async () => {
    const invalidInput = {
      ...validInput,
      assets: [
        {
          name: 'Video 1',
          blobUrl: 'not-a-valid-url',
        },
      ],
    };

    await expectResult(
      createBulkAssets(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it('should return INTERNAL_ERROR on transaction failure', async () => {
    mockDb.transaction.mockRejectedValueOnce(new Error('Transaction failed'));

    const result = await createBulkAssets(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('should create assets without auto-analyze', async () => {
    const inputNoAnalyze = {
      ...validInput,
      autoAnalyze: false,
    };

    const mockBatch = {
      id: 'batch_123',
      totalAssets: 2,
      completedAssets: 0,
      failedAssets: 0,
      status: 'processing',
      organizationId: 'org_123',
      createdById: 'user_123',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockAssets = [
      {
        id: 'asset_1',
        name: 'Video 1',
        blobUrl: 'https://storage.example.com/video1.mp4',
        type: 'video',
        organizationId: 'org_123',
      },
      {
        id: 'asset_2',
        name: 'Video 2',
        blobUrl: 'https://storage.example.com/video2.mp4',
        type: 'video',
        organizationId: 'org_123',
      },
    ];

    mockDb.returning
      .mockResolvedValueOnce([mockBatch])
      .mockResolvedValueOnce(mockAssets);

    const result = await createBulkAssets(mockDb as never, inputNoAnalyze);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.analysisQueued).toBe(0);
    }
  });
});
