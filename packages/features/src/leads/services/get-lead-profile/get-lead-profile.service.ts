import {
  type Appointment,
  type ConsentFormSubmission,
  type Lead,
  type PatientDocument,
  appointment,
  consentFormSubmission,
  documentImport,
  lead,
  patientAuth,
  patientDocument,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type GetLeadProfileInput,
  getLeadProfileSchema,
} from './get-lead-profile.schema.js';

/** How many appointments the profile returns (most recent first). */
const APPOINTMENTS_LIMIT = 50;

/**
 * The trimmed lead identity block for the profile header + Notes tab.
 *
 * Deliberately includes every field `buildUpdateLeadPayload` round-trips
 * (source/status/tags/consent flags), so a notes-only save through the shared
 * update-lead form intent cannot silently blank the other fields.
 */
export type LeadProfileLead = Pick<
  Lead,
  | 'id'
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'phone'
  | 'whatsapp'
  | 'source'
  | 'status'
  | 'tags'
  | 'notes'
  | 'portalNote'
  | 'consentEmail'
  | 'consentSms'
  | 'consentVoice'
  | 'createdAt'
>;

/** One appointment row for the Bookings tab, with its service name resolved. */
export interface LeadProfileAppointment {
  id: string;
  title: string;
  startDate: Date;
  endDate: Date;
  status: Appointment['status'];
  serviceName: string | null;
}

/** One consent-form submission row for the Forms tab. */
export interface LeadProfileConsentFormSubmission {
  id: string;
  /** From the frozen `templateSnapshot` — what the patient actually saw. */
  title: string;
  status: ConsentFormSubmission['status'];
  appointmentId: string;
  signedByName: string | null;
  signedAt: Date | null;
  sentAt: Date | null;
}

/** One document row for the Documents tab. */
export type LeadProfileDocument = Pick<
  PatientDocument,
  | 'id'
  | 'fileName'
  | 'mimeType'
  | 'sizeBytes'
  | 'uploadedByType'
  | 'blobUrl'
  | 'createdAt'
>;

/**
 * Everything the clinic-side patient profile page needs, in one read.
 */
/**
 * A consent form that arrived on paper — scanned or photographed and run
 * through the bulk importer, which classified it as a consent form and filed
 * it against this client.
 *
 * These have no `consent_form_submission` row and cannot have one: that table
 * requires an appointment and a template, and a form signed on a clipboard has
 * neither. They are still consent forms though, and a nurse looking for "did
 * this client consent?" should not have to know which of two systems captured
 * it. `documentId` points at the filed copy in the client's documents, which
 * is what the download opens.
 */
export interface LeadProfileUploadedConsentForm {
  id: string;
  documentId: string;
  fileName: string;
  /** When the matcher filed it, falling back to when it was imported. */
  filedAt: Date;
}

export interface LeadProfile {
  lead: LeadProfileLead;
  appointments: LeadProfileAppointment[];
  consentFormSubmissions: LeadProfileConsentFormSubmission[];
  uploadedConsentForms: LeadProfileUploadedConsentForm[];
  documents: LeadProfileDocument[];
  /**
   * True when the patient has an activated portal account — a `patient_auth`
   * row with a set password. A row with a null hash is a staff-created
   * account the patient never activated, so it doesn't count.
   */
  hasPortalAccount: boolean;
}

/**
 * Internal implementation of get lead profile
 */
