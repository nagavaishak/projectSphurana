/**
 * FLfB ↔ classic PARITY SUITE.
 *
 * The FLfB migration changes three load-bearing assumptions (non-expiring
 * system-user token, multiple pages + ad accounts, Instagram via the page
 * token on graph.facebook.com). This file runs the highest-risk Meta paths
 * through BOTH worlds side by side and asserts the invariants that keep each
 * world working:
 *
 *   CLASSIC — expiring user token, single page, single ad account,
 *             standalone Instagram-Login token on graph.instagram.com.
 *   FLFB    — tokenExpiresAt null, connectionMethod 'flfb', multiple pages
 *             each with their own default ad account, page-linked Instagram
 *             on graph.facebook.com.
 *
 * Per-service edge cases live in each service's own test file; this suite
 * exists so a change that fixes one world and silently breaks the other
 * fails HERE, with the two worlds visible next to each other.
 */
import { decryptCredentials } from '@borradh-workspace/integrations';
// Same symbol, separate canonical mock module — services import from either
import { decryptCredentials as decryptCredentialsSubpath } from '@borradh-workspace/integrations/encryption';
import { mockMetaOAuthService } from '@borradh-workspace/integrations/meta-ads';
import { isFeatureEnabled } from '@borradh-workspace/observability';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { getMetaCredentials } from '../meta-ads/services/_shared/get-meta-credentials.js';
import { isFlfbIntegration } from '../shared/index.js';
import { getPostEngagement } from '../social-posts/services/get-post-engagement/get-post-engagement.service.js';
import { listMetaAdsPages } from './services/list-meta-ads-pages/list-meta-ads-pages.service.js';
import { refreshMetaTokens } from './services/refresh-meta-tokens/refresh-meta-tokens.service.js';
import { snapshotMetaTokenHealth } from './services/snapshot-meta-token-health/snapshot-meta-token-health.service.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockRefreshLongLivedToken = vi.mocked(
  mockMetaOAuthService.refreshLongLivedToken
);

// ---------------------------------------------------------------------------
// The two worlds. Encrypted blobs decrypt to distinct tokens so assertions can
// prove WHICH token was used, not just that something was.
// ---------------------------------------------------------------------------

const TOKENS: Record<string, { accessToken: string }> = {
  'enc-classic-int': { accessToken: 'classic_user_token' },
  'enc-classic-page': { accessToken: 'classic_page_token' },
  'enc-flfb-int': { accessToken: 'flfb_system_user_token' },
  'enc-flfb-page-1': { accessToken: 'flfb_page_1_token' },
  'enc-flfb-page-2': { accessToken: 'flfb_page_2_token' },
  'enc-standalone-ig': { accessToken: 'standalone_ig_token' },
};

const futureDate = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000);

const classicPage = {
  id: 'row-classic-1',
  metaAdsIntegrationId: 'int-classic',
  pageId: 'fbp-classic',
  pageName: 'Classic Page',
  pageAccessToken: 'enc-classic-page',
  platform: 'facebook' as const,
  defaultAdAccountId: null,
  defaultAdAccountCurrency: null,
  linkedInstagramAccountId: null,
  linkedInstagramUsername: null,
  linkedInstagramName: null,
  isChatbotActive: false,
  isActive: true,
  pixelId: null,
  pixelName: null,
  defaultLeadFormId: null,
  defaultLeadFormName: null,
  createdAt: new Date('2026-01-01'),
};

const classicIntegration = {
  id: 'int-classic',
  organizationId: 'org-classic',
  connectionMethod: 'classic' as const,
  configurationStatus: 'configured' as const,
  isActive: true,
  tokenStatus: 'valid' as const,
  tokenExpiresAt: futureDate(30),
  encryptedCredentials: 'enc-classic-int',
  adAccountId: 'act_classic',
  availableAdAccounts: [{ accountId: 'act_classic', currency: 'EUR' }],
  defaultPageId: 'row-classic-1',
  defaultPage: classicPage,
  pages: [classicPage],
};

const flfbPage1 = {
  ...classicPage,
  id: 'row-flfb-1',
  metaAdsIntegrationId: 'int-flfb',
  pageId: 'fbp-flfb-1',
  pageName: 'FLfB Page One',
  pageAccessToken: 'enc-flfb-page-1',
  defaultAdAccountId: 'act_a',
  defaultAdAccountCurrency: 'EUR',
  linkedInstagramAccountId: 'ig-account-1',
  linkedInstagramUsername: 'clinic_one',
};

const flfbPage2 = {
  ...classicPage,
  id: 'row-flfb-2',
  metaAdsIntegrationId: 'int-flfb',
  pageId: 'fbp-flfb-2',
  pageName: 'FLfB Page Two',
  pageAccessToken: 'enc-flfb-page-2',
  defaultAdAccountId: 'act_b',
  defaultAdAccountCurrency: 'USD',
};

