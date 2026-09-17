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
import { listAssets } from './list-assets.service.js';

describe('listAssets', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  /**
   * `listAssets` issues up to THREE queries on the same builder, in order:
   *   1. the page          `.where(and(...conditions))` -> chains to .orderBy
   *   2. the service links `.where(inArray(...))`       -> awaited, SKIPPED
   *                                                        when the page is empty
   *   3. the count         `.where(and(...conditions))` -> awaited
   * so `where` must chain once and then resolve once or twice. Passing a total
   * different from the page length is what lets these tests tell a real count
   * from `items.length`.
   */
  const mockAssetQueries = (opts: { hasItems: boolean; total: number }) => {
    mockDb.where.mockReturnValueOnce(mockDb as never);
    if (opts.hasItems) mockDb.where.mockResolvedValueOnce([] as never);
    mockDb.where.mockResolvedValueOnce([{ value: opts.total }] as never);
  };

  const validInput = {
    organizationId: 'org_123',
  };

  it('should return list of assets', async () => {
    const mockAssets = [
      {
        id: 'asset_1',
        name: 'Video 1',
        blobUrl: 'https://storage.example.com/video1.mp4',
        type: 'video',
        organizationId: 'org_123',
        uploader: {
          id: 'user_1',
          name: 'John',
          email: 'john@example.com',
          image: null,
        },
      },
      {
        id: 'asset_2',
        name: 'Image 1',
        blobUrl: 'https://storage.example.com/image1.jpg',
        type: 'image',
        organizationId: 'org_123',
        uploader: {
          id: 'user_2',
          name: 'Jane',
          email: 'jane@example.com',
          image: null,
        },
      },
    ];

    mockAssetQueries({ hasItems: true, total: mockAssets.length + 7 });
    mockDb.offset.mockResolvedValueOnce(mockAssets);

    const result = await listAssets(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
      // `total` is the MATCH COUNT, not the page length. The mock returns a
      // count that differs from `items.length` on purpose, so this fails if
      // `total: itemsWithServices.length` ever comes back.
      expect(result.data.total).toBe(9);
      expect(result.data.total).not.toBe(result.data.items.length);
      expect(result.data.items[0].name).toBe('Video 1');
      expect(result.data.items[1].name).toBe('Image 1');
    }
  });

  it('should return empty list when no assets exist', async () => {
    mockAssetQueries({ hasItems: false, total: 0 });
    mockDb.offset.mockResolvedValueOnce([]);

    const result = await listAssets(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(0);
    }
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      organizationId: '',
    };

    await expectResult(
      listAssets(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('should filter by type', async () => {
    const inputWithTypeFilter = {
      ...validInput,
      type: 'video' as const,
    };

    const mockAssets = [
      {
        id: 'asset_1',
        name: 'Video 1',
        type: 'video',
        organizationId: 'org_123',
      },
    ];

    mockAssetQueries({ hasItems: true, total: mockAssets.length + 7 });
    mockDb.offset.mockResolvedValueOnce(mockAssets);

    const result = await listAssets(mockDb as never, inputWithTypeFilter);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items.every((a) => a.type === 'video')).toBe(true);
    }
  });

  it('should filter by source', async () => {
    const inputWithSourceFilter = {
      ...validInput,
      source: 'raw' as const,
    };

    mockAssetQueries({ hasItems: false, total: 0 });
    mockDb.offset.mockResolvedValueOnce([]);

    const result = await listAssets(mockDb as never, inputWithSourceFilter);

    expect(result.success).toBe(true);
    expect(mockDb.select).toHaveBeenCalled();
  });

  it('should filter by tags', async () => {
    const inputWithTagsFilter = {
      ...validInput,
      tags: ['marketing', 'promo'],
    };

    const mockAssets = [
      {
        id: 'asset_1',
        name: 'Marketing Video',
        type: 'video',
        tags: ['marketing', 'q1'],
        organizationId: 'org_123',
      },
    ];

    mockAssetQueries({ hasItems: true, total: mockAssets.length + 7 });
    mockDb.offset.mockResolvedValueOnce(mockAssets);

    const result = await listAssets(mockDb as never, inputWithTagsFilter);

    expect(result.success).toBe(true);
    expect(mockDb.select).toHaveBeenCalled();
  });

  it('should filter by free-text search (name / filename)', async () => {
    const inputWithSearch = {
      ...validInput,
      search: 'Endosphere',
    };

    const mockAssets = [
      {
        id: 'asset_1',
        name: 'Endosphere before shot',
        sourceFileName: 'endosphere-1.jpg',
        type: 'image',
        organizationId: 'org_123',
      },
    ];

    mockAssetQueries({ hasItems: true, total: mockAssets.length });
    mockDb.offset.mockResolvedValueOnce(mockAssets);

    const result = await listAssets(mockDb as never, inputWithSearch);

    expect(result.success).toBe(true);
    // The search condition is composed into the same `where(and(...))` the
    // page and count queries share, so a match narrows both.
    expect(mockDb.select).toHaveBeenCalled();
    expect(mockDb.where).toHaveBeenCalled();
    if (result.success) {
      expect(result.data.items[0]?.name).toBe('Endosphere before shot');
    }
  });

  it('should reject an empty search string', async () => {
    await expectResult(
      listAssets(mockDb as never, { ...validInput, search: '   ' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should apply pagination with limit and offset', async () => {
    const inputWithPagination = {
      ...validInput,
      limit: 10,
      offset: 20,
    };

    mockAssetQueries({ hasItems: false, total: 0 });
    mockDb.offset.mockResolvedValueOnce([]);

    const result = await listAssets(mockDb as never, inputWithPagination);

    expect(result.success).toBe(true);
    expect(mockDb.limit).toHaveBeenCalledWith(10);
    expect(mockDb.offset).toHaveBeenCalledWith(20);
  });

  it('should use default pagination values', async () => {
    mockAssetQueries({ hasItems: false, total: 0 });
    mockDb.offset.mockResolvedValueOnce([]);

    const result = await listAssets(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockDb.limit).toHaveBeenCalledWith(50); // default from schema
    expect(mockDb.offset).toHaveBeenCalledWith(0); // default from schema
  });

  it('should include uploader information', async () => {
    const mockAssets = [
      {
        id: 'asset_1',
        name: 'Video 1',
        type: 'video',
        organizationId: 'org_123',
        uploadedById: 'user_1',
        uploader: {
          id: 'user_1',
          name: 'John Doe',
          email: 'john@example.com',
          image: 'https://example.com/avatar.jpg',
        },
      },
    ];

    mockAssetQueries({ hasItems: true, total: mockAssets.length + 7 });
    mockDb.offset.mockResolvedValueOnce(mockAssets);

    const result = await listAssets(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success && result.data.items.length > 0) {
      expect(result.data.items[0].uploader).toBeDefined();
      expect(result.data.items[0].uploader?.name).toBe('John Doe');
    }
  });

  it('should return VALIDATION_ERROR for limit below minimum', async () => {
    const invalidInput = {
      ...validInput,
      limit: 0,
    };

    await expectResult(
      listAssets(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for limit above maximum', async () => {
    const invalidInput = {
      ...validInput,
      limit: 101,
    };

    await expectResult(
      listAssets(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.offset.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expect(listAssets(mockDb as never, validInput)).rejects.toThrow(
      'Database connection failed'
    );
  });
});
