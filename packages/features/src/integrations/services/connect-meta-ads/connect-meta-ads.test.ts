import { encryptCredentials } from '@borradh-workspace/integrations';
import { MetaOAuthService } from '@borradh-workspace/integrations/meta-ads';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';

import {
  connectMetaAds,
  initiateMetaOAuth,
} from './connect-meta-ads.service.js';

const metaOAuthService = new MetaOAuthService() as Record<
  string,
  ReturnType<typeof vi.fn>
>;
const mockExchangeCodeForToken = vi.mocked(
  metaOAuthService.exchangeCodeForToken
);
const mockExchangeForLongLivedToken = vi.mocked(
  metaOAuthService.exchangeForLongLivedToken
);
const mockGetUserInfo = vi.mocked(metaOAuthService.getUserInfo);
const mockGetAdAccounts = vi.mocked(metaOAuthService.getAdAccounts);
const mockGetPages = vi.mocked(metaOAuthService.getPages);
const mockGetBusinesses = vi.mocked(metaOAuthService.getBusinesses);
const mockGetBusinessAdAccounts = vi.mocked(
  metaOAuthService.getBusinessAdAccounts
);
const mockGetBusinessPages = vi.mocked(metaOAuthService.getBusinessPages);
const mockSubscribePageToWebhooks = vi.mocked(
  metaOAuthService.subscribePageToWebhooks
);
const mockEncryptCredentials = vi.mocked(encryptCredentials);

