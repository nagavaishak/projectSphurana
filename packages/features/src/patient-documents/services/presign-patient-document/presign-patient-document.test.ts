import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { presignPatientDocument } from './presign-patient-document.service.js';

describe('presignPatientDocument', () => {
  const mockDb = createMockDatabase();
  const mockStorage = {
    getOrgAssetsBucket: vi.fn().mockReturnValue('test-org-assets-bucket'),
    getPublicAssetsBucket: vi.fn().mockReturnValue('test-public-assets-bucket'),
    getS3Region: vi.fn().mockReturnValue('eu-west-1'),
    getPresignedUploadUrl: vi
      .fn()
      .mockResolvedValue('https://s3.amazonaws.com/presigned-upload-url'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // The lead exists in this org unless a test says otherwise.
    mockDb.query.lead.findFirst.mockResolvedValue({
      id: 'lead_1',
      organizationId: 'org_1',
    });
  });

  const validInput = {
    organizationId: 'org_1',
    leadId: 'lead_1',
    uploaderId: 'lead_1',
    fileName: 'referral-letter.pdf',
    mimeType: 'application/pdf' as const,
    sizeBytes: 1024 * 1024,
  };

  it('presigns a PDF upload under the patient-documents prefix', async () => {
    const result = await presignPatientDocument(
      mockDb as never,
      mockStorage as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toBe(
        'https://s3.amazonaws.com/presigned-upload-url'
      );
      expect(result.data.key).toContain('patient-documents/org_1/lead_1/');
      expect(result.data.key).toMatch(/\.pdf$/);
      expect(result.data.expiresIn).toBe(3600);
    }
    // Clinical files must go to the PRIVATE bucket, never public-assets.
    expect(mockStorage.getPresignedUploadUrl).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: 'test-org-assets-bucket' })
    );
  });

  it('accepts an iPhone HEIC capture', async () => {
    const result = await presignPatientDocument(
      mockDb as never,
      mockStorage as never,
      {
        ...validInput,
        fileName: 'IMG_0001.HEIC',
        mimeType: 'image/heic' as const,
      }
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.key).toMatch(/\.heic$/);
    }
  });

  it('rejects a disallowed mime type', async () => {
    const result = await presignPatientDocument(
      mockDb as never,
      mockStorage as never,
      {
        ...validInput,
        mimeType: 'video/mp4' as never,
      }
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockStorage.getPresignedUploadUrl).not.toHaveBeenCalled();
  });

  it('rejects a file over 15MB', async () => {
    const result = await presignPatientDocument(
      mockDb as never,
      mockStorage as never,
      {
        ...validInput,
        sizeBytes: 15 * 1024 * 1024 + 1,
      }
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockStorage.getPresignedUploadUrl).not.toHaveBeenCalled();
  });

  it('rejects a missing leadId', async () => {
    const result = await presignPatientDocument(
      mockDb as never,
      mockStorage as never,
      {
        ...validInput,
        leadId: '',
      }
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns INTERNAL_ERROR when presigning fails', async () => {
    mockStorage.getPresignedUploadUrl.mockRejectedValueOnce(
      new Error('S3 down')
    );

    const result = await presignPatientDocument(
      mockDb as never,
      mockStorage as never,
      validInput
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  /**
   * Only `createPatientDocument` verified the lead belongs to the org, so a
   * staff user could presign for any leadId string. The key is still rooted at
   * their OWN org prefix, so it was never a cross-org write — it littered
   * orphan objects under a path for a patient who does not exist there. Cheap
   * to check, and it keeps both halves of the upload honest about the same
   * thing.
   */
  it('refuses to presign for a lead that is not in this org', async () => {
    mockDb.query.lead.findFirst.mockResolvedValue(undefined);

    const result = await presignPatientDocument(
      mockDb as never,
      mockStorage as never,
      validInput
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
    expect(mockStorage.getPresignedUploadUrl).not.toHaveBeenCalled();
  });
});
