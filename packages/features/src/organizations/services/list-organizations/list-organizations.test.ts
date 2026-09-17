import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import {
  type ListOrganizationsAuthApi,
  listOrganizations,
} from './list-organizations.service.js';

describe('listOrganizations', () => {
  let mockAuthApi: ListOrganizationsAuthApi;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthApi = {
      listOrganizations: vi.fn(),
    };
  });

  const validInput = {
    sessionToken: 'valid-session-token',
  };

  it('should return organizations list on success', async () => {
    const mockOrgs = [
      {
        id: 'org_1',
        name: 'Org 1',
        slug: 'org-1',
        logo: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        metadata: null,
      },
      {
        id: 'org_2',
        name: 'Org 2',
        slug: 'org-2',
        logo: 'https://example.com/logo.png',
        createdAt: '2024-01-02T00:00:00.000Z',
        metadata: { key: 'value' },
      },
    ];

    vi.mocked(mockAuthApi.listOrganizations).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockOrgs),
    } as Response);

    const result = await listOrganizations(mockAuthApi, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.organizations).toHaveLength(2);
      expect(result.data.organizations[0].name).toBe('Org 1');
      expect(result.data.organizations[1].logo).toBe(
        'https://example.com/logo.png'
      );
    }
  });

  it('should return empty array when no organizations', async () => {
    vi.mocked(mockAuthApi.listOrganizations).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    } as Response);

    const result = await listOrganizations(mockAuthApi, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.organizations).toHaveLength(0);
    }
  });

  it('should return UNAUTHORIZED on 401 response', async () => {
    vi.mocked(mockAuthApi.listOrganizations).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: 'Unauthorized' }),
    } as Response);

    const result = await listOrganizations(mockAuthApi, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.UNAUTHORIZED);
    }
  });

  it('should return INTERNAL_ERROR on other error responses', async () => {
    vi.mocked(mockAuthApi.listOrganizations).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ message: 'Server error' }),
    } as Response);

    const result = await listOrganizations(mockAuthApi, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('should return VALIDATION_ERROR for missing sessionToken', async () => {
    const invalidInput = {};

    const result = await listOrganizations(mockAuthApi, invalidInput as never);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('should return VALIDATION_ERROR for empty sessionToken', async () => {
    const invalidInput = { sessionToken: '' };

    const result = await listOrganizations(mockAuthApi, invalidInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('should handle network errors gracefully', async () => {
    vi.mocked(mockAuthApi.listOrganizations).mockRejectedValueOnce(
      new Error('Network error')
    );

    const result = await listOrganizations(mockAuthApi, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
