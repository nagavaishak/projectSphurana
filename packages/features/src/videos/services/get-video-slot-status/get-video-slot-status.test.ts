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
import { getVideoSlotStatus } from './get-video-slot-status.service.js';

describe('getVideoSlotStatus', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { videoId: 'video_123' };

  it('should return slot status for video without variation', async () => {
    const videoData = {
      id: 'video_123',
      title: 'Test Video',
      variationId: null,
      thumbnailUrl: null,
      draftConfig: null,
    };
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([videoData]);

    const result = await getVideoSlotStatus(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.videoId).toBe('video_123');
      expect(result.data.title).toBe('Test Video');
      expect(result.data.slots).toHaveLength(1);
      expect(result.data.slots[0].type).toBe('talkingHead');
      expect(result.data.slots[0].filled).toBeNull();
      expect(result.data.isComplete).toBe(false);
    }
  });

  it('should show talking head as filled when asset exists', async () => {
    const videoData = {
      id: 'video_123',
      title: 'Test Video',
      variationId: null,
      thumbnailUrl: null,
      draftConfig: {
        talkingHeadAssetId: 'asset_123',
        talkingHeadUrl: 'https://example.com/talking-head.mp4',
      },
    };
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([videoData]);

    const result = await getVideoSlotStatus(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slots[0].filled).not.toBeNull();
      expect(result.data.slots[0].filled?.assetId).toBe('asset_123');
      expect(result.data.isComplete).toBe(true);
    }
  });

  it('should extract script from legacy draftConfig fields', async () => {
    const videoData = {
      id: 'video_123',
      title: 'Test Video',
      variationId: null,
      thumbnailUrl: null,
      draftConfig: {
        hook: 'This is the hook',
        script: 'This is the body',
        cta: 'Call to action',
      },
    };
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([videoData]);

    const result = await getVideoSlotStatus(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.script).not.toBeNull();
      expect(result.data.script?.hook).toBe('This is the hook');
      expect(result.data.script?.body).toBe('This is the body');
      expect(result.data.script?.cta).toBe('Call to action');
      expect(result.data.script?.fullText).toContain('This is the hook');
      expect(result.data.script?.fullText).toContain('This is the body');
      expect(result.data.script?.fullText).toContain('Call to action');
    }
  });

  it('should return null script when no script data exists', async () => {
    const videoData = {
      id: 'video_123',
      title: 'Test Video',
      variationId: null,
      thumbnailUrl: null,
      draftConfig: null,
    };
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([videoData]);

    const result = await getVideoSlotStatus(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.script).toBeNull();
    }
  });

  it('should return NOT_FOUND when video does not exist', async () => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([]);

    await expectResult(
      getVideoSlotStatus(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return VALIDATION_ERROR for missing videoId', async () => {
    await expectResult(
      getVideoSlotStatus(mockDb as never, {} as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty videoId', async () => {
    await expectResult(
      getVideoSlotStatus(mockDb as never, { videoId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
