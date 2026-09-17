/**
 * Patient-portal API types — a straight move from
 * apps/app/src/features/patient-portal/api/types.ts.
 *
 * `PatientAuthResponse.token` is deliberately NOT modelled here. The API still
 * returns it, but on a microsite the session is the httpOnly cookie and
 * nothing may read or store that token — see src/lib/patient-fetch.ts. Typing
 * it would be an invitation.
 */

/** Response of GET patient/me. */
export interface CurrentPatient {
  leadId: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  phone: string | null;
  organizationId: string;
  /** The clinic's note to this customer. Never `lead.notes` (staff-internal). */
  portalNote: string | null;
}

/** POST public/patient-auth/request-otp — always 202, neutral. */
export interface RequestOtpInput {
  email: string;
  organizationSlug: string;
}

/** POST public/patient-auth/verify-otp. */
export interface VerifyOtpInput {
  email: string;
  organizationSlug: string;
  code: string;
}

/** POST public/patient-auth/verify-magic-link. */
export interface VerifyMagicLinkInput {
  token: string;
  organizationSlug: string;
}

/**
 * What the portal keeps from verify-otp / verify-magic-link.
 *
 * The session itself arrives as a Set-Cookie on the same response (proxied
 * first-party by src/pages/api/[...path].ts). The body's `token` field is
 * ignored on purpose.
 */
export interface PatientAuthResponse {
  patient: {
    firstName: string | null;
    lastName: string | null;
    email: string;
  };
}

/** Minimal clinic branding for the portal chrome. */
export interface OrgBranding {
  organizationName: string;
  organizationSlug: string;
  organizationLogo: string | null;
}

/** The branch a booking is at, as returned inside GET patient/bookings. */
export interface PatientBookingLocation {
  id: string;
  /** "Dublin Branch". Null on branches nobody named — render the address. */
  name: string | null;
  /**
   * The branch's public slug. Null on a pre-backfill row, in which case the
   * server has already refused online rescheduling for any org where the
   * omission would resolve a DIFFERENT branch (see `canReschedule`).
   */
  slug: string | null;
  /** Postal address, one line per part. */
  addressLines: string[];
}

/** One booking as returned by GET patient/bookings (dates are ISO strings). */
export interface PatientBooking {
  id: string;
  serviceName: string;
  practitionerName: string | null;
  startTime: string;
  endTime: string;
  status:
    | 'booked'
    | 'confirmed'
    | 'arrived'
    | 'started'
    | 'completed'
    | 'no_show'
    | 'cancelled';
  /** Null means the booking can't be rescheduled online. */
  serviceId: string | null;
  durationMinutes: number;
  /**
   * The branch this booking is at. Optional for contract tolerance and null
   * when the appointment carries no branch — either way the UI shows nothing
   * rather than the clinic's primary address, which is not where the patient
   * is going.
   */
  location?: PatientBookingLocation | null;
  /**
   * Clinic allows online cancellations AND the booking is still actionable
   * AND the cancellation notice window hasn't passed. Drives the Cancel CTA.
   */
  canCancel?: boolean;
  /**
   * Last instant the booking may still be cancelled online (ISO) —
   * `startTime - noticeHours`. Null when cancellations are disabled or no
   * notice is required.
   */
  cancelDeadline?: string | null;
  /**
   * Same computation against the org's rescheduling notice window, AND
   * whether this booking's branch can be named to the public slots endpoint.
   * A multi-branch clinic whose branch slugs have not been backfilled reports
   * false here rather than have the portal offer another branch's times.
   */
  canReschedule?: boolean;
}

export interface PatientBookingsResponse {
  upcoming: PatientBooking[];
  past: PatientBooking[];
  /** The clinic's IANA timezone — render times in it, not the browser's. */
  timezone: string;
}

/** Statuses a patient can still act on (mirrors activeAppointmentStatuses). */
export const ACTIONABLE_BOOKING_STATUSES: ReadonlySet<
  PatientBooking['status']
> = new Set(['booked', 'confirmed']);

/**
 * Consent-form field/status unions.
 *
 * apps/app imported these from `@borradh-workspace/labels`. marketing-astro
 * deliberately does not depend on the backend packages (see the api-client
 * shim), so the two values the portal actually branches on are inlined. Any
 * unrecognised field type falls through to a text input.
 */
export type ConsentFormFieldType = 'text' | 'date' | 'checkbox' | (string & {});
export type ConsentFormSubmissionStatus =
  | 'pending'
  | 'completed'
  | (string & {});

export interface PatientConsentFormField {
  type: ConsentFormFieldType;
  label: string;
}

/** Response of GET patient/consent-forms/:id. */
export interface PatientConsentForm {
  id: string;
  status: ConsentFormSubmissionStatus;
  templateSnapshot: {
    title: string;
    body: string;
    fields: PatientConsentFormField[];
    requiresSignature: boolean;
  };
  fieldData: Record<string, string | boolean>;
  signedByName?: string | null;
  signedAt?: string | null;
}

/** Minimal shape the pending-forms banner needs; tolerant of extra fields. */
export interface PendingConsentForm {
  id: string;
  [key: string]: unknown;
}

/** Serialized `patient_document` as returned by GET patient/documents. */
export interface PatientDocumentItem {
  id: string;
  leadId: string;
  uploadedByType: 'patient' | 'staff' | (string & {});
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface PatientDocumentListResponse {
  items: PatientDocumentItem[];
}

/** `POST patient/documents/presign` response — single-PUT upload target. */
export interface PresignPatientDocumentResponse {
  url: string;
  key: string;
  expiresIn: number;
}

/** Short-lived presigned GET for opening a stored document. */
export interface DocumentDownloadUrlResponse {
  url: string;
  expiresIn: number;
  fileName: string;
  mimeType: string;
}

/** Mirrors the server-side allowlist + 15MB cap (presign re-validates). */
export const PATIENT_DOCUMENT_MAX_SIZE_BYTES = 15 * 1024 * 1024;

export const PATIENT_DOCUMENT_ACCEPT =
  'application/pdf,image/jpeg,image/png,image/heic,image/webp';

/** One offered reschedule slot (same shape the public booking page uses). */
export interface TimeSlot {
  startTime: string;
  endTime?: string;
}

export interface AvailableSlotsResponse {
  slots: TimeSlot[];
}
