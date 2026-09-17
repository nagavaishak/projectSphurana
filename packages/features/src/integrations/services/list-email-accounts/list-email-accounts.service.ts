import { emailAccount, withOrgScope } from '@borradh-workspace/database';
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
  type ListEmailAccountsInput,
  listEmailAccountsSchema,
} from './list-email-accounts.schema.js';

/**
 * Internal implementation of list email accounts
 */
const listEmailAccountsImpl = async (
  db: DbConnection,
  input: ListEmailAccountsInput
): Promise<Result<typeof accounts>> => {
  const parsed = listEmailAccountsSchema.safeParse(input);
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
      id: emailAccount.id,
      provider: emailAccount.provider,
      email: emailAccount.email,
      displayName: emailAccount.displayName,
      isActive: emailAccount.isActive,
      lastSyncAt: emailAccount.lastSyncAt,
      tokenExpiresAt: emailAccount.tokenExpiresAt,
      createdAt: emailAccount.createdAt,
    })
    .from(emailAccount)
    .where(eq(emailAccount.organizationId, organizationId));

  return ok(accounts);
};

/**
 * List all email accounts connected to an organization
 */
export const listEmailAccounts = (
  db: DbConnection,
  input: ListEmailAccountsInput
) =>
  trackedResult(
    'integrations.listEmailAccounts',
    () => withOrgScope((tx) => listEmailAccountsImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type ListEmailAccountsResult = Awaited<
  ReturnType<typeof listEmailAccounts>
>;
