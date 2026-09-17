import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { getPatientConsentForm } from './get-patient-consent-form.service.js';

describe('getPatientConsentForm', () => {
  const mockDb = createMockDatabase();

  const validInput = {
    leadId: 'lead_1',
    organizationId: 'org_1',
    submissionId: 'sub_1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('returns the full submission (snapshot + fieldData) when found', async () => {
    const mockRow = {
      id: 'sub_1',
      leadId: 'lead_1',
      templateSnapshot: {
        title: 'Laser Consent',
        body: 'I consent.',
        fields: [],
        requiresSignature: true,
      },
      fieldData: {},
      status: 'pending',
    };
    mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(mockRow);

    const result = await getPatientConsentForm(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('sub_1');
      expect(result.data.templateSnapshot.title).toBe('Laser Consent');
    }
  });

  it('returns NOT_FOUND for a pending form whose appointment was cancelled', async () => {
    // An emailed link or a stale tab must not still open the sign screen.
    mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce({
      id: 'sub_1',
      appointmentId: 'apt_1',
      leadId: 'lead_1',
      status: 'pending',
      templateSnapshot: {
        title: 'Laser Consent',
        body: 'I consent.',
        fields: [],
        requiresSignature: true,
      },
      fieldData: {},
    });
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      status: 'cancelled',
      deletedAt: null,
    });

    await expectResult(
      getPatientConsentForm(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('still returns a SIGNED form whose appointment was cancelled', async () => {
    mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce({
      id: 'sub_1',
      appointmentId: 'apt_1',
      leadId: 'lead_1',
      status: 'completed',
      signedAt: new Date('2026-08-01T10:00:00Z'),
      templateSnapshot: {
        title: 'Laser Consent',
        body: 'I consent.',
        fields: [],
        requiresSignature: true,
      },
      fieldData: {},
    });
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      status: 'cancelled',
      deletedAt: null,
    });

    const result = await getPatientConsentForm(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('completed');
  });

  it("returns NOT_FOUND for another patient's submission (filtered row)", async () => {
    mockDb.query.consentFormSubmission.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getPatientConsentForm(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for a missing submissionId', async () => {
    await expectResult(
      getPatientConsentForm(mockDb as never, {
        ...validInput,
        submissionId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on database failure', async () => {
    mockDb.query.consentFormSubmission.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      getPatientConsentForm(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
