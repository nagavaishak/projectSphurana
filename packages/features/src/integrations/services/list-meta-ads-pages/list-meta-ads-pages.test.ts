import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { listMetaAdsPages } from './list-meta-ads-pages.service.js';

const mockDb = {
  query: {
    metaAdsIntegration: {
      findFirst: vi.fn(),
    },
    instagramIntegration: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn(),
};

describe('listMetaAdsPages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish chainable mocks after clearAllMocks resets return values
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
  });

  describe('validation', () => {
    it('returns VALIDATION_ERROR for missing organizationId', async () => {
      const result = await listMetaAdsPages(mockDb as never, {
        organizationId: '',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });
  });

  describe('no integration', () => {
    it('returns empty array when no integration exists', async () => {
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);

      const result = await listMetaAdsPages(mockDb as never, {
        organizationId: 'org-123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([]);
      }
    });
  });

  describe('success cases', () => {
    const mockIntegration = {
      id: 'integration-1',
      organizationId: 'org-123',
      defaultPageId: 'page-1',
    };

    it('lists pages with isDefault flag', async () => {
      const mockPages = [
        {
          id: 'page-1',
          pageId: 'fb-page-1',
          pageName: 'Default Page',
          platform: 'facebook',
          pixelId: null,
          pixelName: null,
          defaultLeadFormId: null,
          defaultLeadFormName: null,
          isActive: true,
          createdAt: new Date(),
        },
        {
          id: 'page-2',
          pageId: 'fb-page-2',
          pageName: 'Other Page',
          platform: 'instagram',
          pixelId: 'pixel-1',
          pixelName: 'My Pixel',
          defaultLeadFormId: 'form-1',
          defaultLeadFormName: 'Contact Form',
          isActive: true,
          createdAt: new Date(),
        },
      ];

      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
        mockIntegration
      );
      mockDb.where.mockResolvedValueOnce(mockPages);

      const result = await listMetaAdsPages(mockDb as never, {
        organizationId: 'org-123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
        expect(result.data[0].isDefault).toBe(true);
        expect(result.data[1].isDefault).toBe(false);
      }
    });

    it('returns empty array when integration has no pages', async () => {
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
        mockIntegration
      );
      mockDb.where.mockResolvedValueOnce([]);

      const result = await listMetaAdsPages(mockDb as never, {
        organizationId: 'org-123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([]);
      }
    });

    it('handles integration with no default page', async () => {
      const integrationNoDefault = {
        ...mockIntegration,
        defaultPageId: null,
      };

      const mockPages = [
        {
          id: 'page-1',
          pageId: 'fb-page-1',
          pageName: 'Page',
          platform: 'facebook',
          pixelId: null,
          pixelName: null,
          defaultLeadFormId: null,
          defaultLeadFormName: null,
          isActive: true,
          createdAt: new Date(),
        },
      ];

      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
        integrationNoDefault
      );
      mockDb.where.mockResolvedValueOnce(mockPages);

      const result = await listMetaAdsPages(mockDb as never, {
        organizationId: 'org-123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data[0].isDefault).toBe(false);
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
      mockDb.where.mockRejectedValueOnce(new Error('DB failed'));

      const result = await listMetaAdsPages(mockDb as never, {
        organizationId: 'org-123',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      }
    });
  });
});
