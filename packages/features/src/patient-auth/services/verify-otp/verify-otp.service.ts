import {
  patientAuth as patientAuthInstance,
  runWithPatientAuthContext,
} from '@borradh-workspace/auth/patient';
import {
  isUniqueViolation,
  withSystemScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
} from '../../../shared/index.js';
import { findOrgBySlug } from '../shared/lookups.js';
import { ensurePortalMembershipByEmail } from '../shared/membership.js';
import {
  type PatientSignInData,
  finalizePatientSignIn,
} from '../shared/sign-in.js';
import { type VerifyOtpInput, verifyOtpSchema } from './verify-otp.schema.js';

export type { PatientSignInData };

/** One generic failure for every distinct cause — no oracle. */
const invalid = (): Result<PatientSignInData> =>
  err(new FeatureError(ErrorCodes.UNAUTHORIZED, 'Invalid or expired code'));

const verifyOtpImpl = async (
  tx: DbConnection,
  input: VerifyOtpInput
): Promise<Result<PatientSignInData>> => {
  const parsed = verifyOtpSchema.safeParse(input);
  if (!parsed.success) return invalid();

  const { organizationSlug, email, code } = parsed.data;

  const org = await findOrgBySlug(tx, organizationSlug);
  if (!org) return invalid();

  // Unknown email → generic failure (never reveals membership). Also (re)ensures
  // the BA identity exists so signInEmailOTP (disableSignUp) can find the user.
  // Wrapped: a concurrent FIRST-EVER request for the same email races on the
  // `customer_account` insert, and the loser gets a 23505. `requestOtp` has
  // always caught that; here and in mintMagicLink it escaped to trackedResult
  // as an INTERNAL_ERROR, so two devices tapping "sign in" together turned one
  // of them into a 500 on a request that had actually succeeded. Retry once:
  // the winner has created the row, so the second attempt resolves it.
  let membership: Awaited<ReturnType<typeof ensurePortalMembershipByEmail>>;
  try {
    membership = await ensurePortalMembershipByEmail(
      tx,
      org.id,
      email,
      'allowed'
    );
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    membership = await ensurePortalMembershipByEmail(
      tx,
      org.id,
      email,
      'allowed'
    );
  }
  if (!membership) return invalid();

  try {
    // The org-pin is stamped on the new session by the instance's create hook,
    // reading `organizationId` from this ambient context.
    const { headers } = await runWithPatientAuthContext(
      { organizationId: org.id },
      () =>
        patientAuthInstance.api.signInEmailOTP({
          body: { email, otp: code },
          returnHeaders: true,
        })
    );

    return finalizePatientSignIn(tx, {
      headers,
      customerAccountId: membership.customerAccountId,
      leadId: membership.leadId,
      email: membership.email,
      firstName: membership.firstName,
      lastName: membership.lastName,
      // They read a code out of the mailbox just now, so mailbox control is
      // proven at this moment: full-length session.
      method: 'otp',
    });
  } catch {
    // BA throws a generic APIError on wrong / expired / too-many-attempts.
    return invalid();
  }
};

/**
 * Verify an emailed sign-in code and establish a session.
 *
 * `withSystemScope`: session validation IS the step that establishes the
 * patient principal, and the domain writes hit zero-policy tables reachable
 * only on the system connection (mirrors how BA reads its own tables).
 */
export const verifyOtp = (db: DbConnection, input: VerifyOtpInput) =>
  trackedResult(
    'patientAuth.verifyOtp',
    () => withSystemScope((tx) => verifyOtpImpl(tx, input), { db }),
    { internalErrorsOnly: true, trackSuccess: false }
  );

export type VerifyOtpResult = Awaited<ReturnType<typeof verifyOtp>>;
