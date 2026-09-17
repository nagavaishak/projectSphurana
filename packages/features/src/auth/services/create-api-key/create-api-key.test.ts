import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import type { CreateApiKeyAuthApi } from './create-api-key.service.js';
import { createApiKey } from './create-api-key.service.js';

describe('createApiKey', () => {
  let mockAuthApi: CreateApiKeyAuthApi;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthApi = {
      createApiKey: vi.fn(),
    } as unknown as CreateApiKeyAuthApi;
  });

  const validInput = {
    userId: 'user-123',
    organizationId: 'org-456',
    organizationName: 'My Organization',
    organizationSlug: 'my-org',
    name: 'Production API Key',
    expiresInDays: 365,
  };

  it('should create API key successfully', async () => {
    const mockResult = {
      id: 'key-789',
      key: 'org_my-org_abc123xyz789',
      name: 'Production API Key',
      expiresAt: new Date('2026-01-01'),
      prefix: 'org_my-org_',
    };

    vi.mocked(mockAuthApi.createApiKey).mockResolvedValueOnce(
      mockResult as Awaited<ReturnType<typeof mockAuthApi.createApiKey>>
    );

    const result = await createApiKey(mockAuthApi, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('key-789');
      expect(result.data.key).toBe('org_my-org_abc123xyz789');
      expect(result.data.name).toBe('Production API Key');
      expect(result.data.prefix).toBe('org_my-org_');
    }
    expect(mockAuthApi.createApiKey).toHaveBeenCalledWith({
      body: expect.objectContaining({
        name: 'Production API Key',
        userId: 'user-123',
        prefix: 'org_my-org_',
        metadata: expect.objectContaining({
          organizationId: 'org-456',
          organizationName: 'My Organization',
          organizationSlug: 'my-org',
        }),
      }),
    });
  });

  it('should use default name when not provided', async () => {
    const inputWithoutName = {
      ...validInput,
      name: undefined,
    };

    const mockResult = {
      id: 'key-789',
      key: 'org_my-org_abc123',
      name: 'my-org-api-key',
      expiresAt: new Date(),
      prefix: 'org_my-org_',
    };

    vi.mocked(mockAuthApi.createApiKey).mockResolvedValueOnce(
      mockResult as Awaited<ReturnType<typeof mockAuthApi.createApiKey>>
    );

    await createApiKey(mockAuthApi, inputWithoutName);

    expect(mockAuthApi.createApiKey).toHaveBeenCalledWith({
      body: expect.objectContaining({
        name: 'my-org-api-key',
      }),
    });
  });

  it('should return VALIDATION_ERROR for missing userId', async () => {
    const result = await createApiKey(mockAuthApi, {
      ...validInput,
      userId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockAuthApi.createApiKey).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const result = await createApiKey(mockAuthApi, {
      ...validInput,
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockAuthApi.createApiKey).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationName', async () => {
    const result = await createApiKey(mockAuthApi, {
      ...validInput,
      organizationName: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('should return VALIDATION_ERROR for missing organizationSlug', async () => {
    const result = await createApiKey(mockAuthApi, {
      ...validInput,
      organizationSlug: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('should return UNAUTHORIZED when not authorized', async () => {
    vi.mocked(mockAuthApi.createApiKey).mockRejectedValueOnce(
      new Error('Unauthorized to create API key')
    );

    const result = await createApiKey(mockAuthApi, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.UNAUTHORIZED);
    }
  });

  it('should return INTERNAL_ERROR on unexpected error', async () => {
    vi.mocked(mockAuthApi.createApiKey).mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    const result = await createApiKey(mockAuthApi, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('should convert expiresInDays to milliseconds', async () => {
    const mockResult = {
      id: 'key-789',
      key: 'org_my-org_abc123',
      name: 'Test Key',
      expiresAt: new Date(),
      prefix: 'org_my-org_',
    };

    vi.mocked(mockAuthApi.createApiKey).mockResolvedValueOnce(
      mockResult as Awaited<ReturnType<typeof mockAuthApi.createApiKey>>
    );

    await createApiKey(mockAuthApi, { ...validInput, expiresInDays: 30 });

    expect(mockAuthApi.createApiKey).toHaveBeenCalledWith({
      body: expect.objectContaining({
        expiresIn: 30 * 24 * 60 * 60 * 1000, // 30 days in ms
      }),
    });
  });
});
