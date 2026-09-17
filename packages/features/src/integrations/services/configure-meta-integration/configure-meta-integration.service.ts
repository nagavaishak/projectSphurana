import {
  type MetaAdsIntegration,
  type MetaAdsPage,
  metaAdsIntegration,
  metaAdsPage,
  withOrgScope,
} from '@borradh-workspace/database';
import { encryptCredentials } from '@borradh-workspace/integrations';
import { MetaOAuthService } from '@borradh-workspace/integrations/meta-ads';
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
import { queueVoiceIngest } from '../../../voice-cloning/services/queue-voice-ingest/index.js';
import {
  type ConfigureMetaIntegrationInput,
  configureMetaIntegrationSchema,
} from './configure-meta-integration.schema.js';

export interface ConfigureMetaIntegrationResponse {
  integration: MetaAdsIntegration;
  pages: MetaAdsPage[];
}

/**
 * Configure a pending Meta Ads integration - completes the wizard flow
 * by selecting ad accounts, pages, and Instagram accounts, subscribing to webhooks,
 * and setting the configuration status to 'configured'.
 *
 * Supports multi-select: multiple ad accounts, pages, and Instagram accounts.
 */
const configureMetaIntegrationImpl = async (
  db: DbConnection,
  input: ConfigureMetaIntegrationInput
): Promise<Result<ConfigureMetaIntegrationResponse>> => {
  const parsed = configureMetaIntegrationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, integrationId, adAccountIds, pageIds } = parsed.data;

  try {
    // Get existing integration
    const existing = await db.query.metaAdsIntegration.findFirst({
      where: (t, { and: andOp, eq: eqOp }) =>
        andOp(
          eqOp(t.id, integrationId),
          eqOp(t.organizationId, organizationId)
        ),
    });

    if (!existing) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Integration not found')
      );
    }

    // Verify it's in pending_selection state
    if (existing.configurationStatus !== 'pending_selection') {
      return err(
        new FeatureError(
          ErrorCodes.CONFLICT,
          'Integration is already configured. To reconfigure, please reconnect your Meta account.'
        )
      );
    }

    // Validate all selected ad accounts against available options
    const availableAdAccounts = existing.availableAdAccounts ?? [];
    const selectedAdAccounts = adAccountIds.map((id) => {
      const account = availableAdAccounts.find(
        (acc) => acc.id === id || acc.accountId === id
      );
      return account ?? null;
    });

    const missingAdAccount = selectedAdAccounts.findIndex((a) => a === null);
    if (missingAdAccount !== -1) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          `Ad account "${adAccountIds[missingAdAccount]}" is not available. Please reconnect your Meta account.`
        )
      );
    }

    // Validate all ad accounts are in a usable state (status 1 = Active, 9 = Grace Period)
    const statusMessages: Record<number, string> = {
      2: 'This ad account has been disabled by Meta. Please check your Meta Business Settings.',
      3: 'This ad account has an unpaid balance. Please pay the outstanding balance in Meta Business Settings.',
      7: 'This ad account is under review by Meta. Please wait for the review to complete.',
      100: 'This ad account is being closed.',
      101: 'This ad account has been permanently closed.',
    };

    for (const account of selectedAdAccounts) {
      if (!account) continue;
      if (account.accountStatus !== 1 && account.accountStatus !== 9) {
        return err(
          new FeatureError(
            ErrorCodes.VALIDATION_ERROR,
            statusMessages[account.accountStatus] ||
              `Ad account "${account.name}" is not active (status: ${account.accountStatus}). Please choose a different account or resolve the issue in Meta Business Settings.`
          )
        );
      }
    }

    // Validate all selected pages against available options
    const availablePages = existing.availablePages ?? [];
    const selectedPages = pageIds.map((id) => {
      const page = availablePages.find((p) => p.id === id);
      return page ?? null;
    });

    const missingPage = selectedPages.findIndex((p) => p === null);
    if (missingPage !== -1) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          `Page "${pageIds[missingPage]}" is not available. Please reconnect your Meta account.`
        )
      );
    }

    const metaOAuth = new MetaOAuthService();

    // Subscribe EACH selected Facebook page to webhooks
    for (const page of selectedPages) {
      if (!page) continue;
      // Field list DERIVED from the webhook registry.
      await metaOAuth.subscribePageToWebhooks(page.id, page.accessToken);
    }

    // Use the first selected ad account as the primary
    const primaryAdAccount = selectedAdAccounts[0] as NonNullable<
      (typeof selectedAdAccounts)[0]
    >;

    // Update integration to configured status
    let [integration] = await db
      .update(metaAdsIntegration)
      .set({
        adAccountId: primaryAdAccount.accountId,
        adAccountName: primaryAdAccount.name || null,
        configurationStatus: 'configured',
        // Keep all selected ad accounts
        availableAdAccounts: selectedAdAccounts.filter(
          (a): a is NonNullable<typeof a> => a !== null
        ),
        // Clear availablePages as they contain access tokens
        availablePages: null,
        updatedAt: new Date(),
      })
      .where(eq(metaAdsIntegration.id, integrationId))
      .returning();

    const createdPages: MetaAdsPage[] = [];

    // Create/update metaAdsPage record for each selected Facebook page
    for (const page of selectedPages) {
      if (!page) continue;

      const encryptedPageToken = encryptCredentials({
        accessToken: page.accessToken,
      });

      // Check if page already exists for this integration
      const existingPage = await db.query.metaAdsPage.findFirst({
        where: (t, { and: andOp, eq: eqOp }) =>
          andOp(
            eqOp(t.metaAdsIntegrationId, integration.id),
            eqOp(t.pageId, page.id)
          ),
      });

      let createdPage: MetaAdsPage;

      // Populate linked Instagram Business Account from page data
      const igAccount = page.instagramBusinessAccount;

      if (existingPage) {
        [createdPage] = await db
          .update(metaAdsPage)
          .set({
            pageName: page.name || null,
            pagePictureUrl: page.pictureUrl || null,
            pageAccessToken: encryptedPageToken,
            platform: 'facebook',
            linkedInstagramAccountId: igAccount?.id || null,
            linkedInstagramUsername: igAccount?.username || null,
            linkedInstagramName: igAccount?.name || null,
            defaultAdAccountId: primaryAdAccount.accountId,
            defaultAdAccountName: primaryAdAccount.name || null,
            defaultAdAccountCurrency: primaryAdAccount.currency || null,
            isActive: true,
            updatedAt: new Date(),
          })
          .where(eq(metaAdsPage.id, existingPage.id))
          .returning();
      } else {
        [createdPage] = await db
          .insert(metaAdsPage)
          .values({
            metaAdsIntegrationId: integration.id,
            pageId: page.id,
            pageName: page.name || null,
            pagePictureUrl: page.pictureUrl || null,
            pageAccessToken: encryptedPageToken,
            platform: 'facebook',
            linkedInstagramAccountId: igAccount?.id || null,
            linkedInstagramUsername: igAccount?.username || null,
            linkedInstagramName: igAccount?.name || null,
            defaultAdAccountId: primaryAdAccount.accountId,
            defaultAdAccountName: primaryAdAccount.name || null,
            defaultAdAccountCurrency: primaryAdAccount.currency || null,
            isActive: true,
          })
          .returning();
      }

      createdPages.push(createdPage);
    }

    // Deactivate pages that were not in the new selection
    const selectedFbPageIds = new Set(
      selectedPages
        .filter((p): p is NonNullable<typeof p> => p !== null)
        .map((p) => p.id)
    );
    const existingPages = await db.query.metaAdsPage.findMany({
      where: eq(metaAdsPage.metaAdsIntegrationId, integration.id),
    });
    for (const existing of existingPages) {
      if (!selectedFbPageIds.has(existing.pageId) && existing.isActive) {
        await db
          .update(metaAdsPage)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(metaAdsPage.id, existing.id));
      }
    }

    // Set default page to first created page if not already set,
    // or update if the current default was deactivated
    const currentDefaultStillActive =
      integration.defaultPageId &&
      createdPages.some((p) => p.id === integration.defaultPageId);

    if (
      (!integration.defaultPageId || !currentDefaultStillActive) &&
      createdPages.length > 0
    ) {
      [integration] = await db
        .update(metaAdsIntegration)
        .set({ defaultPageId: createdPages[0].id })
        .where(eq(metaAdsIntegration.id, integration.id))
        .returning();
    }

    // Queue voice ingest for each newly created/updated page (non-blocking)
    for (const page of createdPages) {
      try {
        await queueVoiceIngest({
          organizationId,
          metaAdsPageId: page.id,
          triggerReason: 'page_connect',
        });
      } catch {
        // Voice ingest queueing should never block page connection
      }
    }

    return ok({ integration, pages: createdPages });
  } catch (error) {
    logError('integrations.configureMetaIntegration', error, {
      feature: 'integrations',
      extra: { organizationId, integrationId, adAccountIds, pageIds },
    });

    if (
      error instanceof Error &&
      error.message.includes('webhook subscription')
    ) {
      return err(
        new FeatureError(
          ErrorCodes.EXTERNAL_SERVICE_ERROR,
          'Failed to configure page webhooks. Please try again.'
        )
      );
    }

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'An unexpected error occurred while configuring Meta Ads'
      )
    );
  }
};

/**
 * Configure a pending Meta Ads integration (wizard completion)
 */
export const configureMetaIntegration = (
  db: DbConnection,
  input: ConfigureMetaIntegrationInput
) =>
  trackedResult(
    'integrations.configureMetaIntegration',
    () => withOrgScope((tx) => configureMetaIntegrationImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        integrationId: input.integrationId,
      },
    }
  );

export type ConfigureMetaIntegrationResult = Awaited<
  ReturnType<typeof configureMetaIntegration>
>;
