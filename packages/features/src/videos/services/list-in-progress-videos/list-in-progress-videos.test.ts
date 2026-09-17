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

// The real `../../templates/index.js` barrel is used on purpose: it is pure
// data + pure lookup helpers, and every fixture below has `variationId: null`,
// so `getVariationById` returns `null` naturally. Under `isolate: false` a
// file-local `vi.mock` of this internal barrel would persist on the shared
// worker graph and delete every export the factory omitted for later files.
import { listInProgressVideos } from './list-in-progress-videos.service.js';

describe('listInProgressVideos', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
  };

  it('should return incomplete draft videos', async () => {
    const draftVideos = [
      {
        id: 'video_1',
        title: 'Incomplete Video',
        status: 'draft',
        variationId: null,
        templateId: 'template_1',
        thumbnailUrl: null,
        createdAt: new Date('2024-01-15'),
        draftConfig: null,
      },
      {
        id: 'video_2',
        title: 'Another Incomplete',
        status: 'draft',
        variationId: null,
        templateId: 'template_2',
        thumbnailUrl: null,
        createdAt: new Date('2024-01-14'),
        draftConfig: {},
      },
    ];
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockResolvedValueOnce(draftVideos);

    const result = await listInProgressVideos(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items.length).toBe(2);
      expect(result.data.total).toBe(2);
      expect(result.data.items[0].id).toBe('video_1');
      expect(result.data.items[0].slotSummary.needsTalkingHead).toBe(true);
    }
  });

  it('should filter out complete videos (all slots filled)', async () => {
    const draftVideos = [
      {
        id: 'video_complete',
        title: 'Complete Video',
        status: 'draft',
        variationId: null,
        templateId: 'template_1',
        thumbnailUrl: null,
        createdAt: new Date(),
        draftConfig: {
          talkingHeadAssetId: 'asset_1',
          talkingHeadUrl: 'https://example.com/th.mp4',
        },
      },
    ];
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockResolvedValueOnce(draftVideos);

    const result = await listInProgressVideos(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items.length).toBe(0);
      expect(result.data.total).toBe(0);
    }
  });

  it('should apply pagination correctly', async () => {
    const draftVideos = Array.from({ length: 5 }, (_, i) => ({
      id: `video_${i + 1}`,
      title: `Video ${i + 1}`,
      status: 'draft',
      variationId: null,
      templateId: 'template_1',
      thumbnailUrl: null,
      createdAt: new Date(),
      draftConfig: null,
    }));
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockResolvedValueOnce(draftVideos);

    const result = await listInProgressVideos(mockDb as never, {
      ...validInput,
      limit: 2,
      offset: 1,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items.length).toBe(2);
      expect(result.data.total).toBe(5);
      expect(result.data.items[0].id).toBe('video_2');
      expect(result.data.items[1].id).toBe('video_3');
    }
  });

  it('should return empty list when no draft videos exist', async () => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockResolvedValueOnce([]);

    const result = await listInProgressVideos(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toEqual([]);
      expect(result.data.total).toBe(0);
    }
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      listInProgressVideos(mockDb as never, {} as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    await expectResult(
      listInProgressVideos(mockDb as never, { organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should use default limit and offset', async () => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockResolvedValueOnce([]);

    const result = await listInProgressVideos(mockDb as never, validInput);

    expect(result.success).toBe(true);
  });
});
