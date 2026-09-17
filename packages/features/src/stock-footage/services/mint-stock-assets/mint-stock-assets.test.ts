import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { mintStockAssets } from './mint-stock-assets.service.js';

const insertValues = vi.fn().mockResolvedValue(undefined);

const mockDb = {
  query: {
    asset: { findMany: vi.fn() },
    stockClip: { findMany: vi.fn() },
  },
  insert: vi.fn(() => ({ values: insertValues })),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.query.asset.findMany.mockResolvedValue([]);
  mockDb.query.stockClip.findMany.mockResolvedValue([]);
});

describe('mintStockAssets', () => {
  it('returns {} and touches nothing for empty input', async () => {
    const result = await mintStockAssets(mockDb as never, {
      organizationId: 'o1',
      uploadedById: 'u1',
      stockClipIds: [],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({});
    expect(mockDb.query.asset.findMany).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('reuses already-minted assets without inserting', async () => {
    mockDb.query.asset.findMany.mockResolvedValueOnce([
      { id: 'a1', stockClipId: 'c1' },
      { id: 'a2', stockClipId: 'c2' },
    ]);

    const result = await mintStockAssets(mockDb as never, {
      organizationId: 'o1',
      uploadedById: 'u1',
      stockClipIds: ['c1', 'c2'],
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ c1: 'a1', c2: 'a2' });
    expect(mockDb.query.stockClip.findMany).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('mints only the missing clips and maps them as stock assets', async () => {
    mockDb.query.asset.findMany.mockResolvedValueOnce([
      { id: 'a1', stockClipId: 'c1' },
    ]);
    mockDb.query.stockClip.findMany.mockResolvedValueOnce([
      {
        id: 'c2',
        description: 'derma roller close-up',
        blobUrl: 'https://b/c2.mp4',
        transcodedBlobUrl: null,
        contentType: 'procedure',
        mediaType: 'video',
        durationSec: 8,
        width: 1080,
        height: 1920,
      },
    ]);

    const result = await mintStockAssets(mockDb as never, {
      organizationId: 'o1',
      uploadedById: 'u1',
      stockClipIds: ['c1', 'c2'],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.c1).toBe('a1');
      expect(result.data.c2).toBeTruthy();
    }

    expect(insertValues).toHaveBeenCalledTimes(1);
    const rows = insertValues.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({
      stockClipId: 'c2',
      source: 'stock',
      transcodeStatus: 'ready',
      type: 'video',
      blobUrl: 'https://b/c2.mp4',
      // transcodedBlobUrl falls back to blobUrl when the clip has none.
      transcodedBlobUrl: 'https://b/c2.mp4',
      organizationId: 'o1',
      uploadedById: 'u1',
      tags: ['procedure'],
    });
  });
});
