import * as dbModule from '@borradh-workspace/database';
import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { mockMetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { importMetaAds } from './import-meta-ads.service.js';

const mockDecryptCredentials = vi.mocked(decryptCredentials);
const mockListAllAdsWithCreative = vi.mocked(
  mockMetaAdsService.listAllAdsWithCreative
);

describe('importMetaAds', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnThis(),
    });
  });

  const validInput = { organizationId: 'org_123' };

  it('wraps the scoped import in withDbRetry so a severed connection replays (prod-500 guard)', async () => {
    const retrySpy = vi.spyOn(dbModule, 'withDbRetry');
    try {
      // No integration → impl returns a clean error, but the whole scoped op must
      // still be wrapped: importMetaAds fetches from Meta AND writes inside one
      // withOrgScope txn, which a Fly NAT sever could kill mid-flight (prod 500).
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);
      await importMetaAds(mockDb as never, validInput);
      expect(retrySpy).toHaveBeenCalledTimes(1);
    } finally {
      retrySpy.mockRestore();
    }
  });

  it('should import new ads from Meta', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'int_1',
      isActive: true,
      configurationStatus: 'configured',
      encryptedCredentials: 'encrypted',
      adAccountId: 'act_123',
      defaultPage: { pageId: 'page_1', pageName: 'Test Page' },
    });
    mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'token_123',
    });
    mockListAllAdsWithCreative.mockResolvedValueOnce([
      {
        id: 'meta_ad_1',
        name: 'Test Ad',
        effectiveStatus: 'ACTIVE',
        creative: { title: 'Title', body: 'Body' },
      },
    ]);
    // First findMany: existing ads with metaAdId (none)
    mockDb.query.metaAd.findMany.mockResolvedValueOnce([]);
    // Second findMany: pending ads without metaAdId (none)
    mockDb.query.metaAd.findMany.mockResolvedValueOnce([]);

    const result = await importMetaAds(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.imported).toBe(1);
      expect(result.data.updated).toBe(0);
      expect(result.data.total).toBe(1);
    }
  });

  it('should skip already existing ads', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'int_1',
      isActive: true,
      configurationStatus: 'configured',
      encryptedCredentials: 'encrypted',
      adAccountId: 'act_123',
      defaultPage: { pageId: 'page_1', pageName: 'Test Page' },
    });
    mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'token_123',
    });
    mockListAllAdsWithCreative.mockResolvedValueOnce([
      { id: 'meta_ad_1', name: 'Existing Ad', effectiveStatus: 'ACTIVE' },
    ]);
    // First findMany: existing ads with metaAdId
    mockDb.query.metaAd.findMany.mockResolvedValueOnce([
      { id: 'local_1', metaAdId: 'meta_ad_1' },
    ]);
    // Second findMany: pending ads without metaAdId (none)
    mockDb.query.metaAd.findMany.mockResolvedValueOnce([]);

    const result = await importMetaAds(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.imported).toBe(0);
      expect(result.data.updated).toBe(1);
    }
  });

  /**
   * The data-loss bug this guards, reproduced on a preview before the fix:
   * one `POST /meta-ads/import` blanked `headline`, `primaryText`,
   * `description` and `destinationUrl` on a LIVE, locally-created ad. The next
   * copy edit would then have rebuilt the creative from those blanks and
   * pushed EMPTY copy to the running ad.
   *
   * Two causes, both covered here: Meta returns no top-level copy for a
   * story-spec creative (so the read is empty), and an ad WE authored is not
   * Meta's to re-describe anyway.
   */
  function configured() {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'int_1',
      isActive: true,
      configurationStatus: 'configured',
      encryptedCredentials: 'encrypted',
      adAccountId: 'act_123',
      defaultPage: { pageId: 'page_1', pageName: 'Test Page' },
    });
    mockDecryptCredentials.mockReturnValueOnce({ accessToken: 'token_123' });
  }

  /** The `.set({...})` the service handed drizzle for the update branch. */
  function updatePayload() {
    return mockDb.update().set.mock.calls.at(-1)?.[0] ?? {};
  }

  it('never blanks the copy on an ad we authored', async () => {
    configured();
    // Meta answers with NO copy — exactly what a story-spec creative gives
    // back on the top-level fields.
    mockListAllAdsWithCreative.mockResolvedValueOnce([
      {
        id: 'meta_ad_1',
        name: 'Renamed In Ads Manager',
        effectiveStatus: 'ACTIVE',
      },
    ]);
    mockDb.query.metaAd.findMany.mockResolvedValueOnce([
      {
        id: 'local_1',
        metaAdId: 'meta_ad_1',
        isImported: false,
        headline: 'Balayage, booking now',
        primaryText: 'Autumn colour with our senior stylists.',
        description: 'Book online',
        destinationUrl: 'https://bloom.example/book',
      },
    ]);
    mockDb.query.metaAd.findMany.mockResolvedValueOnce([]);

    const result = await importMetaAds(mockDb as never, validInput);
    expect(result.success).toBe(true);

    const set = updatePayload();
    // Not written at all — not written as null, not written as the old value.
    expect(set).not.toHaveProperty('headline');
    expect(set).not.toHaveProperty('primaryText');
    expect(set).not.toHaveProperty('description');
    expect(set).not.toHaveProperty('destinationUrl');
    // Nor may a sync rename an ad the owner named in Borradh.
    expect(set).not.toHaveProperty('name');
    // What IS Meta's still syncs.
    expect(set.status).toBe('active');
    expect(set.metaStatus).toBe('ACTIVE');
  });

  it('still takes copy from Meta for an IMPORTED ad', async () => {
    configured();
    mockListAllAdsWithCreative.mockResolvedValueOnce([
      {
        id: 'meta_ad_1',
        name: 'Imported Ad',
        effectiveStatus: 'ACTIVE',
        creative: { title: 'From Meta', body: 'Meta body' },
      },
    ]);
    mockDb.query.metaAd.findMany.mockResolvedValueOnce([
      {
        id: 'local_1',
        metaAdId: 'meta_ad_1',
        isImported: true,
        headline: 'stale',
        primaryText: 'stale',
        description: null,
        destinationUrl: null,
      },
    ]);
    mockDb.query.metaAd.findMany.mockResolvedValueOnce([]);

    const result = await importMetaAds(mockDb as never, validInput);
    expect(result.success).toBe(true);

    const set = updatePayload();
    expect(set.headline).toBe('From Meta');
    expect(set.primaryText).toBe('Meta body');
    expect(set.name).toBe('Imported Ad');
  });

  it('does not blank an imported ad’s copy when Meta returns none', async () => {
    configured();
    mockListAllAdsWithCreative.mockResolvedValueOnce([
      { id: 'meta_ad_1', name: 'Imported Ad', effectiveStatus: 'ACTIVE' },
    ]);
    mockDb.query.metaAd.findMany.mockResolvedValueOnce([
      {
        id: 'local_1',
        metaAdId: 'meta_ad_1',
        isImported: true,
        headline: 'What we already had',
        primaryText: 'Kept',
        description: null,
        destinationUrl: null,
      },
    ]);
    mockDb.query.metaAd.findMany.mockResolvedValueOnce([]);

    const result = await importMetaAds(mockDb as never, validInput);
    expect(result.success).toBe(true);

    const set = updatePayload();
    expect(set).not.toHaveProperty('headline');
    expect(set).not.toHaveProperty('primaryText');
  });

  it('should return error when integration not configured', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);

    const result = await importMetaAds(mockDb as never, validInput);

    expect(result.success).toBe(false);
  });

  it('should return error when no ad account', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'int_1',
      isActive: true,
      configurationStatus: 'configured',
      encryptedCredentials: 'encrypted',
      adAccountId: null,
      defaultPage: { pageId: 'page_1' },
    });

    const result = await importMetaAds(mockDb as never, validInput);

    expect(result.success).toBe(false);
  });

  it('should return error when no default page', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'int_1',
      isActive: true,
      configurationStatus: 'configured',
      encryptedCredentials: 'encrypted',
      adAccountId: 'act_123',
      defaultPage: null,
    });

    const result = await importMetaAds(mockDb as never, validInput);

    expect(result.success).toBe(false);
  });

  it('should return INTERNAL_ERROR when decryption fails', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'int_1',
      isActive: true,
      configurationStatus: 'configured',
      encryptedCredentials: 'encrypted',
      adAccountId: 'act_123',
      defaultPage: { pageId: 'page_1', pageName: 'Test Page' },
    });
    mockDecryptCredentials.mockImplementationOnce(() => {
      throw new Error('Decryption failed');
    });

    await expectResult(
      importMetaAds(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    await expectResult(
      importMetaAds(mockDb as never, { organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
