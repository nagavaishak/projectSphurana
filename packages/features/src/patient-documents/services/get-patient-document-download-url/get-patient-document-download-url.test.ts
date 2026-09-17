import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import {
  getPatientDocumentDownloadUrlForPatient,
  getPatientDocumentDownloadUrlForStaff,
} from './get-patient-document-download-url.service.js';

describe('getPatientDocumentDownloadUrl', () => {
  const mockDb = createMockDatabase();
  const getPresignedDownloadUrl = vi.fn();
  const storage = {
    getOrgAssetsBucket: () => 'org-assets-bucket',
    getPresignedDownloadUrl,
    attachmentDisposition: (fileName: string) =>
      `attachment; filename="${fileName}"`,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    getPresignedDownloadUrl.mockResolvedValue(
      'https://signed.example/doc?sig=x'
    );
  });

  const validInput = {
    organizationId: 'org_1',
    leadId: 'lead_1',
    documentId: 'doc_1',
  };

  const ownedDoc = {
    id: 'doc_1',
    fileName: 'aftercare.pdf',
    mimeType: 'application/pdf',
    blobUrl:
      'https://org-assets-bucket.s3.eu-west-1.amazonaws.com/patient-documents/org_1/lead_1/123-abc.pdf',
  };

  describe('patient variant', () => {
    it('mints a short-lived presigned URL for an owned document', async () => {
      mockDb.query.patientDocument.findFirst.mockResolvedValueOnce(ownedDoc);

      const result = await getPatientDocumentDownloadUrlForPatient(
        mockDb as never,
        storage,
        validInput
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.url).toContain('signed.example');
        expect(result.data.expiresIn).toBe(300);
        expect(result.data.fileName).toBe('aftercare.pdf');
      }
      // The key handed to S3 is the one parsed from the blobUrl, under the
      // patient's own prefix.
      expect(getPresignedDownloadUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'patient-documents/org_1/lead_1/123-abc.pdf',
          expiresIn: 300,
          // Stored-XSS mitigation: the download is forced to a neutral type +
          // attachment, never served inline as the uploaded content-type.
          responseContentType: 'application/octet-stream',
          responseContentDisposition: 'attachment; filename="aftercare.pdf"',
        })
      );
    });

    it('returns NOT_FOUND when the document is not visible', async () => {
      mockDb.query.patientDocument.findFirst.mockResolvedValueOnce(undefined);

      const result = await getPatientDocumentDownloadUrlForPatient(
        mockDb as never,
        storage,
        validInput
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
      }
      expect(getPresignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('fails closed when the stored blobUrl escapes the patient prefix', async () => {
      // A tampered/legacy row pointing at another patient's directory must
      // never mint a URL.
      mockDb.query.patientDocument.findFirst.mockResolvedValueOnce({
        ...ownedDoc,
        blobUrl:
          'https://org-assets-bucket.s3.eu-west-1.amazonaws.com/patient-documents/org_1/OTHER_LEAD/secret.pdf',
      });

      const result = await getPatientDocumentDownloadUrlForPatient(
        mockDb as never,
        storage,
        validInput
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      }
      expect(getPresignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('returns VALIDATION_ERROR without a documentId', async () => {
      const result = await getPatientDocumentDownloadUrlForPatient(
        mockDb as never,
        storage,
        { ...validInput, documentId: '' }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });
  });

  describe('staff variant', () => {
    it('mints a URL for an org document', async () => {
      mockDb.query.patientDocument.findFirst.mockResolvedValueOnce(ownedDoc);

      const result = await getPatientDocumentDownloadUrlForStaff(
        mockDb as never,
        storage,
        validInput
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.url).toContain('signed.example');
      }
    });
  });
});
