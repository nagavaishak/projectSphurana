import {
  CalendlyApiService,
  TimelyOAuthService,
  decryptCredentials,
} from '@borradh-workspace/integrations';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';

import { listExternalTeamMembers } from './list-external-team-members.service.js';

const calendlyApiService = new CalendlyApiService() as {
  getOrganizationMembers: ReturnType<typeof vi.fn>;
};
const timelyOAuthService = new TimelyOAuthService() as {
  getUsers: ReturnType<typeof vi.fn>;
};
const mocks = {
  mockDecryptCredentials: vi.mocked(decryptCredentials),
  mockGetOrganizationMembers: vi.mocked(
    calendlyApiService.getOrganizationMembers
  ),
  mockGetUsers: vi.mocked(timelyOAuthService.getUsers),
};

describe('listExternalTeamMembers', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    bookingAccountId: 'ba_123',
    organizationId: 'org_123',
  };

  it('should list Calendly team members', async () => {
    mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce({
      id: 'ba_123',
      organizationId: 'org_123',
      provider: 'calendly',
      isActive: true,
      encryptedCredentials: 'encrypted_data',
      config: { calendly: { organizationUri: 'https://calendly.com/org/123' } },
    });
    mocks.mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'token_123',
    });
    mocks.mockGetOrganizationMembers.mockResolvedValueOnce([
      {
        userUri: 'user_1',
        name: 'Jane Doe',
        email: 'jane@example.com',
        avatarUrl: null,
        schedulingUrl: 'https://calendly.com/jane',
      },
    ]);

    const result = await listExternalTeamMembers(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('Jane Doe');
      expect(result.data[0].externalId).toBe('user_1');
    }
  });

  it('should list Timely team members', async () => {
    mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce({
      id: 'ba_123',
      organizationId: 'org_123',
      provider: 'timely',
      isActive: true,
      encryptedCredentials: 'encrypted_data',
      config: { timely: { accountId: '456' } },
    });
    mocks.mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'token_123',
    });
    mocks.mockGetUsers.mockResolvedValueOnce([
      {
        id: 1,
        name: 'John Smith',
        email: 'john@example.com',
        avatarUrl: null,
      },
    ]);

    const result = await listExternalTeamMembers(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('John Smith');
      expect(result.data[0].externalId).toBe('1');
    }
  });

  it('should return empty array for unsupported providers', async () => {
    mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce({
      id: 'ba_123',
      organizationId: 'org_123',
      provider: 'phorest',
      isActive: true,
      encryptedCredentials: 'encrypted_data',
      config: {},
    });
    mocks.mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'token_123',
    });

    const result = await listExternalTeamMembers(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(0);
    }
  });

  it('should return NOT_FOUND when booking account not found', async () => {
    mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      listExternalTeamMembers(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return VALIDATION_ERROR for empty bookingAccountId', async () => {
    await expectResult(
      listExternalTeamMembers(mockDb as never, {
        ...validInput,
        bookingAccountId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return EXTERNAL_SERVICE_ERROR when API fails', async () => {
    mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce({
      id: 'ba_123',
      organizationId: 'org_123',
      provider: 'calendly',
      isActive: true,
      encryptedCredentials: 'encrypted_data',
      config: { calendly: { organizationUri: 'https://calendly.com/org/123' } },
    });
    mocks.mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'token_123',
    });
    mocks.mockGetOrganizationMembers.mockRejectedValueOnce(
      new Error('API failed')
    );

    await expectResult(
      listExternalTeamMembers(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.EXTERNAL_SERVICE_ERROR);
  });
});
