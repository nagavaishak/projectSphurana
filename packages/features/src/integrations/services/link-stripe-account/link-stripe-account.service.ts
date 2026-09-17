import {
  type StripeConnectIntegration,
  isUniqueViolation,
  stripeConnectIntegration,
  withOrgScope,
} from '@borradh-workspace/database';
import {
  describeStripeError,
  getStripeConnectService,
  isUnknownAccountError,
} from '@borradh-workspace/integrations/stripe';
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
  type LinkStripeAccountInput,
  linkStripeAccountSchema,
} from './link-stripe-account.schema.js';

/**
 * Attach an EXISTING Stripe connected account to this organization by its
 * `acct_` id.
 *
 * The onboarding path this serves: the merchant completes Stripe onboarding on
 * their own from a link sent after the sales call, so the account exists on the
 * platform before the workspace does. Nobody can complete an OAuth handshake or
 * a fresh Account Link for it afterwards — the account is already onboarded —
 * so the id is the only handle we have, and this is what turns that id into a
 * working connection.
 *
 * Everything downstream (charges, deposits, payouts, POS) reads
 * `stripe_connect_integration.stripe_account_id`, so a row written here is
 * indistinguishable from one written by the OAuth or embedded-onboarding paths.
 * That is exactly why the two guards below are not optional: a mistyped or
 * mis-copied id would quietly point one merchant's payments at another
 * merchant's Stripe account.
 */
const linkStripeAccountImpl = async (
  db: DbConnection,
  input: LinkStripeAccountInput
): Promise<Result<StripeConnectIntegration>> => {
  const parsed = linkStripeAccountSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, userId, stripeAccountId } = parsed.data;

  const existing = await withOrgScope(
    (tx) =>
      tx.query.stripeConnectIntegration.findFirst({
        where: (t, { eq: eqOp }) => eqOp(t.organizationId, organizationId),
      }),
    { db }
  );

  // Guard 1 (same org): don't silently repoint a live connection at a different
  // account. Re-linking the SAME id is allowed — that's a harmless re-sync.
  if (existing && existing.stripeAccountId !== stripeAccountId) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'This workspace is already connected to a different Stripe account. Disconnect it first, then link the new account.'
      )
    );
  }

  const stripeConnect = getStripeConnectService();

  let account: Awaited<ReturnType<typeof stripeConnect.getAccountInfo>>;
  try {
    account = await stripeConnect.getAccountInfo(stripeAccountId);
  } catch (error) {
    if (isUnknownAccountError(error)) {
      return err(
        new FeatureError(
          ErrorCodes.NOT_FOUND,
          'No Stripe account with that ID is connected to Borradh. Check the ID in the Stripe Connect dashboard.'
        )
      );
    }

    logError('integrations.linkStripeAccount.retrieve', error, {
      feature: 'integrations',
      extra: {
        organizationId,
        stripeAccountId,
        ...describeStripeError(error),
      },
    });
    return err(
      new FeatureError(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        'Could not reach Stripe to verify that account. Please try again.'
      )
    );
  }

  // Guard 2 (cross org): the account itself carries the org that claimed it.
  // This lives in Stripe metadata rather than in our own table because the API
  // request path connects as `app_authenticated` and cannot see another org's
  // integration row under RLS — a database check would report "unclaimed" for
  // an account that is already in use and let two workspaces share one payout
  // destination.
  if (
    account.linkedOrganizationId &&
    account.linkedOrganizationId !== organizationId
  ) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'That Stripe account is already linked to another Borradh workspace.'
      )
    );
  }

  // Claim it BEFORE writing our row, and fail the link if the claim fails.
  // A link whose claim was skipped looks identical to one that succeeded, and
  // the next workspace to paste the same id would sail past Guard 2 — so a
  // failure here has to be loud at onboarding time rather than invisible until
  // two merchants share an account.
  try {
    await stripeConnect.claimAccount(stripeAccountId, organizationId);
  } catch (error) {
    logError('integrations.linkStripeAccount.claim', error, {
      feature: 'integrations',
      extra: {
        organizationId,
        stripeAccountId,
        ...describeStripeError(error),
      },
    });
    return err(
      new FeatureError(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        'Stripe would not let us mark that account as belonging to this workspace, so it has not been linked. Please contact support.'
      )
    );
  }

  const values = {
    connectedById: userId,
    stripeAccountId,
    // Read off the live account rather than assumed: it decides whether
    // disconnect revokes an OAuth grant, and whether the embedded Connect
    // components can be rendered for this account.
    //
    // The Standard case is deliberately NOT recorded as 'standard_oauth'.
    // Mechanically the two are the same account, but that value means "the
    // legacy in-product OAuth integration" everywhere it is read, and the
    // payments panel uses it to replace the whole status view with a notice
    // pointing at the Integrations screen. An account onboarded from a
    // self-serve link and attached here is the CURRENT path, so it gets its
    // own value and renders like any other live connection.
    accountType:
      account.accountType === 'standard_oauth'
        ? ('standard_linked' as const)
        : account.accountType,
    accountName: account.businessName,
    accountEmail: account.email,
    chargesEnabled: account.chargesEnabled,
    payoutsEnabled: account.payoutsEnabled,
    detailsSubmitted: account.detailsSubmitted,
    defaultCurrency: account.defaultCurrency,
    requirementsCurrentlyDue: account.requirementsCurrentlyDue,
    disabledReason: account.disabledReason,
    isActive: true,
    lastSyncAt: new Date(),
  };

  try {
    const [integration] = existing
      ? await withOrgScope(
          (tx) =>
            tx
              .update(stripeConnectIntegration)
              .set({ ...values, updatedAt: new Date() })
              .where(
                eq(stripeConnectIntegration.organizationId, organizationId)
              )
              .returning(),
          { db }
        )
      : await withOrgScope(
          (tx) =>
            tx
              .insert(stripeConnectIntegration)
              .values({ organizationId, ...values })
              .returning(),
          { db }
        );

    return ok(integration);
  } catch (error) {
    // The race Guard 2 cannot close. That guard reads the account's Stripe
    // metadata, and two concurrent links for the same acct_ can BOTH read
    // "unclaimed" before either claims it. A cross-org SELECT would not help:
    // RLS hides the other organization's row from this path by design. The
    // unique index is what actually decides it, and exactly one of the two
    // writers arrives here — so this is the same answer Guard 2 gives, just
    // reached a few milliseconds later.
    if (
      isUniqueViolation(
        error,
        'stripe_connect_integration_stripe_account_id_unique'
      )
    ) {
      return err(
        new FeatureError(
          ErrorCodes.CONFLICT,
          'That Stripe account is already linked to another Borradh workspace.'
        )
      );
    }

    logError('integrations.linkStripeAccount', error, {
      feature: 'integrations',
      extra: { organizationId, stripeAccountId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to link the Stripe account'
      )
    );
  }
};

/**
 * Attach an existing Stripe connected account to an organization by its id.
 */
export const linkStripeAccount = (
  db: DbConnection,
  input: LinkStripeAccountInput
) =>
  trackedResult(
    'integrations.linkStripeAccount',
    () => linkStripeAccountImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

export type LinkStripeAccountResult = Awaited<
  ReturnType<typeof linkStripeAccount>
>;
