import { deleteObject, parseS3Url } from '@borradh-workspace/storage';
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

// `@borradh-workspace/storage` is a canonically aliased mock (vite.config.ts) —
// drive its `vi.fn()`s with `vi.mocked()` rather than a file-local `vi.mock`,
// which would leak under `isolate: false`.
const mocks = {
  mockDeleteObject: vi.mocked(deleteObject),
  mockParseS3Url: vi.mocked(parseS3Url),
};

import { cleanupOrphanedAssets } from './cleanup-orphaned-assets.service.js';

describe('cleanupOrphanedAssets', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // `.mockReset()` drops any queued `*Once` left by a prior test/sibling file
    // (which `vi.clearAllMocks()` does NOT clear).
    mocks.mockDeleteObject.mockReset();
    mocks.mockParseS3Url.mockReset();
  });

  const validInput = { organizationId: 'org_123' };

  it('should delete orphaned assets', async () => {
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48 hours ago
    mockDb.query.asset.findMany.mockResolvedValueOnce([
      {
        id: 'asset_1',
        blobUrl: 'https://s3.example.com/file.mp4',
        createdAt: oldDate,
      },
      {
        id: 'asset_2',
        blobUrl: 'https://s3.example.com/file2.mp4',
        createdAt: oldDate,
      },
    ]);
    mockDb.query.video.findMany.mockResolvedValueOnce([
      { id: 'video_1', draftConfig: { bRollClips: [{ assetId: 'asset_2' }] } },
    ]);
    mocks.mockParseS3Url.mockReturnValue({ bucket: 'test', key: 'file.mp4' });
    mocks.mockDeleteObject.mockResolvedValue(undefined);
    mockDb.delete.mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });

    const result = await cleanupOrphanedAssets(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deletedCount).toBe(1);
      expect(result.data.orphanedAssetIds).toContain('asset_1');
      expect(result.data.orphanedAssetIds).not.toContain('asset_2');
    }
  });

  it('should return empty result when no assets', async () => {
    mockDb.query.asset.findMany.mockResolvedValueOnce([]);

    const result = await cleanupOrphanedAssets(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deletedCount).toBe(0);
      expect(result.data.orphanedAssetIds).toEqual([]);
    }
  });

  it('should support dry run mode', async () => {
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
    mockDb.query.asset.findMany.mockResolvedValueOnce([
      {
        id: 'asset_1',
        blobUrl: 'https://s3.example.com/file.mp4',
        createdAt: oldDate,
      },
    ]);
    mockDb.query.video.findMany.mockResolvedValueOnce([]);

    const result = await cleanupOrphanedAssets(mockDb as never, {
      ...validInput,
      dryRun: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deletedCount).toBe(0);
      expect(result.data.orphanedAssetIds).toContain('asset_1');
    }
    expect(mocks.mockDeleteObject).not.toHaveBeenCalled();
  });

  it('should track errors for individual asset deletion failures', async () => {
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
    mockDb.query.asset.findMany.mockResolvedValueOnce([
      {
        id: 'asset_1',
        blobUrl: 'https://s3.example.com/file.mp4',
        createdAt: oldDate,
      },
    ]);
    mockDb.query.video.findMany.mockResolvedValueOnce([]);
    mocks.mockParseS3Url.mockReturnValue({ bucket: 'test', key: 'file.mp4' });
    mocks.mockDeleteObject.mockRejectedValueOnce(new Error('S3 error'));

    const result = await cleanupOrphanedAssets(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.errors.length).toBe(1);
      expect(result.data.deletedCount).toBe(0);
    }
  });

  it('should respect minAgeHours filter', async () => {
    const recentDate = new Date(); // just created
    mockDb.query.asset.findMany.mockResolvedValueOnce([
      {
        id: 'asset_1',
        blobUrl: 'https://s3.example.com/file.mp4',
        createdAt: recentDate,
      },
    ]);
    mockDb.query.video.findMany.mockResolvedValueOnce([]);

    const result = await cleanupOrphanedAssets(mockDb as never, {
      ...validInput,
      minAgeHours: 24,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deletedCount).toBe(0);
      expect(result.data.orphanedAssetIds).toEqual([]);
    }
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    await expectResult(
      cleanupOrphanedAssets(mockDb as never, { organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
