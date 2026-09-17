import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { presignDocumentImport } from './presign-document-import.service.js';

describe('presignDocumentImport', () => {
  const mockDb = createMockDatabase();
  const storage = {
    getOrgAssetsBucket: vi.fn().mockReturnValue('org-assets'),
    getPresignedUploadUrl: vi.fn().mockResolvedValue('https://s3/put'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    storage.getOrgAssetsBucket.mockReturnValue('org-assets');
    storage.getPresignedUploadUrl.mockResolvedValue('https://s3/put');
  });

  const input = {
    organizationId: 'org_1',
    uploaderId: 'user_1',
    fileName: 'consent.pdf',
    mimeType: 'application/pdf' as const,
    sizeBytes: 2048,
  };

  it('creates the staging row first and signs a PUT bound to its key, type and size', async () => {
    const result = await presignDocumentImport(
      mockDb as never,
      storage as never,
      input
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(mockDb.insert).toHaveBeenCalledTimes(1);
    const [values] = mockDb.values.mock.calls[0];
    expect(values).toMatchObject({
      id: result.data.importId,
      organizationId: 'org_1',
      uploadedByUserId: 'user_1',
      fileName: 'consent.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      status: 'uploading',
    });
    expect(values.storageKey).toBe(result.data.key);
    expect(result.data.key).toMatch(
      new RegExp(
        `^document-imports/org_1/${result.data.importId}/\\d+-[0-9a-f]{8}\\.pdf$`
      )
    );
    expect(storage.getPresignedUploadUrl).toHaveBeenCalledWith({
      bucket: 'org-assets',
      key: result.data.key,
      expiresIn: 900,
      contentType: 'application/pdf',
      contentLength: 2048,
    });
    expect(result.data.url).toBe('https://s3/put');
  });

  it('rejects HEIC — the matcher cannot read it', async () => {
    const result = await presignDocumentImport(
      mockDb as never,
      storage as never,
      { ...input, mimeType: 'image/heic' as never }
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(storage.getPresignedUploadUrl).not.toHaveBeenCalled();
  });

  it('rejects files over 15MB before touching storage', async () => {
    const result = await presignDocumentImport(
      mockDb as never,
      storage as never,
      { ...input, sizeBytes: 15 * 1024 * 1024 + 1 }
    );

    expect(result.success).toBe(false);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR when signing fails', async () => {
    storage.getPresignedUploadUrl.mockRejectedValueOnce(new Error('s3 down'));

    const result = await presignDocumentImport(
      mockDb as never,
      storage as never,
      input
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
