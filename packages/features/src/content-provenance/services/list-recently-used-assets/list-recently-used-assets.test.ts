import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import {
  listRecentlyUsedAssetIds,
  listRecentlyUsedAssetIdsSafe,
} from './list-recently-used-assets.service.js';

/**
 * Chainable select-mock: `.select().from().where().orderBy().limit()` resolves
 * to whatever `rows` is set to.
 */
let rows: { assetId: string | null }[] = [];
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn(() => Promise.resolve(rows)),
};

describe('listRecentlyUsedAssetIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rows = [];
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockImplementation(() => Promise.resolve(rows));
  });

  it('returns asset ids most-recently-used first', async () => {
    rows = [
      { assetId: 'newest' },
      { assetId: 'middle' },
      { assetId: 'oldest' },
    ];

    const result = await listRecentlyUsedAssetIds(mockDb as never, {
      organizationId: 'org-1',
      serviceId: 'svc-1',
      lookbackDays: 45,
      limit: 100,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual(['newest', 'middle', 'oldest']);
  });

  it('de-dupes while preserving recency order', async () => {
    // An asset used three times must not occupy three ranking slots — that
    // would push genuinely-unused assets down the preference order.
    rows = [
      { assetId: 'a' },
      { assetId: 'b' },
      { assetId: 'a' },
      { assetId: 'a' },
      { assetId: 'c' },
    ];

    const result = await listRecentlyUsedAssetIds(mockDb as never, {
      organizationId: 'org-1',
      lookbackDays: 45,
      limit: 100,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual(['a', 'b', 'c']);
  });

  it('skips null asset ids (stock / AI / no-resolution rows)', async () => {
    rows = [{ assetId: null }, { assetId: 'real' }, { assetId: null }];

    const result = await listRecentlyUsedAssetIds(mockDb as never, {
      organizationId: 'org-1',
      lookbackDays: 45,
      limit: 100,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual(['real']);
  });

  it('returns VALIDATION_ERROR without an organizationId', async () => {
    const result = await listRecentlyUsedAssetIds(mockDb as never, {
      organizationId: '',
      lookbackDays: 45,
      limit: 100,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });
});

describe('listRecentlyUsedAssetIdsSafe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockReturnThis();
  });

  // Rotation is an improvement, never a gate. If the history read fails we
  // must still produce content — just without the variety benefit.
  it('returns an empty list when the query throws', async () => {
    mockDb.limit.mockImplementation(() =>
      Promise.reject(new Error('db unavailable'))
    );

    const ids = await listRecentlyUsedAssetIdsSafe(mockDb as never, {
      organizationId: 'org-1',
      lookbackDays: 45,
      limit: 100,
    });

    expect(ids).toEqual([]);
  });

  it('returns an empty list on a validation failure', async () => {
    const ids = await listRecentlyUsedAssetIdsSafe(mockDb as never, {
      organizationId: '',
      lookbackDays: 45,
      limit: 100,
    });

    expect(ids).toEqual([]);
  });
});