const flfbIntegration = {
  ...classicIntegration,
  id: 'int-flfb',
  organizationId: 'org-flfb',
  connectionMethod: 'flfb' as const,
  tokenExpiresAt: null,
  encryptedCredentials: 'enc-flfb-int',
  adAccountId: 'act_default',
  availableAdAccounts: [
    { accountId: 'act_default', currency: 'EUR' },
    { accountId: 'act_a', currency: 'EUR' },
    { accountId: 'act_b', currency: 'USD' },
  ],
  defaultPageId: 'row-flfb-1',
  defaultPage: flfbPage1,
  pages: [flfbPage1, flfbPage2],
};

const standaloneIgIntegration = {
  id: 'ig-int-1',
  organizationId: 'org-classic',
  isActive: true,
  instagramUserId: 'ig-standalone-user',
  username: 'legacy_ig',
  name: 'Legacy IG',
  chatbotEnabled: false,
  encryptedCredentials: 'enc-standalone-ig',
  createdAt: new Date('2026-01-01'),
};

describe('meta FLfB ↔ classic parity', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockFetch.mockReset();
    const decryptByBlob = (enc: string) =>
      TOKENS[enc] ?? { accessToken: `unknown:${enc}` };
    vi.mocked(decryptCredentials).mockImplementation(decryptByBlob);
    vi.mocked(decryptCredentialsSubpath).mockImplementation(decryptByBlob);
    // PostHog flag default-off unless a test flips it
    vi.mocked(isFeatureEnabled).mockResolvedValue(false as never);
  });

  // -------------------------------------------------------------------------
  // isFlfbIntegration — the single boolean everything keys off
  // -------------------------------------------------------------------------
  describe('isFlfbIntegration', () => {
    it('classifies both worlds and legacy NULL rows', () => {
      expect(isFlfbIntegration(classicIntegration)).toBe(false);
      expect(isFlfbIntegration(flfbIntegration)).toBe(true);
      // Rows written before the column existed
      expect(
        isFlfbIntegration({
          connectionMethod: null,
          tokenExpiresAt: futureDate(30),
        })
      ).toBe(false);
      expect(
        isFlfbIntegration({ connectionMethod: null, tokenExpiresAt: null })
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Credential resolution — the shared helper every ads/campaigns path uses
  // -------------------------------------------------------------------------
  describe('getMetaCredentials', () => {
    it('classic: resolves the single page + integration ad account', async () => {
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
        classicIntegration
      );

      const result = await getMetaCredentials(mockDb as never, {
        organizationId: 'org-classic',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.credentials.accessToken).toBe('classic_user_token');
        expect(result.data.credentials.adAccountId).toBe('act_classic');
        expect(result.data.credentials.pageId).toBe('fbp-classic');
      }
    });

    it('flfb: default resolution uses default page + ITS ad account (not the integration default)', async () => {
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
        flfbIntegration
      );

      const result = await getMetaCredentials(mockDb as never, {
        organizationId: 'org-flfb',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.credentials.accessToken).toBe(
          'flfb_system_user_token'
        );
        expect(result.data.credentials.adAccountId).toBe('act_a');
        expect(result.data.credentials.pageId).toBe('fbp-flfb-1');
        expect(result.data.resolvedPage.linkedInstagramAccountId).toBe(
          'ig-account-1'
        );
      }
    });

    it('flfb: selecting a non-default page carries that page + its ad account', async () => {
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
        flfbIntegration
      );

      const result = await getMetaCredentials(mockDb as never, {
        organizationId: 'org-flfb',
        metaAdsPageId: 'row-flfb-2',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.credentials.adAccountId).toBe('act_b');
        expect(result.data.credentials.pageId).toBe('fbp-flfb-2');
        expect(result.data.credentials.adAccountCurrency).toBe('USD');
      }
    });

    it('flfb: an explicit ad-account override (campaign snapshot) wins over every default', async () => {
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
        flfbIntegration
      );

      const result = await getMetaCredentials(mockDb as never, {
        organizationId: 'org-flfb',
        metaAdsPageId: 'row-flfb-2',
        adAccountId: 'act_snapshot',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.credentials.adAccountId).toBe('act_snapshot');
        expect(result.data.credentials.pageId).toBe('fbp-flfb-2');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Token lifecycle — classic refreshes, FLfB must NEVER touch fb_exchange_token
  // -------------------------------------------------------------------------
  describe('token lifecycle', () => {
    it('refresh: refreshes the expiring classic token, skips the FLfB row', async () => {
      const expiringClassic = {
        ...classicIntegration,
        tokenExpiresAt: futureDate(3),
      };
      mockDb.query.metaAdsIntegration.findMany.mockResolvedValueOnce([
        expiringClassic,
        // Even if the SQL guard regresses and an FLfB row reaches the loop,
        // the per-row guard must skip it.
        flfbIntegration,
      ]);
      mockRefreshLongLivedToken.mockResolvedValueOnce({
        accessToken: 'refreshed_classic_token',
        tokenType: 'bearer',
        expiresIn: 5184000,
      });

      const result = await refreshMetaTokens(mockDb as never, {
        daysBeforeExpiry: 7,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.refreshed).toBe(1);
        expect(result.data.skipped).toBe(1);
        expect(result.data.failed).toBe(0);
      }
      expect(mockRefreshLongLivedToken).toHaveBeenCalledTimes(1);
      expect(mockRefreshLongLivedToken).toHaveBeenCalledWith(
        'classic_user_token'
      );
    });

    it('health snapshot: counts both worlds healthy (null expiry ≠ expired)', async () => {
      mockDb.query.metaAdsIntegration.findMany.mockResolvedValueOnce([
        classicIntegration,
        flfbIntegration,
      ]);

      const result = await snapshotMetaTokenHealth(mockDb as never);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.healthy).toBe(2);
        expect(result.data.expired).toBe(0);
        expect(result.data.needsReconnect).toBe(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Instagram host/token routing — page tokens ONLY work on graph.facebook.com,
  // standalone Instagram-Login tokens ONLY on graph.instagram.com
  // -------------------------------------------------------------------------
  describe('instagram engagement routing', () => {
    const igPost = (orgId: string) => ({
      id: 'post-ig',
      organizationId: orgId,
      platformResults: [
        { platform: 'instagram', success: true, postId: 'ig-media-1' },
      ],
    });

    it('classic: standalone token → graph.instagram.com', async () => {
      mockDb.query.socialPost.findFirst.mockResolvedValueOnce(
        igPost('org-classic')
      );
      mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce(
        standaloneIgIntegration
      );
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ like_count: 5, comments_count: 2 }),
      });

      const result = await getPostEngagement(mockDb as never, {
        socialPostId: 'post-ig',
        organizationId: 'org-classic',
      });

      expect(result.success).toBe(true);
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('graph.instagram.com');
      expect(url).toContain('access_token=standalone_ig_token');
    });

    it('flfb: page token → graph.facebook.com (never graph.instagram.com)', async () => {
      mockDb.query.socialPost.findFirst.mockResolvedValueOnce(
        igPost('org-flfb')
      );
      // No standalone integration for the FLfB org
      mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce(null);
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
        flfbIntegration
      );
      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(flfbPage1);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ like_count: 9, comments_count: 4 }),
      });

      const result = await getPostEngagement(mockDb as never, {
        socialPostId: 'post-ig',
        organizationId: 'org-flfb',
      });

      expect(result.success).toBe(true);
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('graph.facebook.com');
      expect(url).not.toContain('graph.instagram.com');
      expect(url).toContain('access_token=flfb_page_1_token');
    });
  });

  // -------------------------------------------------------------------------
  // Page listing — the ig-standalone: virtual page must survive for classic
  // orgs and disappear only once the page-linked IG covers it under the flag
  // -------------------------------------------------------------------------
  describe('page listing (ig-standalone: retirement)', () => {
    it('classic: standalone IG shows as a virtual page', async () => {
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
        classicIntegration
      );
      mockDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([classicPage]),
        }),
      } as never);
      mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce(
        standaloneIgIntegration
      );

      const result = await listMetaAdsPages(mockDb as never, {
        organizationId: 'org-classic',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.some((p) => p.id.startsWith('ig-standalone:'))).toBe(
          true
        );
      }
    });

    it('flfb + flag ON: virtual page suppressed when a page carries the same IG account', async () => {
      vi.mocked(isFeatureEnabled).mockResolvedValue(true as never);
      const migratedStandalone = {
        ...standaloneIgIntegration,
        organizationId: 'org-flfb',
        instagramUserId: 'ig-account-1', // now linked to flfbPage1
      };
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
        flfbIntegration
      );
      mockDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([flfbPage1, flfbPage2]),
        }),
      } as never);
      mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce(
        migratedStandalone
      );

      const result = await listMetaAdsPages(mockDb as never, {
        organizationId: 'org-flfb',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.some((p) => p.id.startsWith('ig-standalone:'))).toBe(
          false
        );
        expect(result.data).toHaveLength(2);
      }
    });

    it('flfb + flag OFF: virtual page kept even when the IG account is page-linked (rollback safety)', async () => {
      const migratedStandalone = {
        ...standaloneIgIntegration,
        organizationId: 'org-flfb',
        instagramUserId: 'ig-account-1',
      };
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
        flfbIntegration
      );
      mockDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([flfbPage1, flfbPage2]),
        }),
      } as never);
      mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce(
        migratedStandalone
      );

      const result = await listMetaAdsPages(mockDb as never, {
        organizationId: 'org-flfb',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.some((p) => p.id.startsWith('ig-standalone:'))).toBe(
          true
        );
      }
    });
  });
});
