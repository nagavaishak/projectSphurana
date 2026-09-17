import {
  type MetaAdsPage,
  metaAdsIntegration,
  metaAdsPage,
  withOrgScope,
} from '@borradh-workspace/database';
import { encryptCredentials } from '@borradh-workspace/integrations';
import { MetaOAuthService } from '@borradh-workspace/integrations/meta-ads';
import { createLogger, trackedResult } from '@borradh-workspace/observability';
import { logError } from '@borradh-workspace/observability';
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
  type AddMetaAdsPageInput,
  addMetaAdsPageSchema,
} from './add-meta-ads-page.schema.js';

const logger = createLogger('AddMetaAdsPage');

/**
 * Internal implementation of add Meta Ads page
 */
const addMetaAdsPageImpl = async (
  db: DbConnection,
  input: AddMetaAdsPageInput
): Promise<Result<MetaAdsPage>> => {
  const parsed = addMetaAdsPageSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationId,
    pageId,
    pageName,
    pageAccessToken,
    platform,
    pixelId,
    pixelName,
    setAsDefault,
  } = parsed.data;

  try {
    // Get the integration for this organization
    const integration = await db.query.metaAdsIntegration.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.organizationId, organizationId),
    });

    if (!integration) {
      return err(
        new FeatureError(
          ErrorCodes.NOT_FOUND,
          'Meta Ads integration not found. Please connect Meta first.'
        )
      );
    }

    // Check if page already exists
    const existingPage = await db.query.metaAdsPage.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(
          eqOp(t.metaAdsIntegrationId, integration.id),
          eqOp(t.pageId, pageId)
        ),
    });

    if (existingPage) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          'This page is already connected'
        )
      );
    }

    // Encrypt the page access token
    const encryptedPageToken = encryptCredentials({
      accessToken: pageAccessToken,
    });

    const metaOAuth = new MetaOAuthService();

    // Capture the page-linked Instagram Business Account so Instagram DMs +
    // publishing can run on the page (FLfB system-user) token rather than a
    // fragile standalone IG-Login user token. Best-effort — never blocks add.
    const linkedIg = await metaOAuth.getPageInstagramAccount(
      pageId,
      pageAccessToken
    );

    // Create the page
    const [page] = await db
      .insert(metaAdsPage)
      .values({
        metaAdsIntegrationId: integration.id,
        pageId,
        pageName: pageName || null,
        pageAccessToken: encryptedPageToken,
        platform,
        linkedInstagramAccountId: linkedIg?.id ?? null,
        linkedInstagramUsername: linkedIg?.username ?? null,
        linkedInstagramName: linkedIg?.name ?? null,
        pixelId: pixelId || null,
        pixelName: pixelName || null,
        isActive: true,
      })
      .returning();

    // Subscribe the page to webhooks so we receive messages
    try {
      // Field list DERIVED from the webhook registry.
      await metaOAuth.subscribePageToWebhooks(pageId, pageAccessToken);
    } catch (subscribeError) {
      // Log but don't fail — the page is already saved.
      // Webhook subscription can be retried later.
      logger.warn('Failed to subscribe page to webhooks', {
        pageId,
        error:
          subscribeError instanceof Error
            ? subscribeError.message
            : 'Unknown error',
      });
    }

    // Set as default if requested or if it's the first page
    if (setAsDefault || !integration.defaultPageId) {
      await db
        .update(metaAdsIntegration)
        .set({ defaultPageId: page.id })
        .where(eq(metaAdsIntegration.id, integration.id));
    }

    return ok(page);
  } catch (error) {
    logError('integrations.addMetaAdsPage', error, {
      feature: 'integrations',
      extra: { organizationId, pageId },
    });

    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to add Meta Ads page')
    );
  }
};

/**
 * Add a Meta Ads page to an organization's integration
 */
export const addMetaAdsPage = (db: DbConnection, input: AddMetaAdsPageInput) =>
  trackedResult(
    'integrations.addMetaAdsPage',
    () => withOrgScope((tx) => addMetaAdsPageImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        pageId: input.pageId,
      },
    }
  );

export type AddMetaAdsPageResult = Awaited<ReturnType<typeof addMetaAdsPage>>;
