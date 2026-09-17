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
import { updateSocialPost } from './update-social-post.service.js';

describe('updateSocialPost', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'post_123',
    organizationId: 'org_123',
    title: 'Updated Title',
  };

  it('should update social post with valid input', async () => {
    const existingPost = {
      id: 'post_123',
      organizationId: 'org_123',
      title: 'Original Title',
      status: 'draft',
    };

    const updatedPost = {
      ...existingPost,
      title: 'Updated Title',
      updatedAt: new Date(),
    };

    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(existingPost);
    mockDb.returning.mockResolvedValueOnce([updatedPost]);

    const result = await updateSocialPost(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('Updated Title');
    }
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should update multiple fields at once', async () => {
    const existingPost = {
      id: 'post_123',
      organizationId: 'org_123',
      title: 'Original',
      caption: 'Original caption',
      status: 'draft',
    };

    const updateInput = {
      id: 'post_123',
      organizationId: 'org_123',
      title: 'New Title',
      caption: 'New caption',
      platforms: ['facebook', 'instagram'] as const,
    };

    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(existingPost);
    mockDb.returning.mockResolvedValueOnce([
      { ...existingPost, ...updateInput },
    ]);

    const result = await updateSocialPost(mockDb as never, updateInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('New Title');
      expect(result.data.caption).toBe('New caption');
    }
  });

  it('should auto-set status to scheduled when scheduledAt is set', async () => {
    const existingPost = {
      id: 'post_123',
      organizationId: 'org_123',
      status: 'draft',
      scheduledAt: null,
    };

    const updateInput = {
      id: 'post_123',
      organizationId: 'org_123',
      scheduledAt: new Date('2024-01-15T10:00:00Z'),
    };

    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(existingPost);
    mockDb.returning.mockResolvedValueOnce([
      { ...existingPost, ...updateInput, status: 'scheduled' },
    ]);

    const result = await updateSocialPost(mockDb as never, updateInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('scheduled');
    }
  });

  it('should auto-set status to draft when scheduledAt is cleared', async () => {
    const existingPost = {
      id: 'post_123',
      organizationId: 'org_123',
      status: 'scheduled',
      scheduledAt: new Date('2024-01-15T10:00:00Z'),
    };

    const updateInput = {
      id: 'post_123',
      organizationId: 'org_123',
      scheduledAt: null,
    };

    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(existingPost);
    mockDb.returning.mockResolvedValueOnce([
      { ...existingPost, scheduledAt: null, status: 'draft' },
    ]);

    const result = await updateSocialPost(mockDb as never, updateInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('draft');
    }
  });

  it('should return NOT_FOUND when post does not exist', async () => {
    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      updateSocialPost(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toBe('Social post not found');
    });

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return CONFLICT for published post', async () => {
    const publishedPost = {
      id: 'post_123',
      organizationId: 'org_123',
      status: 'published',
    };

    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(publishedPost);

    await expectResult(
      updateSocialPost(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.CONFLICT);
      expect(error.message).toContain('published');
    });

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return CONFLICT for publishing post', async () => {
    const publishingPost = {
      id: 'post_123',
      organizationId: 'org_123',
      status: 'publishing',
    };

    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(publishingPost);

    await expectResult(
      updateSocialPost(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.CONFLICT);
      expect(error.message).toContain('publishing');
    });

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should allow updating scheduled post', async () => {
    const scheduledPost = {
      id: 'post_123',
      organizationId: 'org_123',
      title: 'Scheduled Post',
      status: 'scheduled',
    };

    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(scheduledPost);
    mockDb.returning.mockResolvedValueOnce([
      { ...scheduledPost, title: 'Updated Title' },
    ]);

    const result = await updateSocialPost(mockDb as never, validInput);

    expect(result.success).toBe(true);
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    const invalidInput = {
      organizationId: 'org_123',
      title: 'New Title',
    };

    await expectResult(
      updateSocialPost(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      id: 'post_123',
      title: 'New Title',
    };

    await expectResult(
      updateSocialPost(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.update).not.toHaveBeenCalled();
  });
});
