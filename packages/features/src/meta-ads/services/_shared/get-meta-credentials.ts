import { metaAdsIntegration } from '@borradh-workspace/database';
import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import type { MetaAdsCredentials } from '@borradh-workspace/integrations/meta-ads';
import { logError } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { CampaignErrorCodes } from '../../../meta-campaigns/models/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { AdErrorCodes } from '../../models/ad-error.types.js';

export interface GetCredentialsOptions {
  organizationId: string;
  /** Select a specific page by its internal ID (metaAdsPage.id). Falls back to default page if not found. */
  metaAdsPageId?: string | null;
  /** Explicit ad account override (from campaign config snapshot). Highest priority in resolution chain. */
  adAccountId?: string | null;
  /** Require `configurationStatus = 'configured'`. Default: true. Set to false for publish-ad style queries. */
  requireConfigured?: boolean;
  /** Operation name for error logging context */
  operationName?: string;
}

export interface CredentialsResult {
  credentials: MetaAdsCredentials;
  integration: {
    id: string;
    /** @deprecated Use credentials.adAccountId (resolved via three-tier chain) instead */
    adAccountId: string | null;
    availableAdAccounts?: Array<{
      id?: string;
      accountId?: string;
      currency?: string;
      name?: string;
      /**
       * Whether Meta will actually bill this account.
       *
       * Synced from Meta alongside the id and currency, and the single fact
       * that decides whether a launch can possibly succeed. Absent means
       * unknown, which is NOT the same as false.
       */
      hasPaymentMethod?: boolean;
    }> | null;
  };
  resolvedPage: {
    id: string;
    pageId: string;
    pageName: string | null;
    linkedInstagramAccountId?: string | null;
    linkedInstagramUsername?: string | null;
  };
}

/**
 * Resolve Meta Ads credentials for an organization.
 *
 * Looks up the active integration, decrypts credentials, resolves the
 * correct page, and returns everything needed to call the Meta API.
 */
