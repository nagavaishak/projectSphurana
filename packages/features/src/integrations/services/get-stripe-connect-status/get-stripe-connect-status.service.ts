import { withOrgScope } from '@borradh-workspace/database';
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
  type GetStripeConnectStatusInput,
  getStripeConnectStatusSchema,
} from './get-stripe-connect-status.schema.js';

export interface StripeConnectStatus {
  /** false when the org has no Stripe integration row yet. */
  connected: boolean;
  accountType: 'standard_oauth' | 'standard_linked' | 'controller' | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsCurrentlyDue: string[];
  disabledReason: string | null;
}

const getStripeConnectStatusImpl = async (
  db: DbConnection,
  input: GetStripeConnectStatusInput
): Promise<Result<StripeConnectStatus>> => {
  const parsed = getStripeConnectStatusSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const integration = await withOrgScope(
    (tx) =>
      tx.query.stripeConnectIntegration.findFirst({
        where: (t, { eq: eqOp }) =>
          eqOp(t.organizationId, parsed.data.organizationId),
      }),
    { db }
  );

  if (!integration) {
    return ok({
      connected: false,
      accountType: null,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      requirementsCurrentlyDue: [],
      disabledReason: null,
    });
  }

  return ok({
    connected: true,
    accountType: integration.accountType,
    chargesEnabled: integration.chargesEnabled,
    payoutsEnabled: integration.payoutsEnabled,
    detailsSubmitted: integration.detailsSubmitted,
    requirementsCurrentlyDue: integration.requirementsCurrentlyDue ?? [],
    disabledReason: integration.disabledReason,
  });
};

export const getStripeConnectStatus = (
  db: DbConnection,
  input: GetStripeConnectStatusInput
) =>
  trackedResult(
    'integrations.getStripeConnectStatus',
    () => getStripeConnectStatusImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type GetStripeConnectStatusResult = Awaited<
  ReturnType<typeof getStripeConnectStatus>
>;
