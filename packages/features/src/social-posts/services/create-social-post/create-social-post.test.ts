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
import { createSocialPost } from './create-social-post.service.js';

describe('createSocialPost', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    createdById: 'user_123',
    title: 'Summer Sale Post',
    caption: 'Check out our summer sale!',
    mediaType: 'image' as const,
    mediaUrl: 'https://example.com/image.jpg',
    platforms: ['facebook', 'instagram'] as const,
  };

  it('should create social post with valid input', async () => {
    const createdPost = {
      id: 'post_123',
      ...validInput,
      status: 'draft',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([createdPost]);

    const result = await createSocialPost(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('Summer Sale Post');
      expect(result.data.status).toBe('draft');
    }
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('should auto-set status to scheduled when scheduledAt is provided', async () => {
    const inputWithSchedule = {
      ...validInput,
      scheduledAt: new Date('2024-01-15T10:00:00Z'),
    };

    const scheduledPost = {
      id: 'post_123',
      ...inputWithSchedule,
      status: 'scheduled',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([scheduledPost]);

    const result = await createSocialPost(mockDb as never, inputWithSchedule);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('scheduled');
    }
  });

  it('should respect explicit status even with scheduledAt', async () => {
    const inputWithExplicitStatus = {
      ...validInput,
      scheduledAt: new Date('2024-01-15T10:00:00Z'),
      status: 'draft' as const,
    };

    const draftPost = {
      id: 'post_123',
      ...inputWithExplicitStatus,
      status: 'draft',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([draftPost]);

    const result = await createSocialPost(
      mockDb as never,
      inputWithExplicitStatus
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('draft');
    }
  });

  it('should create post with video media type', async () => {
    const videoInput = {
      ...validInput,
      mediaType: 'video' as const,
      mediaUrl: 'https://example.com/video.mp4',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      videoId: 'video_123',
    };

    const videoPost = {
      id: 'post_123',
      ...videoInput,
      status: 'draft',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([videoPost]);

    const result = await createSocialPost(mockDb as never, videoInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mediaType).toBe('video');
      expect(result.data.videoId).toBe('video_123');
    }
  });

  it('should create post with platform settings', async () => {
    const inputWithSettings = {
      ...validInput,
      platformSettings: {
        facebook: { linkPreview: true },
        instagram: { shareToFeed: true },
      },
    };

    const postWithSettings = {
      id: 'post_123',
      ...inputWithSettings,
      status: 'draft',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([postWithSettings]);

    const result = await createSocialPost(mockDb as never, inputWithSettings);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.platformSettings).toEqual(
        inputWithSettings.platformSettings
      );
    }
  });

  it('should persist mediaUrls for a multi-image carousel', async () => {
    const carouselInput = {
      ...validInput,
      mediaUrl: 'https://example.com/slide-0.jpg',
      mediaUrls: [
        'https://example.com/slide-0.jpg',
        'https://example.com/slide-1.jpg',
        'https://example.com/slide-2.jpg',
      ],
    };

    mockDb.returning.mockResolvedValueOnce([
      { id: 'post_123', ...carouselInput, status: 'draft' },
    ]);

    const result = await createSocialPost(mockDb as never, carouselInput);

    expect(result.success).toBe(true);
    const inserted = mockDb.values.mock.calls[0][0];
    expect(inserted.mediaUrls).toEqual(carouselInput.mediaUrls);
    // First entry must equal the single mediaUrl for single-image consumers.
    expect(inserted.mediaUrls[0]).toBe(inserted.mediaUrl);
  });

  it('prepends mediaUrl and dedupes when building the carousel list', async () => {
    const carouselInput = {
      ...validInput,
      mediaUrl: 'https://example.com/slide-0.jpg',
      // mediaUrl missing from the list + a duplicate entry
      mediaUrls: [
        'https://example.com/slide-1.jpg',
        'https://example.com/slide-1.jpg',
        'https://example.com/slide-2.jpg',
      ],
    };

    mockDb.returning.mockResolvedValueOnce([
      { id: 'post_123', ...carouselInput, status: 'draft' },
    ]);

    await createSocialPost(mockDb as never, carouselInput);

    const inserted = mockDb.values.mock.calls[0][0];
    expect(inserted.mediaUrls).toEqual([
      'https://example.com/slide-0.jpg',
      'https://example.com/slide-1.jpg',
      'https://example.com/slide-2.jpg',
    ]);
  });

  it('collapses a single-entry mediaUrls list to null (normal post)', async () => {
    const singleInput = {
      ...validInput,
      mediaUrls: ['https://example.com/image.jpg'],
    };

    mockDb.returning.mockResolvedValueOnce([
      { id: 'post_123', ...singleInput, status: 'draft' },
    ]);

    await createSocialPost(mockDb as never, singleInput);

    const inserted = mockDb.values.mock.calls[0][0];
    expect(inserted.mediaUrls).toBeNull();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      createdById: 'user_123',
      title: 'Test Post',
      mediaType: 'image' as const,
      mediaUrl: 'https://example.com/image.jpg',
      platforms: ['facebook'] as const,
    };

    await expectResult(
      createSocialPost(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing createdById', async () => {
    const invalidInput = {
      organizationId: 'org_123',
      title: 'Test Post',
      mediaType: 'image' as const,
      mediaUrl: 'https://example.com/image.jpg',
      platforms: ['facebook'] as const,
    };

    await expectResult(
      createSocialPost(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty platforms array', async () => {
    const invalidInput = {
      ...validInput,
      platforms: [],
    };

    await expectResult(
      createSocialPost(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});
