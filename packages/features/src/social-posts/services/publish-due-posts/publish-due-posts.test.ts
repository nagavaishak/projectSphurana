import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
// `publish-social-post.service` is an INTERNAL sibling exercised by its own
// suite — a file-local `vi.mock` would leak under `isolate: false`, so use a
// restored `vi.spyOn` (created in beforeEach, restored in afterEach).
import * as publishSocialPostModule from '../publish-social-post/publish-social-post.service.js';
import { publishDuePosts } from './publish-due-posts.service.js';

let mockPublish: ReturnType<typeof vi.spyOn>;

const okPost = (id: string, status = 'published') =>
  ({ success: true, data: { id, status } }) as never;

describe('publishDuePosts', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockPublish = vi
      .spyOn(publishSocialPostModule, 'publishSocialPost')
      .mockResolvedValue(okPost('default'));
  });

  afterEach(() => {
    mockPublish.mockRestore();
  });

  it('publishes each due post and tallies results', async () => {
    // First findMany = due posts; second findMany = stale rows (none).
    mockDb.query.socialPost.findMany
      .mockResolvedValueOnce([
        { id: 'p1', organizationId: 'org1' },
        { id: 'p2', organizationId: 'org2' },
      ])
      .mockResolvedValueOnce([]);

    mockPublish
      .mockResolvedValueOnce(okPost('p1', 'published'))
      .mockResolvedValueOnce(okPost('p2', 'published'));

    const result = await publishDuePosts(mockDb as never, {});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.considered).toBe(2);
      expect(result.data.published).toBe(2);
      expect(result.data.failed).toBe(0);
      expect(result.data.skippedStale).toBe(0);
    }

    expect(mockPublish).toHaveBeenCalledTimes(2);
    expect(mockPublish).toHaveBeenCalledWith(mockDb, {
      id: 'p1',
      organizationId: 'org1',
    });
  });

  it('counts a failed publish without throwing', async () => {
    mockDb.query.socialPost.findMany
      .mockResolvedValueOnce([{ id: 'p1', organizationId: 'org1' }])
      .mockResolvedValueOnce([]);

    mockPublish.mockResolvedValueOnce({
      success: true,
      data: { id: 'p1', status: 'failed' },
    } as never);

    const result = await publishDuePosts(mockDb as never, {});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.published).toBe(0);
      expect(result.data.failed).toBe(1);
    }
  });

  it('reports stale posts it deliberately skips', async () => {
    mockDb.query.socialPost.findMany
      .mockResolvedValueOnce([]) // nothing in the due window
      .mockResolvedValueOnce([{ id: 'old1' }, { id: 'old2' }]); // stale backlog

    const result = await publishDuePosts(mockDb as never, {});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.considered).toBe(0);
      expect(result.data.skippedStale).toBe(2);
    }
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('rejects an invalid batchSize', async () => {
    const result = await publishDuePosts(
      mockDb as never,
      {
        batchSize: -5,
      } as never
    );
    expect(result.success).toBe(false);
  });
});
