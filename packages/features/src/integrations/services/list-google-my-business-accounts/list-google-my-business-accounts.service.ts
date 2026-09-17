import {
  googleMyBusinessAccount,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { logError } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListGoogleMyBusinessAccountsInput,
  listGoogleMyBusinessAccountsSchema,
} from './list-google-my-business-accounts.schema.js';

const listGoogleMyBusinessAccountsImpl = async (
  db: DbConnection,
  input: ListGoogleMyBusinessAccountsInput
) => {
  const parsed = listGoogleMyBusinessAccountsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  try {
    const accounts = await db.query.googleMyBusinessAccount.findMany({
      where: eq(googleMyBusinessAccount.organizationId, organizationId),
      columns: {
        id: true,
        googleAccountEmail: true,
        accountName: true,
        locationId: true,
        locationName: true,
        placeId: true,
        reviewLink: true,
        averageRating: true,
        totalReviews: true,
        isActive: true,
        lastSyncAt: true,
        tokenExpiresAt: true,
        createdAt: true,
      },
    });

    return ok(accounts);
  } catch (error) {
    logError('integrations.listGoogleMyBusinessAccounts', error, {
      feature: 'integrations',
      extra: { organizationId },
    });

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to list Google My Business accounts'
      )
    );
  }
};

export const listGoogleMyBusinessAccounts = (
  db: DbConnection,
  input: ListGoogleMyBusinessAccountsInput
) =>
  trackedResult(
    'integrations.listGoogleMyBusinessAccounts',
    () =>
      withOrgScope((tx) => listGoogleMyBusinessAccountsImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type ListGoogleMyBusinessAccountsResult = Awaited<
  ReturnType<typeof listGoogleMyBusinessAccounts>
>;
