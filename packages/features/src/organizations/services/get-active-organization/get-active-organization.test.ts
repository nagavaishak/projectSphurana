import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import {
  type GetActiveOrganizationAuthApi,
  getActiveOrganization,
} from './get-active-organization.service.js';

describe('getActiveOrganization', () => {
  let mockAuthApi: GetActiveOrganizationAuthApi;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthApi = {
      getFullOrganization: vi.fn(),
    };
  });

  const validInput = {
    sessionToken: 'valid-session-token',
  };

  it('should return active organization when set', async () => {
    const mockOrg = {
      id: 'org_123',
      name: 'My Organization',
      slug: 'my-org',
      logo: 'https://example.com/logo.png',
      createdAt: '2024-01-01T00:00:00.000Z',
      metadata: { key: 'value' },
    };

    vi.mocked(mockAuthApi.getFullOrganization).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockOrg),
    } as Response);

    const result = await getActiveOrganization(mockAuthApi, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.organization?.id).toBe('org_123');
      expect(result.data.organization?.name).toBe('My Organization');
    }
  });

  it('should return null organization when no active org set', async () => {
    vi.mocked(mockAuthApi.getFullOrganization).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(null),
    } as Response);

    const result = await getActiveOrganization(mockAuthApi, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.organization).toBeNull();
    }
  });

  it('should return UNAUTHORIZED on 401 response', async () => {
    vi.mocked(mockAuthApi.getFullOrganization).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: 'Unauthorized' }),
    } as Response);

    const result = await getActiveOrganization(mockAuthApi, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.UNAUTHORIZED);
    }
  });

  it('should return INTERNAL_ERROR on other error responses', async () => {
    vi.mocked(mockAuthApi.getFullOrganization).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ message: 'Server error' }),
    } as Response);

    const result = await getActiveOrganization(mockAuthApi, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('should return VALIDATION_ERROR for missing sessionToken', async () => {
    const invalidInput = {};

    const result = await getActiveOrganization(
      mockAuthApi,
      invalidInput as never
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('should return VALIDATION_ERROR for empty sessionToken', async () => {
    const invalidInput = { sessionToken: '' };

    const result = await getActiveOrganization(mockAuthApi, invalidInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('should handle network errors gracefully', async () => {
    vi.mocked(mockAuthApi.getFullOrganization).mockRejectedValueOnce(
      new Error('Network error')
    );

    const result = await getActiveOrganization(mockAuthApi, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
