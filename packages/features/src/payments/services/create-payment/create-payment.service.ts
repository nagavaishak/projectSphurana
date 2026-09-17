import {
  type Payment,
  payment,
  withOrgScope,
} from '@borradh-workspace/database';
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
import {
  type CreatePaymentInput,
  createPaymentSchema,
} from './create-payment.schema.js';

export interface CreatePaymentResult {
  payment: Payment;
  checkoutUrl: string;
}

const createPaymentImpl = async (
  db: DbConnection,
  input: CreatePaymentInput
): Promise<Result<CreatePaymentResult>> => {
  const parsed = createPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationId,
    leadId,
    amountCents,
    currency,
    description,
    customerEmail,
    customerName,
    expirationHours,
    successUrl,
    cancelUrl,
    metadata: inputMetadata,
  } = parsed.data;

  try {
    // Get organization's Stripe Connect integration
    const integration = await withOrgScope(
      (tx) =>
        tx.query.stripeConnectIntegration.findFirst({
          where: (t, { eq }) => eq(t.organizationId, organizationId),
        }),
      { db }
    );

    if (!integration) {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'Stripe Connect not configured. Please connect your Stripe account first.'
        )
      );
    }

    if (!integration.isActive) {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'Stripe Connect integration is not active'
        )
      );
    }

    if (!integration.chargesEnabled) {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'Stripe account cannot accept payments. Please complete your Stripe account setup.'
        )
      );
    }

    // Calculate expiration time
    const hours = expirationHours ?? 24;
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

    // Create Stripe checkout session
    const stripeConnect = getStripeConnectService();
    const checkoutResult = await stripeConnect.createPaymentCheckout({
      connectedAccountId: integration.stripeAccountId,
      amountCents,
      currency,
      description,
      customerEmail,
      successUrl,
      cancelUrl,
      expiresAt,
      metadata: {
        organizationId,
        ...(leadId ? { leadId } : {}),
      },
    });

    // Create payment record
    const [result] = await withOrgScope(
      (tx) =>
        tx
          .insert(payment)
          .values({
            organizationId,
            leadId: leadId ?? null,
            amountCents,
            currency,
            status: 'pending',
            description,
            stripeCheckoutSessionId: checkoutResult.sessionId,
            stripeConnectedAccountId: integration.stripeAccountId,
            checkoutUrl: checkoutResult.url,
            customerEmail: customerEmail ?? null,
            customerName: customerName ?? null,
            metadata: inputMetadata ?? null,
            expiresAt,
          })
          .returning(),
      { db }
    );

    return ok({
      payment: result,
      checkoutUrl: checkoutResult.url,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'StripeTaxSetupIncompleteError'
    ) {
      return err(new FeatureError(ErrorCodes.INVALID_STATE, error.message));
    }

    logError('payments.createPayment', error, {
      feature: 'payments',
      extra: { organizationId, amountCents, description },
    });

    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to create payment')
    );
  }
};

export const createPayment = (db: DbConnection, input: CreatePaymentInput) =>
  trackedResult('payments.createPayment', () => createPaymentImpl(db, input), {
    properties: {
      organizationId: input.organizationId,
      amountCents: input.amountCents,
    },
  });

export type CreatePaymentServiceResult = Awaited<
  ReturnType<typeof createPayment>
>;
