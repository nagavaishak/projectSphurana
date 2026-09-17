import {
  GoogleDriveApiService,
  GoogleDriveOAuthService,
  decryptCredentials,
  encryptCredentials,
} from '@borradh-workspace/integrations';
import { getOrgAssetsBucket, upload } from '@borradh-workspace/storage';
import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import * as createAssetModule from '../../../assets/services/create-asset/create-asset.service.js';
import { ErrorCodes } from '../../../shared/index.js';

// `@borradh-workspace/storage` is a canonically aliased mock (vite.config.ts) —
// drive its `vi.fn()`s with `vi.mocked()` rather than a file-local `vi.mock`,
// which would leak under `isolate: false`.
const mockStorage = {
  mockUpload: vi.mocked(upload),
  mockGetOrgAssetsBucket: vi.mocked(getOrgAssetsBucket),
};

// `createAsset` is an INTERNAL module shared with create-asset.test.ts (which
// exercises the REAL service) — a file-local `vi.mock` would leak under
// `isolate: false`, so use a restored `vi.spyOn` instead (created in
// beforeEach, restored in afterEach).
let mockCreateAsset: ReturnType<typeof vi.spyOn>;

import { importDriveFile } from './import-drive-file.service.js';

const driveApiService = new GoogleDriveApiService() as {
  downloadFile: ReturnType<typeof vi.fn>;
};
const driveOAuthService = new GoogleDriveOAuthService() as {
  refreshAccessToken: ReturnType<typeof vi.fn>;
};
const mockDownloadFile = vi.mocked(driveApiService.downloadFile);
const mockRefreshAccessToken = vi.mocked(driveOAuthService.refreshAccessToken);

describe('importDriveFile', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockDownloadFile.mockReset();
    mockRefreshAccessToken.mockReset();
    mockStorage.mockUpload.mockReset();
    mockStorage.mockGetOrgAssetsBucket.mockReset();
    mockStorage.mockGetOrgAssetsBucket.mockReturnValue('test-bucket');
    mockCreateAsset = vi.spyOn(createAssetModule, 'createAsset');
    vi.mocked(decryptCredentials).mockReturnValue({
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
      expiresIn: 3600,
    } as never);
    vi.mocked(encryptCredentials).mockReturnValue('encrypted_credentials');
  });

  afterEach(() => {
    mockCreateAsset.mockRestore();
  });

  const validInput = {
    organizationId: 'org-123',
    userId: 'user-456',
    accountId: 'drive-789',
    fileId: 'file-abc',
    name: 'My Video',
    tags: ['tag1'],
  };

  const mockAccount = {
    id: 'drive-789',
    organizationId: 'org-123',
    isActive: true,
    encryptedCredentials: 'encrypted_creds',
    tokenExpiresAt: new Date(Date.now() + 3600000),
  };

  it('imports drive file successfully', async () => {
    mockDb.query.driveAccount.findFirst.mockResolvedValueOnce(mockAccount);
    mockDownloadFile.mockResolvedValueOnce({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      }),
      fileName: 'video.mp4',
      mimeType: 'video/mp4',
    });
    mockStorage.mockUpload.mockResolvedValueOnce(undefined);
    mockCreateAsset.mockResolvedValueOnce({
      success: true,
      data: {
        id: 'asset-1',
        name: 'My Video',
        blobUrl: 'https://test-bucket.s3.amazonaws.com/key',
      },
    });

    const result = await importDriveFile(mockDb as never, validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('asset-1');
    }
  });

  it('returns NOT_FOUND when drive account does not exist', async () => {
    mockDb.query.driveAccount.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      importDriveFile(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns FORBIDDEN when drive account is inactive', async () => {
    mockDb.query.driveAccount.findFirst.mockResolvedValueOnce({
      ...mockAccount,
      isActive: false,
    });

    await expectResult(
      importDriveFile(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.FORBIDDEN);
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      importDriveFile(mockDb as never, { ...validInput, organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for missing fileId', async () => {
    await expectResult(
      importDriveFile(mockDb as never, { ...validInput, fileId: '' })
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
      importDriveFile(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.UNAUTHORIZED);
  });

  it('returns NOT_FOUND when file not found in Drive', async () => {
    mockDb.query.driveAccount.findFirst.mockResolvedValueOnce(mockAccount);
    mockDownloadFile.mockRejectedValueOnce(new Error('File not found'));

    await expectResult(
      importDriveFile(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for file too large', async () => {
    mockDb.query.driveAccount.findFirst.mockResolvedValueOnce(mockAccount);
    mockDownloadFile.mockRejectedValueOnce(new Error('File too large'));

    await expectResult(
      importDriveFile(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for invalid file type', async () => {
    mockDb.query.driveAccount.findFirst.mockResolvedValueOnce(mockAccount);
    mockDownloadFile.mockRejectedValueOnce(new Error('Invalid file type'));

    await expectResult(
      importDriveFile(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on unexpected failure', async () => {
    mockDb.query.driveAccount.findFirst.mockRejectedValueOnce(
      new Error('DB error')
    );

    await expectResult(
      importDriveFile(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
