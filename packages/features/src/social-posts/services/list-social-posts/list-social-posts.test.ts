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
import { listSocialPosts } from './list-social-posts.service.js';

describe('listSocialPosts', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // The page comes from `db.query.socialPost.findMany`; the count is a
    // separate `select().from().where()` chain, so `where` appears ONLY in the
    // count and can resolve unconditionally. Deliberately not equal to any
    // page length in these tests, so `total: items.length` cannot pass by
    // coincidence.
    mockDb.where.mockResolvedValue([{ value: 137 }] as never);
  });

  const validInput = {
    organizationId: 'org_123',
  };

  it('should return list of social posts', async () => {
    const posts = [
      {
        id: 'post_1',
        organizationId: 'org_123',
        title: 'Post 1',
        status: 'draft',
        scheduledAt: new Date('2024-01-20'),
      },
      {
        id: 'post_2',
        organizationId: 'org_123',
        title: 'Post 2',
        status: 'scheduled',
        scheduledAt: new Date('2024-01-15'),
      },
    ];

    mockDb.query.socialPost.findMany.mockResolvedValueOnce(posts);

    const result = await listSocialPosts(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      // `total` is the MATCH COUNT, not the page length. The mock returns a
      // number that differs from `items.length` on purpose, so a regression to
      // `total: items.length` fails here rather than passing by coincidence.
      expect(result.data.total).toBe(137);
      expect(result.data.total).not.toBe(result.data.items.length);
      expect(result.data.items).toHaveLength(2);
    }
  });

  it('should return empty array when no posts exist', async () => {
    mockDb.query.socialPost.findMany.mockResolvedValueOnce([]);

    const result = await listSocialPosts(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toEqual([]);
    }
  });

  it('should filter posts by status', async () => {
    const scheduledPosts = [
      {
        id: 'post_1',
        organizationId: 'org_123',
        title: 'Scheduled Post',
        status: 'scheduled',
      },
    ];

    mockDb.query.socialPost.findMany.mockResolvedValueOnce(scheduledPosts);

    const result = await listSocialPosts(mockDb as never, {
      ...validInput,
      status: 'scheduled',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0].status).toBe('scheduled');
    }
  });

  it('should filter posts by mediaType', async () => {
    const videoPosts = [
      {
        id: 'post_1',
        organizationId: 'org_123',
        title: 'Video Post',
        mediaType: 'video',
      },
    ];

    mockDb.query.socialPost.findMany.mockResolvedValueOnce(videoPosts);

    const result = await listSocialPosts(mockDb as never, {
      ...validInput,
      mediaType: 'video',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0].mediaType).toBe('video');
    }
  });

  it('should filter posts by platform', async () => {
    const instagramPosts = [
      {
        id: 'post_1',
        organizationId: 'org_123',
        title: 'Instagram Post',
        platforms: ['instagram'],
      },
    ];

    mockDb.query.socialPost.findMany.mockResolvedValueOnce(instagramPosts);

    const result = await listSocialPosts(mockDb as never, {
      ...validInput,
      platform: 'instagram',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(1);
    }
  });

  it('should filter posts by date range', async () => {
    const postsInRange = [
      {
        id: 'post_1',
        organizationId: 'org_123',
        title: 'January Post',
        scheduledAt: new Date('2024-01-15'),
      },
    ];

    mockDb.query.socialPost.findMany.mockResolvedValueOnce(postsInRange);

    const result = await listSocialPosts(mockDb as never, {
      ...validInput,
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-01-31'),
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(1);
    }
  });

  it('should search posts by title', async () => {
    const searchResults = [
      {
        id: 'post_1',
        organizationId: 'org_123',
        title: 'Summer Sale Campaign',
      },
    ];

    mockDb.query.socialPost.findMany.mockResolvedValueOnce(searchResults);

    const result = await listSocialPosts(mockDb as never, {
      ...validInput,
      search: 'Summer',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0].title).toContain('Summer');
    }
  });

  it('should apply pagination with limit and offset', async () => {
    const paginatedPosts = [
      { id: 'post_3', organizationId: 'org_123', title: 'Post 3' },
      { id: 'post_4', organizationId: 'org_123', title: 'Post 4' },
    ];

    mockDb.query.socialPost.findMany.mockResolvedValueOnce(paginatedPosts);

    const result = await listSocialPosts(mockDb as never, {
      ...validInput,
      limit: 2,
      offset: 2,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
    }
  });

  it('should combine multiple filters', async () => {
    const filteredPosts = [
      {
        id: 'post_1',
        organizationId: 'org_123',
        title: 'Scheduled Video for Instagram',
        status: 'scheduled',
        mediaType: 'video',
        platforms: ['instagram'],
      },
    ];

    mockDb.query.socialPost.findMany.mockResolvedValueOnce(filteredPosts);

    const result = await listSocialPosts(mockDb as never, {
      ...validInput,
      status: 'scheduled',
      mediaType: 'video',
      platform: 'instagram',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(1);
    }
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {};

    await expectResult(
      listSocialPosts(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