describe('initiateMetaOAuth', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockEncryptCredentials.mockReturnValue('encrypted_credentials');
  });

  const validInput = {
    organizationId: 'org_123',
    userId: 'user_123',
    code: 'oauth_code_123',
  };

  const mockTokenResponse = {
    accessToken: 'short_lived_token',
    tokenType: 'Bearer',
    expiresIn: 3600,
  };

  const mockLongLivedToken = {
    accessToken: 'long_lived_token',
    tokenType: 'Bearer',
    expiresIn: 5184000, // ~60 days
  };

  const mockAdAccounts = [
    {
      id: 'act_123',
      accountId: '123',
      name: 'Test Ad Account',
      currency: 'USD',
      accountStatus: 1,
    },
  ];

  const mockPages = [
    {
      id: 'page_123',
      name: 'Test Page',
      accessToken: 'page_token_123',
      category: 'Business',
    },
  ];

  it('should initiate Meta OAuth successfully (new integration)', async () => {
    mockExchangeCodeForToken.mockResolvedValueOnce(mockTokenResponse);
    mockExchangeForLongLivedToken.mockResolvedValueOnce(mockLongLivedToken);
    mockGetUserInfo.mockResolvedValueOnce({
      name: 'Test User',
      email: null,
      pictureUrl: null,
    });
    // No businesses → fallback to me/* endpoints
    mockGetBusinesses.mockResolvedValueOnce([]);
    mockGetAdAccounts.mockResolvedValueOnce(mockAdAccounts);
    mockGetPages.mockResolvedValueOnce(mockPages);
    // No existing integration
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);
    // Insert new integration
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      { id: 'meta_integration_123', organizationId: 'org_123' },
    ]);

    const result = await initiateMetaOAuth(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.integrationId).toBe('meta_integration_123');
    }
  });

  /** The `values()` call that carries the asset lists onto the persisted row. */
  const findInsertedAssets = () =>
    mockDb.values.mock.calls
      .map((call) => call[0])
      .find(
        (
          v
        ): v is {
          availableAdAccounts?: unknown[];
          availablePages?: unknown[];
        } =>
          Array.isArray(
            (v as { availableAdAccounts?: unknown }).availableAdAccounts
          )
      );

  it('preserves business-owned ad accounts when the token scope (/me/adaccounts) is empty', async () => {
    // Reproduces ENG-622: business endpoints return owned assets, but the
    // system-user/FLFB token's /me/adaccounts is empty. The old intersection
    // wiped every business account → availableAdAccounts: []. The union must
    // keep them (with businessId intact).
    const businessAdAccount = {
      id: 'act_biz_1',
      accountId: 'biz_1',
      name: 'Business Ad Account',
      currency: 'EUR',
      accountStatus: 1,
      businessId: 'biz_123',
    };
    const businessPage = {
      id: 'page_biz_1',
      name: 'Business Page',
      accessToken: 'page_token_biz_1',
      businessId: 'biz_123',
    };

    mockExchangeCodeForToken.mockResolvedValueOnce(mockTokenResponse);
    mockExchangeForLongLivedToken.mockResolvedValueOnce(mockLongLivedToken);
    mockGetUserInfo.mockResolvedValueOnce({
      name: 'Test User',
      email: null,
      pictureUrl: null,
    });
    mockGetBusinesses.mockResolvedValueOnce([{ id: 'biz_123', name: 'Biz' }]);
    mockGetBusinessAdAccounts.mockResolvedValueOnce([businessAdAccount]);
    mockGetBusinessPages.mockResolvedValueOnce([businessPage]);
    // Token-scoped /me/* endpoints return nothing (system-user token path)
    mockGetAdAccounts.mockResolvedValueOnce([]);
    mockGetPages.mockResolvedValueOnce([]);

    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      { id: 'meta_integration_biz', organizationId: 'org_123' },
    ]);

    const result = await initiateMetaOAuth(mockDb as never, validInput);

    expect(result.success).toBe(true);

    // The persisted insert must still carry the business-owned account + page.
    const insertedValues = findInsertedAssets();
    expect(insertedValues?.availableAdAccounts).toEqual([businessAdAccount]);
    expect(insertedValues?.availablePages).toEqual([businessPage]);
  });

  it('unions token-scoped assets with business-owned ones, deduped by id', async () => {
    // The user granted access to a PERSONAL page/account that no business owns.
    // Union means both sets survive; dedupe means the asset present in BOTH
    // (act_shared / page_shared) appears exactly once, in its business-owned
    // form — the copy that still carries businessId.
    const businessAdAccount = {
      id: 'act_shared',
      accountId: 'shared',
      name: 'Shared Ad Account',
      currency: 'EUR',
      accountStatus: 1,
      businessId: 'biz_123',
    };
    const businessPage = {
      id: 'page_shared',
      name: 'Shared Page',
      accessToken: 'page_token_shared',
      businessId: 'biz_123',
    };
    const personalAdAccount = {
      id: 'act_personal',
      accountId: 'personal',
      name: 'Personal Ad Account',
      currency: 'GBP',
      accountStatus: 1,
    };
    const personalPage = {
      id: 'page_personal',
      name: 'Personal Page',
      accessToken: 'page_token_personal',
    };

    mockExchangeCodeForToken.mockResolvedValueOnce(mockTokenResponse);
    mockExchangeForLongLivedToken.mockResolvedValueOnce(mockLongLivedToken);
    mockGetUserInfo.mockResolvedValueOnce({
      name: 'Test User',
      email: null,
      pictureUrl: null,
    });
    mockGetBusinesses.mockResolvedValueOnce([{ id: 'biz_123', name: 'Biz' }]);
    mockGetBusinessAdAccounts.mockResolvedValueOnce([businessAdAccount]);
    mockGetBusinessPages.mockResolvedValueOnce([businessPage]);
    // /me/* returns the shared assets (WITHOUT businessId) plus personal ones.
    mockGetAdAccounts.mockResolvedValueOnce([
      { ...businessAdAccount, businessId: undefined },
      personalAdAccount,
    ]);
    mockGetPages.mockResolvedValueOnce([
      { ...businessPage, businessId: undefined },
      personalPage,
    ]);

    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      { id: 'meta_integration_union', organizationId: 'org_123' },
    ]);

    const result = await initiateMetaOAuth(mockDb as never, validInput);
    expect(result.success).toBe(true);

    const inserted = findInsertedAssets();
    expect(inserted?.availableAdAccounts).toEqual([
      businessAdAccount,
      personalAdAccount,
    ]);
    expect(inserted?.availablePages).toEqual([businessPage, personalPage]);
  });

  it('keeps business-owned assets when the token-scoped fetch THROWS', async () => {
    // A /me/* failure must never erase what the business endpoints already
    // returned — that would persist availableAdAccounts: [] and hide every
    // account from the picker.
    const businessAdAccount = {
      id: 'act_biz_1',
      accountId: 'biz_1',
      name: 'Business Ad Account',
      currency: 'EUR',
      accountStatus: 1,
      businessId: 'biz_123',
    };
    const businessPage = {
      id: 'page_biz_1',
      name: 'Business Page',
      accessToken: 'page_token_biz_1',
      businessId: 'biz_123',
    };

    mockExchangeCodeForToken.mockResolvedValueOnce(mockTokenResponse);
    mockExchangeForLongLivedToken.mockResolvedValueOnce(mockLongLivedToken);
    mockGetUserInfo.mockResolvedValueOnce({
      name: 'Test User',
      email: null,
      pictureUrl: null,
    });
    mockGetBusinesses.mockResolvedValueOnce([{ id: 'biz_123', name: 'Biz' }]);
    mockGetBusinessAdAccounts.mockResolvedValueOnce([businessAdAccount]);
    mockGetBusinessPages.mockResolvedValueOnce([businessPage]);
    mockGetAdAccounts.mockRejectedValueOnce(new Error('Graph 500'));
    mockGetPages.mockRejectedValueOnce(new Error('Graph 500'));

    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      { id: 'meta_integration_partial', organizationId: 'org_123' },
    ]);

    const result = await initiateMetaOAuth(mockDb as never, validInput);

    // OAuth still completes — the merge failure is logged, not fatal.
    expect(result.success).toBe(true);
    const inserted = findInsertedAssets();
    expect(inserted?.availableAdAccounts).toEqual([businessAdAccount]);
    expect(inserted?.availablePages).toEqual([businessPage]);
  });

  it('keeps token-scoped assets when a per-business fetch returns nothing', async () => {
    // The mirror case: the business owns nothing we can see (permission error
    // degraded to []), but the token has personal assets. Those must survive.
    const personalAdAccount = {
      id: 'act_personal',
      accountId: 'personal',
      name: 'Personal Ad Account',
      currency: 'USD',
      accountStatus: 1,
    };
    const personalPage = {
      id: 'page_personal',
      name: 'Personal Page',
      accessToken: 'page_token_personal',
    };

    mockExchangeCodeForToken.mockResolvedValueOnce(mockTokenResponse);
    mockExchangeForLongLivedToken.mockResolvedValueOnce(mockLongLivedToken);
    mockGetUserInfo.mockResolvedValueOnce({
      name: 'Test User',
      email: null,
      pictureUrl: null,
    });
    mockGetBusinesses.mockResolvedValueOnce([{ id: 'biz_123', name: 'Biz' }]);
    mockGetBusinessAdAccounts.mockResolvedValueOnce([]);
    mockGetBusinessPages.mockResolvedValueOnce([]);
    mockGetAdAccounts.mockResolvedValueOnce([personalAdAccount]);
    mockGetPages.mockResolvedValueOnce([personalPage]);

    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      { id: 'meta_integration_personal', organizationId: 'org_123' },
    ]);

    const result = await initiateMetaOAuth(mockDb as never, validInput);
    expect(result.success).toBe(true);

    const inserted = findInsertedAssets();
    expect(inserted?.availableAdAccounts).toEqual([personalAdAccount]);
    expect(inserted?.availablePages).toEqual([personalPage]);
  });

  it('should update existing integration on re-auth', async () => {
    mockExchangeCodeForToken.mockResolvedValueOnce(mockTokenResponse);
    mockExchangeForLongLivedToken.mockResolvedValueOnce(mockLongLivedToken);
    mockGetUserInfo.mockResolvedValueOnce({
      name: 'Test User',
      email: null,
      pictureUrl: null,
    });
    mockGetBusinesses.mockResolvedValueOnce([]);
    mockGetAdAccounts.mockResolvedValueOnce(mockAdAccounts);
    mockGetPages.mockResolvedValueOnce(mockPages);
    // Existing integration found
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'existing_meta',
      organizationId: 'org_123',
    });
    // Update existing integration
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      { id: 'existing_meta', organizationId: 'org_123' },
    ]);

    const result = await initiateMetaOAuth(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.integrationId).toBe('existing_meta');
    }
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should return EXTERNAL_SERVICE_ERROR when token exchange fails', async () => {
    mockExchangeCodeForToken.mockRejectedValueOnce(
      new Error('Failed to exchange code')
    );

    const result = await initiateMetaOAuth(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.EXTERNAL_SERVICE_ERROR);
    }
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      code: 'oauth_code_123',
    };

    const result = await initiateMetaOAuth(
      mockDb as never,
      invalidInput as never
    );

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });
});

