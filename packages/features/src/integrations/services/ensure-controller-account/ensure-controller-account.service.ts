import {
  type StripeConnectIntegration,
  stripeConnectIntegration,
  withOrgScope,
} from '@borradh-workspace/database';
import { getStripeConnectService } from '@borradh-workspace/integrations/stripe';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  currencyForCountry,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type EnsureControllerAccountInput,
  ensureControllerAccountSchema,
} from './ensure-controller-account.schema.js';

/**
 * Lazily create an embedded-Connect controller account for the org
 * (contract §7.A). Idempotent: if a stripe_connect_integration row exists
 * (OAuth or controller), it is reused untouched — dual-path.
 */
const ensureControllerAccountImpl = async (
  db: DbConnection,
  input: EnsureControllerAccountInput
): Promise<Result<StripeConnectIntegration>> => {
  const parsed = ensureControllerAccountSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, userId, userEmail } = parsed.data;

  try {
    // Reuse existing integration (legacy OAuth or previous controller)
    const existing = await withOrgScope(
      (tx) =>
        tx.query.stripeConnectIntegration.findFirst({
          where: (t, { eq: eqOp }) => eqOp(t.organizationId, organizationId),
        }),
      { db }
    );
    if (existing) {
      return ok(existing);
    }

    // Prefill from org + primary location (contract §7.A prefill sources)
    const [org, primaryLocation] = await withOrgScope(
      async (tx) => {
        const orgRow = await tx.query.organization.findFirst({
          where: (t, { eq: eqOp }) => eqOp(t.id, organizationId),
        });
        const location = await tx.query.organizationLocation.findFirst({
          where: (t, { and: andOp, eq: eqOp }) =>
            andOp(
              eqOp(t.organizationId, organizationId),
              eqOp(t.isPrimary, true)
            ),
        });
        return [orgRow, location] as const;
      },
      { db }
    );

    if (!org) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
      );
    }

    const country = (primaryLocation?.country ?? 'ie').toUpperCase();
    const currency = currencyForCountry(
      primaryLocation?.country ?? null
    ).code.toLowerCase();

    // External Stripe call OUTSIDE any transaction. The idempotency key is
    // keyed on organizationId so two concurrent callers can't create two
    // acct_ objects (L4). createControllerAccount appends a hash of the account
    // params so a config change automatically rotates the key.
    const stripeConnect = getStripeConnectService();
    const created = await stripeConnect.createControllerAccount({
      country,
      email: userEmail,
      businessName: org.name,
      websiteUrl: org.websiteUrl ?? undefined,
      defaultCurrency: currency,
      idempotencyKey: `controller-account:${organizationId}`,
    });

    // Guard the insert against the check-then-create race: if a concurrent
    // request already inserted the org's row, `onConflictDoNothing` returns no
    // row — re-read and reconcile instead of 500ing on the unique constraint.
    const [row] = await withOrgScope(
      (tx) =>
        tx
          .insert(stripeConnectIntegration)
          .values({
            organizationId,
            connectedById: userId ?? null,
            stripeAccountId: created.accountId,
            accountType: 'controller',
            accountEmail: userEmail ?? null,
            accountName: org.name,
            defaultCurrency: currency,
            chargesEnabled: created.account.chargesEnabled,
            payoutsEnabled: created.account.payoutsEnabled,
            detailsSubmitted: created.account.detailsSubmitted,
          })
          .onConflictDoNothing({
            target: stripeConnectIntegration.organizationId,
          })
          .returning(),
      { db }
    );

    if (row) {
      return ok(row);
    }

    // Lost the race — the row now exists from the concurrent creator.
    const reconciled = await withOrgScope(
      (tx) =>
        tx.query.stripeConnectIntegration.findFirst({
          where: (t, { eq: eqOp }) => eqOp(t.organizationId, organizationId),
        }),
      { db }
    );

    if (!reconciled) {
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'Failed to set up Stripe account'
        )
      );
    }

    return ok(reconciled);
  } catch (error) {
    logError('integrations.ensureControllerAccount', error, {
      feature: 'integrations',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to set up Stripe account'
      )
    );
  }
};

export const ensureControllerAccount = (
  db: DbConnection,
  input: EnsureControllerAccountInput
) =>
  trackedResult(
    'integrations.ensureControllerAccount',
    () => ensureControllerAccountImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

export type EnsureControllerAccountResult = Awaited<
  ReturnType<typeof ensureControllerAccount>
>;
