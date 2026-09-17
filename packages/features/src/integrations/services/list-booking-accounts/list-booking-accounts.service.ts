import {
  bookingAccount,
  user,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { logError } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListBookingAccountsInput,
  listBookingAccountsSchema,
} from './list-booking-accounts.schema.js';

export interface BookingAccountWithUser {
  id: string;
  provider: 'calendly' | 'timely' | 'phorest' | 'fresha';
  externalAccountId: string | null;
  email: string | null;
  displayName: string | null;
  isActive: boolean;
  lastSyncAt: Date | null;
  tokenExpiresAt: Date | null;
  createdAt: Date;
  connectedByName: string | null;
}

/**
 * Internal implementation of list booking accounts
 */
const listBookingAccountsImpl = async (
  db: DbConnection,
  input: ListBookingAccountsInput
) => {
  const parsed = listBookingAccountsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, provider } = parsed.data;

  try {
    const conditions = [eq(bookingAccount.organizationId, organizationId)];
    if (provider) {
      conditions.push(eq(bookingAccount.provider, provider));
    }

    const items = await db
      .select({
        id: bookingAccount.id,
        provider: bookingAccount.provider,
        externalAccountId: bookingAccount.externalAccountId,
        email: bookingAccount.email,
        displayName: bookingAccount.displayName,
        isActive: bookingAccount.isActive,
        lastSyncAt: bookingAccount.lastSyncAt,
        tokenExpiresAt: bookingAccount.tokenExpiresAt,
        createdAt: bookingAccount.createdAt,
        connectedByName: user.name,
      })
      .from(bookingAccount)
      .leftJoin(user, eq(bookingAccount.userId, user.id))
      .where(and(...conditions))
      .orderBy(bookingAccount.createdAt);

    // Return a bare array to match the sibling list-accounts services
    // (email/calendar/whatsapp) and the `{ accounts: BookingAccount[] }`
    // response contract; the controller wraps it as `{ accounts }`.
    return ok(items);
  } catch (error) {
    logError('integrations.listBookingAccounts', error, {
      feature: 'integrations',
      extra: { organizationId, provider },
    });

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'An unexpected error occurred while listing booking accounts'
      )
    );
  }
};

/**
 * List booking accounts for an organization
 */
export const listBookingAccounts = (
  db: DbConnection,
  input: ListBookingAccountsInput
) =>
  trackedResult(
    'integrations.listBookingAccounts',
    () => withOrgScope((tx) => listBookingAccountsImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type ListBookingAccountsResult = Awaited<
  ReturnType<typeof listBookingAccounts>
>;
