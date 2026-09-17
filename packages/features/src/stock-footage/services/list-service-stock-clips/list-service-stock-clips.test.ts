import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { listServiceStockClips } from './list-service-stock-clips.service.js';

const mockDb = {
  query: {
    organization: { findFirst: vi.fn() },
    serviceStockClip: { findMany: vi.fn() },
    stockClip: { findMany: vi.fn() },
  },
};

const ref = (id: string, isGeneric = true) => ({
  id,
  active: true,
  mediaType: 'video' as const,
  blobUrl: `https://cdn/${id}.mp4`,
  transcodedBlobUrl: null,
  durationSec: 7,
  width: 1080,
  height: 1920,
  contentType: 'environment',
  description: `clip ${id}`,
  isGeneric,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.query.organization.findFirst.mockResolvedValue({
    businessType: 'aesthetic_clinic',
  });
  mockDb.query.serviceStockClip.findMany.mockResolvedValue([]);
  mockDb.query.stockClip.findMany.mockResolvedValue([ref('g1'), ref('g2')]);
});

describe('listServiceStockClips', () => {
  it('returns generic clips when no service is selected', async () => {
    const result = await listServiceStockClips(mockDb as never, {
      organizationId: 'org_1',
      serviceId: null,
      mediaType: 'video',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.items).toHaveLength(2);
    expect(result.data.items[0]).toMatchObject({
      stockClipId: 'g1',
      isGeneric: true,
    });
    expect(mockDb.query.serviceStockClip.findMany).not.toHaveBeenCalled();
  });
});
