import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import {
  type UpdateOrganizationAuthApi,
  updateOrganization,
} from './update-organization.service.js';

describe('updateOrganization', () => {
  let mockAuthApi: UpdateOrganizationAuthApi;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthApi = {
      updateOrganization: vi.fn(),
    };
  });

  const validInput = {
    sessionToken: 'valid-session-token',
    name: 'Updated Org Name',
  };

  it('should update organization successfully', async () => {
    const mockOrg = {
      id: 'org_123',
      name: 'Updated Org Name',
      slug: 'org-slug',
      logo: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      metadata: null,
    };

    vi.mocked(mockAuthApi.updateOrganization).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockOrg),
    } as Response);

    const result = await updateOrganization(mockAuthApi, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.organization.name).toBe('Updated Org Name');
    }
  });

  it('should update organization with logo', async () => {
    const inputWithLogo = {
      ...validInput,
      logo: 'https://example.com/new-logo.png',
    };

    const mockOrg = {
      id: 'org_123',
      name: 'Updated Org Name',
      slug: 'org-slug',
      logo: 'https://example.com/new-logo.png',
      createdAt: '2024-01-01T00:00:00.000Z',
      metadata: null,
    };

    vi.mocked(mockAuthApi.updateOrganization).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockOrg),
    } as Response);

    const result = await updateOrganization(mockAuthApi, inputWithLogo);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.organization.logo).toBe(
        'https://example.com/new-logo.png'
      );
    }
  });

  it('should return UNAUTHORIZED on 401 response', async () => {
    vi.mocked(mockAuthApi.updateOrganization).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: 'Unauthorized' }),
    } as Response);

    const result = await updateOrganization(mockAuthApi, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.UNAUTHORIZED);
    }
  });

  it('should return FORBIDDEN on 403 response', async () => {
    vi.mocked(mockAuthApi.updateOrganization).mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ message: 'Forbidden' }),
    } as Response);

    const result = await updateOrganization(mockAuthApi, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.FORBIDDEN);
    }
  });

  it('should return NOT_FOUND on 404 response', async () => {
    vi.mocked(mockAuthApi.updateOrganization).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ message: 'Not found' }),
    } as Response);

    const result = await updateOrganization(mockAuthApi, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('should return VALIDATION_ERROR for missing sessionToken', async () => {
    const invalidInput = {
      name: 'Updated Name',
    };

    const result = await updateOrganization(mockAuthApi, invalidInput as never);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('should handle network errors gracefully', async () => {
    vi.mocked(mockAuthApi.updateOrganization).mockRejectedValueOnce(
      new Error('Network error')
    );

    const result = await updateOrganization(mockAuthApi, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
