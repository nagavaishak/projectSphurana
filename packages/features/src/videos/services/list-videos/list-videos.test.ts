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
import { listVideos } from './list-videos.service.js';

describe('listVideos', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  /**
   * `listVideos` issues TWO queries on the same builder: the page
   * (`.where().orderBy().limit().offset()`) and then a `SELECT count(*)`
   * (`.where()`, awaited). So `where` must CHAIN on the first call and RESOLVE
   * on the second. Passing a total different from the page length is what makes
   * these tests able to tell a real count from `items.length`.
   */
  const mockPageThenCount = (total: number) => {
    mockDb.where
      .mockReturnValueOnce(mockDb as never)
      .mockResolvedValueOnce([{ value: total }] as never);
  };

  const validInput = {
    organizationId: 'org_123',
    limit: 20,
    offset: 0,
  };

  it('should return list of videos for organization', async () => {
    const videos = [
      {
        id: 'video_1',
        title: 'Video 1',
        status: 'completed',
        progress: 100,
        organizationId: 'org_123',
        creator: { id: 'user_1', name: 'John', email: 'john@test.com' },
      },
      {
        id: 'video_2',
        title: 'Video 2',
        status: 'draft',
        progress: 0,
        organizationId: 'org_123',
        creator: { id: 'user_1', name: 'John', email: 'john@test.com' },
      },
    ];

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.leftJoin.mockReturnThis();
    mockPageThenCount(videos.length + 7);
    mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockReturnThis();
    mockDb.offset.mockResolvedValueOnce(videos);

    const result = await listVideos(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
      // `total` is the MATCH COUNT, not the page length. The mock deliberately
      // returns a count that differs from `items.length`, so this assertion
      // fails if `total: items.length` ever comes back.
      expect(result.data.total).toBe(9);
      expect(result.data.total).not.toBe(result.data.items.length);
    }
  });

  it('should return empty array when no videos exist', async () => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.leftJoin.mockReturnThis();
    mockPageThenCount(0);
    mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockReturnThis();
    mockDb.offset.mockResolvedValueOnce([]);

    const result = await listVideos(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toEqual([]);
    }
  });

  it('should include creator information', async () => {
    const videos = [
      {
        id: 'video_1',
        title: 'Video 1',
        status: 'completed',
        organizationId: 'org_123',
        creator: {
          id: 'user_1',
          name: 'John Doe',
          email: 'john@test.com',
          image: 'https://example.com/avatar.jpg',
        },
      },
    ];

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.leftJoin.mockReturnThis();
    mockPageThenCount(videos.length + 7);
    mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockReturnThis();
    mockDb.offset.mockResolvedValueOnce(videos);

    const result = await listVideos(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].creator?.name).toBe('John Doe');
    }
  });

  it('should apply pagination with limit and offset', async () => {
    const paginatedVideos = [
      {
        id: 'video_3',
        title: 'Video 3',
        organizationId: 'org_123',
        creator: null,
      },
      {
        id: 'video_4',
        title: 'Video 4',
        organizationId: 'org_123',
        creator: null,
      },
    ];

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.leftJoin.mockReturnThis();
    mockPageThenCount(paginatedVideos.length + 7);
    mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockReturnThis();
    mockDb.offset.mockResolvedValueOnce(paginatedVideos);

    const result = await listVideos(mockDb as never, {
      ...validInput,
      limit: 2,
      offset: 2,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
    }
  });

  it('should return videos with various statuses', async () => {
    const videosWithStatuses = [
      {
        id: 'video_1',
        status: 'completed',
        organizationId: 'org_123',
        creator: null,
      },
      {
        id: 'video_2',
        status: 'processing',
        organizationId: 'org_123',
        creator: null,
      },
      {
        id: 'video_3',
        status: 'queued',
        organizationId: 'org_123',
        creator: null,
      },
      {
        id: 'video_4',
        status: 'draft',
        organizationId: 'org_123',
        creator: null,
      },
      {
        id: 'video_5',
        status: 'error',
        organizationId: 'org_123',
        creator: null,
      },
    ];

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.leftJoin.mockReturnThis();
    mockPageThenCount(videosWithStatuses.length + 7);
    mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockReturnThis();
    mockDb.offset.mockResolvedValueOnce(videosWithStatuses);

    const result = await listVideos(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(5);
      const statuses = result.data.items.map((v) => v.status);
      expect(statuses).toContain('completed');
      expect(statuses).toContain('processing');
      expect(statuses).toContain('queued');
      expect(statuses).toContain('draft');
      expect(statuses).toContain('error');
    }
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      limit: 20,
      offset: 0,
    };

    await expectResult(
      listVideos(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
