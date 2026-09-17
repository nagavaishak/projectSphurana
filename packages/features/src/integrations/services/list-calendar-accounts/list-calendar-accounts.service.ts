import {
  calendarAccount,
  user,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
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
  type ListCalendarAccountsInput,
  listCalendarAccountsSchema,
} from './list-calendar-accounts.schema.js';

/**
 * Internal implementation of list calendar accounts
 */
const listCalendarAccountsImpl = async (
  db: DbConnection,
  input: ListCalendarAccountsInput
): Promise<Result<typeof accounts>> => {
  const parsed = listCalendarAccountsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  const accounts = await db
    .select({
      id: calendarAccount.id,
      email: calendarAccount.email,
      displayName: calendarAccount.displayName,
      calendarId: calendarAccount.calendarId,
      isActive: calendarAccount.isActive,
      syncEnabled: calendarAccount.syncEnabled,
      lastSyncAt: calendarAccount.lastSyncAt,
      tokenExpiresAt: calendarAccount.tokenExpiresAt,
      createdAt: calendarAccount.createdAt,
      connectedByName: user.name,
    })
    .from(calendarAccount)
    .leftJoin(user, eq(calendarAccount.userId, user.id))
    .where(eq(calendarAccount.organizationId, organizationId));

  return ok(accounts);
};

/**
 * List all calendar accounts connected to an organization
 */
export const listCalendarAccounts = (
  db: DbConnection,
  input: ListCalendarAccountsInput
) =>
  trackedResult(
    'integrations.listCalendarAccounts',
    () => withOrgScope((tx) => listCalendarAccountsImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type ListCalendarAccountsResult = Awaited<
  ReturnType<typeof listCalendarAccounts>
>;