describe('connectMetaAds', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockEncryptCredentials.mockReturnValue('encrypted_credentials');
  });

  const validInput = {
    organizationId: 'org_123',
    userId: 'user_123',
    code: 'oauth_code_123',
    adAccountId: 'act_123',
    adAccountName: 'Test Ad Account',
    pageId: 'page_123',
    pageName: 'Test Page',
  };

  const mockTokenResponse = {
    accessToken: 'short_lived_token',
    tokenType: 'Bearer',
    expiresIn: 3600,
  };

  const mockLongLivedToken = {
    accessToken: 'long_lived_token',
    tokenType: 'Bearer',
    expiresIn: 5184000,
  };

  const mockAdAccounts = [
    {
      id: 'act_123',
      accountId: '123',
      name: 'Test Ad Account',
      currency: 'USD',
      accountStatus: 1,
    },
  ];

  const mockPages = [
    {
      id: 'page_123',
      name: 'Test Page',
      accessToken: 'page_token_123',
      category: 'Business',
    },
  ];

  it('should connect Meta Ads successfully (new integration)', async () => {
    mockExchangeCodeForToken.mockResolvedValueOnce(mockTokenResponse);
    mockExchangeForLongLivedToken.mockResolvedValueOnce(mockLongLivedToken);
    mockGetUserInfo.mockResolvedValueOnce({
      name: 'Test User',
      email: null,
      pictureUrl: null,
    });
    mockGetAdAccounts.mockResolvedValueOnce(mockAdAccounts);
    mockGetPages.mockResolvedValueOnce(mockPages);
    mockSubscribePageToWebhooks.mockResolvedValueOnce(undefined);
    // No existing integration
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);
    // Insert integration
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning
      .mockResolvedValueOnce([
        {
          id: 'meta_123',
          organizationId: 'org_123',
          adAccountId: 'act_123',
          defaultPageId: null,
          isActive: true,
        },
      ])
      // Insert page
      .mockResolvedValueOnce([
        {
          id: 'page_record_123',
          pageId: 'page_123',
          pageName: 'Test Page',
          isActive: true,
        },
      ]);

    // Update integration to set defaultPageId
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'meta_123',
        organizationId: 'org_123',
        adAccountId: 'act_123',
        defaultPageId: 'page_record_123',
        isActive: true,
      },
    ]);

    const result = await connectMetaAds(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.adAccountId).toBe('act_123');
    }
    expect(mockSubscribePageToWebhooks).toHaveBeenCalled();
  });

  it('should update existing Meta Ads integration', async () => {
    mockExchangeCodeForToken.mockResolvedValueOnce(mockTokenResponse);
    mockExchangeForLongLivedToken.mockResolvedValueOnce(mockLongLivedToken);
    mockGetUserInfo.mockResolvedValueOnce({
      name: 'Test User',
      email: null,
      pictureUrl: null,
    });
    mockGetAdAccounts.mockResolvedValueOnce(mockAdAccounts);
    mockGetPages.mockResolvedValueOnce(mockPages);
    mockSubscribePageToWebhooks.mockResolvedValueOnce(undefined);
    // Existing integration
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'existing_meta',
      organizationId: 'org_123',
    });
    // No existing page for this integration
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(null);
    // Update integration
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'existing_meta',
        organizationId: 'org_123',
        adAccountId: 'act_123',
        defaultPageId: null,
        isActive: true,
      },
    ]);
    // Insert new page
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'page_record_123',
        pageId: 'page_123',
        pageName: 'Test Page',
        isActive: true,
      },
    ]);
    // Update integration to set defaultPageId
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'existing_meta',
        organizationId: 'org_123',
        adAccountId: 'act_123',
        defaultPageId: 'page_record_123',
        isActive: true,
      },
    ]);

    const result = await connectMetaAds(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should return NOT_FOUND when selected page is not found', async () => {
    mockExchangeCodeForToken.mockResolvedValueOnce(mockTokenResponse);
    mockExchangeForLongLivedToken.mockResolvedValueOnce(mockLongLivedToken);
    mockGetUserInfo.mockResolvedValueOnce({
      name: 'Test User',
      email: null,
      pictureUrl: null,
    });
    mockGetAdAccounts.mockResolvedValueOnce(mockAdAccounts);
    mockGetPages.mockResolvedValueOnce([]); // No pages

    const result = await connectMetaAds(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(result.error.message).toContain('page not found');
    }
  });

  it('should return EXTERNAL_SERVICE_ERROR when token exchange fails', async () => {
    mockExchangeCodeForToken.mockRejectedValueOnce(
      new Error('Failed to exchange code')
    );

    const result = await connectMetaAds(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.EXTERNAL_SERVICE_ERROR);
    }
  });

  it('should return VALIDATION_ERROR for missing required fields', async () => {
    const invalidInput = {
      organizationId: 'org_123',
      code: 'oauth_code_123',
      // Missing adAccountId, pageId, userId
    };

    const result = await connectMetaAds(mockDb as never, invalidInput as never);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return INTERNAL_ERROR on database failure', async () => {
    mockExchangeCodeForToken.mockResolvedValueOnce(mockTokenResponse);
    mockExchangeForLongLivedToken.mockResolvedValueOnce(mockLongLivedToken);
    mockGetUserInfo.mockResolvedValueOnce({
      name: 'Test User',
      email: null,
      pictureUrl: null,
    });
    mockGetAdAccounts.mockResolvedValueOnce(mockAdAccounts);
    mockGetPages.mockResolvedValueOnce(mockPages);
    mockSubscribePageToWebhooks.mockResolvedValueOnce(undefined);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockRejectedValueOnce(new Error('Database error'));

    const result = await connectMetaAds(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
  });
});
