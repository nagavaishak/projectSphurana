import { describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { removeMetaAdsPage } from './remove-meta-ads-page.service.js';

// Helper to create a fresh mock db for each test
function createMockDb(options?: {
  integration?: Record<string, unknown> | null;
  page?: Record<string, unknown> | null;
  remainingPage?: Record<string, unknown> | null;
  deleteError?: Error;
}) {
  const mockDeleteWhere = options?.deleteError
    ? vi.fn().mockRejectedValue(options.deleteError)
    : vi.fn().mockResolvedValue({ rowCount: 1 });

  const mockUpdateWhere = vi.fn().mockResolvedValue({ rowCount: 1 });

  // For findFirst on metaAdsPage, we need to handle multiple calls
  const pageFinds = [options?.page, options?.remainingPage].filter(
    (v) => v !== undefined
  );
  const pageFindFirst = vi.fn();
  for (const val of pageFinds) {
    pageFindFirst.mockResolvedValueOnce(val);
  }
  // Default to null if no more values
  pageFindFirst.mockResolvedValue(null);

  return {
    db: {
      query: {
        metaAdsIntegration: {
          findFirst: vi.fn().mockResolvedValue(options?.integration ?? null),
        },
        metaAdsPage: {
          findFirst: pageFindFirst,
        },
      },
      delete: vi.fn(() => ({
        where: mockDeleteWhere,
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: mockUpdateWhere,
        })),
      })),
    },
    mockDeleteWhere,
    mockUpdateWhere,
  };
}

describe('removeMetaAdsPage', () => {
  describe('validation', () => {
    it('returns VALIDATION_ERROR for missing organizationId', async () => {
      const { db } = createMockDb();
      const result = await removeMetaAdsPage(db as never, {
        organizationId: '',
        pageId: 'page-123',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });

    it('returns VALIDATION_ERROR for missing pageId', async () => {
      const { db } = createMockDb();
      const result = await removeMetaAdsPage(db as never, {
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
      const { db } = createMockDb({ integration: null });

      const result = await removeMetaAdsPage(db as never, {
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
      const { db } = createMockDb({
        integration: {
          id: 'integration-1',
          organizationId: 'org-123',
          defaultPageId: null,
        },
        page: null,
      });

      const result = await removeMetaAdsPage(db as never, {
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

    it('removes page successfully', async () => {
      const { db, mockDeleteWhere } = createMockDb({
        integration: mockIntegration,
        page: mockPage,
      });

      const result = await removeMetaAdsPage(db as never, {
        organizationId: 'org-123',
        pageId: 'page-123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.success).toBe(true);
      }
      expect(db.delete).toHaveBeenCalled();
      expect(mockDeleteWhere).toHaveBeenCalled();
    });

    it('sets new default when removed page was default', async () => {
      const integrationWithDefault = {
        ...mockIntegration,
        defaultPageId: 'page-123',
      };

      const remainingPage = {
        id: 'page-456',
        pageId: 'fb-page-456',
      };

      const { db, mockUpdateWhere } = createMockDb({
        integration: integrationWithDefault,
        page: mockPage,
        remainingPage,
      });

      const result = await removeMetaAdsPage(db as never, {
        organizationId: 'org-123',
        pageId: 'page-123',
      });

      expect(result.success).toBe(true);
      expect(db.update).toHaveBeenCalled();
      expect(mockUpdateWhere).toHaveBeenCalled();
    });

    it('clears default when no remaining pages', async () => {
      const integrationWithDefault = {
        ...mockIntegration,
        defaultPageId: 'page-123',
      };

      const { db, mockUpdateWhere } = createMockDb({
        integration: integrationWithDefault,
        page: mockPage,
        remainingPage: null, // No remaining pages
      });

      const result = await removeMetaAdsPage(db as never, {
        organizationId: 'org-123',
        pageId: 'page-123',
      });

      expect(result.success).toBe(true);
      expect(db.update).toHaveBeenCalled();
      expect(mockUpdateWhere).toHaveBeenCalled();
    });

    it('does not update default when removed page was not default', async () => {
      const integrationWithOtherDefault = {
        ...mockIntegration,
        defaultPageId: 'other-page',
      };

      const { db } = createMockDb({
        integration: integrationWithOtherDefault,
        page: mockPage,
      });

      const result = await removeMetaAdsPage(db as never, {
        organizationId: 'org-123',
        pageId: 'page-123',
      });

      expect(result.success).toBe(true);
      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('returns INTERNAL_ERROR on database failure', async () => {
      const { db } = createMockDb({
        integration: {
          id: 'integration-1',
          organizationId: 'org-123',
          defaultPageId: null,
        },
        page: {
          id: 'page-123',
          pageId: 'fb-page-123',
        },
        deleteError: new Error('DB failed'),
      });

      const result = await removeMetaAdsPage(db as never, {
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
