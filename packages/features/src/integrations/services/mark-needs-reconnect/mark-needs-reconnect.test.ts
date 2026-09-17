import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';

const mockIsMetaAuthError = vi.fn();

type MarkNeedsReconnectModule = typeof import(
  './mark-needs-reconnect.service.js'
);
let handleMetaAuthError: MarkNeedsReconnectModule['handleMetaAuthError'];
let markInstagramNeedsReconnect: MarkNeedsReconnectModule['markInstagramNeedsReconnect'];
let markMetaAdsNeedsReconnect: MarkNeedsReconnectModule['markMetaAdsNeedsReconnect'];
let resetInstagramTokenStatus: MarkNeedsReconnectModule['resetInstagramTokenStatus'];
let resetMetaAdsTokenStatus: MarkNeedsReconnectModule['resetMetaAdsTokenStatus'];

describe('markNeedsReconnect', () => {
  const mockDb = createMockDatabase();

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockDb._resetMocks();

    // The service only imports `isMetaAuthError` from @borradh-workspace/integrations.
    // Provide a minimal mock — avoids the expensive `importOriginal()` that
    // re-evaluates the entire canonical mock tree on every beforeEach.
    vi.doMock('@borradh-workspace/integrations', () => ({
      isMetaAuthError: mockIsMetaAuthError,
    }));

    ({
      handleMetaAuthError,
      markInstagramNeedsReconnect,
      markMetaAdsNeedsReconnect,
      resetInstagramTokenStatus,
      resetMetaAdsTokenStatus,
    } = await import('./mark-needs-reconnect.service.js'));
  }, 30_000);

  afterEach(() => {
    vi.doUnmock('@borradh-workspace/integrations');
    vi.resetModules();
  });

  describe('markMetaAdsNeedsReconnect', () => {
    it('should mark integration as needs_reconnect', async () => {
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
        id: 'int_1',
        tokenStatus: 'valid',
      });
      mockDb.update.mockReturnThis();
      mockDb.set.mockReturnThis();
      mockDb.where.mockResolvedValueOnce(undefined);

      await markMetaAdsNeedsReconnect(mockDb as never, 'org_123');

      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should skip if already needs_reconnect', async () => {
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
        id: 'int_1',
        tokenStatus: 'needs_reconnect',
      });

      await markMetaAdsNeedsReconnect(mockDb as never, 'org_123');

      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('should skip if integration not found', async () => {
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);

      await markMetaAdsNeedsReconnect(mockDb as never, 'org_123');

      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('should not throw on database failure', async () => {
      mockDb.query.metaAdsIntegration.findFirst.mockRejectedValueOnce(
        new Error('DB error')
      );

      // Should not throw
      await markMetaAdsNeedsReconnect(mockDb as never, 'org_123');
    });
  });

  describe('markInstagramNeedsReconnect', () => {
    it('should mark integration as needs_reconnect', async () => {
      mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce({
        id: 'ig_1',
        tokenStatus: 'valid',
      });
      mockDb.update.mockReturnThis();
      mockDb.set.mockReturnThis();
      mockDb.where.mockResolvedValueOnce(undefined);

      await markInstagramNeedsReconnect(mockDb as never, 'org_123');

      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should skip if already needs_reconnect', async () => {
      mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce({
        id: 'ig_1',
        tokenStatus: 'needs_reconnect',
      });

      await markInstagramNeedsReconnect(mockDb as never, 'org_123');

      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  describe('handleMetaAuthError', () => {
    it('should mark meta_ads integration on auth error', async () => {
      mockIsMetaAuthError.mockReturnValueOnce(true);
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
        id: 'int_1',
        tokenStatus: 'valid',
      });
      mockDb.update.mockReturnThis();
      mockDb.set.mockReturnThis();
      mockDb.where.mockResolvedValueOnce(undefined);

      await handleMetaAuthError(mockDb as never, new Error('Auth failed'), {
        type: 'meta_ads',
        organizationId: 'org_123',
      });

      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should be a no-op for non-auth errors', async () => {
      mockIsMetaAuthError.mockReturnValueOnce(false);

      await handleMetaAuthError(mockDb as never, new Error('Not auth'), {
        type: 'meta_ads',
        organizationId: 'org_123',
      });

      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  describe('resetMetaAdsTokenStatus', () => {
    it('should reset token status to valid', async () => {
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
        id: 'integration_123',
        tokenStatus: 'needs_reconnect',
      });
      mockDb.update.mockReturnThis();
      mockDb.set.mockReturnThis();
      mockDb.where.mockResolvedValueOnce(undefined);

      await resetMetaAdsTokenStatus(mockDb as never, 'org_123');

      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should be a no-op when no integration exists', async () => {
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);

      await resetMetaAdsTokenStatus(mockDb as never, 'org_123');

      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  describe('resetInstagramTokenStatus', () => {
    it('should reset token status to valid', async () => {
      mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce({
        id: 'integration_123',
        tokenStatus: 'needs_reconnect',
      });
      mockDb.update.mockReturnThis();
      mockDb.set.mockReturnThis();
      mockDb.where.mockResolvedValueOnce(undefined);

      await resetInstagramTokenStatus(mockDb as never, 'org_123');

      expect(mockDb.update).toHaveBeenCalled();
    });
  });
});
