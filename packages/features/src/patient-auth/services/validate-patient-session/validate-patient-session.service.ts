import {
  patientAuth as patientAuthInstance,
  patientSessionCookieHeader,
} from '@borradh-workspace/auth/patient';
import { withSystemScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { findOrgBySlug } from '../shared/lookups.js';
import { resolvePatientPrincipal } from '../shared/membership.js';
import {
  type ValidatePatientSessionInput,
  validatePatientSessionSchema,
} from './validate-patient-session.schema.js';

export interface ValidatedPatientSession {
  patientAuthId: string;
  leadId: string;
  organizationId: string;
  customerAccountId: string;
  expiresAt: Date;
}

/**
 * Resolve a raw session token (httpOnly cookie / bearer) PLUS the requested
 * clinic (the `X-Portal-Org` slug) to the signed-in patient's per-org
 * identity. Called by the API's PatientAuthGuard on every guarded request.
 *
 * BA-backed: the token is validated by `patientAuth.api.getSession` (the token
 * is a SIGNED cookie value). Then the session's org-PIN additional field must
 * match the requested clinic (Blocker 1 — a session minted for clinic A can't
 * act at clinic B), and a `patient_auth` membership must exist there. Every
 * failure returns the SAME generic UNAUTHORIZED so a stolen cookie can't probe
 * which clinics a person attends.
 */
const validatePatientSessionImpl = async (
  tx: DbConnection,
  input: ValidatePatientSessionInput
): Promise<Result<ValidatedPatientSession>> => {
  const parsed = validatePatientSessionSchema.safeParse(input);
  if (!parsed.success) {
    return err(new FeatureError(ErrorCodes.UNAUTHORIZED, 'Invalid session'));
  }

  const { sessionToken, organizationSlug } = parsed.data;

  const generic = () =>
    err(
      new FeatureError(ErrorCodes.UNAUTHORIZED, 'Invalid or expired session')
    );

  try {
    const org = await findOrgBySlug(tx, organizationSlug);
    if (!org) return generic();

    const result = await patientAuthInstance.api.getSession({
      headers: new Headers({
        cookie: await patientSessionCookieHeader(sessionToken),
      }),
    });
    if (!result?.session) return generic();

    // Blocker 1: the session is pinned to its minting clinic.
    if (result.session.organizationId !== org.id) return generic();

    const customerAccountId = result.user.id;
    const principal = await resolvePatientPrincipal(
      tx,
      customerAccountId,
      org.id
    );
    if (!principal) return generic();

    return ok({
      patientAuthId: principal.patientAuthId,
      leadId: principal.leadId,
      organizationId: principal.organizationId,
      customerAccountId,
      expiresAt: result.session.expiresAt,
    });
  } catch (error) {
    logError('patientAuth.validatePatientSession', error, {
      feature: 'patient-auth',
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to validate session')
    );
  }
};

export const validatePatientSession = (
  db: DbConnection,
  input: ValidatePatientSessionInput
) =>
  trackedResult(
    'patientAuth.validatePatientSession',
    () =>
      withSystemScope((tx) => validatePatientSessionImpl(tx, input), { db }),
    { internalErrorsOnly: true, trackSuccess: false }
  );

export type ValidatePatientSessionResult = Awaited<
  ReturnType<typeof validatePatientSession>
>;
