import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { createPatientDocument } from './create-patient-document.service.js';

describe('createPatientDocument', () => {
  const mockDb = createMockDatabase();
  const mockStorage = {
    getOrgAssetsBucket: vi.fn().mockReturnValue('test-org-assets-bucket'),
    getS3Region: vi.fn().mockReturnValue('eu-west-1'),
    getMetadata: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // Default: the presigned object exists with the expected type/size, so the
    // HeadObject verification passes. Tests that exercise the phantom-object or
    // disallowed-type paths override this.
    mockStorage.getMetadata.mockResolvedValue({
      key: 'patient-documents/org_1/lead_1/1700000000-abc123.pdf',
      size: 1024 * 1024,
      contentType: 'application/pdf',
    });
  });

  const validInput = {
    organizationId: 'org_1',
    leadId: 'lead_1',
    key: 'patient-documents/org_1/lead_1/1700000000-abc123.pdf',
    fileName: 'referral-letter.pdf',
    mimeType: 'application/pdf' as const,
    sizeBytes: 1024 * 1024,
    uploadedByType: 'patient' as const,
  };

  const mockLead = { id: 'lead_1', organizationId: 'org_1' };

  it('records a patient-uploaded document', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    mockDb.returning.mockResolvedValueOnce([
      { id: 'doc_1', fileName: 'referral-letter.pdf' },
    ]);

    const result = await createPatientDocument(
      mockDb as never,
      mockStorage as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('doc_1');
    }
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
    const [values] = mockDb.values.mock.calls[0];
    expect(values).toMatchObject({
      organizationId: 'org_1',
      leadId: 'lead_1',
      uploadedByType: 'patient',
      // Patient uploads never carry a staff user id.
      uploadedByUserId: null,
      blobUrl:
        'https://test-org-assets-bucket.s3.eu-west-1.amazonaws.com/patient-documents/org_1/lead_1/1700000000-abc123.pdf',
    });
  });

  it('records a staff upload with the acting user id', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    mockDb.returning.mockResolvedValueOnce([{ id: 'doc_2' }]);

    const result = await createPatientDocument(
      mockDb as never,
      mockStorage as never,
      {
        ...validInput,
        uploadedByType: 'staff' as const,
        uploadedByUserId: 'user_9',
      }
    );

    expect(result.success).toBe(true);
    const [values] = mockDb.values.mock.calls[0];
    expect(values).toMatchObject({
      uploadedByType: 'staff',
      uploadedByUserId: 'user_9',
    });
  });

  it('rejects a key outside this patient prefix', async () => {
    const result = await createPatientDocument(
      mockDb as never,
      mockStorage as never,
      {
        ...validInput,
        key: 'patient-documents/org_1/OTHER_LEAD/1700000000-abc123.pdf',
      }
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('rejects a disallowed mime type', async () => {
    const result = await createPatientDocument(
      mockDb as never,
      mockStorage as never,
      { ...validInput, mimeType: 'application/zip' as never }
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('rejects a phantom row when the object was never uploaded', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    // HeadObject finds nothing — the key was presigned but never PUT.
    mockStorage.getMetadata.mockResolvedValueOnce(null);

    const result = await createPatientDocument(
      mockDb as never,
      mockStorage as never,
      validInput
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('persists the size/type S3 observed, not the client claim', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    mockDb.returning.mockResolvedValueOnce([{ id: 'doc_obs' }]);
    // Client claimed 1MB pdf; S3 actually holds a 2MB jpeg.
    mockStorage.getMetadata.mockResolvedValueOnce({
      key: validInput.key,
      size: 2 * 1024 * 1024,
      contentType: 'image/jpeg',
    });

    const result = await createPatientDocument(
      mockDb as never,
      mockStorage as never,
      validInput
    );

    expect(result.success).toBe(true);
    const [values] = mockDb.values.mock.calls[0];
    expect(values).toMatchObject({
      mimeType: 'image/jpeg',
      sizeBytes: 2 * 1024 * 1024,
    });
  });

  it('rejects a file over 15MB', async () => {
    const result = await createPatientDocument(
      mockDb as never,
      mockStorage as never,
      { ...validInput, sizeBytes: 15 * 1024 * 1024 + 1 }
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns NOT_FOUND when the lead is not in the org', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

    const result = await createPatientDocument(
      mockDb as never,
      mockStorage as never,
      validInput
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    const result = await createPatientDocument(
      mockDb as never,
      mockStorage as never,
      validInput
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
