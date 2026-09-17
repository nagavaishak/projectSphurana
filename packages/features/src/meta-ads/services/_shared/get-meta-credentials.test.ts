import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { CampaignErrorCodes } from '../../../meta-campaigns/models/index.js';
import { ErrorCodes } from '../../../shared/index.js';

import { getMetaCredentials } from './get-meta-credentials.js';

const mockDecryptCredentials = vi.mocked(decryptCredentials);

const defaultPage = {
  id: 'page-internal-1',
  pageId: 'fb-page-123',
  pageName: 'My Page',
  linkedInstagramAccountId: 'ig-123',
  linkedInstagramUsername: 'mypage',
  defaultAdAccountId: 'act_page_default',
  defaultAdAccountName: 'Page Default Account',
  defaultAdAccountCurrency: 'EUR',
};

const secondPage = {
  id: 'page-internal-2',
  pageId: 'fb-page-456',
  pageName: 'Other Page',
  linkedInstagramAccountId: null,
  linkedInstagramUsername: null,
  defaultAdAccountId: 'act_page_2',
  defaultAdAccountName: 'Page 2 Account',
  defaultAdAccountCurrency: 'GBP',
};

const pageWithNoAdAccount = {
  id: 'page-internal-3',
  pageId: 'fb-page-789',
  pageName: 'Bare Page',
  linkedInstagramAccountId: null,
  linkedInstagramUsername: null,
  defaultAdAccountId: null,
  defaultAdAccountName: null,
  defaultAdAccountCurrency: null,
};

const makeDb = (integration: unknown) => ({
  query: {
    metaAdsIntegration: {
      findFirst: vi.fn().mockResolvedValue(integration),
    },
  },
});

