/**
 * The load-bearing case is ADOPT: an ad account that already has a pixel must
 * never get a second one. Pixel creation is capped per ad account, and a
 * duplicate splits the org's conversion history permanently.
 */

import { mockMetaPixelsService } from '@borradh-workspace/integrations/meta-capi';
import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import {
  installMetaAdsSharedSpies,
  metaAdsSharedMocks,
  restoreMetaAdsSharedSpies,
} from '../../../meta-ads/services/_shared/__fixtures__/shared-spies.js';
import { ErrorCodes } from '../../../shared/index.js';
import { resolveOrgPixel } from './resolve-org-pixel.service.js';

const ORG_ID = 'org_123';
const PAGE_ROW_ID = 'page_row_1';

const listPixels = vi.mocked(mockMetaPixelsService.listPixels);
const createPixel = vi.mocked(mockMetaPixelsService.createPixel);

const credentials = () => ({
  success: true as const,
  data: {
    credentials: {
      accessToken: 'tok',
      adAccountId: 'act_999',
      pageId: 'fb_page_1',
      appSecret: undefined,
    },
    integration: { id: 'int_1', adAccountId: 'act_999' },
    resolvedPage: {
      id: PAGE_ROW_ID,
      pageId: 'fb_page_1',
      pageName: 'Test Salon',
    },
  },
});

describe('resolveOrgPixel', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    installMetaAdsSharedSpies('getMetaCredentials');
    mockDb._resetMocks();
    metaAdsSharedMocks.getMetaCredentials.mockResolvedValue(credentials());
    mockDb.query.metaAdsPage.findFirst.mockResolvedValue({
      id: PAGE_ROW_ID,
      pixelId: null,
      pixelName: null,
    });
  });

  afterEach(restoreMetaAdsSharedSpies);

  it('ADOPTS the existing pixel and never creates a second one', async () => {
    listPixels.mockResolvedValueOnce([{ id: '778899', name: 'Salon Pixel' }]);

    const result = await resolveOrgPixel(mockDb as never, {
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({
      pixelId: '778899',
      pixelName: 'Salon Pixel',
      source: 'adopted',
    });
    expect(createPixel).not.toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith({
      pixelId: '778899',
      pixelName: 'Salon Pixel',
    });
  });

  it('creates a pixel ONLY when the ad account has none', async () => {
    listPixels.mockResolvedValueOnce([]);
    createPixel.mockResolvedValueOnce({ id: '112233', name: 'Test Salon' });

    const result = await resolveOrgPixel(mockDb as never, {
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({ pixelId: '112233', source: 'created' });
    expect(createPixel).toHaveBeenCalledTimes(1);
  });

  it('short-circuits on the stored pixel without calling Meta', async () => {
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
      id: PAGE_ROW_ID,
      pixelId: 'already-known',
      pixelName: 'Known',
    });

    const result = await resolveOrgPixel(mockDb as never, {
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.source).toBe('stored');
    expect(listPixels).not.toHaveBeenCalled();
  });

  it('re-reads from Meta when forceRefresh is set, even with a stored id', async () => {
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
      id: PAGE_ROW_ID,
      pixelId: 'stale',
      pixelName: 'Stale',
    });
    listPixels.mockResolvedValueOnce([{ id: 'fresh', name: 'Fresh' }]);

    const result = await resolveOrgPixel(mockDb as never, {
      organizationId: ORG_ID,
      forceRefresh: true,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pixelId).toBe('fresh');
  });

  it('returns EXTERNAL_SERVICE_ERROR instead of throwing when Meta fails', async () => {
    listPixels.mockRejectedValueOnce(new Error('Meta API Error: rate limited'));

    const result = await resolveOrgPixel(mockDb as never, {
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.EXTERNAL_SERVICE_ERROR);
  });
});
