import { subscriptions, withOrgScope } from '@borradh-workspace/database';
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
  type GetSubscriptionInput,
  getSubscriptionSchema,
} from './get-subscription.schema.js';

/**
 * Internal implementation
 */
const getSubscriptionImpl = async (
  db: DbConnection,
  input: GetSubscriptionInput
): Promise<Result<typeof subscriptions.$inferSelect>> => {
  const parsed = getSubscriptionSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const subscription = await withOrgScope(
    (tx) =>
      tx.query.subscriptions.findFirst({
        where: eq(subscriptions.organizationId, parsed.data.organizationId),
      }),
    { db }
  );

  if (!subscription) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Subscription not found')
    );
  }

  return ok(subscription);
};

/**
 * Get subscription for an organization
 */
export const getSubscription = (
  db: DbConnection,
  input: GetSubscriptionInput
) =>
  trackedResult(
    'billing.getSubscription',
    () => getSubscriptionImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type GetSubscriptionResult = Awaited<ReturnType<typeof getSubscription>>;
