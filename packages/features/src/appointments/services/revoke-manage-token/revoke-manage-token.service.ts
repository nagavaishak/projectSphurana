import { appointmentManageToken } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { hashManageToken } from '../../shared/manage-token.js';
import {
  type RevokeManageTokenInput,
  revokeManageTokenSchema,
} from './revoke-manage-token.schema.js';

/**
 * Drop a single manage-booking capability, identified by its raw token.
 *
 * The counterpart to `issueManageToken({ replaceExisting: false })`: a caller
 * that mints a token as a short-lived internal credential retires exactly that
 * one afterwards, leaving every other live link for the appointment — the ones
 * already sitting in the patient's confirmation and reminder emails — alone.
 *
 * Scoped by `appointmentId` as well as the hash so a token can only ever be
 * revoked against the appointment it belongs to.
 */
const revokeManageTokenImpl = async (
  db: DbConnection,
  input: RevokeManageTokenInput
): Promise<Result<{ revoked: boolean }>> => {
  const parsed = revokeManageTokenSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { appointmentId, token } = parsed.data;

  try {
    const deleted = await db
      .delete(appointmentManageToken)
      .where(
        and(
          eq(appointmentManageToken.appointmentId, appointmentId),
          eq(appointmentManageToken.tokenHash, hashManageToken(token))
        )
      )
      .returning({ id: appointmentManageToken.id });

    return ok({ revoked: deleted.length > 0 });
  } catch (error) {
    logError('appointments.revokeManageToken', error, {
      feature: 'appointments',
      extra: { appointmentId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to revoke manage token'
      )
    );
  }
};

export const revokeManageToken = (
  db: DbConnection,
  input: RevokeManageTokenInput
) =>
  trackedResult(
    'appointments.revokeManageToken',
    () => revokeManageTokenImpl(db, input),
    { properties: { appointmentId: input.appointmentId } }
  );

export type RevokeManageTokenResult = Awaited<
  ReturnType<typeof revokeManageToken>
>;
