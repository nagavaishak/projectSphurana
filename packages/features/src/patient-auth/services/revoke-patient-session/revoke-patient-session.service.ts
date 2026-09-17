import {
  patientAuth as patientAuthInstance,
  patientSessionCookieHeader,
} from '@borradh-workspace/auth/patient';
import { patientSession, withSystemScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { type DbConnection, type Result, ok } from '../../../shared/index.js';
import {
  type RevokePatientSessionInput,
  revokePatientSessionSchema,
} from './revoke-patient-session.schema.js';

/**
 * Revoke (sign out) a patient session. Best-effort: BA's signOut deletes the
 * presented session row; whether or not it succeeds, the controller clears the
 * cookie and the client drops its token, so a failed revoke can never strand a
 * signed-in-looking session.
 */
const revokePatientSessionImpl = async (
  db: DbConnection,
  input: RevokePatientSessionInput
): Promise<Result<{ revoked: true }>> => {
  const parsed = revokePatientSessionSchema.safeParse(input);
  if (!parsed.success) return ok({ revoked: true });

  // `everywhere`: resolve the account from the presented session, then drop
  // every row it owns. Done BEFORE signOut, which deletes the presented
  // session and would leave us nothing to resolve from.
  if (parsed.data.scope === 'everywhere') {
    try {
      const current = await patientAuthInstance.api.getSession({
        headers: new Headers({
          cookie: await patientSessionCookieHeader(parsed.data.sessionToken),
        }),
      });
      const userId = current?.user?.id;
      if (userId) {
        await withSystemScope(
          (tx) =>
            tx.delete(patientSession).where(eq(patientSession.userId, userId)),
          { db }
        );
        // Every row is gone, including the presented one — nothing left to
        // sign out of.
        return ok({ revoked: true });
      }
    } catch {
      // Fall through to the single-session revoke: signing out of THIS device
      // is strictly better than signing out of nothing.
    }
  }

  try {
    await patientAuthInstance.api.signOut({
      headers: new Headers({
        cookie: await patientSessionCookieHeader(parsed.data.sessionToken),
      }),
    });
  } catch {
    // Best-effort — already-invalid tokens are a no-op from the client's view.
  }
  return ok({ revoked: true });
};

export const revokePatientSession = (
  db: DbConnection,
  input: RevokePatientSessionInput
) =>
  trackedResult(
    'patientAuth.revokePatientSession',
    () => revokePatientSessionImpl(db, input),
    { trackSuccess: false, internalErrorsOnly: true }
  );

export type RevokePatientSessionResult = Awaited<
  ReturnType<typeof revokePatientSession>
>;
