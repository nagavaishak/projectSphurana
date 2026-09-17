import {
  InstagramOAuthService,
  decryptCredentials,
  encryptCredentials,
  isMetaAuthError,
} from '@borradh-workspace/integrations';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import * as markNeedsReconnect from '../mark-needs-reconnect/mark-needs-reconnect.service.js';

const mocks = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockUpdate: vi.fn().mockReturnThis(),
  mockSet: vi.fn().mockReturnThis(),
  mockWhere: vi.fn().mockResolvedValue(undefined),
}));

// `@borradh-workspace/integrations` is aliased to the canonical mock
// (vite.config.ts). NEVER `vi.mock` it — under `isolate: false` the factory
// persists on the shared worker graph and poisons later files. The canonical
// mock exports `isMetaAuthError` as a `vi.fn` whose default is the REAL
// classifier, so we drive it with `vi.mocked()`; the auth-error test forces
// `true` with a one-shot override (real returns false for a plain Error).
const mockIsMetaAuthError = vi.mocked(isMetaAuthError);

// Stub the reconnect writer via a file-local `vi.spyOn` (restored in afterEach)
// so it never leaks into other test files under `isolate: false`.
let markReconnectSpy: ReturnType<typeof vi.spyOn>;

import { refreshInstagramTokens } from './refresh-instagram-tokens.service.js';

const instagramOAuthService = new InstagramOAuthService() as {
  refreshLongLivedToken: ReturnType<typeof vi.fn>;
};
const mockDecryptCredentials = vi.mocked(decryptCredentials);
const mockEncryptCredentials = vi.mocked(encryptCredentials);
const mockRefreshLongLivedToken = vi.mocked(
  instagramOAuthService.refreshLongLivedToken
);

const mockDb = {
  query: {
    instagramIntegration: {
      findMany: mocks.mockFindMany,
    },
  },
  update: mocks.mockUpdate,
} as never;

// Wire up chain
mocks.mockUpdate.mockReturnValue({ set: mocks.mockSet });
mocks.mockSet.mockReturnValue({ where: mocks.mockWhere });

describe('refreshInstagramTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markReconnectSpy = vi
      .spyOn(markNeedsReconnect, 'markInstagramNeedsReconnect')
      .mockResolvedValue(undefined);
    mocks.mockUpdate.mockReturnValue({ set: mocks.mockSet });
    mocks.mockSet.mockReturnValue({ where: mocks.mockWhere });
    // No persistent override: the canonical `isMetaAuthError` defaults to the
    // REAL classifier (returns false for a plain Error), and setting a
    // persistent `mockReturnValue` here would leak onto the shared canonical
    // mock. The auth-error test uses a one-shot `mockReturnValueOnce(true)`.
  });

  afterEach(() => {
    markReconnectSpy.mockRestore();
  });

  const futureDate = (daysFromNow: number) =>
    new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);

  const pastDate = (daysAgo: number) =>
    new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

  it('should refresh tokens expiring within threshold', async () => {
    const integration = {
      id: 'ig_1',
      organizationId: 'org_1',
      isActive: true,
      encryptedCredentials: 'encrypted_data',
      instagramUserId: 'ig_user_1',
      tokenExpiresAt: futureDate(3),
    };

    mocks.mockFindMany.mockResolvedValueOnce([integration]);
    mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'old_token',
    });
    mockRefreshLongLivedToken.mockResolvedValueOnce({
      accessToken: 'new_token',
      expiresIn: 5184000,
    });
    mockEncryptCredentials.mockReturnValueOnce('new_encrypted_data');

    const result = await refreshInstagramTokens(mockDb, {
      daysBeforeExpiry: 7,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.refreshed).toBe(1);
      expect(result.data.failed).toBe(0);
      expect(result.data.skipped).toBe(0);
    }
  });

  it('should skip already-expired tokens', async () => {
    const integration = {
      id: 'ig_1',
      organizationId: 'org_1',
      isActive: true,
      encryptedCredentials: 'encrypted_data',
      tokenExpiresAt: pastDate(1),
    };

    mocks.mockFindMany.mockResolvedValueOnce([integration]);

    const result = await refreshInstagramTokens(mockDb, {
      daysBeforeExpiry: 7,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.refreshed).toBe(0);
      expect(result.data.skipped).toBe(1);
    }
    expect(mockRefreshLongLivedToken).not.toHaveBeenCalled();
  });

  it('should handle refresh failures gracefully', async () => {
    const integration = {
      id: 'ig_1',
      organizationId: 'org_1',
      isActive: true,
      encryptedCredentials: 'encrypted_data',
      tokenExpiresAt: futureDate(3),
    };

    mocks.mockFindMany.mockResolvedValueOnce([integration]);
    mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'old_token',
    });
    mockRefreshLongLivedToken.mockRejectedValueOnce(new Error('Token expired'));

    const result = await refreshInstagramTokens(mockDb, {
      daysBeforeExpiry: 7,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.refreshed).toBe(0);
      expect(result.data.failed).toBe(1);
      expect(result.data.errors).toHaveLength(1);
    }
  });

  it('should mark needs_reconnect on auth errors', async () => {
    const integration = {
      id: 'ig_1',
      organizationId: 'org_1',
      isActive: true,
      encryptedCredentials: 'encrypted_data',
      tokenExpiresAt: futureDate(3),
    };

    mocks.mockFindMany.mockResolvedValueOnce([integration]);
    mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'old_token',
    });
    mockRefreshLongLivedToken.mockRejectedValueOnce(new Error('Auth error'));
    mockIsMetaAuthError.mockReturnValueOnce(true);
    markReconnectSpy.mockResolvedValueOnce(undefined);

    await refreshInstagramTokens(mockDb, { daysBeforeExpiry: 7 });

    expect(markReconnectSpy).toHaveBeenCalledWith(mockDb, 'org_1');
  });

  it('should return ok with zeros when no integrations need refresh', async () => {
    mocks.mockFindMany.mockResolvedValueOnce([]);

    const result = await refreshInstagramTokens(mockDb, {
      daysBeforeExpiry: 7,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.refreshed).toBe(0);
      expect(result.data.failed).toBe(0);
      expect(result.data.skipped).toBe(0);
    }
  });

  it('should return VALIDATION_ERROR for invalid input', async () => {
    await expectResult(
      refreshInstagramTokens(mockDb, { daysBeforeExpiry: -1 } as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
