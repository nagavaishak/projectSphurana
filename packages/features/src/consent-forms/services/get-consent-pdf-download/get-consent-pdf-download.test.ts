import { getPresignedDownloadUrl } from '@borradh-workspace/storage';
// `@borradh-workspace/storage` is canonically aliased to the shared mock
// (vite.config.ts). The generate service is stubbed with a restored spy (the
// mock-boundaries gate forbids vi.mock of internal modules) so this suite
// tests the download contract, not PDF composition.
import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import { ErrorCodes, FeatureError, err, ok } from '../../../shared/index.js';
import * as generateConsentPdfModule from '../generate-consent-pdf/index.js';
import {
  getConsentPdfDownloadForPatient,
  getConsentPdfDownloadForStaff,
} from './get-consent-pdf-download.service.js';

describe('getConsentPdfDownload', () => {
  const mockDb = createMockDatabase();

  const submission = (overrides: Record<string, unknown> = {}) => ({
    id: 'sub_1',
    leadId: 'lead_1',
    organizationId: 'org_1',
    status: 'completed',
    pdfKey: 'consent-pdfs/org_1/lead_1/sub_1.pdf',
    pdfGenerationAttempts: 0,
    ...overrides,
  });

  const patientInput = {
    submissionId: 'sub_1',
    leadId: 'lead_1',
    organizationId: 'org_1',
  };

  let generatePdfSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    generatePdfSpy = vi
      .spyOn(generateConsentPdfModule, 'generateConsentPdf')
      .mockResolvedValue(ok({ pdfKey: 'consent-pdfs/org_1/lead_1/sub_1.pdf' }));
    vi.mocked(getPresignedDownloadUrl).mockResolvedValue(
      'https://s3.example.com/signed'
    );
  });

  afterEach(() => {
    generatePdfSpy.mockRestore();
  });

  it('presigns the stored pdf_key for the patient', async () => {
    mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(
      submission()
    );

    const result = await getConsentPdfDownloadForPatient(
      mockDb as never,
      patientInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toBe('https://s3.example.com/signed');
      expect(result.data.expiresIn).toBe(300);
    }
    expect(getPresignedDownloadUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'consent-pdfs/org_1/lead_1/sub_1.pdf',
        expiresIn: 300,
      })
    );
    expect(generatePdfSpy).not.toHaveBeenCalled();
  });

  it('generates on demand when pdf_key is null, then presigns the new key', async () => {
    mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(
      submission({ pdfKey: null })
    );
    generatePdfSpy.mockResolvedValueOnce(
      ok({ pdfKey: 'consent-pdfs/org_1/lead_1/sub_1.pdf' })
    );

    const result = await getConsentPdfDownloadForPatient(
      mockDb as never,
      patientInput
    );

    expect(result.success).toBe(true);
    expect(generatePdfSpy).toHaveBeenCalledWith(expect.anything(), {
      submissionId: 'sub_1',
      organizationId: 'org_1',
    });
    expect(getPresignedDownloadUrl).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'consent-pdfs/org_1/lead_1/sub_1.pdf' })
    );
  });

  it('propagates a failed on-demand generation', async () => {
    mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(
      submission({ pdfKey: null })
    );
    generatePdfSpy.mockResolvedValueOnce(
      err(new FeatureError(ErrorCodes.INTERNAL_ERROR, 'compose failed'))
    );

    await expectResult(
      getConsentPdfDownloadForPatient(mockDb as never, patientInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
    expect(getPresignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for a pending (unsigned) submission', async () => {
    mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(
      submission({ status: 'pending' })
    );

    await expectResult(
      getConsentPdfDownloadForPatient(mockDb as never, patientInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
    expect(getPresignedDownloadUrl).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND for another patient's submission (filtered row)", async () => {
    mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getConsentPdfDownloadForPatient(mockDb as never, patientInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for missing ids', async () => {
    await expectResult(
      getConsentPdfDownloadForPatient(mockDb as never, {
        submissionId: '',
        leadId: '',
        organizationId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('staff variant presigns an org-scoped submission', async () => {
    mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(
      submission()
    );

    const result = await getConsentPdfDownloadForStaff(mockDb as never, {
      submissionId: 'sub_1',
      organizationId: 'org_1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toBe('https://s3.example.com/signed');
    }
  });

  it('staff variant returns NOT_FOUND outside the active org', async () => {
    mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getConsentPdfDownloadForStaff(mockDb as never, {
        submissionId: 'sub_1',
        organizationId: 'other_org',
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns INTERNAL_ERROR when presigning fails', async () => {
    mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(
      submission()
    );
    vi.mocked(getPresignedDownloadUrl).mockRejectedValueOnce(
      new Error('S3 down')
    );

    await expectResult(
      getConsentPdfDownloadForPatient(mockDb as never, patientInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });

  /**
   * `pdf_key` is the ONLY thing deciding which object gets signed, and the
   * presign runs with our own credentials — so a key from outside this
   * submission's prefix would be an arbitrary-object read. Ownership is
   * already proven upstream; this is the defence in depth the sibling
   * patient-documents path has always had and this one did not.
   */
  describe('presigned key must sit under the submission prefix', () => {
    it.each([
      ['another submission', 'consent-pdfs/org_1/lead_OTHER/sub_9.pdf'],
      ['another org', 'consent-pdfs/org_EVIL/lead_1/sub_1.pdf'],
      ['a different area entirely', 'patient-documents/org_1/lead_1/x.pdf'],
      ['a traversal attempt', 'consent-pdfs/org_1/lead_1/../../../secret.pdf'],
    ])('refuses a key pointing at %s', async (_label, pdfKey) => {
      mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(
        submission({ pdfKey })
      );

      await expectResult(
        getConsentPdfDownloadForPatient(mockDb as never, patientInput)
      ).toFailWithCode(ErrorCodes.NOT_FOUND);

      expect(getPresignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('still signs a key under the submission’s own prefix', async () => {
      mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(
        submission()
      );

      const result = await getConsentPdfDownloadForPatient(
        mockDb as never,
        patientInput
      );

      expect(result.success).toBe(true);
      expect(getPresignedDownloadUrl).toHaveBeenCalled();
    });
  });

  /**
   * Generation at sign time is fire-and-forget and this endpoint regenerates
   * whenever `pdf_key` is null — so a compose that fails DETERMINISTICALLY
   * (oversized body, pdf-lib throw, a logo that times out) re-ran the whole
   * document render on EVERY download, from both the patient and the staff
   * endpoint, with no backoff and no record. The only symptom was repeated
   * 500s.
   */
  describe('a failing compose is not retried forever', () => {
    it('stops composing once the attempt cap is reached', async () => {
      mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(
        submission({ pdfKey: null, pdfGenerationAttempts: 3 })
      );

      await expectResult(
        getConsentPdfDownloadForPatient(mockDb as never, patientInput)
      ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);

      // The expensive part never runs again.
      expect(generatePdfSpy).not.toHaveBeenCalled();
    });

    it('records the failure so the next request can stop', async () => {
      mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(
        submission({ pdfKey: null, pdfGenerationAttempts: 1 })
      );
      generatePdfSpy.mockResolvedValueOnce(
        err(new FeatureError(ErrorCodes.INTERNAL_ERROR, 'compose blew up'))
      );

      await expectResult(
        getConsentPdfDownloadForPatient(mockDb as never, patientInput)
      ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);

      expect(mockDb.set).toHaveBeenCalledWith({ pdfGenerationAttempts: 2 });
    });

    it('clears the counter when a retry finally succeeds', async () => {
      mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(
        submission({ pdfKey: null, pdfGenerationAttempts: 2 })
      );
      generatePdfSpy.mockResolvedValueOnce(
        ok({ pdfKey: 'consent-pdfs/org_1/lead_1/sub_1.pdf' })
      );

      const result = await getConsentPdfDownloadForPatient(
        mockDb as never,
        patientInput
      );

      expect(result.success).toBe(true);
      // A transient failure must not permanently condemn the form.
      expect(mockDb.set).toHaveBeenCalledWith({ pdfGenerationAttempts: 0 });
    });
  });
});
