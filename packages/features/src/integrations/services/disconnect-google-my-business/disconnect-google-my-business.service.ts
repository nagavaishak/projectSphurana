import {
  googleMyBusinessAccount,
  withOrgScope,
} from '@borradh-workspace/database';
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
  type DisconnectGoogleMyBusinessInput,
  disconnectGoogleMyBusinessSchema,
} from './disconnect-google-my-business.schema.js';

const disconnectGoogleMyBusinessImpl = async (
  db: DbConnection,
  input: DisconnectGoogleMyBusinessInput
): Promise<Result<{ success: true }>> => {
  const parsed = disconnectGoogleMyBusinessSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, accountId } = parsed.data;

  try {
    const deleted = await db
      .delete(googleMyBusinessAccount)
      .where(
        and(
          eq(googleMyBusinessAccount.id, accountId),
          eq(googleMyBusinessAccount.organizationId, organizationId)
        )
      )
      .returning();

    if (deleted.length === 0) {
      return err(
        new FeatureError(
          ErrorCodes.NOT_FOUND,
          'Google My Business account not found'
        )
      );
    }

    return ok({ success: true as const });
  } catch (error) {
    logError('integrations.disconnectGoogleMyBusiness', error, {
      feature: 'integrations',
      extra: { organizationId, accountId },
    });

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to disconnect Google My Business account'
      )
    );
  }
};

export const disconnectGoogleMyBusiness = (
  db: DbConnection,
  input: DisconnectGoogleMyBusinessInput
) =>
  trackedResult(
    'integrations.disconnectGoogleMyBusiness',
    () =>
      withOrgScope((tx) => disconnectGoogleMyBusinessImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type DisconnectGoogleMyBusinessResult = Awaited<
  ReturnType<typeof disconnectGoogleMyBusiness>
>;
