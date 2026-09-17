import {
  type StripeConnectIntegration,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type GetStripeConnectionInput,
  getStripeConnectionSchema,
} from './get-stripe-connection.schema.js';

/**
 * Get Stripe Connect integration for an organization
 */
const getStripeConnectionImpl = async (
  db: DbConnection,
  input: GetStripeConnectionInput
): Promise<Result<StripeConnectIntegration | null>> => {
  const parsed = getStripeConnectionSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  const integration = await withOrgScope(
    (tx) =>
      tx.query.stripeConnectIntegration.findFirst({
        where: (t, { eq }) => eq(t.organizationId, organizationId),
      }),
    { db }
  );

  return ok(integration ?? null);
};

/**
 * Get Stripe Connect integration for an organization
 */
export const getStripeConnection = (
  db: DbConnection,
  input: GetStripeConnectionInput
) =>
  trackedResult(
    'integrations.getStripeConnection',
    () => getStripeConnectionImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type GetStripeConnectionResult = Awaited<
  ReturnType<typeof getStripeConnection>
>;
