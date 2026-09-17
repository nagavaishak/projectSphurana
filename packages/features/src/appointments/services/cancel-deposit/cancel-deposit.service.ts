import { appointmentDeposit, withOrgScope } from '@borradh-workspace/database';
import { getStripeConnectService } from '@borradh-workspace/integrations/stripe';
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
  type CancelDepositInput,
  cancelDepositSchema,
} from './cancel-deposit.schema.js';

/**
 * Cancel a pending deposit request
 */
const cancelDepositImpl = async (
  db: DbConnection,
  input: CancelDepositInput
): Promise<Result<{ success: true }>> => {
  const parsed = cancelDepositSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { depositId, organizationId } = parsed.data;

  try {
    // Get the deposit
    const deposit = await db.query.appointmentDeposit.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.id, depositId), eqOp(t.organizationId, organizationId)),
    });

    if (!deposit) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Deposit not found'));
    }

    if (deposit.status !== 'pending') {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          `Cannot cancel deposit with status: ${deposit.status}`
        )
      );
    }

    // Try to expire the Stripe checkout session if it exists
    if (deposit.stripeCheckoutSessionId) {
      try {
        const stripeConnect = getStripeConnectService();
        await stripeConnect.expireCheckoutSession(
          deposit.stripeConnectedAccountId,
          deposit.stripeCheckoutSessionId
        );
      } catch (stripeError) {
        // Log but don't fail - session might already be expired
        logError('appointments.cancelDeposit.expireSession', stripeError, {
          feature: 'appointments',
          extra: { depositId, sessionId: deposit.stripeCheckoutSessionId },
        });
      }
    }

    // Update deposit status
    await db
      .update(appointmentDeposit)
      .set({
        status: 'cancelled',
        updatedAt: new Date(),
      })
      .where(eq(appointmentDeposit.id, depositId));

    return ok({ success: true });
  } catch (error) {
    logError('appointments.cancelDeposit', error, {
      feature: 'appointments',
      extra: { depositId, organizationId },
    });

    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to cancel deposit')
    );
  }
};

/**
 * Cancel a pending deposit request
 */
export const cancelDeposit = (db: DbConnection, input: CancelDepositInput) =>
  trackedResult(
    'appointments.cancelDeposit',
    () => withOrgScope((tx) => cancelDepositImpl(tx, input), { db }),
    {
      properties: {
        depositId: input.depositId,
        organizationId: input.organizationId,
      },
    }
  );

export type CancelDepositResult = Awaited<ReturnType<typeof cancelDeposit>>;
