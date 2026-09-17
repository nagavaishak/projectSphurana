import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import {
  type SetActiveOrganizationAuthApi,
  setActiveOrganization,
} from './set-active-organization.service.js';

describe('setActiveOrganization', () => {
  let mockAuthApi: SetActiveOrganizationAuthApi;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthApi = {
      setActiveOrganization: vi.fn(),
    };
  });

  const validInput = {
    sessionToken: 'valid-session-token',
    organizationId: 'org_123',
  };

  it('should set active organization successfully', async () => {
    const mockOrg = {
      id: 'org_123',
      name: 'My Organization',
      slug: 'my-org',
      logo: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      metadata: null,
    };

    vi.mocked(mockAuthApi.setActiveOrganization).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockOrg),
    } as Response);

    const result = await setActiveOrganization(mockAuthApi, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.organization.id).toBe('org_123');
      expect(result.data.organization.name).toBe('My Organization');
    }
  });

  it('should return UNAUTHORIZED on 401 response', async () => {
    vi.mocked(mockAuthApi.setActiveOrganization).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: 'Unauthorized' }),
    } as Response);

    const result = await setActiveOrganization(mockAuthApi, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.UNAUTHORIZED);
    }
  });

  it('should return FORBIDDEN on 403 response', async () => {
    vi.mocked(mockAuthApi.setActiveOrganization).mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ message: 'Forbidden' }),
    } as Response);

    const result = await setActiveOrganization(mockAuthApi, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.FORBIDDEN);
    }
  });

  it('should return NOT_FOUND on 404 response', async () => {
    vi.mocked(mockAuthApi.setActiveOrganization).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ message: 'Organization not found' }),
    } as Response);

    const result = await setActiveOrganization(mockAuthApi, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('should return VALIDATION_ERROR for missing sessionToken', async () => {
    const invalidInput = {
      organizationId: 'org_123',
    };

    const result = await setActiveOrganization(
      mockAuthApi,
      invalidInput as never
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      sessionToken: 'valid-session-token',
    };

    const result = await setActiveOrganization(
      mockAuthApi,
      invalidInput as never
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('should handle network errors gracefully', async () => {
    vi.mocked(mockAuthApi.setActiveOrganization).mockRejectedValueOnce(
      new Error('Network error')
    );

    const result = await setActiveOrganization(mockAuthApi, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
