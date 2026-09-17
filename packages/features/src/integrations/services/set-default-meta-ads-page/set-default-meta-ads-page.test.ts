import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { setDefaultMetaAdsPage } from './set-default-meta-ads-page.service.js';

const mockDb = {
  query: {
    metaAdsIntegration: {
      findFirst: vi.fn(),
    },
    metaAdsPage: {
      findFirst: vi.fn(),
    },
  },
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  returning: vi.fn(),
};

describe('setDefaultMetaAdsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validation', () => {
    it('returns VALIDATION_ERROR for missing organizationId', async () => {
      const result = await setDefaultMetaAdsPage(mockDb as never, {
        organizationId: '',
        pageId: 'page-123',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });

    it('returns VALIDATION_ERROR for missing pageId', async () => {
      const result = await setDefaultMetaAdsPage(mockDb as never, {
        organizationId: 'org-123',
        pageId: '',
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

      const result = await setDefaultMetaAdsPage(mockDb as never, {
        organizationId: 'org-123',
        pageId: 'page-123',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(result.error.message).toContain('integration not found');
      }
    });
  });

  describe('page lookup', () => {
    it('returns NOT_FOUND when page does not exist', async () => {
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
        id: 'integration-1',
        organizationId: 'org-123',
        defaultPageId: null,
      });
      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(null);

      const result = await setDefaultMetaAdsPage(mockDb as never, {
        organizationId: 'org-123',
        pageId: 'page-123',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(result.error.message).toContain('Page not found');
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
      id: 'page-123',
      pageId: 'fb-page-123',
      metaAdsIntegrationId: 'integration-1',
    };

    it('sets default page successfully', async () => {
      const updatedIntegration = {
        ...mockIntegration,
        defaultPageId: 'page-123',
      };

      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
        mockIntegration
      );
      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(mockPage);
      mockDb.returning.mockResolvedValueOnce([updatedIntegration]);

      const result = await setDefaultMetaAdsPage(mockDb as never, {
        organizationId: 'org-123',
        pageId: 'page-123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.defaultPageId).toBe('page-123');
      }
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalled();
    });

    it('updates from existing default to new default', async () => {
      const integrationWithDefault = {
        ...mockIntegration,
        defaultPageId: 'old-page',
      };

      const updatedIntegration = {
        ...integrationWithDefault,
        defaultPageId: 'page-123',
      };

      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
        integrationWithDefault
      );
      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(mockPage);
      mockDb.returning.mockResolvedValueOnce([updatedIntegration]);

      const result = await setDefaultMetaAdsPage(mockDb as never, {
        organizationId: 'org-123',
        pageId: 'page-123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.defaultPageId).toBe('page-123');
      }
    });

    it('handles setting same page as default (idempotent)', async () => {
      const integrationAlreadyDefault = {
        ...mockIntegration,
        defaultPageId: 'page-123',
      };

      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
        integrationAlreadyDefault
      );
      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(mockPage);
      mockDb.returning.mockResolvedValueOnce([integrationAlreadyDefault]);

      const result = await setDefaultMetaAdsPage(mockDb as never, {
        organizationId: 'org-123',
        pageId: 'page-123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.defaultPageId).toBe('page-123');
      }
    });
  });

  describe('error handling', () => {
    it('returns INTERNAL_ERROR on database failure', async () => {
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
        id: 'integration-1',
        organizationId: 'org-123',
        defaultPageId: null,
      });
      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
        id: 'page-123',
        pageId: 'fb-page-123',
      });
      mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

      const result = await setDefaultMetaAdsPage(mockDb as never, {
        organizationId: 'org-123',
        pageId: 'page-123',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      }
    });
  });
});
