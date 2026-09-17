import { metaAdsPage, subscriptions } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';

export const getOrganizationOnboardingSchema = z.object({
  organizationId: z.string().min(1),
});

export type GetOrganizationOnboardingInput = z.input<
  typeof getOrganizationOnboardingSchema
>;

export interface OrganizationOnboardingState {
  subscription: {
    stripeSubscriptionId: string | null;
    stripeCustomerId: string;
    status: string;
    currentPeriodEnd: Date | null;
  } | null;
  stripeAccount: {
    stripeAccountId: string;
    accountName: string | null;
    accountType: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
  } | null;
  meta: {
    connectionMethod: string | null;
    adAccountId: string | null;
    adAccountName: string | null;
    pages: Array<{
      pageId: string;
      pageName: string | null;
      instagramUsername: string | null;
    }>;
    whatsappNumbers: string[];
  } | null;
}

/**
 * What an organization has already had attached, for the admin onboarding
 * screen to render as its current state.
 *
 * It exists because the screen is a pair of input boxes, and an input box with
 * nothing in it says "not done" — which is a lie for an org that was onboarded
 * last week, and an invitation to attach a second subscription to a workspace
 * that already has one. Reading the ids back means the fields show what IS
 * attached rather than what you last typed into this browser tab.
 */
const getOrganizationOnboardingImpl = async (
  db: DbConnection,
  input: GetOrganizationOnboardingInput
): Promise<Result<OrganizationOnboardingState>> => {
  const parsed = getOrganizationOnboardingSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  // Cross-tenant by design, like the rest of admin-terminal: the admin is not
  // a member of this org, so these are unscoped reads.
  const [subscription, integration, metaIntegration, whatsapp] =
    await Promise.all([
      db.query.subscriptions.findFirst({
        where: eq(subscriptions.organizationId, organizationId),
      }),
      db.query.stripeConnectIntegration.findFirst({
        where: (t, { eq: eqOp }) => eqOp(t.organizationId, organizationId),
      }),
      db.query.metaAdsIntegration.findFirst({
        where: (t, { eq: eqOp }) => eqOp(t.organizationId, organizationId),
      }),
      db.query.whatsappAccount.findMany({
        where: (t, { eq: eqOp }) => eqOp(t.organizationId, organizationId),
        columns: { phoneNumber: true },
      }),
    ]);

  const pages = metaIntegration
    ? await db.query.metaAdsPage.findMany({
        where: eq(metaAdsPage.metaAdsIntegrationId, metaIntegration.id),
        columns: {
          pageId: true,
          pageName: true,
          linkedInstagramUsername: true,
        },
      })
    : [];

  return ok({
    subscription: subscription
      ? {
          stripeSubscriptionId: subscription.stripeSubscriptionId,
          stripeCustomerId: subscription.stripeCustomerId,
          status: subscription.status,
          currentPeriodEnd: subscription.currentPeriodEnd,
        }
      : null,
    stripeAccount: integration
      ? {
          stripeAccountId: integration.stripeAccountId,
          accountName: integration.accountName,
          accountType: integration.accountType,
          chargesEnabled: integration.chargesEnabled,
          payoutsEnabled: integration.payoutsEnabled,
        }
      : null,
    meta: metaIntegration
      ? {
          connectionMethod: metaIntegration.connectionMethod,
          adAccountId: metaIntegration.adAccountId,
          adAccountName: metaIntegration.adAccountName,
          pages: pages.map((page) => ({
            pageId: page.pageId,
            pageName: page.pageName,
            instagramUsername: page.linkedInstagramUsername,
          })),
          whatsappNumbers: whatsapp.map((account) => account.phoneNumber),
        }
      : null,
  });
};

/** What an organization has already had attached. */
export const getOrganizationOnboarding = (
  db: DbConnection,
  input: GetOrganizationOnboardingInput
) =>
  trackedResult(
    'adminTerminal.getOrganizationOnboarding',
    () => getOrganizationOnboardingImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
      trackSuccess: false,
    }
  );

export type GetOrganizationOnboardingResult = Awaited<
  ReturnType<typeof getOrganizationOnboarding>
>;
