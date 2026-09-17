import {
  GoogleDriveApiService,
  GoogleDriveOAuthService,
  decryptCredentials,
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

import { listDriveFiles } from './list-drive-files.service.js';

const driveApiService = new GoogleDriveApiService() as {
  listFiles: ReturnType<typeof vi.fn>;
  getFolderPath: ReturnType<typeof vi.fn>;
};
const driveOAuthService = new GoogleDriveOAuthService() as {
  refreshAccessToken: ReturnType<typeof vi.fn>;
};
const mockListFiles = vi.mocked(driveApiService.listFiles);
const mockGetFolderPath = vi.mocked(driveApiService.getFolderPath);
const mockRefreshAccessToken = vi.mocked(driveOAuthService.refreshAccessToken);
const mockDecryptCredentials = vi.mocked(decryptCredentials);
const mockEncryptCredentials = vi.mocked(encryptCredentials);

describe('listDriveFiles', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockDecryptCredentials.mockReturnValue({
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
      expiresIn: 3600,
    });
    mockEncryptCredentials.mockReturnValue('encrypted_credentials');
  });

  const validInput = {
    organizationId: 'org-123',
    accountId: 'drive-789',
  };

  const mockAccount = {
    id: 'drive-789',
    organizationId: 'org-123',
    isActive: true,
    encryptedCredentials: 'encrypted_creds',
    tokenExpiresAt: new Date(Date.now() + 3600000),
  };

  it('lists drive files successfully', async () => {
    mockDb.query.driveAccount.findFirst.mockResolvedValueOnce(mockAccount);
    mockListFiles.mockResolvedValueOnce({
      files: [
        {
          id: 'file-1',
          name: 'video.mp4',
          mimeType: 'video/mp4',
          size: '1024',
        },
        {
          id: 'folder-1',
          name: 'My Folder',
          mimeType: 'application/vnd.google-apps.folder',
        },
      ],
      nextPageToken: undefined,
    });
    mockGetFolderPath.mockResolvedValueOnce([{ id: 'root', name: 'My Drive' }]);
    // Mock lastSyncAt update
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([]);

    const result = await listDriveFiles(mockDb as never, validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.files).toHaveLength(2);
      expect(result.data.files[0].isFolder).toBe(false);
      expect(result.data.files[1].isFolder).toBe(true);
      expect(result.data.breadcrumbs).toHaveLength(1);
    }
  });

  it('returns NOT_FOUND when drive account does not exist', async () => {
    mockDb.query.driveAccount.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      listDriveFiles(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns FORBIDDEN when drive account is inactive', async () => {
    mockDb.query.driveAccount.findFirst.mockResolvedValueOnce({
      ...mockAccount,
      isActive: false,
    });

    await expectResult(
      listDriveFiles(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.FORBIDDEN);
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      listDriveFiles(mockDb as never, { ...validInput, organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for missing accountId', async () => {
    await expectResult(
      listDriveFiles(mockDb as never, { ...validInput, accountId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns UNAUTHORIZED when token refresh fails', async () => {
    mockDb.query.driveAccount.findFirst.mockResolvedValueOnce({
      ...mockAccount,
      tokenExpiresAt: new Date(Date.now() - 3600000),
    });
    mockRefreshAccessToken.mockRejectedValueOnce(
      new Error('Failed to refresh token')
    );

    await expectResult(
      listDriveFiles(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.UNAUTHORIZED);
  });

  it('returns EXTERNAL_SERVICE_ERROR when listing files fails', async () => {
    mockDb.query.driveAccount.findFirst.mockResolvedValueOnce(mockAccount);
    mockListFiles.mockRejectedValueOnce(new Error('Failed to list files'));

    await expectResult(
      listDriveFiles(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.EXTERNAL_SERVICE_ERROR);
  });

  it('returns INTERNAL_ERROR on unexpected failure', async () => {
    mockDb.query.driveAccount.findFirst.mockRejectedValueOnce(
      new Error('DB error')
    );

    await expectResult(
      listDriveFiles(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
