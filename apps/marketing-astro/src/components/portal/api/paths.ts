/**
 * Every patient-portal endpoint path lives here so backend contract drift is a
 * one-file fix. Paths are relative — `patientFetch` prefixes `/api`, the
 * same-origin proxy that makes the session cookie first-party.
 */
export const PATIENT_PORTAL_PATHS = {
  /** POST {email, organizationSlug} → always 202 (neutral, no enumeration) */
  requestOtp: 'public/patient-auth/request-otp',
  /** POST {email, organizationSlug, code} → 200 + sets cookie; generic 401 */
  verifyOtp: 'public/patient-auth/verify-otp',
  /** POST {token, organizationSlug} → 200 + sets cookie; single-use */
  verifyMagicLink: 'public/patient-auth/verify-magic-link',
  /** GET → current patient or 401 */
  me: 'patient/me',
  /** POST → revokes the patient session */
  logout: 'patient/logout',
  /** GET → the patient's own bookings, upcoming + past */
  bookings: 'patient/bookings',
  /** GET → the patient's document vault */
  documents: 'patient/documents',
  /** GET → outstanding consent forms */
  pendingForms: 'patient/consent-forms?status=pending',
  /** Public clinic branding — reused from the booking config endpoint. */
  branding: (slug: string) => `public/booking/${slug}`,
} as const;

/**
 * Query keys for the patient-portal cache namespace.
 *
 * Every key is scoped by clinic slug. apps/app learned this the hard way: one
 * customer can be a patient at several clinics, and a slug-less key served
 * clinic A's cached payload on clinic B's page for the whole staleTime window.
 */
export const patientPortalKeys = {
  all: ['patient-portal'] as const,
  scoped: (slug: string) => ['patient-portal', slug] as const,
  me: (slug: string) => ['patient-portal', slug, 'me'] as const,
  branding: (slug: string) => ['patient-portal', slug, 'branding'] as const,
  bookings: (slug: string) => ['patient-portal', slug, 'bookings'] as const,
  documents: (slug: string) => ['patient-portal', slug, 'documents'] as const,
  consentForms: (slug: string) =>
    ['patient-portal', slug, 'consent-forms'] as const,
  consentForm: (slug: string, id: string) =>
    ['patient-portal', slug, 'consent-forms', id] as const,
  pendingForms: (slug: string) =>
    ['patient-portal', slug, 'consent-forms', 'pending'] as const,
  slots: (
    slug: string,
    serviceId: string,
    date: string,
    locationSlug: string | null
  ) =>
    // The branch is part of the key for the same reason it is part of the
    // server's cache key: two branches of one clinic have different diaries on
    // the same (service, day), so a branch-blind key hands Cork whatever
    // Dublin's picker fetched a minute ago.
    ['patient-portal', slug, 'slots', serviceId, date, locationSlug] as const,
};

/**
 * Extract the HTTP status from a thrown error. `PatientApiError` carries
 * `.status`; the `.response.status` branch keeps ky-shaped errors working if
 * one ever reaches this layer.
 */
export function getErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const withResponse = error as { response?: { status?: number } };
  if (typeof withResponse.response?.status === 'number') {
    return withResponse.response.status;
  }
  const withStatus = error as { status?: number };
  if (typeof withStatus.status === 'number') return withStatus.status;
  return undefined;
}
