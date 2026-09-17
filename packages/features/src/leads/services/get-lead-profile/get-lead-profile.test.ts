import {
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { getLeadProfile } from './get-lead-profile.service.js';

const mocks = {
  leadFindFirst: vi.fn(),
  appointmentFindMany: vi.fn(),
  submissionFindMany: vi.fn(),
  documentImportFindMany: vi.fn(),
  documentFindMany: vi.fn(),
  patientAuthFindFirst: vi.fn(),
};

const mockDb = {
  query: {
    lead: { findFirst: mocks.leadFindFirst },
    appointment: { findMany: mocks.appointmentFindMany },
    consentFormSubmission: { findMany: mocks.submissionFindMany },
    documentImport: { findMany: mocks.documentImportFindMany },
    patientDocument: { findMany: mocks.documentFindMany },
    patientAuth: { findFirst: mocks.patientAuthFindFirst },
  },
} as never;

const validInput = { organizationId: 'org_123', leadId: 'lead_123' };

const mockLead = {
  id: 'lead_123',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  phone: '+3530155501',
  whatsapp: null,
  source: 'manual',
  status: 'new',
  tags: ['vip'],
  notes: 'Prefers mornings.',
  consentEmail: true,
  consentSms: false,
  consentVoice: false,
  createdAt: new Date('2025-01-01T00:00:00Z'),
};

describe('getLeadProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.leadFindFirst.mockResolvedValue(mockLead);
    mocks.appointmentFindMany.mockResolvedValue([]);
    mocks.submissionFindMany.mockResolvedValue([]);
    mocks.documentImportFindMany.mockResolvedValue([]);
    mocks.documentFindMany.mockResolvedValue([]);
    mocks.patientAuthFindFirst.mockResolvedValue(undefined);
  });

  it('aggregates lead, appointments, submissions and documents', async () => {
    mocks.appointmentFindMany.mockResolvedValueOnce([
      {
        id: 'appt_1',
        title: 'Consultation',
        startDate: new Date('2025-06-01T10:00:00Z'),
        endDate: new Date('2025-06-01T10:30:00Z'),
        status: 'completed',
        service: { name: 'Skin Consultation' },
      },
      {
        id: 'appt_2',
        title: 'Follow-up',
        startDate: new Date('2025-05-01T10:00:00Z'),
        endDate: new Date('2025-05-01T10:30:00Z'),
        status: 'cancelled',
        service: null,
      },
    ]);
    mocks.submissionFindMany.mockResolvedValueOnce([
      {
        id: 'sub_1',
        templateSnapshot: {
          title: 'Laser Consent',
          body: '...',
          fields: [],
          requiresSignature: true,
        },
        status: 'completed',
        appointmentId: 'appt_1',
        signedByName: 'Jane Doe',
        signedAt: new Date('2025-05-30T09:00:00Z'),
        sentAt: new Date('2025-05-28T09:00:00Z'),
      },
    ]);
    mocks.documentFindMany.mockResolvedValueOnce([
      {
        id: 'doc_1',
        fileName: 'referral.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        uploadedByType: 'patient',
        blobUrl: 'https://example.com/referral.pdf',
        createdAt: new Date('2025-05-20T09:00:00Z'),
      },
    ]);
    mocks.patientAuthFindFirst.mockResolvedValueOnce({
      id: 'pa_1',
      lastLoginAt: new Date('2025-05-30T08:55:00Z'),
    });

    const result = await getLeadProfile(mockDb, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lead.id).toBe('lead_123');
      expect(result.data.lead.notes).toBe('Prefers mornings.');
      expect(result.data.appointments).toHaveLength(2);
      // Service name is flattened; missing service maps to null.
      expect(result.data.appointments[0].serviceName).toBe('Skin Consultation');
      expect(result.data.appointments[1].serviceName).toBeNull();
      // The submission title comes from the frozen template snapshot.
      expect(result.data.consentFormSubmissions).toEqual([
        {
          id: 'sub_1',
          title: 'Laser Consent',
          status: 'completed',
          appointmentId: 'appt_1',
          signedByName: 'Jane Doe',
          signedAt: new Date('2025-05-30T09:00:00Z'),
          sentAt: new Date('2025-05-28T09:00:00Z'),
        },
      ]);
      expect(result.data.documents).toHaveLength(1);
      expect(result.data.hasPortalAccount).toBe(true);
    }
  });

  it('returns empty collections for a lead with no history', async () => {
    const result = await getLeadProfile(mockDb, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.appointments).toEqual([]);
      expect(result.data.consentFormSubmissions).toEqual([]);
      expect(result.data.documents).toEqual([]);
      expect(result.data.hasPortalAccount).toBe(false);
    }
  });

  it('reports hasPortalAccount=false for a membership that has never signed in (null lastLoginAt)', async () => {
    mocks.patientAuthFindFirst.mockResolvedValueOnce({
      id: 'pa_1',
      lastLoginAt: null,
    });

    const result = await getLeadProfile(mockDb, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hasPortalAccount).toBe(false);
    }
  });

  it('returns NOT_FOUND when the lead does not exist in this organization', async () => {
    mocks.leadFindFirst.mockResolvedValueOnce(undefined);

    await expectResult(getLeadProfile(mockDb, validInput)).toFailWithCode(
      ErrorCodes.NOT_FOUND
    );
    // No point fanning out once the anchor row is missing.
    expect(mocks.appointmentFindMany).not.toHaveBeenCalled();
    expect(mocks.patientAuthFindFirst).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for an empty leadId', async () => {
    await expectResult(
      getLeadProfile(mockDb, { organizationId: 'org_123', leadId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mocks.leadFindFirst).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for an empty organizationId', async () => {
    await expectResult(
      getLeadProfile(mockDb, { organizationId: '', leadId: 'lead_123' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mocks.leadFindFirst).not.toHaveBeenCalled();
  });

  /**
   * Paper consent forms live in a different table from digital ones and
   * cannot be moved: `consent_form_submission` requires an appointment and a
   * template, and a form signed on a clipboard has neither. Surfacing them on
   * the profile is what lets one tab answer "has this client consented?"
   * without the answer depending on which system happened to capture it.
   */
  it('includes consent forms that arrived on paper via the importer', async () => {
    mocks.documentImportFindMany.mockResolvedValueOnce([
      {
        id: 'imp_1',
        patientDocumentId: 'doc_9',
        fileName: 'consent-signed.pdf',
        processedAt: new Date('2026-08-27T10:00:00Z'),
        createdAt: new Date('2026-08-27T09:00:00Z'),
      },
    ]);

    const result = await getLeadProfile(mockDb, validInput);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.uploadedConsentForms).toEqual([
      {
        id: 'imp_1',
        documentId: 'doc_9',
        fileName: 'consent-signed.pdf',
        // Filed-at, not imported-at: when the matcher actually placed it.
        filedAt: new Date('2026-08-27T10:00:00Z'),
      },
    ]);
  });

  it('falls back to the import date when the row was never processed', async () => {
    mocks.documentImportFindMany.mockResolvedValueOnce([
      {
        id: 'imp_2',
        patientDocumentId: 'doc_10',
        fileName: 'consent.pdf',
        processedAt: null,
        createdAt: new Date('2026-08-26T09:00:00Z'),
      },
    ]);

    const result = await getLeadProfile(mockDb, validInput);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.uploadedConsentForms[0].filedAt).toEqual(
      new Date('2026-08-26T09:00:00Z')
    );
  });

  /**
   * One home per document. A consent form surfaced on the Consent tab is
   * taken out of Documents rather than listed twice — but only the ones the
   * importer classified: a file dropped straight into the vault has no
   * documentKind to route on and must stay where it was put.
   */
  it('moves a consent form out of Documents rather than showing it twice', async () => {
    mocks.documentImportFindMany.mockResolvedValueOnce([
      {
        id: 'imp_1',
        patientDocumentId: 'doc_consent',
        fileName: 'consent-signed.pdf',
        processedAt: new Date('2026-08-27T10:00:00Z'),
        createdAt: new Date('2026-08-27T09:00:00Z'),
      },
    ]);
    mocks.documentFindMany.mockResolvedValueOnce([
      { id: 'doc_consent', fileName: 'consent-signed.pdf' },
      { id: 'doc_other', fileName: 'referral.pdf' },
    ]);

    const result = await getLeadProfile(mockDb, validInput);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.documents.map((d) => d.id)).toEqual(['doc_other']);
    expect(result.data.uploadedConsentForms.map((f) => f.documentId)).toEqual([
      'doc_consent',
    ]);
  });

  it('leaves a directly-uploaded vault file in Documents', async () => {
    mocks.documentImportFindMany.mockResolvedValueOnce([]);
    mocks.documentFindMany.mockResolvedValueOnce([
      { id: 'doc_direct', fileName: 'consent-on-paper.pdf' },
    ]);

    const result = await getLeadProfile(mockDb, validInput);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.documents.map((d) => d.id)).toEqual(['doc_direct']);
  });
});
