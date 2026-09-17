import { emailAccount, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { logError } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type DisconnectEmailAccountInput,
  disconnectEmailAccountSchema,
} from './disconnect-email-account.schema.js';

/**
 * Internal implementation of disconnect email account
 */
const disconnectEmailAccountImpl = async (
  db: DbConnection,
  input: DisconnectEmailAccountInput
): Promise<Result<{ success: boolean }>> => {
  const parsed = disconnectEmailAccountSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, accountId } = parsed.data;

  try {
    // Verify account belongs to organization
    const existing = await db.query.emailAccount.findFirst({
      where: (t, { and: andOp, eq: eqOp }) =>
        andOp(eqOp(t.id, accountId), eqOp(t.organizationId, organizationId)),
    });

    if (!existing) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Email account not found')
      );
    }

    // Delete the account
    await db
      .delete(emailAccount)
      .where(
        and(
          eq(emailAccount.id, accountId),
          eq(emailAccount.organizationId, organizationId)
        )
      );

    return ok({ success: true });
  } catch (error) {
    logError('integrations.disconnectEmailAccount', error, {
      feature: 'integrations',
      extra: { organizationId, accountId },
    });

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to disconnect email account'
      )
    );
  }
};

/**
 * Disconnect an email account from an organization
 */
export const disconnectEmailAccount = (
  db: DbConnection,
  input: DisconnectEmailAccountInput
) =>
  trackedResult(
    'integrations.disconnectEmailAccount',
    () => withOrgScope((tx) => disconnectEmailAccountImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type DisconnectEmailAccountResult = Awaited<
  ReturnType<typeof disconnectEmailAccount>
>;