export const getMetaCredentials = async (
  db: DbConnection,
  options: GetCredentialsOptions
): Promise<Result<CredentialsResult>> => {
  const {
    organizationId,
    metaAdsPageId,
    adAccountId: explicitAdAccountId,
    requireConfigured = true,
    operationName = 'metaAds.getCredentials',
  } = options;

  // Build query conditions
  const conditions = [
    eq(metaAdsIntegration.organizationId, organizationId),
    eq(metaAdsIntegration.isActive, true),
  ];
  if (requireConfigured) {
    conditions.push(eq(metaAdsIntegration.configurationStatus, 'configured'));
  }

  const integration = await db.query.metaAdsIntegration.findFirst({
    where: and(...conditions),
    with: {
      defaultPage: true,
      pages: true,
    },
  });

  if (!integration || !integration.encryptedCredentials) {
    return err(
      new FeatureError(
        CampaignErrorCodes.META_NOT_CONFIGURED,
        'Meta Ads integration not configured. Please connect your Meta Ad Account first.'
      )
    );
  }

  if (!integration.defaultPage || !integration.defaultPage.pageId) {
    return err(
      new FeatureError(
        CampaignErrorCodes.META_NOT_CONFIGURED,
        'No Facebook Page selected. Please complete the Meta Ads integration setup.'
      )
    );
  }

  // Resolve page: use selected page or fall back to default
  let resolvedPage = integration.defaultPage;
  if (metaAdsPageId) {
    const page = integration.pages?.find((p) => p.id === metaAdsPageId);
    if (page) resolvedPage = page;
  }

  const available =
    (integration.availableAdAccounts as CredentialsResult['integration']['availableAdAccounts']) ??
    [];
  const isAccount = (
    account: (typeof available)[number],
    id: string | null | undefined
  ) => Boolean(id) && (account?.id === id || account?.accountId === id);

  // Three-tier ad account resolution:
  // 1. Explicit override (from campaign config snapshot) — highest priority
  // 2. Page's default ad account
  // 3. Integration-level ad account — fallback
  let resolvedAdAccountId =
    explicitAdAccountId ??
    resolvedPage?.defaultAdAccountId ??
    integration.adAccountId;

  // AN ACCOUNT THAT CANNOT BE BILLED IS NOT A DEFAULT.
  //
  // Meta tells us `hasPaymentMethod` per account, and the chain above ignored
  // it — so an org with two accounts launched into whichever the snapshot
  // happened to hold, and array order decided where the money went. When the
  // unbillable one came first, every launch spent 36 seconds round-tripping to
  // Meta to be told "no payment method" about an account the owner does not
  // use.
  //
  // Only when the choice was NOT explicit. Redirecting an account somebody
  // deliberately picked would move spending — and currency — without being
  // asked; that case fails loudly below instead.
  if (!explicitAdAccountId) {
    const current = available.find((a) => isAccount(a, resolvedAdAccountId));
    if (!resolvedAdAccountId || current?.hasPaymentMethod === false) {
      const billable = available.find((a) => a?.hasPaymentMethod === true);
      const billableId = billable?.id ?? billable?.accountId;
      if (billableId) resolvedAdAccountId = billableId;
    }
  }

  if (!resolvedAdAccountId) {
    return err(
      new FeatureError(
        CampaignErrorCodes.META_NOT_CONFIGURED,
        'No Ad Account selected. Please complete the Meta Ads integration setup.'
      )
    );
  }

  // FAIL BEFORE META DOES, and name the way out.
  //
  // An explicitly chosen account with no payment method cannot launch, and we
  // know that here — before a creative is uploaded and an ad is created. Meta's
  // own answer arrives half a minute later and names a code, not an account, so
  // the owner is told their billing is broken when in fact one of their
  // accounts is fine and the campaign is pointed at the other one.
  const chosen = available.find((a) => isAccount(a, resolvedAdAccountId));
  if (chosen?.hasPaymentMethod === false) {
    const alternative = available.find((a) => a?.hasPaymentMethod === true);
    const chosenName = chosen.name ?? resolvedAdAccountId;
    // NAME WHAT CAN ACTUALLY BE DONE.
    //
    // This first said "point the campaign at that account" — an action nothing
    // can take: a campaign's ad account is snapshotted at creation and there is
    // no path to change it. Told to do the impossible, Claire correctly
    // concluded she could not and sent the owner to email a colleague — over an
    // org with a perfectly good ad account and two working ways to use it.
    const nextStep = alternative
      ? `A NEW campaign will use ${alternative.name ?? alternative.id}, which does have one — this campaign cannot be moved across. Or add a payment method to ${chosenName} in Meta Business Manager and launch it as it is.`
      : 'Add a payment method in Meta Business Manager, then try again.';
    return err(
      new FeatureError(
        AdErrorCodes.META_PAYMENT_METHOD_REQUIRED,
        `The ad account this campaign uses — ${chosenName} — has no payment method, so nothing can launch from it. ${nextStep}`
      )
    );
  }

  // Resolve currency from page default or available ad accounts
  const resolvedCurrency =
    resolvedPage?.defaultAdAccountCurrency ??
    (
      (integration.availableAdAccounts as CredentialsResult['integration']['availableAdAccounts']) ??
      []
    )?.find(
      (a) =>
        a?.accountId === resolvedAdAccountId || a?.id === resolvedAdAccountId
    )?.currency;

  try {
    const decrypted = decryptCredentials<{ accessToken: string }>(
      integration.encryptedCredentials
    );

    const credentials: MetaAdsCredentials = {
      accessToken: decrypted.accessToken,
      adAccountId: resolvedAdAccountId,
      pageId: resolvedPage.pageId,
      pageName: resolvedPage.pageName ?? undefined,
      adAccountCurrency: resolvedCurrency ?? undefined,
      appSecret: process.env.META_APP_SECRET || undefined,
    };

    return ok({
      credentials,
      integration: {
        id: integration.id,
        adAccountId: integration.adAccountId,
        availableAdAccounts:
          integration.availableAdAccounts as CredentialsResult['integration']['availableAdAccounts'],
      },
      resolvedPage: {
        id: resolvedPage.id,
        pageId: resolvedPage.pageId,
        pageName: resolvedPage.pageName,
        linkedInstagramAccountId: resolvedPage.linkedInstagramAccountId,
        linkedInstagramUsername: resolvedPage.linkedInstagramUsername,
      },
    });
  } catch (error) {
    logError(operationName, error, {
      feature: 'meta-ads',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to decrypt Meta credentials. Please reconnect your Meta account.'
      )
    );
  }
};
