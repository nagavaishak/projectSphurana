import {
  PhorestApiService,
  encryptCredentials,
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

import { connectPhorest } from './connect-phorest.service.js';

const phorestApiService = new PhorestApiService() as {
  testConnection: ReturnType<typeof vi.fn>;
  getBranches: ReturnType<typeof vi.fn>;
};
const mockTestConnection = vi.mocked(phorestApiService.testConnection);
const mockGetBranches = vi.mocked(phorestApiService.getBranches);
const mockEncryptCredentials = vi.mocked(encryptCredentials);

describe('connectPhorest', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockEncryptCredentials.mockReturnValue('encrypted_credentials');
  });

  const validInput = {
    organizationId: 'org_123',
    userId: 'user_123',
    username: 'global/test@salon.com',
    password: 'password123',
    businessId: 'business_123',
    region: 'us' as const,
  };

  const mockBranches = [
    {
      branchId: 'branch_123',
      name: 'Main Salon',
    },
  ];

  it('should connect Phorest account successfully', async () => {
    mockTestConnection.mockResolvedValueOnce(true);
    mockGetBranches.mockResolvedValueOnce(mockBranches);
    mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce(null);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'booking_123',
        organizationId: 'org_123',
        provider: 'phorest',
        displayName: 'Main Salon',
        isActive: true,
      },
    ]);

    const result = await connectPhorest(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe('phorest');
      expect(result.data.displayName).toBe('Main Salon');
    }
    expect(mockTestConnection).toHaveBeenCalled();
  });

  it('should return EXTERNAL_SERVICE_ERROR when connection test fails', async () => {
    mockTestConnection.mockResolvedValueOnce(false);

    await expectResult(connectPhorest(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.EXTERNAL_SERVICE_ERROR);
        expect(error.message).toContain('Invalid Phorest credentials');
      }
    );
  });

  it('should return ALREADY_EXISTS when account is already connected', async () => {
    mockTestConnection.mockResolvedValueOnce(true);
    mockGetBranches.mockResolvedValueOnce(mockBranches);
    mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce({
      id: 'existing_booking',
      provider: 'phorest',
      externalAccountId: 'business_123',
    });

    await expectResult(connectPhorest(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.ALREADY_EXISTS);
        expect(error.message).toContain('business_123');
      }
    );
  });

  it('should return UNAUTHORIZED when credentials are invalid', async () => {
    mockTestConnection.mockRejectedValueOnce(new Error('401 Unauthorized'));

    await expectResult(connectPhorest(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.UNAUTHORIZED);
      }
    );
  });

  it('should return VALIDATION_ERROR for missing username', async () => {
    const invalidInput = {
      organizationId: 'org_123',
      userId: 'user_123',
      password: 'password123',
      businessId: 'business_123',
      region: 'us',
    };

    await expectResult(
      connectPhorest(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing businessId', async () => {
    const invalidInput = {
      organizationId: 'org_123',
      userId: 'user_123',
      username: 'global/test@salon.com',
      password: 'password123',
      region: 'us',
    };

    await expectResult(
      connectPhorest(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return INTERNAL_ERROR on database failure', async () => {
    mockTestConnection.mockResolvedValueOnce(true);
    mockGetBranches.mockResolvedValueOnce(mockBranches);
    mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce(null);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockRejectedValueOnce(new Error('Database error'));

    await expectResult(
      connectPhorest(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
