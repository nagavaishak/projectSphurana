import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import * as mintStockAssetsModule from '../mint-stock-assets/index.js';
import { selectStockBRoll } from './select-stock-broll.service.js';

// The features suite runs `isolate: false`, so a file-local `vi.mock` of an
// internal module persists on the shared worker graph and races other files
// that import the real module (mint-stock-assets.test.ts). Use a restored
// `vi.spyOn` per the config's maintenance rule instead — see vitest.config.ts.
let mockMint: MockInstance;

const mockDb = {
  query: {
    organization: { findFirst: vi.fn() },
    // The ambient pool is region-filtered against the service, so the resolver
    // reads its regions. Default to none declared — the strictest case, which
    // admits only genuinely region-neutral generics.
    organizationService: {
      findFirst: vi.fn().mockResolvedValue({ regions: [] }),
    },
    serviceStockClip: { findMany: vi.fn() },
    stockClip: { findMany: vi.fn() },
  },
};

const input = { organizationId: 'o1', serviceId: 'svc1', uploadedById: 'u1' };

// A stock_clip ref as returned by the shared resolver's column selection.
const vid = (id: string) => ({
  id,
  active: true,
  mediaType: 'video' as const,
  blobUrl: `b/${id}`,
  transcodedBlobUrl: null,
  durationSec: null,
  width: null,
  height: null,
  contentType: 'procedure',
  description: id,
  regions: [] as string[],
});

/** A generic clip that names a body part — the shape that leaked a full-face
 *  sheet mask onto an Aqualyx (abdomen/flank/thighs) video in production. */
const vidIn = (id: string, regions: string[]) => ({ ...vid(id), regions });

beforeEach(() => {
  vi.clearAllMocks();
  mockMint = vi.spyOn(mintStockAssetsModule, 'mintStockAssets');
  mockDb.query.organization.findFirst.mockResolvedValue({
    businessType: 'aesthetic_clinic',
  });
  // serviceStockClip.findMany is called with `with: { stockClip }`.
  mockDb.query.serviceStockClip.findMany.mockResolvedValue([
    { stockClipId: 'm1', stockClip: vid('m1') },
    { stockClipId: 'm2', stockClip: vid('m2') },
  ]);
  mockDb.query.stockClip.findMany.mockResolvedValue([
    vid('g1'),
    vid('g2'),
    vid('g3'),
  ]);
  // Mint returns a deterministic assetId per requested clip.
  mockMint.mockImplementation((_db: never, arg: never) =>
    Promise.resolve({
      success: true,
      data: Object.fromEntries(
        (arg as { stockClipIds: string[] }).stockClipIds.map((id) => [
          id,
          `asset-${id}`,
        ])
      ),
    })
  );
});

// Restore the real binding so the spy never leaks onto the shared worker graph.
// Restore only THIS handle (not vi.restoreAllMocks, which would restore other
// files' spies living on the shared graph) — per the config's maintenance rule.
afterEach(() => {
  mockMint.mockRestore();
});

describe('selectStockBRoll', () => {
  it('still returns clips when the org has no seeded vertical', async () => {
    // This used to assert []. An unmapped business_type emptied the whole
    // result — including service-matched clips, which are gated on technique
    // and never on vertical. Measured on the live bank, 230 of 281 clips carry
    // no vertical at all and every video in the ambient pool is one of them, so
    // the filter did not scope the pool, it deleted it.
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      businessType: 'salon',
    });

    const result = await selectStockBRoll(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.length).toBeGreaterThan(0);
  });

  it('puts service matches first, then tops up from the generic pool', async () => {
    const result = await selectStockBRoll(mockDb as never, input);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).toHaveLength(5);
    expect(result.data[0]).toEqual({
      assetId: 'asset-m1',
      order: 0,
      clipType: 'bRoll',
    });
    expect(result.data[1].assetId).toBe('asset-m2');

    const chosen = mockMint.mock.calls[0][1].stockClipIds as string[];
    expect(chosen.slice(0, 2)).toEqual(['m1', 'm2']);
    expect(chosen.slice(2).sort()).toEqual(['g1', 'g2', 'g3']);
    expect(result.data.map((c) => c.order)).toEqual([0, 1, 2, 3, 4]);
  });

  it('falls back entirely to the generic pool when no service match exists', async () => {
    mockDb.query.serviceStockClip.findMany.mockResolvedValueOnce([]);
    mockDb.query.stockClip.findMany.mockResolvedValueOnce([
      vid('g1'),
      vid('g2'),
    ]);

    const result = await selectStockBRoll(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data.map((c) => c.assetId).sort()).toEqual([
        'asset-g1',
        'asset-g2',
      ]);
    }
  });

  it('keeps a region-tagged generic when the service treats that region', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      regions: ['abdomen', 'flank'],
    });
    mockDb.query.serviceStockClip.findMany.mockResolvedValueOnce([]);
    mockDb.query.stockClip.findMany.mockResolvedValueOnce([
      vidIn('g-abdomen', ['abdomen']),
    ]);

    const result = await selectStockBRoll(mockDb as never, input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.map((c) => c.assetId)).toEqual(['asset-g-abdomen']);
    }
  });

  it('drops a region-tagged generic the service does not treat', async () => {
    // The reported defect: a `full face` sheet mask served to a body treatment.
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      regions: ['abdomen', 'flank'],
    });
    mockDb.query.serviceStockClip.findMany.mockResolvedValueOnce([]);
    mockDb.query.stockClip.findMany.mockResolvedValueOnce([
      vidIn('g-face', ['full face']),
      vidIn('g-neutral', []),
    ]);

    const result = await selectStockBRoll(mockDb as never, input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.map((c) => c.assetId)).toEqual(['asset-g-neutral']);
    }
  });

  it('admits only NEUTRAL generics when the service has no regions', async () => {
    // An empty `regions` on the service means "unknown body part" here, not
    // "anything goes" — the inverse reading is what let the sheet mask through
    // on a service that declared no regions at all.
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      regions: [],
    });
    mockDb.query.serviceStockClip.findMany.mockResolvedValueOnce([]);
    mockDb.query.stockClip.findMany.mockResolvedValueOnce([
      vidIn('g-face', ['full face']),
      vidIn('g-neutral', []),
    ]);

    const result = await selectStockBRoll(mockDb as never, input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.map((c) => c.assetId)).toEqual(['asset-g-neutral']);
    }
  });

  it('uses the generic pool when no service is provided', async () => {
    mockDb.query.stockClip.findMany.mockResolvedValueOnce([
      vid('g1'),
      vid('g2'),
    ]);

    const result = await selectStockBRoll(mockDb as never, {
      organizationId: 'o1',
      serviceId: null,
      uploadedById: 'u1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.map((c) => c.assetId).sort()).toEqual([
        'asset-g1',
        'asset-g2',
      ]);
    }
    expect(mockDb.query.serviceStockClip.findMany).not.toHaveBeenCalled();
  });

  it('returns [] when neither matches nor generics exist', async () => {
    mockDb.query.serviceStockClip.findMany.mockResolvedValueOnce([]);
    mockDb.query.stockClip.findMany.mockResolvedValueOnce([]);

    const result = await selectStockBRoll(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual([]);
    expect(mockMint).not.toHaveBeenCalled();
  });

  it('respects an explicit count', async () => {
    const result = await selectStockBRoll(mockDb as never, {
      ...input,
      count: 3,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveLength(3);
    const chosen = mockMint.mock.calls[0][1].stockClipIds as string[];
    expect(chosen).toHaveLength(3);
    expect(chosen.slice(0, 2)).toEqual(['m1', 'm2']);
  });
});
