import {
  creditBalances,
  creditTransactions,
  sequence,
} from '@borradh-workspace/database';
import {
  createLogger,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';

const logger = createLogger('UseCredits');
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { BillingErrorCodes } from '../../models/billing-error.types.js';
import { getCreditCost } from '../../models/billing.types.js';
import {
  type UseCreditsInput,
  useCreditsSchema,
} from './use-credits.schema.js';

interface UseCreditsResult {
  success: boolean;
  creditsUsed: number;
  balanceAfter: number;
  transactionId: string;
}

/**
 * Internal implementation
 */
const useCreditsImpl = async (
  db: DbConnection,
  input: UseCreditsInput
): Promise<Result<UseCreditsResult>> => {
  const parsed = useCreditsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationId,
    channel,
    quantity,
    referenceId,
    referenceType,
    description,
  } = parsed.data;

  // Calculate credit cost
  const creditsToUse = getCreditCost(channel, quantity);

  try {
    // Get current balance
    const balance = await db.query.creditBalances.findFirst({
      where: eq(creditBalances.organizationId, organizationId),
    });

    if (!balance) {
      return err(
        new FeatureError(
          BillingErrorCodes.CREDIT_BALANCE_NOT_FOUND,
          'Credit balance not found for organization'
        )
      );
    }

    // Check if sufficient credits
    if (balance.balance < creditsToUse) {
      return err(
        new FeatureError(
          BillingErrorCodes.INSUFFICIENT_CREDITS,
          `Insufficient credits. Required: ${creditsToUse / 100}, Available: ${balance.balance / 100}`,
          {
            required: creditsToUse,
            available: balance.balance,
          }
        )
      );
    }

    // Deduct credits and create transaction atomically
    const newBalance = balance.balance - creditsToUse;
    const transactionId = crypto.randomUUID();

    // Update balance
    await db
      .update(creditBalances)
      .set({
        balance: newBalance,
        lowBalanceAlertSent:
          newBalance > (balance.lowBalanceAlertThreshold ?? 0)
            ? false
            : balance.lowBalanceAlertSent,
      })
      .where(eq(creditBalances.organizationId, organizationId));

    // Create transaction record
    await db.insert(creditTransactions).values({
      id: transactionId,
      organizationId,
      type: 'usage',
      amount: -creditsToUse, // Negative for usage
      balanceAfter: newBalance,
      channel,
      referenceId,
      referenceType,
      description: description ?? `${channel} usage`,
    });

    // If credits exhausted and auto-refill is off, deactivate all sequences
    if (newBalance <= 0 && !balance.autoRefillEnabled) {
      const deactivatedSequences = await db
        .update(sequence)
        .set({ isActive: false })
        .where(
          and(
            eq(sequence.organizationId, organizationId),
            eq(sequence.isActive, true),
            notDeleted(sequence)
          )
        )
        .returning({ id: sequence.id });

      if (deactivatedSequences.length > 0) {
        logger.info(
          `Deactivated ${deactivatedSequences.length} sequences for org ${organizationId} due to credit exhaustion`
        );
      }
    }

    return ok({
      success: true,
      creditsUsed: creditsToUse,
      balanceAfter: newBalance,
      transactionId,
    });
  } catch (error) {
    logError('billing.useCredits', error, {
      feature: 'billing',
      extra: { organizationId, channel, quantity },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to use credits')
    );
  }
};

/**
 * Use credits for an organization
 *
 * @param db - Database connection
 * @param input - Credit usage input
 * @returns Result with usage details or error
 *
 * @example
 * ```ts
 * const result = await useCredits(db, {
 *   organizationId: 'org_123',
 *   channel: 'sms',
 *   quantity: 1,
 *   referenceId: 'msg_456',
 *   referenceType: 'sms_message',
 * });
 * ```
 */
export const useCredits = (db: DbConnection, input: UseCreditsInput) =>
  trackedResult('billing.useCredits', () => useCreditsImpl(db, input), {
    properties: {
      organizationId: input.organizationId,
      channel: input.channel,
      quantity: input.quantity,
    },
  });

export type UseCreditsServiceResult = Awaited<ReturnType<typeof useCredits>>;
