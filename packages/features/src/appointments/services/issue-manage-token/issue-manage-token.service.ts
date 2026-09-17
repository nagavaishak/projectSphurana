import { appointmentManageToken } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  generateManageToken,
  hashManageToken,
  manageTokenExpiryFor,
} from '../../shared/manage-token.js';
import {
  type IssueManageTokenInput,
  issueManageTokenSchema,
} from './issue-manage-token.schema.js';

/**
 * Mints the patient's manage-booking capability and returns the RAW token —
 * the only moment it exists in plaintext. The caller embeds it in a link and
 * then drops it; we persist only the hash.
 *
 * Idempotent per appointment: re-issuing replaces any existing token. That
 * matters because the same appointment is emailed about more than once
 * (confirmation, then reminders) and every one of those links must work. The
 * alternative — a fresh token per email — would silently break the link in the
 * confirmation the moment a reminder went out.
 */
const issueManageTokenImpl = async (
  db: DbConnection,
  input: IssueManageTokenInput
): Promise<Result<{ token: string; expiresAt: Date }>> => {
  const parsed = issueManageTokenSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, appointmentId, appointmentEnd, replaceExisting } =
    parsed.data;

  const token = generateManageToken();
  const expiresAt = manageTokenExpiryFor(appointmentEnd);

  try {
    // Replace rather than accumulate: one live capability per appointment, so
    // revoking is a single delete and there is no set of stale tokens to reason
    // about. Callers minting an internal, immediately-revoked credential opt
    // out — see `replaceExisting` on the schema.
    if (replaceExisting) {
      await db
        .delete(appointmentManageToken)
        .where(eq(appointmentManageToken.appointmentId, appointmentId));
    }

    await db.insert(appointmentManageToken).values({
      organizationId,
      appointmentId,
      tokenHash: hashManageToken(token),
      expiresAt,
    });

    return ok({ token, expiresAt });
  } catch (error) {
    logError('appointments.issueManageToken', error, {
      feature: 'appointments',
      extra: { organizationId, appointmentId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to issue manage token'
      )
    );
  }
};

export const issueManageToken = (
  db: DbConnection,
  input: IssueManageTokenInput
) =>
  trackedResult(
    'appointments.issueManageToken',
    () => issueManageTokenImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        appointmentId: input.appointmentId,
      },
    }
  );

export type IssueManageTokenResult = Awaited<
  ReturnType<typeof issueManageToken>
>;
