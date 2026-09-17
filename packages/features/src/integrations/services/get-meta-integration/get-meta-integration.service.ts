import {
  type MetaAdAccountInfo,
  type MetaBusinessInfoStored,
  type MetaIntegrationStatus,
  type MetaPageInfoStored,
  type TokenStatus,
  metaAdsIntegration,
  metaAdsPage,
  user,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { logError } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  isFlfbIntegration,
  ok,
} from '../../../shared/index.js';
import {
  type GetMetaIntegrationInput,
  getMetaIntegrationSchema,
} from './get-meta-integration.schema.js';

export interface MetaPageInfo {
  id: string;
  pageId: string;
  pageName: string | null;
  pageUsername: string | null;
  pagePictureUrl: string | null;
  platform: 'facebook' | 'instagram';
  pixelId: string | null;
  pixelName: string | null;
  defaultLeadFormId: string | null;
  defaultLeadFormName: string | null;
  defaultAdAccountId: string | null;
  defaultAdAccountName: string | null;
  defaultAdAccountCurrency: string | null;
  /**
   * The Instagram business account linked to this Facebook page, if any.
   *
   * The campaign form gates its `instagram_dm` destination on the DEFAULT page
   * carrying one (`use-create-campaign-form.ts` → `hasInstagramLinked`), and
   * this endpoint is where it reads pages from. The column was set on connect
   * but never projected here, so `hasInstagramLinked` was false for every org
   * and the destination could never be enabled — by anyone.
   */
  linkedInstagramAccountId: string | null;
  linkedInstagramUsername: string | null;
  linkedInstagramName: string | null;
  isActive: boolean;
  createdAt: Date;
}

export interface MetaIntegrationInfo {
  id: string;
  configurationStatus: MetaIntegrationStatus;
  adAccountId: string | null;
  adAccountName: string | null;
  defaultPageId: string | null;
  isActive: boolean;
  tokenStatus: TokenStatus;
  connectedByName: string | null;
  facebookUserName: string | null;
  facebookUserEmail: string | null;
  facebookUserPictureUrl: string | null;
  tokenExpiresAt: Date | null;
  /**
   * True when connected via Facebook Login for Business: non-expiring
   * system-user token, all business pages + ad accounts, no refresh needed.
   */
  isFlfb: boolean;
  createdAt: Date;
  pages: MetaPageInfo[];
  defaultPage: MetaPageInfo | null;
  // Available options for wizard (only populated when configurationStatus is 'pending_selection')
  availableBusinesses: MetaBusinessInfoStored[] | null;
  availableAdAccounts: MetaAdAccountInfo[] | null;
  availablePages: MetaPageInfoStored[] | null;
}

/**
 * Internal implementation of get Meta integration
 */
const getMetaIntegrationImpl = async (
  db: DbConnection,
  input: GetMetaIntegrationInput
): Promise<Result<MetaIntegrationInfo | null>> => {
  const parsed = getMetaIntegrationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  try {
    const [integration] = await db
      .select({
        id: metaAdsIntegration.id,
        configurationStatus: metaAdsIntegration.configurationStatus,
        adAccountId: metaAdsIntegration.adAccountId,
        adAccountName: metaAdsIntegration.adAccountName,
        defaultPageId: metaAdsIntegration.defaultPageId,
        isActive: metaAdsIntegration.isActive,
        tokenStatus: metaAdsIntegration.tokenStatus,
        connectedByName: user.name,
        facebookUserName: metaAdsIntegration.facebookUserName,
        facebookUserEmail: metaAdsIntegration.facebookUserEmail,
        facebookUserPictureUrl: metaAdsIntegration.facebookUserPictureUrl,
        tokenExpiresAt: metaAdsIntegration.tokenExpiresAt,
        connectionMethod: metaAdsIntegration.connectionMethod,
        createdAt: metaAdsIntegration.createdAt,
        availableBusinesses: metaAdsIntegration.availableBusinesses,
        availableAdAccounts: metaAdsIntegration.availableAdAccounts,
        availablePages: metaAdsIntegration.availablePages,
      })
      .from(metaAdsIntegration)
      .leftJoin(user, eq(metaAdsIntegration.connectedById, user.id))
      .where(eq(metaAdsIntegration.organizationId, organizationId))
      .limit(1);

    if (!integration) {
      return ok(null);
    }

    // Fetch pages for this integration
    const pages = await db
      .select({
        id: metaAdsPage.id,
        pageId: metaAdsPage.pageId,
        pageName: metaAdsPage.pageName,
        pageUsername: metaAdsPage.pageUsername,
        pagePictureUrl: metaAdsPage.pagePictureUrl,
        platform: metaAdsPage.platform,
        pixelId: metaAdsPage.pixelId,
        pixelName: metaAdsPage.pixelName,
        defaultLeadFormId: metaAdsPage.defaultLeadFormId,
        defaultLeadFormName: metaAdsPage.defaultLeadFormName,
        defaultAdAccountId: metaAdsPage.defaultAdAccountId,
        defaultAdAccountName: metaAdsPage.defaultAdAccountName,
        defaultAdAccountCurrency: metaAdsPage.defaultAdAccountCurrency,
        linkedInstagramAccountId: metaAdsPage.linkedInstagramAccountId,
        linkedInstagramUsername: metaAdsPage.linkedInstagramUsername,
        linkedInstagramName: metaAdsPage.linkedInstagramName,
        isActive: metaAdsPage.isActive,
        createdAt: metaAdsPage.createdAt,
      })
      .from(metaAdsPage)
      .where(eq(metaAdsPage.metaAdsIntegrationId, integration.id));

    // Find the default page
    const defaultPage = integration.defaultPageId
      ? pages.find((p) => p.id === integration.defaultPageId) || null
      : null;

    // When configured, only expose the selected ad account (not all available ones)
    const filteredAdAccounts =
      integration.configurationStatus === 'configured' &&
      integration.adAccountId &&
      integration.availableAdAccounts
        ? integration.availableAdAccounts.filter(
            (acc) =>
              acc.id === integration.adAccountId ||
              acc.accountId === integration.adAccountId
          )
        : integration.availableAdAccounts;

    const { connectionMethod, ...integrationInfo } = integration;

    return ok({
      ...integrationInfo,
      isFlfb: isFlfbIntegration(integration),
      availableAdAccounts: filteredAdAccounts,
      pages,
      defaultPage,
    });
  } catch (error) {
    logError('integrations.getMetaIntegration', error, {
      feature: 'integrations',
      extra: { organizationId },
    });

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to get Meta integration'
      )
    );
  }
};

/**
 * Get Meta Ads integration for an organization
 */
export const getMetaIntegration = (
  db: DbConnection,
  input: GetMetaIntegrationInput
) =>
  trackedResult(
    'integrations.getMetaIntegration',
    () => withOrgScope((tx) => getMetaIntegrationImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type GetMetaIntegrationResult = Awaited<
  ReturnType<typeof getMetaIntegration>
>;
