import {
  decryptCredentials,
  encryptCredentials,
} from '@borradh-workspace/integrations';
import { mockMetaOAuthService } from '@borradh-workspace/integrations/meta-ads';
import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { refreshMetaTokens } from './refresh-meta-tokens.service.js';

const mocks = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockUpdate: vi.fn().mockReturnThis(),
  mockSet: vi.fn().mockReturnThis(),
  mockWhere: vi.fn().mockResolvedValue(undefined),
}));

const mockDecryptCredentials = vi.mocked(decryptCredentials);
const mockEncryptCredentials = vi.mocked(encryptCredentials);
const mockRefreshLongLivedToken = vi.mocked(
  mockMetaOAuthService.refreshLongLivedToken
);

const mockDb = {
  query: {
    metaAdsIntegration: {
      findMany: mocks.mockFindMany,
    },
  },
  update: mocks.mockUpdate,
} as never;

// Wire up chain: update().set().where()
mocks.mockUpdate.mockReturnValue({ set: mocks.mockSet });
mocks.mockSet.mockReturnValue({ where: mocks.mockWhere });

describe('refreshMetaTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockUpdate.mockReturnValue({ set: mocks.mockSet });
    mocks.mockSet.mockReturnValue({ where: mocks.mockWhere });
  });

  const futureDate = (daysFromNow: number) =>
    new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);

  const pastDate = (daysAgo: number) =>
    new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

  it('should refresh tokens expiring within the threshold', async () => {
    const integration = {
      id: 'int_1',
      organizationId: 'org_1',
      isActive: true,
      configurationStatus: 'configured',
      encryptedCredentials: 'encrypted_data',
      tokenExpiresAt: futureDate(3), // expires in 3 days
    };

    mocks.mockFindMany.mockResolvedValueOnce([integration]);
    mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'old_token',
    });
    mockRefreshLongLivedToken.mockResolvedValueOnce({
      accessToken: 'new_token',
      tokenType: 'bearer',
      expiresIn: 5184000, // 60 days
    });
    mockEncryptCredentials.mockReturnValueOnce('new_encrypted_data');

    const result = await refreshMetaTokens(mockDb, { daysBeforeExpiry: 7 });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.refreshed).toBe(1);
      expect(result.data.failed).toBe(0);
      expect(result.data.skipped).toBe(0);
    }
    expect(mockDecryptCredentials).toHaveBeenCalledWith('encrypted_data');
    expect(mockRefreshLongLivedToken).toHaveBeenCalledWith('old_token');
    expect(mockEncryptCredentials).toHaveBeenCalledWith({
      accessToken: 'new_token',
      tokenType: 'bearer',
      expiresIn: 5184000,
    });
    expect(mocks.mockUpdate).toHaveBeenCalled();
  });

  it('should skip already-expired tokens', async () => {
    const integration = {
      id: 'int_1',
      organizationId: 'org_1',
      isActive: true,
      configurationStatus: 'configured',
      encryptedCredentials: 'encrypted_data',
      tokenExpiresAt: pastDate(1), // expired 1 day ago
    };

    mocks.mockFindMany.mockResolvedValueOnce([integration]);

    const result = await refreshMetaTokens(mockDb, { daysBeforeExpiry: 7 });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.refreshed).toBe(0);
      expect(result.data.skipped).toBe(1);
    }
    expect(mockRefreshLongLivedToken).not.toHaveBeenCalled();
  });

  it('should never refresh FLfB system-user tokens (tokenExpiresAt null)', async () => {
    const integration = {
      id: 'int_flfb',
      organizationId: 'org_flfb',
      isActive: true,
      configurationStatus: 'configured',
      encryptedCredentials: 'encrypted_data',
      tokenExpiresAt: null, // FLfB system-user token — non-expiring
    };

    // Even if the query ever returns an FLfB row, the per-row guard must skip it
    mocks.mockFindMany.mockResolvedValueOnce([integration]);

    const result = await refreshMetaTokens(mockDb, { daysBeforeExpiry: 7 });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.refreshed).toBe(0);
      expect(result.data.skipped).toBe(1);
    }
    expect(mockDecryptCredentials).not.toHaveBeenCalled();
    expect(mockRefreshLongLivedToken).not.toHaveBeenCalled();
    expect(mocks.mockUpdate).not.toHaveBeenCalled();
  });

  it('should handle refresh failures gracefully', async () => {
    const integration = {
      id: 'int_1',
      organizationId: 'org_1',
      isActive: true,
      configurationStatus: 'configured',
      encryptedCredentials: 'encrypted_data',
      tokenExpiresAt: futureDate(3),
    };

    mocks.mockFindMany.mockResolvedValueOnce([integration]);
    mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'old_token',
    });
    mockRefreshLongLivedToken.mockRejectedValueOnce(
      new Error('Token expired or invalid')
    );

    const result = await refreshMetaTokens(mockDb, { daysBeforeExpiry: 7 });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.refreshed).toBe(0);
      expect(result.data.failed).toBe(1);
      expect(result.data.errors).toHaveLength(1);
      expect(result.data.errors[0].organizationId).toBe('org_1');
      expect(result.data.errors[0].message).toContain('Token expired');
    }
  });

  it('should return ok with zeros when no integrations need refresh', async () => {
    mocks.mockFindMany.mockResolvedValueOnce([]);

    const result = await refreshMetaTokens(mockDb, { daysBeforeExpiry: 7 });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.refreshed).toBe(0);
      expect(result.data.failed).toBe(0);
      expect(result.data.skipped).toBe(0);
    }
  });

  it('should return VALIDATION_ERROR for invalid input', async () => {
    const result = await refreshMetaTokens(mockDb, {
      daysBeforeExpiry: -1,
    } as never);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
