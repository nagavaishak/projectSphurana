import {
  extractPatientSessionToken,
  patientAuth as patientAuthInstance,
  patientSessionCookieHeader,
} from '@borradh-workspace/auth/patient';
import {
  customerAccount,
  patientAuth,
  patientSession,
} from '@borradh-workspace/database';
import { and, asc, eq, inArray, lt } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';

/**
 * The shape both token-exchange services (verify-otp, verify-magic-link)
 * return — and, minus `sessionToken`/`expiresAt`, what the controller sends to
 * the portal. `sessionToken` is the SIGNED Better Auth cookie value (opaque);
 * the controller places it in the httpOnly cookie and echoes it as the bearer.
 */
export interface PatientSignInData {
  sessionToken: string;
  expiresAt: Date;
  patient: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  };
}

/**
 * How the customer proved who they were. The session they get depends on it.
 *
 * `otp` — they read a code out of the mailbox at that moment, so mailbox
 *   control is proven NOW. Full 30-day session, matching the BA instance's
 *   `session.expiresIn`.
 *
 * `magic-link` — a bearer credential that has been sitting in an inbox, and
 *   may have been forwarded to a partner, read from a shared family mailbox,
 *   or pulled out of a backup. It proves far less, so it buys less: 7 days.
 *   The link's own TTL (24h) bounds how stale that proof can be; this bounds
 *   what it is worth once redeemed.
 */
export type PatientSignInMethod = 'otp' | 'magic-link';

/** Matches the patient BA instance's `session.expiresIn`. */
const OTP_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAGIC_LINK_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Exported so the policy itself is testable without standing up Better Auth.
 * Whether the session ROW is actually shortened is asserted in the API
 * integration suite, where a real session can be read back.
 */
export const patientSessionTtlMs = (method: PatientSignInMethod): number =>
  method === 'magic-link' ? MAGIC_LINK_SESSION_TTL_MS : OTP_SESSION_TTL_MS;

/**
 * Cap on LIVE sessions per customer account. BA does not cap sessions, so
 * without this a scripted sign-in loop grows `patient_session` unbounded. 10
 * comfortably covers real multi-device use; beyond that the oldest sessions
 * are hard-deleted (which revokes them). Also sweeps expired rows.
 */
const MAX_LIVE_SESSIONS = 10;

export const enforcePatientSessionCap = async (
  tx: DbConnection,
  customerAccountId: string
): Promise<void> => {
  const now = new Date();
  await tx
    .delete(patientSession)
    .where(
      and(
        eq(patientSession.userId, customerAccountId),
        lt(patientSession.expiresAt, now)
      )
    );

  const live = await tx.query.patientSession.findMany({
    where: eq(patientSession.userId, customerAccountId),
    orderBy: [asc(patientSession.createdAt)],
    columns: { id: true },
  });
  const excess = live.length - MAX_LIVE_SESSIONS;
  if (excess > 0) {
    await tx.delete(patientSession).where(
      inArray(
        patientSession.id,
        live.slice(0, excess).map((s) => s.id)
      )
    );
  }
};

/**
 * Finalise a successful BA token exchange: pull the signed session cookie value
 * out of BA's `returnHeaders` response, stamp `last_login_at` on both the
 * universal account and the per-org membership, enforce the session cap, and
 * shape the greeting the portal renders.
 */
export const finalizePatientSignIn = async (
  tx: DbConnection,
  params: {
    headers: Headers;
    customerAccountId: string;
    leadId: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    method: PatientSignInMethod;
  }
): Promise<Result<PatientSignInData>> => {
  const sessionToken = await extractPatientSessionToken(params.headers);
  if (!sessionToken) {
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to establish session')
    );
  }

  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + patientSessionTtlMs(params.method)
  );

  // BA stamps every session with the instance-level `session.expiresIn`, so a
  // shorter magic-link session has to be written down — reporting a different
  // `expiresAt` to the client while the ROW still says 30 days would shorten
  // nothing. Resolve the row through BA's own getSession rather than splitting
  // the signed cookie value ourselves: the DB stores the raw token and the
  // cookie is `<token>.<hmac>`, and hand-parsing that couples us to BA's
  // cookie format.
  if (params.method === 'magic-link') {
    try {
      const current = await patientAuthInstance.api.getSession({
        headers: new Headers({
          cookie: await patientSessionCookieHeader(sessionToken),
        }),
      });
      const sessionId = current?.session?.id;
      if (sessionId) {
        await tx
          .update(patientSession)
          .set({ expiresAt })
          .where(eq(patientSession.id, sessionId));
      }
    } catch {
      // Non-fatal: the session is valid, just longer-lived than intended. Never
      // fail a sign-in the customer already completed over this.
    }
  }

  await tx
    .update(customerAccount)
    .set({ lastLoginAt: now })
    .where(eq(customerAccount.id, params.customerAccountId));
  await tx
    .update(patientAuth)
    .set({ lastLoginAt: now })
    .where(eq(patientAuth.leadId, params.leadId));

  await enforcePatientSessionCap(tx, params.customerAccountId);

  return ok({
    sessionToken,
    expiresAt,
    patient: {
      firstName: params.firstName,
      lastName: params.lastName,
      email: params.email,
    },
  });
};