describe('getMetaCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDecryptCredentials.mockReturnValue({ accessToken: 'token-abc' });
  });

  it('returns credentials with default page (page ad account takes priority)', async () => {
    const db = makeDb({
      id: 'int-1',
      encryptedCredentials: 'enc',
      adAccountId: 'act_integration_fallback',
      configurationStatus: 'configured',
      isActive: true,
      defaultPage,
      pages: [defaultPage, secondPage],
      availableAdAccounts: null,
    });

    const result = await getMetaCredentials(db as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // Page's defaultAdAccountId takes priority over integration.adAccountId
      expect(result.data.credentials.adAccountId).toBe('act_page_default');
      expect(result.data.credentials.adAccountCurrency).toBe('EUR');
      expect(result.data.credentials.pageId).toBe('fb-page-123');
      expect(result.data.credentials.pageName).toBe('My Page');
      expect(result.data.credentials.accessToken).toBe('token-abc');
      expect(result.data.resolvedPage.id).toBe('page-internal-1');
    }
  });

  it('resolves specific page and its ad account when metaAdsPageId provided', async () => {
    const db = makeDb({
      id: 'int-1',
      encryptedCredentials: 'enc',
      adAccountId: 'act_integration_fallback',
      configurationStatus: 'configured',
      isActive: true,
      defaultPage,
      pages: [defaultPage, secondPage],
      availableAdAccounts: null,
    });

    const result = await getMetaCredentials(db as never, {
      organizationId: 'org-1',
      metaAdsPageId: 'page-internal-2',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.credentials.pageId).toBe('fb-page-456');
      expect(result.data.credentials.adAccountId).toBe('act_page_2');
      expect(result.data.credentials.adAccountCurrency).toBe('GBP');
      expect(result.data.resolvedPage.id).toBe('page-internal-2');
    }
  });

  it('falls back to default page when metaAdsPageId not found', async () => {
    const db = makeDb({
      id: 'int-1',
      encryptedCredentials: 'enc',
      adAccountId: 'act_123',
      configurationStatus: 'configured',
      isActive: true,
      defaultPage,
      pages: [defaultPage],
      availableAdAccounts: null,
    });

    const result = await getMetaCredentials(db as never, {
      organizationId: 'org-1',
      metaAdsPageId: 'nonexistent-page',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.credentials.pageId).toBe('fb-page-123');
    }
  });

  it('returns error when no integration found', async () => {
    const db = makeDb(null);

    const result = await getMetaCredentials(db as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(CampaignErrorCodes.META_NOT_CONFIGURED);
    }
  });

  it('returns error when no encrypted credentials', async () => {
    const db = makeDb({
      id: 'int-1',
      encryptedCredentials: null,
      adAccountId: 'act_123',
      defaultPage,
      pages: [],
    });

    const result = await getMetaCredentials(db as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(CampaignErrorCodes.META_NOT_CONFIGURED);
    }
  });

  it('returns error when no ad account at any tier', async () => {
    // All three tiers are null: no explicit, no page default, no integration fallback
    const db = makeDb({
      id: 'int-1',
      encryptedCredentials: 'enc',
      adAccountId: null,
      configurationStatus: 'configured',
      isActive: true,
      defaultPage: pageWithNoAdAccount,
      pages: [pageWithNoAdAccount],
      availableAdAccounts: null,
    });

    const result = await getMetaCredentials(db as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(CampaignErrorCodes.META_NOT_CONFIGURED);
      expect(result.error.message).toContain('Ad Account');
    }
  });

  it('returns error when no default page', async () => {
    const db = makeDb({
      id: 'int-1',
      encryptedCredentials: 'enc',
      adAccountId: 'act_123',
      defaultPage: null,
      pages: [],
    });

    const result = await getMetaCredentials(db as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(CampaignErrorCodes.META_NOT_CONFIGURED);
      expect(result.error.message).toContain('Page');
    }
  });

  it('explicit adAccountId option takes priority over page and integration', async () => {
    const db = makeDb({
      id: 'int-1',
      encryptedCredentials: 'enc',
      adAccountId: 'act_integration',
      configurationStatus: 'configured',
      isActive: true,
      defaultPage,
      pages: [defaultPage],
      availableAdAccounts: null,
    });

    const result = await getMetaCredentials(db as never, {
      organizationId: 'org-1',
      adAccountId: 'act_explicit_override',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.credentials.adAccountId).toBe('act_explicit_override');
    }
  });

  it('falls back to integration adAccountId when page has no default', async () => {
    const db = makeDb({
      id: 'int-1',
      encryptedCredentials: 'enc',
      adAccountId: 'act_integration_fallback',
      configurationStatus: 'configured',
      isActive: true,
      defaultPage: pageWithNoAdAccount,
      pages: [pageWithNoAdAccount],
      availableAdAccounts: null,
    });

    const result = await getMetaCredentials(db as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.credentials.adAccountId).toBe(
        'act_integration_fallback'
      );
    }
  });

  it('resolves currency from page default', async () => {
    const db = makeDb({
      id: 'int-1',
      encryptedCredentials: 'enc',
      adAccountId: 'act_integration',
      configurationStatus: 'configured',
      isActive: true,
      defaultPage,
      pages: [defaultPage],
      availableAdAccounts: null,
    });

    const result = await getMetaCredentials(db as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.credentials.adAccountCurrency).toBe('EUR');
    }
  });

  it('resolves currency from availableAdAccounts when page has none', async () => {
    const db = makeDb({
      id: 'int-1',
      encryptedCredentials: 'enc',
      adAccountId: 'act_from_available',
      configurationStatus: 'configured',
      isActive: true,
      defaultPage: pageWithNoAdAccount,
      pages: [pageWithNoAdAccount],
      availableAdAccounts: [
        {
          id: 'act_from_available',
          accountId: 'act_from_available',
          currency: 'CAD',
        },
      ],
    });

    const result = await getMetaCredentials(db as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.credentials.adAccountCurrency).toBe('CAD');
    }
  });

  it('includes appSecret from env', async () => {
    const originalSecret = process.env.META_APP_SECRET;
    process.env.META_APP_SECRET = 'test-app-secret';

    const db = makeDb({
      id: 'int-1',
      encryptedCredentials: 'enc',
      adAccountId: 'act_123',
      configurationStatus: 'configured',
      isActive: true,
      defaultPage,
      pages: [defaultPage],
      availableAdAccounts: null,
    });

    const result = await getMetaCredentials(db as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.credentials.appSecret).toBe('test-app-secret');
    }

    process.env.META_APP_SECRET = originalSecret;
  });

  it('returns error on decryption failure', async () => {
    mockDecryptCredentials.mockImplementation(() => {
      throw new Error('Decryption failed');
    });

    const db = makeDb({
      id: 'int-1',
      encryptedCredentials: 'enc',
      adAccountId: 'act_123',
      defaultPage,
      pages: [],
      availableAdAccounts: null,
    });

    const result = await getMetaCredentials(db as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(result.error.message).toContain('decrypt');
    }
  });
});

