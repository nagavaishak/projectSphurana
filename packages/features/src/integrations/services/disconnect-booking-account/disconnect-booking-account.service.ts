import { bookingAccount, withOrgScope } from '@borradh-workspace/database';
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
  type DisconnectBookingAccountInput,
  disconnectBookingAccountSchema,
} from './disconnect-booking-account.schema.js';

/**
 * Internal implementation of disconnect booking account
 */
const disconnectBookingAccountImpl = async (
  db: DbConnection,
  input: DisconnectBookingAccountInput
): Promise<Result<{ success: true }>> => {
  const parsed = disconnectBookingAccountSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, accountId } = parsed.data;

  try {
    // Verify the account exists and belongs to the organization
    const existing = await db.query.bookingAccount.findFirst({
      where: (t, { and, eq }) =>
        and(eq(t.id, accountId), eq(t.organizationId, organizationId)),
    });

    if (!existing) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Booking account not found')
      );
    }

    // Delete the account
    await db
      .delete(bookingAccount)
      .where(
        and(
          eq(bookingAccount.id, accountId),
          eq(bookingAccount.organizationId, organizationId)
        )
      );

    return ok({ success: true });
  } catch (error) {
    logError('integrations.disconnectBookingAccount', error, {
      feature: 'integrations',
      extra: { organizationId, accountId },
    });

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'An unexpected error occurred while disconnecting the booking account'
      )
    );
  }
};

/**
 * Disconnect a booking account from an organization
 */
export const disconnectBookingAccount = (
  db: DbConnection,
  input: DisconnectBookingAccountInput
) =>
  trackedResult(
    'integrations.disconnectBookingAccount',
    () => withOrgScope((tx) => disconnectBookingAccountImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type DisconnectBookingAccountResult = Awaited<
  ReturnType<typeof disconnectBookingAccount>
>;
