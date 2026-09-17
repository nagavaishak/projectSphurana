import { getStripeConnectService } from '@borradh-workspace/integrations/stripe';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { ensureControllerAccount } from '../ensure-controller-account/ensure-controller-account.service.js';
import {
  type CreateAccountSessionInput,
  createAccountSessionSchema,
} from './create-account-session.schema.js';

export interface CreateAccountSessionResult {
  clientSecret: string;
}

/**
 * Create a Stripe Account Session for the embedded Connect components.
 * Lazily provisions the controller account on first touch (contract §7.A).
 */
const createAccountSessionImpl = async (
  db: DbConnection,
  input: CreateAccountSessionInput
): Promise<Result<CreateAccountSessionResult>> => {
  const parsed = createAccountSessionSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, userId, userEmail, components } = parsed.data;

  const integrationResult = await ensureControllerAccount(db, {
    organizationId,
    userId,
    userEmail,
  });
  if (!integrationResult.success) {
    const e = integrationResult.error;
    return err(new FeatureError(e.code, e.message, e.details));
  }

  try {
    const stripeConnect = getStripeConnectService();
    const session = await stripeConnect.createAccountSession({
      connectedAccountId: integrationResult.data.stripeAccountId,
      components,
    });
    return ok({ clientSecret: session.clientSecret });
  } catch (error) {
    logError('integrations.createAccountSession', error, {
      feature: 'integrations',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to create Stripe account session'
      )
    );
  }
};

export const createAccountSession = (
  db: DbConnection,
  input: CreateAccountSessionInput
) =>
  trackedResult(
    'integrations.createAccountSession',
    () => createAccountSessionImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

export type CreateAccountSessionServiceResult = Awaited<
  ReturnType<typeof createAccountSession>
>;
