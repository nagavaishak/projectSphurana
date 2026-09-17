import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { listGraphics } from './list-graphics.service.js';

describe('listGraphics', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
  };

  it('should return list of graphics with templates', async () => {
    const mockGraphics = [
      {
        id: 'graphic_1',
        title: 'Banner 1',
        status: 'ready',
        organizationId: 'org_123',
        template: { id: 'template_1', name: 'Instagram Post' },
        createdAt: new Date(),
      },
      {
        id: 'graphic_2',
        title: 'Banner 2',
        status: 'draft',
        organizationId: 'org_123',
        template: null,
        createdAt: new Date(),
      },
    ];

    mockDb.query.graphic.findMany.mockResolvedValueOnce(mockGraphics);
    // The owning-item lookup — a second query, because the item lives two
    // tables away (attempt → item) and joining it onto the main list would
    // reshape every row for a field most callers ignore.
    mockDb.where.mockResolvedValueOnce([
      { graphicId: 'graphic_1', itemId: 'item_1' },
    ]);

    const result = await listGraphics(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
      expect(result.data.items[0].template?.name).toBe('Instagram Post');
      expect(result.data.items[1].template).toBeNull();
      // The id every EDIT takes, handed out by the lister so a caller never
      // has to turn a graphic id into a post id itself.
      expect(result.data.items[0].itemId).toBe('item_1');
      // Null is legitimate: onboarding ad candidates are not content items.
      expect(result.data.items[1].itemId).toBeNull();
    }
  });

  it('should return empty list when no graphics exist', async () => {
    mockDb.query.graphic.findMany.mockResolvedValueOnce([]);

    const result = await listGraphics(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(0);
    }
  });

  it('should apply pagination with limit and offset', async () => {
    const inputWithPagination = {
      ...validInput,
      limit: 10,
      offset: 20,
    };

    mockDb.query.graphic.findMany.mockResolvedValueOnce([]);

    const result = await listGraphics(mockDb as never, inputWithPagination);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
      expect(result.data.offset).toBe(20);
    }
  });

  it('should use default pagination values', async () => {
    mockDb.query.graphic.findMany.mockResolvedValueOnce([]);

    const result = await listGraphics(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20); // default
      expect(result.data.offset).toBe(0); // default
    }
  });

  it('should filter by status when provided', async () => {
    const inputWithStatusFilter = {
      ...validInput,
      status: 'ready' as const,
    };

    const mockGraphics = [
      {
        id: 'graphic_1',
        status: 'ready',
        organizationId: 'org_123',
      },
    ];

    mockDb.query.graphic.findMany.mockResolvedValueOnce(mockGraphics);
    mockDb.where.mockResolvedValueOnce([]);

    const result = await listGraphics(mockDb as never, inputWithStatusFilter);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items.every((g) => g.status === 'ready')).toBe(true);
    }
  });

  it('should filter by draft status', async () => {
    const inputWithDraftFilter = {
      ...validInput,
      status: 'draft' as const,
    };

    mockDb.query.graphic.findMany.mockResolvedValueOnce([]);

    const result = await listGraphics(mockDb as never, inputWithDraftFilter);

    expect(result.success).toBe(true);
  });

  it('should filter by rendering status', async () => {
    const inputWithRenderingFilter = {
      ...validInput,
      status: 'rendering' as const,
    };

    mockDb.query.graphic.findMany.mockResolvedValueOnce([]);

    const result = await listGraphics(
      mockDb as never,
      inputWithRenderingFilter
    );

    expect(result.success).toBe(true);
  });

  it('should filter by failed status', async () => {
    const inputWithFailedFilter = {
      ...validInput,
      status: 'failed' as const,
    };

    mockDb.query.graphic.findMany.mockResolvedValueOnce([]);

    const result = await listGraphics(mockDb as never, inputWithFailedFilter);

    expect(result.success).toBe(true);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      organizationId: '',
    };

    // The service uses safeParse() and returns a Result error instead of throwing.
    const result = await listGraphics(mockDb as never, invalidInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.graphic.findMany.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expect(listGraphics(mockDb as never, validInput)).rejects.toThrow(
      'Database connection failed'
    );
  });
});
