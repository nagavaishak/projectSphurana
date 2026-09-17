import {
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { listBatchAssets } from './list-batch-assets.service.js';

// The service runs two sequential select queries:
// 1. db.select().from().leftJoin().leftJoin().where().orderBy().limit().offset() → items
// 2. db.select().from().where() → serviceLinks (only if items.length > 0)
// Each db.select() call must return a separate chainable object to avoid mock conflicts.
const createChain = (_resolveFn?: ReturnType<typeof vi.fn>) => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = [
    'select',
    'from',
    'leftJoin',
    'innerJoin',
    'where',
    'orderBy',
    'limit',
    'offset',
  ] as const;
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  return chain;
};

let selectCallCount = 0;
const itemsChain = createChain();
const serviceLinksChain = createChain();

const mockDb = {
  select: vi.fn().mockImplementation(() => {
    selectCallCount++;
    if (selectCallCount === 1) return itemsChain;
    return serviceLinksChain;
  }),
};

describe('listBatchAssets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectCallCount = 0;
  });

  const validInput = {
    batchId: 'batch_123',
    organizationId: 'org_123',
  };

  it('should return batch assets with analysis and service links', async () => {
    const mockItems = [
      {
        id: 'asset_1',
        name: 'Video 1',
        blobUrl: 'https://storage.example.com/v1.mp4',
        sourceFileName: 'v1.mp4',
        tags: ['marketing'],
        clientName: null,
        type: 'video',
        duration: 120,
        width: 1920,
        height: 1080,
        organizationId: 'org_123',
        createdAt: new Date(),
        updatedAt: new Date(),
        analysis: {
          id: 'analysis_1',
          status: 'completed',
          contentType: 'b_roll',
          analysisResult: { tags: ['outdoor'] },
        },
        uploader: {
          id: 'user_1',
          name: 'John Doe',
          image: null,
        },
      },
      {
        id: 'asset_2',
        name: 'Video 2',
        blobUrl: 'https://storage.example.com/v2.mp4',
        sourceFileName: 'v2.mp4',
        tags: [],
        clientName: null,
        type: 'video',
        duration: 60,
        width: 1920,
        height: 1080,
        organizationId: 'org_123',
        createdAt: new Date(),
        updatedAt: new Date(),
        analysis: {
          id: 'analysis_2',
          status: 'completed',
          contentType: 'testimonial',
          analysisResult: null,
        },
        uploader: {
          id: 'user_1',
          name: 'John Doe',
          image: null,
        },
      },
    ];

    const mockServiceLinks = [
      { assetId: 'asset_1', serviceId: 'service_1' },
      { assetId: 'asset_1', serviceId: 'service_2' },
      { assetId: 'asset_2', serviceId: 'service_1' },
    ];

    // Items query resolves at .offset()
    itemsChain.offset.mockResolvedValueOnce(mockItems);
    // Service links query resolves at .where()
    serviceLinksChain.where.mockResolvedValueOnce(mockServiceLinks);

    const result = await listBatchAssets(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
      expect(result.data.items[0].id).toBe('asset_1');
      expect(result.data.items[0].serviceIds).toEqual([
        'service_1',
        'service_2',
      ]);
      expect(result.data.items[1].id).toBe('asset_2');
      expect(result.data.items[1].serviceIds).toEqual(['service_1']);
      expect(result.data.total).toBe(2);
    }
  });

  it('should return empty list when no assets in batch', async () => {
    // Items query returns empty - serviceLinks query should NOT be called
    itemsChain.offset.mockResolvedValueOnce([]);

    const result = await listBatchAssets(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(0);
      expect(result.data.total).toBe(0);
    }
  });

  it('should return VALIDATION_ERROR for empty batchId', async () => {
    const invalidInput = {
      batchId: '',
      organizationId: 'org_123',
    };

    await expectResult(
      listBatchAssets(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    const invalidInput = {
      batchId: 'batch_123',
      organizationId: '',
    };

    await expectResult(
      listBatchAssets(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.select).not.toHaveBeenCalled();
  });
});
