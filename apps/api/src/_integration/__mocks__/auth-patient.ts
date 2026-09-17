/**
 * Stub for @borradh-workspace/auth/patient (the SECOND better-auth instance).
 *
 * Same reason as the `auth-server` stub next to this file: better-auth ships
 * ESM-only, and the integration suite requires the built dist from CJS — an
 * un-stubbed import fails the whole suite at load with "Cannot use import
 * statement outside a module", before a single test runs.
 *
 * It reaches this harness transitively and unavoidably: every controller that
 * imports `@borradh-workspace/features/appointments` pulls in
 * send-appointment-reminder → patient-auth → request-otp → this module. That
 * is why 12 of 16 suites failed to load rather than a handful of portal ones.
 *
 * Only enough surface to LOAD. PatientAuthGuard is overridden in the harness,
 * so none of these are actually invoked — anything that would need real
 * behaviour belongs in a portal-specific test with its own explicit mock, not
 * here.
 */

export interface PatientAuthCallContext {
  organizationId?: string;
  organizationSlug?: string;
}

export const runWithPatientAuthContext = <T>(
  _context: PatientAuthCallContext,
  operation: () => T
): T => operation();

export const patientAuth = {
  api: {
    // Never called: PatientAuthGuard is overridden in the harness.
    getSession: async () => null,
  },
};

export type PatientAuth = typeof patientAuth;

export const getPatientSessionCookieName = async (): Promise<string> =>
  'borradh_patient_session';

export const extractPatientSessionToken = async (): Promise<string | null> =>
  null;

export const patientSessionCookieHeader = async (): Promise<string> => '';

export const bindOrgToMagicToken = (
  baToken: string,
  organizationId: string
): string => `${baToken}.${organizationId}.stub`;

export const unbindOrgFromMagicToken = (
  _composite: string
): { baToken: string; organizationId: string } | null => null;
