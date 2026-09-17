import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { mockMetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { importAdById } from './import-ad-by-id.service.js';

const mockDecryptCredentials = vi.mocked(decryptCredentials);
const mockGetAdForImport = vi.mocked(mockMetaAdsService.getAdForImport);

const validInput = { organizationId: 'org_123', metaAdId: 'meta_ad_1' };

/** Make getMetaCredentials succeed against the mock DB. */
function seedCredentials(mockDb: ReturnType<typeof createMockDatabase>) {
  mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
    id: 'int_1',
    isActive: true,
    configurationStatus: 'configured',
    encryptedCredentials: 'encrypted',
    adAccountId: 'act_123',
    defaultPage: { id: 'p1', pageId: 'page_1', pageName: 'Test Page' },
    pages: [],
  } as never);
  mockDecryptCredentials.mockReturnValueOnce({ accessToken: 'token_123' });
}

describe('importAdById', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'new-internal-ad' }]),
      }),
    });
  });

  it('returns the local id without a Graph call when the ad already exists', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      id: 'existing-ad',
      metaCampaignId: 'cmp-1',
    });

    const result = await importAdById(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        internalAdId: 'existing-ad',
        metaCampaignId: 'cmp-1',
        imported: false,
      });
    }
    expect(mockGetAdForImport).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('imports the ad from Meta and inserts a meta_ad row on a miss', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(undefined); // dedup miss
    seedCredentials(mockDb);
    mockGetAdForImport.mockResolvedValueOnce({
      id: 'meta_ad_1',
      name: 'Body Contouring — Video Ad',
      effectiveStatus: 'ACTIVE',
      campaignId: 'cmp-99',
      adSetId: 'adset-7',
    });

    const result = await importAdById(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        internalAdId: 'new-internal-ad',
        metaCampaignId: 'cmp-99',
        imported: true,
      });
    }
    expect(mockGetAdForImport).toHaveBeenCalledWith('meta_ad_1');
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
  });

  it('returns INTERNAL_ERROR when Meta credentials are unavailable', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(undefined);
    // No integration → getMetaCredentials fails.
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(undefined);

    const result = await importAdById(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
    expect(mockGetAdForImport).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR (no insert) when the Meta fetch throws', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(undefined);
    seedCredentials(mockDb);
    mockGetAdForImport.mockRejectedValueOnce(new Error('Graph 400'));

    const result = await importAdById(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when metaAdId is missing', async () => {
    const result = await importAdById(mockDb as never, {
      organizationId: 'org_123',
      metaAdId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.query.metaAd.findFirst).not.toHaveBeenCalled();
  });
});
