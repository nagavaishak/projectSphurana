import {
  downloadAsBuffer,
  getOrgAssetsBucket,
  getPublicAssetsBucket,
  parseS3Url,
  upload,
} from '@borradh-workspace/storage';
// `@borradh-workspace/storage` is canonically aliased to the shared mock
// (vite.config.ts) — drive it with vi.mocked, no file-local vi.mock.
import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { PDFDocument } from 'pdf-lib';
import { ErrorCodes } from '../../../shared/index.js';
import { generateConsentPdf } from './generate-consent-pdf.service.js';

describe('generateConsentPdf', () => {
  const mockDb = createMockDatabase();

  const completedSubmission = (overrides: Record<string, unknown> = {}) => ({
    id: 'sub_1',
    leadId: 'lead_1',
    organizationId: 'org_1',
    status: 'completed',
    templateSnapshot: {
      title: 'Laser Consent',
      body: 'I consent to the treatment.\n\nRisks were explained to me.',
      fields: [
        { type: 'text', label: 'Allergies' },
        { type: 'checkbox', label: 'Over 18' },
      ],
      requiresSignature: true,
    },
    fieldData: { Allergies: 'None', 'Over 18': true },
    signedByName: 'Jane Doe',
    signedAt: new Date('2026-08-11T14:30:00.000Z'),
    signatureImageKey: null,
    pdfKey: null,
    ...overrides,
  });

  const org = {
    id: 'org_1',
    name: 'Glow Clinic',
    logo: null,
    timezone: 'Europe/Dublin',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    vi.mocked(upload).mockResolvedValue({});
  });

  it('composes an A4 PDF with ≥1 page and non-zero bytes, uploads and saves pdf_key', async () => {
    mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(
      completedSubmission()
    );
    mockDb.query.organization.findFirst.mockResolvedValueOnce(org);

    const result = await generateConsentPdf(mockDb as never, {
      submissionId: 'sub_1',
      organizationId: 'org_1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pdfKey).toBe('consent-pdfs/org_1/lead_1/sub_1.pdf');
    }

    // The uploaded object is a real, loadable PDF.
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'consent-pdfs/org_1/lead_1/sub_1.pdf',
        contentType: 'application/pdf',
      })
    );
    const body = vi.mocked(upload).mock.calls[0][0].body as Buffer;
    expect(body.length).toBeGreaterThan(0);
    const loaded = await PDFDocument.load(body);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(1);

    // pdf_key persisted on the submission.
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith({
      pdfKey: 'consent-pdfs/org_1/lead_1/sub_1.pdf',
    });
  });

  it('paginates a long body across multiple pages', async () => {
    mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(
      completedSubmission({
        templateSnapshot: {
          title: 'Long form',
          body: Array.from(
            { length: 120 },
            (_, i) => `Paragraph ${i}: ${'consent wording '.repeat(12)}`
          ).join('\n'),
          fields: [],
          requiresSignature: false,
        },
      })
    );
    mockDb.query.organization.findFirst.mockResolvedValueOnce(org);

    const result = await generateConsentPdf(mockDb as never, {
      submissionId: 'sub_1',
      organizationId: 'org_1',
    });

    expect(result.success).toBe(true);
    const body = vi.mocked(upload).mock.calls[0][0].body as Buffer;
    const loaded = await PDFDocument.load(body);
    expect(loaded.getPageCount()).toBeGreaterThan(1);
  });

  it('returns NOT_FOUND when the submission does not exist', async () => {
    mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      generateConsentPdf(mockDb as never, {
        submissionId: 'missing',
        organizationId: 'org_1',
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
    expect(upload).not.toHaveBeenCalled();
  });

  it('returns CONFLICT when the submission is still pending', async () => {
    mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(
      completedSubmission({ status: 'pending' })
    );

    await expectResult(
      generateConsentPdf(mockDb as never, {
        submissionId: 'sub_1',
        organizationId: 'org_1',
      })
    ).toFailWithCode(ErrorCodes.CONFLICT);
    expect(upload).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing ids', async () => {
    await expectResult(
      generateConsentPdf(mockDb as never, {
        submissionId: '',
        organizationId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR when the upload fails', async () => {
    mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(
      completedSubmission()
    );
    mockDb.query.organization.findFirst.mockResolvedValueOnce(org);
    vi.mocked(upload).mockRejectedValueOnce(new Error('S3 down'));

    await expectResult(
      generateConsentPdf(mockDb as never, {
        submissionId: 'sub_1',
        organizationId: 'org_1',
      })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });

  /**
   * `organization.logo` is free text validated only as a URL. `parseS3Url`
   * parses ANY `*.s3.*.amazonaws.com` host, and the download runs with the
   * task role's own credentials — so an unconstrained fetch here let an org
   * admin read another tenant's object out of their own consent PDF, and let
   * an arbitrary http(s) host be reached from inside the private network.
   *
   * Every refusal below must still produce a PDF: a logo we will not fetch is
   * a cosmetic loss, not a reason to fail an archival document.
   */
  describe('logo loading is constrained to our own buckets', () => {
    // The storage stubs are SHARED across every file in the worker
    // (`isolate: false`), and several suites call `vi.resetAllMocks()`, which
    // strips the module-level `mockReturnValue` defaults — `getOrgAssetsBucket`
    // then returns undefined and this block fails depending on run order.
    // Establish everything it depends on here rather than inheriting it, and
    // put `parseS3Url` back to its default afterwards.
    beforeEach(() => {
      vi.mocked(getOrgAssetsBucket).mockReturnValue('mock-org-bucket');
      vi.mocked(getPublicAssetsBucket).mockReturnValue('mock-public-bucket');
      vi.mocked(parseS3Url).mockReturnValue(null);
    });

    afterEach(() => {
      vi.mocked(parseS3Url).mockReturnValue(null);
    });

    const withLogo = (logo: string) => {
      mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(
        completedSubmission()
      );
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        ...org,
        logo,
      });
    };

    it('refuses an S3 URL pointing at a bucket that is not ours', async () => {
      vi.mocked(parseS3Url).mockReturnValue({
        bucket: 'someone-elses-bucket',
        key: 'victim-org/logo.png',
      });
      withLogo('https://someone-elses-bucket.s3.eu-west-1.amazonaws.com/x.png');

      const result = await generateConsentPdf(mockDb as never, {
        submissionId: 'sub_1',
        organizationId: 'org_1',
      });

      expect(result.success).toBe(true);
      expect(downloadAsBuffer).not.toHaveBeenCalled();
    });

    it('refuses an arbitrary http(s) host outright', async () => {
      vi.mocked(parseS3Url).mockReturnValue(null);
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      withLogo('http://169.254.169.254/latest/meta-data/');

      const result = await generateConsentPdf(mockDb as never, {
        submissionId: 'sub_1',
        organizationId: 'org_1',
      });

      expect(result.success).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('still loads a logo from our own org-assets bucket', async () => {
      vi.mocked(parseS3Url).mockReturnValue({
        bucket: 'mock-org-bucket',
        key: 'org_1/logo.png',
      });
      withLogo('https://mock-org-bucket.s3.eu-west-1.amazonaws.com/logo.png');

      const result = await generateConsentPdf(mockDb as never, {
        submissionId: 'sub_1',
        organizationId: 'org_1',
      });

      expect(result.success).toBe(true);
      expect(downloadAsBuffer).toHaveBeenCalledWith({
        bucket: 'mock-org-bucket',
        key: 'org_1/logo.png',
      });
    });
  });
});
