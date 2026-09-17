import { encryptCredentials } from '@borradh-workspace/integrations';
import { mockMetaOAuthService } from '@borradh-workspace/integrations/meta-ads';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { addMetaAdsPage } from './add-meta-ads-page.service.js';

const mockSubscribePageToWebhooks = vi.mocked(
  mockMetaOAuthService.subscribePageToWebhooks
);

const mockDb = {
  query: {
    metaAdsIntegration: {
      findFirst: vi.fn(),
    },
    metaAdsPage: {
      findFirst: vi.fn(),
    },
  },
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
};

describe('addMetaAdsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(encryptCredentials).mockReturnValue('encrypted_token');
    mockSubscribePageToWebhooks.mockResolvedValue(true);
  });

  describe('validation', () => {
    it('returns VALIDATION_ERROR for missing organizationId', async () => {
      const result = await addMetaAdsPage(mockDb as never, {
        organizationId: '',
        pageId: 'page-123',
        pageAccessToken: 'token-abc',
        platform: 'facebook',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });

    it('returns VALIDATION_ERROR for missing pageId', async () => {
      const result = await addMetaAdsPage(mockDb as never, {
        organizationId: 'org-123',
        pageId: '',
        pageAccessToken: 'token-abc',
        platform: 'facebook',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });

    it('returns VALIDATION_ERROR for missing pageAccessToken', async () => {
      const result = await addMetaAdsPage(mockDb as never, {
        organizationId: 'org-123',
        pageId: 'page-123',
        pageAccessToken: '',
        platform: 'facebook',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });

    it('returns VALIDATION_ERROR for invalid platform', async () => {
      const result = await addMetaAdsPage(mockDb as never, {
        organizationId: 'org-123',
        pageId: 'page-123',
        pageAccessToken: 'token-abc',
        platform: 'twitter' as 'facebook',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });
  });

  describe('integration lookup', () => {
    it('returns NOT_FOUND when integration does not exist', async () => {
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);

      const result = await addMetaAdsPage(mockDb as never, {
        organizationId: 'org-123',
        pageId: 'page-123',
        pageAccessToken: 'token-abc',
        platform: 'facebook',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(result.error.message).toContain('integration not found');
      }
    });
  });

  describe('duplicate detection', () => {
    it('returns ALREADY_EXISTS when page already connected', async () => {
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
        id: 'integration-1',
        organizationId: 'org-123',
        defaultPageId: null,
      });
      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
        id: 'existing-page',
        pageId: 'page-123',
      });

      const result = await addMetaAdsPage(mockDb as never, {
        organizationId: 'org-123',
        pageId: 'page-123',
        pageAccessToken: 'token-abc',
        platform: 'facebook',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.ALREADY_EXISTS);
        expect(result.error.message).toContain('already connected');
      }
    });
  });

  describe('success cases', () => {
    const mockIntegration = {
      id: 'integration-1',
      organizationId: 'org-123',
      defaultPageId: null,
    };

    const mockPage = {
      id: 'new-page-id',
      pageId: 'page-123',
      pageName: 'My Page',
      platform: 'facebook',
      isActive: true,
    };

    it('creates page with valid input', async () => {
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
        mockIntegration
      );
      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(null);
      mockDb.returning.mockResolvedValueOnce([mockPage]);

      const result = await addMetaAdsPage(mockDb as never, {
        organizationId: 'org-123',
        pageId: 'page-123',
        pageName: 'My Page',
        pageAccessToken: 'token-abc',
        platform: 'facebook',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe('new-page-id');
        expect(result.data.pageId).toBe('page-123');
      }
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('subscribes page to webhooks after creation', async () => {
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
        mockIntegration
      );
      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(null);
      mockDb.returning.mockResolvedValueOnce([mockPage]);

      await addMetaAdsPage(mockDb as never, {
        organizationId: 'org-123',
        pageId: 'page-123',
        pageAccessToken: 'token-abc',
        platform: 'facebook',
      });

      // No field list is passed: the subscription fields are DERIVED from the
      // webhook registry (subscribePageToWebhooks defaults to them), so a call
      // site cannot spell them differently from every other call site.
      expect(mockSubscribePageToWebhooks).toHaveBeenCalledWith(
        'page-123',
        'token-abc'
      );
    });

    it('succeeds even if webhook subscription fails', async () => {
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
        mockIntegration
      );
      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(null);
      mockDb.returning.mockResolvedValueOnce([mockPage]);
      mockSubscribePageToWebhooks.mockRejectedValueOnce(
        new Error('Subscription failed')
      );

      const result = await addMetaAdsPage(mockDb as never, {
        organizationId: 'org-123',
        pageId: 'page-123',
        pageAccessToken: 'token-abc',
        platform: 'facebook',
      });

      expect(result.success).toBe(true);
    });

    it('sets as default when first page (no defaultPageId)', async () => {
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
        mockIntegration
      );
      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(null);
      mockDb.returning.mockResolvedValueOnce([mockPage]);

      await addMetaAdsPage(mockDb as never, {
        organizationId: 'org-123',
        pageId: 'page-123',
        pageAccessToken: 'token-abc',
        platform: 'facebook',
      });

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalled();
    });

    it('sets as default when setAsDefault is true', async () => {
      const integrationWithDefault = {
        ...mockIntegration,
        defaultPageId: 'existing-default',
      };
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
        integrationWithDefault
      );
      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(null);
      mockDb.returning.mockResolvedValueOnce([mockPage]);

      await addMetaAdsPage(mockDb as never, {
        organizationId: 'org-123',
        pageId: 'page-123',
        pageAccessToken: 'token-abc',
        platform: 'facebook',
        setAsDefault: true,
      });

      expect(mockDb.update).toHaveBeenCalled();
    });

    it('does not set as default when not requested and default exists', async () => {
      const integrationWithDefault = {
        ...mockIntegration,
        defaultPageId: 'existing-default',
      };
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
        integrationWithDefault
      );
      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(null);
      mockDb.returning.mockResolvedValueOnce([mockPage]);

      await addMetaAdsPage(mockDb as never, {
        organizationId: 'org-123',
        pageId: 'page-123',
        pageAccessToken: 'token-abc',
        platform: 'facebook',
        setAsDefault: false,
      });

      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('handles instagram platform', async () => {
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
        mockIntegration
      );
      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(null);
      mockDb.returning.mockResolvedValueOnce([
        { ...mockPage, platform: 'instagram' },
      ]);

      const result = await addMetaAdsPage(mockDb as never, {
        organizationId: 'org-123',
        pageId: 'page-123',
        pageAccessToken: 'token-abc',
        platform: 'instagram',
      });

      expect(result.success).toBe(true);
    });

    it('includes optional fields when provided', async () => {
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
        mockIntegration
      );
      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(null);
      mockDb.returning.mockResolvedValueOnce([
        { ...mockPage, pixelId: 'pixel-123', pixelName: 'My Pixel' },
      ]);

      const result = await addMetaAdsPage(mockDb as never, {
        organizationId: 'org-123',
        pageId: 'page-123',
        pageName: 'My Page',
        pageAccessToken: 'token-abc',
        platform: 'facebook',
        pixelId: 'pixel-123',
        pixelName: 'My Pixel',
      });

      expect(result.success).toBe(true);
      expect(mockDb.values).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('returns INTERNAL_ERROR on database failure', async () => {
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
        id: 'integration-1',
        organizationId: 'org-123',
        defaultPageId: null,
      });
      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(null);
      mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

      const result = await addMetaAdsPage(mockDb as never, {
        organizationId: 'org-123',
        pageId: 'page-123',
        pageAccessToken: 'token-abc',
        platform: 'facebook',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      }
    });
  });
});
