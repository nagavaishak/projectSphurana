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
import { getSocialPost } from './get-social-post.service.js';

describe('getSocialPost', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'post_123',
    organizationId: 'org_123',
  };

  it('should return social post when found', async () => {
    const existingPost = {
      id: 'post_123',
      organizationId: 'org_123',
      title: 'Test Post',
      caption: 'Test caption',
      mediaType: 'image',
      mediaUrl: 'https://example.com/image.jpg',
      platforms: ['facebook', 'instagram'],
      status: 'draft',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(existingPost);

    const result = await getSocialPost(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('post_123');
      expect(result.data.title).toBe('Test Post');
    }
  });

  it('should return scheduled post with scheduledAt', async () => {
    const scheduledPost = {
      id: 'post_123',
      organizationId: 'org_123',
      title: 'Scheduled Post',
      status: 'scheduled',
      scheduledAt: new Date('2024-01-15T10:00:00Z'),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(scheduledPost);

    const result = await getSocialPost(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('scheduled');
      expect(result.data.scheduledAt).toEqual(new Date('2024-01-15T10:00:00Z'));
    }
  });

  it('should return published post with platformResults', async () => {
    const publishedPost = {
      id: 'post_123',
      organizationId: 'org_123',
      title: 'Published Post',
      status: 'published',
      publishedAt: new Date(),
      platformResults: [
        {
          platform: 'facebook',
          success: true,
          postId: 'fb_123',
          postUrl: 'https://facebook.com/fb_123',
        },
        {
          platform: 'instagram',
          success: true,
          postId: 'ig_123',
          postUrl: 'https://instagram.com/p/ig_123',
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(publishedPost);

    const result = await getSocialPost(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('published');
      expect(result.data.platformResults).toHaveLength(2);
    }
  });

  it('should return NOT_FOUND when post does not exist', async () => {
    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(null);

    await expectResult(getSocialPost(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(error.message).toBe('Social post not found');
      }
    );
  });

  it('should return NOT_FOUND for post from different organization', async () => {
    // findFirst with organization filter returns null for wrong org
    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(null);

    const result = await getSocialPost(mockDb as never, {
      id: 'post_123',
      organizationId: 'different_org',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    const invalidInput = { organizationId: 'org_123' };

    await expectResult(
      getSocialPost(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = { id: 'post_123' };

    await expectResult(
      getSocialPost(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
