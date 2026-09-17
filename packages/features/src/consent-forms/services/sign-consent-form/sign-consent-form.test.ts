import { upload } from '@borradh-workspace/storage';
// `@borradh-workspace/storage` is canonically aliased to the shared mock
// (vite.config.ts). The PDF generator is stubbed with a restored spy (the
// mock-boundaries gate forbids vi.mock of internal modules): the sign test
// asserts the sign contract, not PDF composition.
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
import { ErrorCodes, ok } from '../../../shared/index.js';
import * as generateConsentPdfModule from '../generate-consent-pdf/index.js';
import { signConsentForm } from './sign-consent-form.service.js';

/**
 * A genuinely well-formed PNG header — magic bytes plus an IHDR carrying real
 * dimensions.
 *
 * This used to be `Buffer.from('not-a-real-png-but-bytes-are-bytes')`, under a
 * comment claiming it was well-formed. That was the bug in miniature: the
 * service only checked the data-URL prefix and the decoded size, so arbitrary
 * bytes sailed through here exactly as they did in production, where the PDF
 * renderer then quietly omitted the image and archived a signature-less
 * "signed" consent form.
 */
const signaturePng = (): Buffer => {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8); // IHDR chunk length
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(300, 16); // width
  buf.writeUInt32BE(120, 20); // height
  return buf;
};

const SIGNATURE_DATA_URL = `data:image/png;base64,${signaturePng().toString(
  'base64'
)}`;

