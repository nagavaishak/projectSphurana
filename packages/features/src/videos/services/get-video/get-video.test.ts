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
import { getVideo } from './get-video.service.js';

describe('getVideo', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'video_123',
  };

  it('should return video with creator info when found', async () => {
    const videoWithCreator = {
      id: 'video_123',
      title: 'Test Video',
      status: 'draft',
      progress: 0,
      draftConfig: { hook: 'Test', script: 'Script', cta: 'CTA' },
      templateId: 'template_123',
      organizationId: 'org_123',
      createdById: 'user_123',
      createdAt: new Date(),
      updatedAt: new Date(),
      creator: {
        id: 'user_123',
        name: 'John Doe',
        email: 'john@example.com',
        image: 'https://example.com/avatar.jpg',
      },
    };

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.leftJoin.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([videoWithCreator]);

    const result = await getVideo(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data?.id).toBe('video_123');
      expect(result.data?.title).toBe('Test Video');
      expect(result.data?.creator?.name).toBe('John Doe');
    }
  });

  it('should return video with null creator when user not found', async () => {
    const videoWithNullCreator = {
      id: 'video_123',
      title: 'Test Video',
      status: 'completed',
      progress: 100,
      blobUrl: 'https://example.com/video.mp4',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      durationMs: 30000,
      creator: null,
    };

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.leftJoin.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([videoWithNullCreator]);

    const result = await getVideo(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data?.creator).toBeNull();
    }
  });

  it('should return video with completed status and exported info', async () => {
    const completedVideo = {
      id: 'video_123',
      title: 'Test Video',
      status: 'completed',
      progress: 100,
      blobUrl: 'https://example.com/video.mp4',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      durationMs: 30000,
      exportedAt: new Date(),
      creator: null,
    };

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.leftJoin.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([completedVideo]);

    const result = await getVideo(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data?.status).toBe('completed');
      expect(result.data?.blobUrl).toBeDefined();
      expect(result.data?.exportedAt).toBeDefined();
    }
  });

  it('should return video with error message when failed', async () => {
    const failedVideo = {
      id: 'video_123',
      title: 'Test Video',
      status: 'error',
      progress: 50,
      errorMessage: 'Rendering failed: Out of memory',
      creator: null,
    };

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.leftJoin.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([failedVideo]);

    const result = await getVideo(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data?.status).toBe('error');
      expect(result.data?.errorMessage).toBe('Rendering failed: Out of memory');
    }
  });

  it('should return null when video not found', async () => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.leftJoin.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([]);

    const result = await getVideo(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    const invalidInput = {};

    await expectResult(
      getVideo(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