const getLeadProfileImpl = async (
  db: DbConnection,
  input: GetLeadProfileInput
): Promise<Result<LeadProfile>> => {
  // Validate input
  const parsed = getLeadProfileSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { leadId, organizationId } = parsed.data;

  // The lead row anchors everything — explicit org check on top of RLS.
  const leadRow = await db.query.lead.findFirst({
    where: and(
      eq(lead.id, leadId),
      eq(lead.organizationId, organizationId),
      isNull(lead.deletedAt)
    ),
    columns: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      whatsapp: true,
      source: true,
      status: true,
      tags: true,
      notes: true,
      portalNote: true,
      consentEmail: true,
      consentSms: true,
      consentVoice: true,
      createdAt: true,
    },
  });

  if (!leadRow) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        `Lead with ID ${leadId} not found`,
        { leadId }
      )
    );
  }

  const [
    appointmentRows,
    submissionRows,
    uploadedConsentRows,
    documentRows,
    authRow,
  ] = await Promise.all([
    db.query.appointment.findMany({
      where: and(
        eq(appointment.leadId, leadId),
        eq(appointment.organizationId, organizationId),
        isNull(appointment.deletedAt)
      ),
      orderBy: [desc(appointment.startDate)],
      limit: APPOINTMENTS_LIMIT,
      columns: {
        id: true,
        title: true,
        startDate: true,
        endDate: true,
        status: true,
      },
      with: {
        service: { columns: { name: true } },
      },
    }),
    db.query.consentFormSubmission.findMany({
      where: and(
        eq(consentFormSubmission.leadId, leadId),
        eq(consentFormSubmission.organizationId, organizationId)
      ),
      orderBy: [desc(consentFormSubmission.createdAt)],
      columns: {
        id: true,
        templateSnapshot: true,
        status: true,
        appointmentId: true,
        signedByName: true,
        signedAt: true,
        sentAt: true,
      },
    }),
    // Consent forms that came in on paper. Filed only — an import still
    // waiting on review belongs to whoever is reviewing it, not to this
    // client's record, and `patientDocumentId` is exactly the line between
    // the two.
    db.query.documentImport.findMany({
      where: and(
        eq(documentImport.matchedLeadId, leadId),
        eq(documentImport.organizationId, organizationId),
        eq(documentImport.documentKind, 'consent_form'),
        isNotNull(documentImport.patientDocumentId),
        isNull(documentImport.deletedAt)
      ),
      orderBy: [desc(documentImport.createdAt)],
      columns: {
        id: true,
        patientDocumentId: true,
        fileName: true,
        processedAt: true,
        createdAt: true,
      },
    }),
    db.query.patientDocument.findMany({
      where: and(
        eq(patientDocument.leadId, leadId),
        eq(patientDocument.organizationId, organizationId),
        isNull(patientDocument.deletedAt)
      ),
      orderBy: [desc(patientDocument.createdAt)],
      columns: {
        id: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        uploadedByType: true,
        blobUrl: true,
        createdAt: true,
      },
    }),
    db.query.patientAuth.findFirst({
      where: eq(patientAuth.leadId, leadId),
      columns: { id: true, lastLoginAt: true },
    }),
  ]);

  const consentDocumentIds = new Set(
    uploadedConsentRows
      .map((row) => row.patientDocumentId)
      .filter((id): id is string => id !== null)
  );

  return ok({
    lead: leadRow,
    appointments: appointmentRows.map(({ service, ...row }) => ({
      ...row,
      serviceName: service?.name ?? null,
    })),
    consentFormSubmissions: submissionRows.map(
      ({ templateSnapshot, ...row }) => ({
        ...row,
        title: templateSnapshot.title,
      })
    ),
    uploadedConsentForms: uploadedConsentRows.flatMap((row) =>
      // `patientDocumentId` is non-null by the query above; the guard is for
      // the type, not the data.
      row.patientDocumentId
        ? [
            {
              id: row.id,
              documentId: row.patientDocumentId,
              fileName: row.fileName,
              filedAt: row.processedAt ?? row.createdAt,
            },
          ]
        : []
    ),
    // Consent forms have their own tab, so they are taken OUT of this list
    // rather than shown twice. Only importer-classified ones move: a file
    // dropped straight into the vault has no `documentKind` to route on and
    // stays exactly where it was put.
    documents: documentRows.filter((row) => !consentDocumentIds.has(row.id)),
    // Portal v2 is passwordless and memberships are auto-created on demand,
    // so a bare `patient_auth` row no longer means the patient ever used the
    // portal — "has signed in at least once" is the truthful signal now.
    hasPortalAccount: authRow?.lastLoginAt != null,
  });
};

/**
 * Unified clinic-side patient profile (ENG-647 Phase 5): the lead, its
 * appointments (with service names), consent-form submissions, documents and
 * portal-account status — one aggregate read instead of four waterfalled ones.
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - `{ organizationId, leadId }`
 * @returns Result with the profile or NOT_FOUND when the lead doesn't exist
 *   in this organization (or is soft-deleted)
 */
export const getLeadProfile = (db: DbConnection, input: GetLeadProfileInput) =>
  trackedResult(
    'leads.getLeadProfile',
    () => withOrgScope((tx) => getLeadProfileImpl(tx, input), { db }),
    {
      properties: {
        leadId: input.leadId,
        organizationId: input.organizationId,
      },
      internalErrorsOnly: true,
    }
  );

/**
 * Result type for getLeadProfile
 */
export type GetLeadProfileResult = Awaited<ReturnType<typeof getLeadProfile>>;
