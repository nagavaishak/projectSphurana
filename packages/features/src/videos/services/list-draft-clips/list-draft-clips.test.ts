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
import { listDraftClips } from './list-draft-clips.service.js';

const VID = '550e8400-e29b-41d4-a716-446655440000';
const ORG = 'org_123';
const OTHER_ORG = 'org_999';

describe('listDraftClips', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('returns empty clips array when tray has no rows', async () => {
    // First select: parent video lookup
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([{ id: VID, organizationId: ORG }]);

    // Second select: clip rows + asset join
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.leftJoin.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockResolvedValueOnce([]);

    const result = await listDraftClips(mockDb as never, {
      videoId: VID,
      organizationId: ORG,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.clips).toEqual([]);
  });

  it('joins asset metadata for ready rows and leaves null for in-flight uploads', async () => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([{ id: VID, organizationId: ORG }]);

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.leftJoin.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockResolvedValueOnce([
      {
        id: 'clip_a',
        videoId: VID,
        assetId: 'asset_a',
        source: 'uploaded',
        beatOrder: 0,
        processingStatus: 'ready',
        createdAt: new Date('2026-04-26T10:00:00Z'),
        updatedAt: new Date('2026-04-26T10:00:00Z'),
        assetIdJoined: 'asset_a',
        assetName: 'procedure.mp4',
        assetType: 'video',
        assetDuration: 12.5,
        assetBlobUrl: 'https://s3/asset_a.mp4',
        assetThumbnailUrl: 'https://s3/asset_a-thumb.jpg',
        assetTags: ['procedure', 'closeup'],
      },
      {
        id: 'clip_b',
        videoId: VID,
        assetId: null,
        source: 'uploaded',
        beatOrder: 1,
        processingStatus: 'uploading',
        createdAt: new Date('2026-04-26T10:01:00Z'),
        updatedAt: new Date('2026-04-26T10:01:00Z'),
        assetIdJoined: null,
        assetName: null,
        assetType: null,
        assetDuration: null,
        assetBlobUrl: null,
        assetThumbnailUrl: null,
        assetTags: null,
      },
    ]);

    const result = await listDraftClips(mockDb as never, {
      videoId: VID,
      organizationId: ORG,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clips).toHaveLength(2);
      expect(result.data.clips[0].asset?.name).toBe('procedure.mp4');
      expect(result.data.clips[0].asset?.tags).toEqual([
        'procedure',
        'closeup',
      ]);
      expect(result.data.clips[1].asset).toBeNull();
      expect(result.data.clips[1].processingStatus).toBe('uploading');
    }
  });

  it('returns NOT_FOUND when video does not exist', async () => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([]);

    await expectResult(
      listDraftClips(mockDb as never, { videoId: VID, organizationId: ORG })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns NOT_FOUND for cross-org access (foreign org videoId)', async () => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([
      { id: VID, organizationId: OTHER_ORG },
    ]);

    await expectResult(
      listDraftClips(mockDb as never, { videoId: VID, organizationId: ORG })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for non-uuid videoId', async () => {
    await expectResult(
      listDraftClips(mockDb as never, {
        videoId: 'not-a-uuid',
        organizationId: ORG,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for empty organizationId', async () => {
    await expectResult(
      listDraftClips(mockDb as never, { videoId: VID, organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
