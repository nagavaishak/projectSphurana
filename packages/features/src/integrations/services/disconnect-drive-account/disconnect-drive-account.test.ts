import {
  GoogleDriveOAuthService,
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
import { disconnectDriveAccount } from './disconnect-drive-account.service.js';

const driveOAuthService = new GoogleDriveOAuthService() as {
  revokeToken: ReturnType<typeof vi.fn>;
};
const mockRevokeToken = vi.mocked(driveOAuthService.revokeToken);

describe('disconnectDriveAccount', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockRevokeToken.mockReset();
    vi.mocked(decryptCredentials).mockReturnValue({
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
    } as never);
  });

  const validInput = {
    organizationId: 'org-123',
    accountId: 'drive-456',
  };

  it('disconnects drive account successfully', async () => {
    mockDb.query.driveAccount.findFirst.mockResolvedValueOnce({
      id: 'drive-456',
      organizationId: 'org-123',
      encryptedCredentials: 'encrypted_creds',
    });
    mockRevokeToken.mockResolvedValueOnce(undefined);
    mockDb.delete.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([]);

    const result = await disconnectDriveAccount(mockDb as never, validInput);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.success).toBe(true);
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('disconnects even if token revocation fails', async () => {
    mockDb.query.driveAccount.findFirst.mockResolvedValueOnce({
      id: 'drive-456',
      organizationId: 'org-123',
      encryptedCredentials: 'encrypted_creds',
    });
    mockRevokeToken.mockRejectedValueOnce(new Error('Revoke failed'));
    mockDb.delete.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([]);

    const result = await disconnectDriveAccount(mockDb as never, validInput);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.success).toBe(true);
  });

  it('returns NOT_FOUND when account does not exist', async () => {
    mockDb.query.driveAccount.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      disconnectDriveAccount(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      disconnectDriveAccount(mockDb as never, {
        ...validInput,
        organizationId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for missing accountId', async () => {
    await expectResult(
      disconnectDriveAccount(mockDb as never, { ...validInput, accountId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on database failure during delete', async () => {
    mockDb.query.driveAccount.findFirst.mockResolvedValueOnce({
      id: 'drive-456',
      organizationId: 'org-123',
      encryptedCredentials: 'encrypted_creds',
    });
    mockRevokeToken.mockResolvedValueOnce(undefined);
    mockDb.delete.mockReturnThis();
    mockDb.where.mockRejectedValueOnce(new Error('DB error'));

    await expectResult(
      disconnectDriveAccount(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
