import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import type { VerifyApiKeyAuthApi } from './verify-api-key.service.js';
import { verifyApiKey } from './verify-api-key.service.js';

describe('verifyApiKey', () => {
  let mockAuthApi: VerifyApiKeyAuthApi;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthApi = {
      verifyApiKey: vi.fn(),
    } as unknown as VerifyApiKeyAuthApi;
  });

  it('should verify valid API key successfully', async () => {
    const input = {
      key: 'org_my-org_abc123xyz789',
    };

    const mockKey = {
      id: 'key-123',
      name: 'Production Key',
      userId: 'user-456',
      metadata: {
        organizationId: 'org-789',
        organizationName: 'My Org',
        organizationSlug: 'my-org',
      },
      expiresAt: new Date('2026-01-01'),
      enabled: true,
    };

    const mockResponse = {
      json: vi.fn().mockResolvedValue({
        valid: true,
        key: mockKey,
      }),
    };

    vi.mocked(mockAuthApi.verifyApiKey).mockResolvedValueOnce(
      mockResponse as Awaited<ReturnType<typeof mockAuthApi.verifyApiKey>>
    );

    const result = await verifyApiKey(mockAuthApi, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.valid).toBe(true);
      expect(result.data.key.id).toBe('key-123');
      expect(result.data.key.userId).toBe('user-456');
      expect(result.data.key.metadata?.organizationId).toBe('org-789');
      expect(result.data.key.enabled).toBe(true);
    }
    expect(mockAuthApi.verifyApiKey).toHaveBeenCalledWith({
      body: { key: input.key },
      asResponse: true,
    });
  });

  it('should return UNAUTHORIZED for invalid API key', async () => {
    const input = {
      key: 'invalid-key',
    };

    const mockResponse = {
      json: vi.fn().mockResolvedValue({
        valid: false,
        error: { message: 'Invalid API key', code: 'INVALID_KEY' },
        key: null,
      }),
    };

    vi.mocked(mockAuthApi.verifyApiKey).mockResolvedValueOnce(
      mockResponse as Awaited<ReturnType<typeof mockAuthApi.verifyApiKey>>
    );

    const result = await verifyApiKey(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.UNAUTHORIZED);
      expect(result.error.message).toBe('Invalid API key');
    }
  });

  it('should return RATE_LIMITED when rate limit exceeded', async () => {
    const input = {
      key: 'org_my-org_abc123',
    };

    const mockResponse = {
      json: vi.fn().mockResolvedValue({
        valid: false,
        error: { message: 'Rate limit exceeded', code: 'RATE_LIMITED' },
        key: null,
      }),
    };

    vi.mocked(mockAuthApi.verifyApiKey).mockResolvedValueOnce(
      mockResponse as Awaited<ReturnType<typeof mockAuthApi.verifyApiKey>>
    );

    const result = await verifyApiKey(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.RATE_LIMITED);
    }
  });

  it('should return UNAUTHORIZED when key is null', async () => {
    const input = {
      key: 'org_my-org_abc123',
    };

    const mockResponse = {
      json: vi.fn().mockResolvedValue({
        valid: true,
        key: null,
      }),
    };

    vi.mocked(mockAuthApi.verifyApiKey).mockResolvedValueOnce(
      mockResponse as Awaited<ReturnType<typeof mockAuthApi.verifyApiKey>>
    );

    const result = await verifyApiKey(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.UNAUTHORIZED);
    }
  });

  it('should return VALIDATION_ERROR for empty key', async () => {
    const result = await verifyApiKey(mockAuthApi, { key: '' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockAuthApi.verifyApiKey).not.toHaveBeenCalled();
  });

  it('should return INTERNAL_ERROR on unexpected error', async () => {
    const input = {
      key: 'org_my-org_abc123',
    };

    vi.mocked(mockAuthApi.verifyApiKey).mockRejectedValueOnce(
      new Error('Network error')
    );

    const result = await verifyApiKey(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('should handle key with null metadata', async () => {
    const input = {
      key: 'org_my-org_abc123',
    };

    const mockResponse = {
      json: vi.fn().mockResolvedValue({
        valid: true,
        key: {
          id: 'key-123',
          name: null,
          userId: 'user-456',
          metadata: null,
          expiresAt: null,
          enabled: true,
        },
      }),
    };

    vi.mocked(mockAuthApi.verifyApiKey).mockResolvedValueOnce(
      mockResponse as Awaited<ReturnType<typeof mockAuthApi.verifyApiKey>>
    );

    const result = await verifyApiKey(mockAuthApi, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.key.metadata).toBeNull();
      expect(result.data.key.name).toBeNull();
      expect(result.data.key.expiresAt).toBeNull();
    }
  });
});
