import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import type {
  AppointmentStatus,
  LeadSource,
  LeadStatus,
} from '@borradh-workspace/api-client/types';
import { queryOptions, useQuery } from '@tanstack/react-query';

/**
 * Response types for `GET leads/:id/profile` (ENG-647 Phase 5).
 *
 * Kept self-contained in this feature: mirrors the backend `LeadProfile`
 * aggregate from `@borradh-workspace/features/leads` with dates serialized to
 * ISO strings (the standard Serialize<T> transformation).
 */
export interface LeadProfileLead {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  source: LeadSource;
  status: LeadStatus;
  tags: string[] | null;
  /** Staff-internal commentary — never shown to the customer. */
  notes: string | null;
  /** The clinic's note TO the customer, shown in their portal. */
  portalNote: string | null;
  consentEmail: boolean;
  consentSms: boolean;
  consentVoice: boolean;
  createdAt: string;
}

export interface LeadProfileAppointment {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  status: AppointmentStatus;
  serviceName: string | null;
}

export type ConsentFormSubmissionStatus = 'pending' | 'completed';

export interface LeadProfileConsentFormSubmission {
  id: string;
  title: string;
  status: ConsentFormSubmissionStatus;
  appointmentId: string;
  signedByName: string | null;
  signedAt: string | null;
  sentAt: string | null;
}

/**
 * A consent form that came in on paper — scanned and run through the bulk
 * importer, which classified it and filed it against this client. No
 * submission row exists (that table needs an appointment and a template, and a
 * clipboard signature has neither), but it is still a consent form and belongs
 * on the same tab.
 */
export interface LeadProfileUploadedConsentForm {
  id: string;
  documentId: string;
  fileName: string;
  filedAt: string;
}

export interface LeadProfileDocument {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByType: 'patient' | 'staff';
  blobUrl: string;
  createdAt: string;
}

export interface LeadProfileResponse {
  lead: LeadProfileLead;
  appointments: LeadProfileAppointment[];
  consentFormSubmissions: LeadProfileConsentFormSubmission[];
  uploadedConsentForms: LeadProfileUploadedConsentForm[];
  documents: LeadProfileDocument[];
  hasPortalAccount: boolean;
}

/**
 * Query options for the unified patient profile.
 *
 * Keyed under the `['leads', …]` prefix so the existing lead mutations
 * (update-lead invalidates `['leads']`) refresh this aggregate too.
 */
export const getLeadProfileQueryOptions = (leadId: string) =>
  queryOptions({
    queryKey: queryKeys.leads.profile(leadId),
    queryFn: () =>
      apiClient.get<LeadProfileResponse>(`leads/${leadId}/profile`),
    enabled: !!leadId,
    staleTime: 60 * 1000,
  });

/**
 * Lead Profile Hook — one fetch feeding every tab of the clinic-side
 * patient profile page (bookings, forms, documents, notes).
 */
export const useLeadProfile = (leadId: string) => {
  const query = useQuery(getLeadProfileQueryOptions(leadId));

  return {
    profile: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
