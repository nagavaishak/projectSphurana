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
import { listPatientConsentForms } from './list-patient-consent-forms.service.js';

describe('listPatientConsentForms', () => {
  const mockDb = createMockDatabase();

  const validInput = { leadId: 'lead_1', organizationId: 'org_1' };

  const mockRow = {
    id: 'sub_1',
    appointmentId: 'apt_1',
    leadId: 'lead_1',
    organizationId: 'org_1',
    status: 'pending' as const,
    templateSnapshot: {
      title: 'Laser Consent',
      body: 'I consent.',
      fields: [],
      requiresSignature: true,
    },
    fieldData: {},
    sentAt: new Date('2026-08-01T10:00:00Z'),
    signedAt: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('lists the patient forms as trimmed items (title from the snapshot)', async () => {
    mockDb.query.consentFormSubmission.findMany.mockResolvedValueOnce([
      mockRow,
    ]);

    const result = await listPatientConsentForms(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toEqual([
        {
          id: 'sub_1',
          appointmentId: 'apt_1',
          status: 'pending',
          title: 'Laser Consent',
          sentAt: mockRow.sentAt,
          signedAt: null,
        },
      ]);
      // The full snapshot body/fieldData never leaks into the list row.
      expect(result.data.items[0]).not.toHaveProperty('templateSnapshot');
      expect(result.data.items[0]).not.toHaveProperty('fieldData');
    }
  });

  it('hides a pending form whose appointment was cancelled', async () => {
    mockDb.query.consentFormSubmission.findMany.mockResolvedValueOnce([
      mockRow,
    ]);
    mockDb.query.appointment.findMany.mockResolvedValueOnce([
      { id: 'apt_1', status: 'cancelled', deletedAt: null },
    ]);

    const result = await listPatientConsentForms(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.items).toEqual([]);
  });

  it('hides a pending form whose appointment was soft-deleted', async () => {
    mockDb.query.consentFormSubmission.findMany.mockResolvedValueOnce([
      mockRow,
    ]);
    mockDb.query.appointment.findMany.mockResolvedValueOnce([
      { id: 'apt_1', status: 'booked', deletedAt: new Date() },
    ]);

    const result = await listPatientConsentForms(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.items).toEqual([]);
  });

  it('keeps a SIGNED form whose appointment was cancelled', async () => {
    // The patient signed it: it is an executed record, not an outstanding ask.
    mockDb.query.consentFormSubmission.findMany.mockResolvedValueOnce([
      { ...mockRow, status: 'completed', signedAt: new Date() },
    ]);
    mockDb.query.appointment.findMany.mockResolvedValueOnce([
      { id: 'apt_1', status: 'cancelled', deletedAt: null },
    ]);

    const result = await listPatientConsentForms(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.items).toHaveLength(1);
  });

  it('keeps the live appointment’s form while dropping the cancelled one', async () => {
    mockDb.query.consentFormSubmission.findMany.mockResolvedValueOnce([
      mockRow,
      { ...mockRow, id: 'sub_2', appointmentId: 'apt_2' },
    ]);
    mockDb.query.appointment.findMany.mockResolvedValueOnce([
      { id: 'apt_1', status: 'cancelled', deletedAt: null },
      { id: 'apt_2', status: 'confirmed', deletedAt: null },
    ]);

    const result = await listPatientConsentForms(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items.map((item) => item.id)).toEqual(['sub_2']);
    }
  });

  it('does not query appointments when the patient has no forms', async () => {
    mockDb.query.consentFormSubmission.findMany.mockResolvedValueOnce([]);

    const result = await listPatientConsentForms(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockDb.query.appointment.findMany).not.toHaveBeenCalled();
  });

  it('accepts a status filter', async () => {
    mockDb.query.consentFormSubmission.findMany.mockResolvedValueOnce([]);

    const result = await listPatientConsentForms(mockDb as never, {
      ...validInput,
      status: 'pending',
    });

    expect(result.success).toBe(true);
  });

  it('returns VALIDATION_ERROR for an unknown status', async () => {
    await expectResult(
      listPatientConsentForms(
        mockDb as never,
        {
          ...validInput,
          status: 'archived',
        } as never
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for a missing leadId', async () => {
    await expectResult(
      listPatientConsentForms(mockDb as never, { ...validInput, leadId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on database failure', async () => {
    mockDb.query.consentFormSubmission.findMany.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      listPatientConsentForms(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