/**
 * Meta tells us which accounts it will actually bill. Ignoring that meant an
 * org with two accounts launched into whichever the campaign snapshot happened
 * to hold — array order deciding where the money went — and spent half a minute
 * round-tripping to Meta to be told "no payment method" about an account the
 * owner does not use.
 */
describe('getMetaCredentials — billable ad accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDecryptCredentials.mockReturnValue({ accessToken: 'token-abc' });
  });

  const twoAccounts = [
    {
      id: 'act_usd',
      accountId: 'usd',
      name: 'USD Ad Account',
      currency: 'USD',
      hasPaymentMethod: false,
    },
    {
      id: 'act_eur',
      accountId: 'eur',
      name: 'DC Ad Account',
      currency: 'EUR',
      hasPaymentMethod: true,
    },
  ];

  const integrationWith = (overrides: Record<string, unknown>) => ({
    id: 'int-1',
    encryptedCredentials: 'enc',
    adAccountId: null,
    configurationStatus: 'configured',
    isActive: true,
    defaultPage: pageWithNoAdAccount,
    pages: [pageWithNoAdAccount],
    availableAdAccounts: twoAccounts,
    ...overrides,
  });

  it('does not default to an account that cannot be billed', async () => {
    const db = makeDb(integrationWith({ adAccountId: 'act_usd' }));

    const result = await getMetaCredentials(db as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.credentials.adAccountId).toBe('act_eur');
    }
  });

  it('picks the billable one when nothing is selected at all', async () => {
    const db = makeDb(integrationWith({}));

    const result = await getMetaCredentials(db as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.credentials.adAccountId).toBe('act_eur');
    }
  });

  // Redirecting an account somebody deliberately picked would move spending —
  // and currency — without being asked. That case fails loudly instead.
  it('refuses an explicit unbillable account instead of switching it', async () => {
    const db = makeDb(integrationWith({}));

    const result = await getMetaCredentials(db as never, {
      organizationId: 'org-1',
      adAccountId: 'act_usd',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('USD Ad Account');
      // Names a way out that EXISTS. "Point the campaign at that account"
      // described an action nothing can take — a campaign's ad account is
      // fixed at creation — so Claire concluded she was stuck and told the
      // owner to email support.
      expect(result.error.message).toContain('DC Ad Account');
      expect(result.error.message).toMatch(/new campaign/i);
      expect(result.error.message).toMatch(/add a payment method to/i);
    }
  });

  // Absent is UNKNOWN, not false — an account we have no billing signal for
  // must not be treated as broken.
  it('leaves an account alone when Meta told us nothing about billing', async () => {
    const db = makeDb(
      integrationWith({
        adAccountId: 'act_unknown',
        availableAdAccounts: [
          { id: 'act_unknown', accountId: 'unknown', currency: 'EUR' },
        ],
      })
    );

    const result = await getMetaCredentials(db as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.credentials.adAccountId).toBe('act_unknown');
    }
  });
});
