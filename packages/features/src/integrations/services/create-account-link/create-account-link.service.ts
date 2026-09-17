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
  type CreateAccountLinkInput,
  createAccountLinkSchema,
} from './create-account-link.schema.js';

export interface CreateAccountLinkResult {
  url: string;
  expiresAt: number;
}

/**
 * Create a Stripe Account Link for hosted onboarding. Lazily provisions the
 * controller account on first touch, then returns a Stripe-hosted URL to
 * redirect the merchant to — replacing the embedded onboarding iframe.
 */
const createAccountLinkImpl = async (
  db: DbConnection,
  input: CreateAccountLinkInput
): Promise<Result<CreateAccountLinkResult>> => {
  const parsed = createAccountLinkSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, userId, userEmail, returnUrl, refreshUrl } =
    parsed.data;

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
    const link = await stripeConnect.createAccountLink({
      connectedAccountId: integrationResult.data.stripeAccountId,
      returnUrl,
      refreshUrl,
    });
    return ok({ url: link.url, expiresAt: link.expiresAt });
  } catch (error) {
    logError('integrations.createAccountLink', error, {
      feature: 'integrations',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to create Stripe onboarding link'
      )
    );
  }
};

export const createAccountLink = (
  db: DbConnection,
  input: CreateAccountLinkInput
) =>
  trackedResult(
    'integrations.createAccountLink',
    () => createAccountLinkImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

export type CreateAccountLinkServiceResult = Awaited<
  ReturnType<typeof createAccountLink>
>;
