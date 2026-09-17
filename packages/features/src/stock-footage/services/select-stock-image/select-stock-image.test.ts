import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { selectStockImage } from './select-stock-image.service.js';

const ref = (id: string, mediaType: 'video' | 'image') => ({
  id,
  active: true,
  mediaType,
  blobUrl: `b/${id}`,
  transcodedBlobUrl: null,
  durationSec: null,
  width: null,
  height: null,
  contentType: 'procedure',
  description: id,
});

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

const input = { organizationId: 'o1', serviceId: 'svc1' };

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.query.organization.findFirst.mockResolvedValue({
    businessType: 'aesthetic_clinic',
  });
  mockDb.query.serviceStockClip.findMany.mockResolvedValue([]);
  mockDb.query.stockClip.findMany.mockResolvedValue([]);
});

describe('selectStockImage', () => {
  it('returns null when the org has no seeded vertical', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      businessType: 'salon',
    });

    const result = await selectStockImage(mockDb as never, input);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBeNull();
  });

  it('picks an image-typed service match and skips video matches', async () => {
    mockDb.query.serviceStockClip.findMany.mockResolvedValueOnce([
      { stockClipId: 'm1', stockClip: ref('m1', 'video') },
      { stockClipId: 'm2', stockClip: ref('m2', 'image') },
    ]);
    mockDb.query.stockClip.findMany.mockResolvedValueOnce([ref('g1', 'image')]);

    const result = await selectStockImage(mockDb as never, input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        stockClipId: 'm2',
        url: 'b/m2',
        matchSource: 'service-match',
      });
    }
  });

  it('falls back to a generic image when no image service match', async () => {
    mockDb.query.stockClip.findMany.mockResolvedValueOnce([
      ref('g1', 'image'),
      ref('g2', 'image'),
    ]);

    const result = await selectStockImage(mockDb as never, input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(['g1', 'g2']).toContain(result.data?.stockClipId);
    }
  });

  it('returns null when only video clips exist (no stills)', async () => {
    mockDb.query.serviceStockClip.findMany.mockResolvedValueOnce([
      { stockClipId: 'm1', stockClip: ref('m1', 'video') },
    ]);
    mockDb.query.stockClip.findMany.mockResolvedValueOnce([ref('g1', 'video')]);

    const result = await selectStockImage(mockDb as never, input);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBeNull();
  });
});
