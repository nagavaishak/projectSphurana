import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { linkServicesToAd } from './link-services-to-ad.js';

const mockDb = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
};

describe('linkServicesToAd', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts junction rows for each serviceId', async () => {
    await linkServicesToAd(mockDb as never, 'ad-1', [
      'svc-1',
      'svc-2',
      'svc-3',
    ]);

    expect(mockDb.insert).toHaveBeenCalledOnce();
    expect(mockDb.values).toHaveBeenCalledWith([
      { metaAdId: 'ad-1', serviceId: 'svc-1' },
      { metaAdId: 'ad-1', serviceId: 'svc-2' },
      { metaAdId: 'ad-1', serviceId: 'svc-3' },
    ]);
  });

  it('does not call db.insert when serviceIds is empty', async () => {
    await linkServicesToAd(mockDb as never, 'ad-1', []);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('handles a single serviceId', async () => {
    await linkServicesToAd(mockDb as never, 'ad-1', ['svc-1']);

    expect(mockDb.insert).toHaveBeenCalledOnce();
    expect(mockDb.values).toHaveBeenCalledWith([
      { metaAdId: 'ad-1', serviceId: 'svc-1' },
    ]);
  });
});
