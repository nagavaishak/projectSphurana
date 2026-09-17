import {
  patientAuth as patientAuthInstance,
  runWithPatientAuthContext,
} from '@borradh-workspace/auth/patient';
import {
  isUniqueViolation,
  patientVerification,
  withSystemScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, desc, eq, gt } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { findOrgBySlug } from '../shared/lookups.js';
import { ensurePortalMembershipByEmail } from '../shared/membership.js';
import {
  type RequestOtpInput,
  requestOtpSchema,
} from './request-otp.schema.js';

/** Sign-in codes are short-lived — 10 minutes (matches the BA instance). */
export const OTP_TOKEN_TTL_MS = 10 * 60 * 1000;

/** Don't email a fresh code while one issued < 60s ago is still live. */
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

/**
 * The ONE response shape every path returns. `expiresAt` is computed uniformly
 * whether or not a code was minted — a shape/value that varied by outcome
 * would be an account-existence oracle.
 */
export interface RequestOtpData {
  requested: true;
  expiresAt: Date;
}

const neutral = (): Result<RequestOtpData> =>
  ok({ requested: true, expiresAt: new Date(Date.now() + OTP_TOKEN_TTL_MS) });

/**
 * Was a sign-in OTP for this email minted < 60s ago? BA's emailOTP plugin keys
 * its verification row on `sign-in-otp-<email>`; we own the table, so we read
 * it directly for the resend cooldown. Best-effort: if BA ever changes the
 * identifier format this simply stops throttling (more emails), never a
 * security regression.
 */
const hasRecentOtp = async (
  tx: DbConnection,
  email: string
): Promise<boolean> => {
  const recent = await tx.query.patientVerification.findFirst({
    where: and(
      eq(patientVerification.identifier, `sign-in-otp-${email}`),
      gt(
        patientVerification.createdAt,
        new Date(Date.now() - OTP_RESEND_COOLDOWN_MS)
      )
    ),
    orderBy: [desc(patientVerification.createdAt)],
  });
  return !!recent;
};

/**
 * Drop any earlier sign-in OTP rows for this email before a new one is minted.
 *
 * BA's `allowedAttempts` cap is PER VERIFICATION ROW, and it does not clear
 * prior rows: `findVerificationValue` takes the newest, and when that row
 * exhausts its five guesses BA DELETES it — at which point the next-newest
 * becomes live again with a fresh counter and its own still-valid code. The
 * effective budget was therefore five guesses per row rather than five per
 * account: request a code every 61 seconds (our own resend cooldown is the
 * real limiter, not BA's cap) and roughly fifty guesses fit inside the
 * ten-minute TTL.
 *
 * Not a practical takeover against a six-digit space, but the cap the
 * controller advertises should be the cap that exists — and stale rows
 * otherwise accumulate in `patient_verification` until they expire.
 *
 * Best-effort, like `hasRecentOtp`: if BA changes the identifier format this
 * stops pruning rather than breaking sign-in.
 */
const clearPriorOtps = async (
  tx: DbConnection,
  email: string
): Promise<void> => {
  await tx
    .delete(patientVerification)
    .where(eq(patientVerification.identifier, `sign-in-otp-${email}`));
};

/**
 * Passwordless sign-in, step 1 (Portal v2, BA-backed).
 *
 * SECURITY: nothing here reveals whether an email belongs to a patient of this
 * clinic. Unknown email → create NOTHING, send NOTHING, same neutral response.
 * Known lead → pre-create the universal `customer_account` + `patient_auth`
 * membership (so the BA instance, which has `disableSignUp: true`, can sign
 * them in), then ask BA to mint + email a code. A code minted < 60s ago
 * suppresses the send — still the same neutral ok.
 */
const requestOtpImpl = async (
  tx: DbConnection,
  input: RequestOtpInput
): Promise<Result<RequestOtpData>> => {
  const parsed = requestOtpSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationSlug, email } = parsed.data;

  const org = await findOrgBySlug(tx, organizationSlug);
  if (!org) {
    // The slug is public (it's in the portal URL) — a 404 says nothing about
    // any email.
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
    );
  }

  try {
    const membership = await ensurePortalMembershipByEmail(tx, org.id, email);
    if (!membership) {
      return neutral();
    }

    if (await hasRecentOtp(tx, email)) {
      return neutral();
    }

    // Exactly ONE live code per email: see clearPriorOtps. Runs after the
    // cooldown check, so a rapid resend still short-circuits above rather than
    // churning rows.
    await clearPriorOtps(tx, email);

    // Mint + email the code. `clinicName` reaches the email template via the
    // ambient BA-callback context (AsyncLocalStorage).
    await runWithPatientAuthContext({ clinicName: org.name }, () =>
      patientAuthInstance.api.sendVerificationOTP({
        body: { email, type: 'sign-in' },
      })
    );

    return neutral();
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Concurrent first-ever request for the same email — the other request
      // created the account/membership and sent the code. Neutral stands.
      return neutral();
    }
    logError('patientAuth.requestOtp', error, {
      feature: 'patient-auth',
      extra: { organizationSlug },
    });
    // NEUTRAL, not INTERNAL_ERROR. Everything above that can throw sits AFTER
    // the lead lookup, so an error here is reachable only for an email that
    // IS a patient of this clinic — which made the failure itself the answer
    // to the question this endpoint must never answer. A shaky database or a
    // Better Auth hiccup would have turned the whole surface into an
    // enumeration oracle, no timing measurement required.
    //
    // The failure is not hidden: it is logged above and reaches Sentry. The
    // customer sees "check your email", receives nothing, and retries — the
    // same experience as any dropped message.
    return neutral();
  }
};

/**
 * Request a sign-in code by email.
 *
 * Runs under `withSystemScope`: the domain writes (customer_account,
 * patient_auth) target zero-RLS-policy tables reachable only on the system
 * (BYPASSRLS) connection, and there is no signed-in patient principal yet.
 */
export const requestOtp = (db: DbConnection, input: RequestOtpInput) =>
  trackedResult(
    'patientAuth.requestOtp',
    () => withSystemScope((tx) => requestOtpImpl(tx, input), { db }),
    { properties: { organizationSlug: input.organizationSlug } }
  );

export type RequestOtpResult = Awaited<ReturnType<typeof requestOtp>>;
