import { driveAccount, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListDriveAccountsInput,
  listDriveAccountsSchema,
} from './list-drive-accounts.schema.js';

/**
 * Drive account summary (without encrypted credentials)
 */
export interface DriveAccountSummary {
  id: string;
  email: string;
  displayName: string | null;
  profilePicture: string | null;
  isActive: boolean;
  lastSyncAt: Date | null;
  tokenExpiresAt: Date | null;
  createdAt: Date;
}

/**
 * Internal implementation of list drive accounts
 */
const listDriveAccountsImpl = async (
  db: DbConnection,
  input: ListDriveAccountsInput
): Promise<
  | { success: true; data: DriveAccountSummary[] }
  | { success: false; error: FeatureError }
> => {
  const parsed = listDriveAccountsSchema.safeParse(input);
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
      id: driveAccount.id,
      email: driveAccount.email,
      displayName: driveAccount.displayName,
      profilePicture: driveAccount.profilePicture,
      isActive: driveAccount.isActive,
      lastSyncAt: driveAccount.lastSyncAt,
      tokenExpiresAt: driveAccount.tokenExpiresAt,
      createdAt: driveAccount.createdAt,
    })
    .from(driveAccount)
    .where(eq(driveAccount.organizationId, organizationId));

  return ok(accounts);
};

/**
 * List all Google Drive accounts connected to an organization
 */
export const listDriveAccounts = (
  db: DbConnection,
  input: ListDriveAccountsInput
) =>
  trackedResult(
    'integrations.listDriveAccounts',
    () => withOrgScope((tx) => listDriveAccountsImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type ListDriveAccountsResult = Awaited<
  ReturnType<typeof listDriveAccounts>
>;