describe('signConsentForm', () => {
  const mockDb = createMockDatabase();

  const validInput = {
    leadId: 'lead_1',
    organizationId: 'org_1',
    submissionId: 'sub_1',
    fieldData: { Allergies: 'None', 'Over 18': true },
    signedByName: 'Jane Doe',
    attested: true,
    signedIp: '203.0.113.7',
    signatureImageDataUrl: SIGNATURE_DATA_URL,
  };

  const pendingSubmission = (overrides: Record<string, unknown> = {}) => ({
    id: 'sub_1',
    leadId: 'lead_1',
    organizationId: 'org_1',
    status: 'pending',
    templateSnapshot: {
      title: 'Laser Consent',
      body: 'I consent.',
      fields: [{ type: 'text', label: 'Allergies' }],
      requiresSignature: true,
    },
    ...overrides,
  });

  let generatePdfSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    vi.mocked(upload).mockResolvedValue({});
    generatePdfSpy = vi
      .spyOn(generateConsentPdfModule, 'generateConsentPdf')
      .mockResolvedValue(ok({ pdfKey: 'k' }));
  });

  afterEach(() => {
    generatePdfSpy.mockRestore();
  });

  it('signs a pending form: uploads the signature, writes fieldData, name, timestamps, ip, key, status', async () => {
    mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(
      pendingSubmission()
    );
    const completed = pendingSubmission({
      status: 'completed',
      signedByName: 'Jane Doe',
    });
    mockDb.returning.mockResolvedValueOnce([completed]);

    const result = await signConsentForm(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('completed');

    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'consent-signatures/org_1/lead_1/sub_1.png',
        contentType: 'image/png',
      })
    );
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith({
      fieldData: { Allergies: 'None', 'Over 18': true },
      signedByName: 'Jane Doe',
      signedAt: expect.any(Date),
      signedIp: '203.0.113.7',
      signatureImageKey: 'consent-signatures/org_1/lead_1/sub_1.png',
      status: 'completed',
    });
  });

  it('rejects a missing drawn signature when the snapshot requires one', async () => {
    mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(
      pendingSubmission()
    );

    await expectResult(
      signConsentForm(mockDb as never, {
        ...validInput,
        signatureImageDataUrl: undefined,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(upload).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('rejects a non-PNG signature data URL (schema)', async () => {
    await expectResult(
      signConsentForm(mockDb as never, {
        ...validInput,
        signatureImageDataUrl: 'data:image/jpeg;base64,AAAA',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(upload).not.toHaveBeenCalled();
  });

  it('rejects a signature whose decoded size exceeds 200KB', async () => {
    mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(
      pendingSubmission()
    );

    const oversized = `data:image/png;base64,${Buffer.alloc(200_001).toString('base64')}`;
    await expectResult(
      signConsentForm(mockDb as never, {
        ...validInput,
        signatureImageDataUrl: oversized,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(upload).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('rejects attested !== true server-side (VALIDATION_ERROR)', async () => {
    await expectResult(
      signConsentForm(mockDb as never, { ...validInput, attested: false })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('rejects a missing name when the snapshot requires a signature', async () => {
    mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(
      pendingSubmission()
    );

    await expectResult(
      signConsentForm(mockDb as never, {
        ...validInput,
        signedByName: '   ',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('allows a missing name when the snapshot does NOT require a signature', async () => {
    mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(
      pendingSubmission({
        templateSnapshot: {
          title: 'Info Only',
          body: 'Read me.',
          fields: [],
          requiresSignature: false,
        },
      })
    );
    mockDb.returning.mockResolvedValueOnce([
      pendingSubmission({ status: 'completed' }),
    ]);

    const result = await signConsentForm(mockDb as never, {
      ...validInput,
      signedByName: undefined,
    });

    expect(result.success).toBe(true);
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ signedByName: null, status: 'completed' })
    );
  });

  it('returns CONFLICT when the form is already completed', async () => {
    mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(
      pendingSubmission({ status: 'completed' })
    );

    await expectResult(
      signConsentForm(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.CONFLICT);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('refuses to sign when the appointment was cancelled', async () => {
    // The clinic cancelled while this page was open, or the patient followed
    // an old email link. Signing would archive consent for a visit that never
    // happens — and a completed row then BLOCKS the hard-delete of the slot.
    mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(
      pendingSubmission({ appointmentId: 'apt_1' })
    );
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      status: 'cancelled',
      deletedAt: null,
    });

    await expectResult(
      signConsentForm(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('refuses to sign when the appointment was soft-deleted', async () => {
    mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(
      pendingSubmission({ appointmentId: 'apt_1' })
    );
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      status: 'booked',
      deletedAt: new Date('2026-08-20T10:00:00Z'),
    });

    await expectResult(
      signConsentForm(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('still signs when the appointment is live', async () => {
    mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(
      pendingSubmission({ appointmentId: 'apt_1' })
    );
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      status: 'confirmed',
      deletedAt: null,
    });
    mockDb.returning.mockResolvedValueOnce([
      pendingSubmission({ status: 'completed' }),
    ]);

    const result = await signConsentForm(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('returns CONFLICT when a concurrent sign wins the status=pending guard', async () => {
    mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(
      pendingSubmission()
    );
    // The guarded UPDATE matched no row — someone signed in between.
    mockDb.returning.mockResolvedValueOnce([]);

    await expectResult(
      signConsentForm(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.CONFLICT);
  });

  it("returns NOT_FOUND for another patient's submission (filtered row)", async () => {
    mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      signConsentForm(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on database failure', async () => {
    mockDb.query.consentFormSubmission.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      signConsentForm(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });

  /**
   * The property that matters: a signature we cannot render must leave the
   * submission SIGNABLE. Before the byte check, these payloads were accepted,
   * uploaded as image/png, and the row flipped to `completed` — after which
   * the patient could never sign again (the status guard returns CONFLICT) and
   * the archived PDF had a blank space where the signature belonged.
   */
  it.each([
    ['a JPEG behind a PNG prefix', Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
    ['an SVG behind a PNG prefix', Buffer.from('<svg></svg>')],
    ['random bytes', Buffer.alloc(64, 0x5a)],
  ])(
    'refuses %s, uploads nothing, and leaves the form still signable',
    async (_label, payload) => {
      mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(
        pendingSubmission()
      );

      await expectResult(
        signConsentForm(mockDb as never, {
          ...validInput,
          signatureImageDataUrl: `data:image/png;base64,${Buffer.concat([
            payload,
            Buffer.alloc(40),
          ]).toString('base64')}`,
        })
      ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

      expect(upload).not.toHaveBeenCalled();
      // Still `pending` — the patient gets another go.
      expect(mockDb.update).not.toHaveBeenCalled();
    }
  );
});
