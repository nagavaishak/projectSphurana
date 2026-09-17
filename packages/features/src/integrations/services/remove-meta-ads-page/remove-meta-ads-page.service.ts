import {
  metaAdsIntegration,
  metaAdsPage,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { logError } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type RemoveMetaAdsPageInput,
  removeMetaAdsPageSchema,
} from './remove-meta-ads-page.schema.js';

/**
 * Internal implementation of remove Meta Ads page
 */
const removeMetaAdsPageImpl = async (
  db: DbConnection,
  input: RemoveMetaAdsPageInput
): Promise<Result<{ success: boolean }>> => {
  const parsed = removeMetaAdsPageSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, pageId } = parsed.data;

  try {
    // Get the integration for this organization
    const integration = await db.query.metaAdsIntegration.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.organizationId, organizationId),
    });

    if (!integration) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Meta Ads integration not found')
      );
    }

    // Find the page to delete
    const page = await db.query.metaAdsPage.findFirst({
      where: (t, { and: andOp, eq: eqOp }) =>
        andOp(eqOp(t.id, pageId), eqOp(t.metaAdsIntegrationId, integration.id)),
    });

    if (!page) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Page not found'));
    }

    // Delete the page
    await db
      .delete(metaAdsPage)
      .where(
        and(
          eq(metaAdsPage.id, pageId),
          eq(metaAdsPage.metaAdsIntegrationId, integration.id)
        )
      );

    // If this was the default page, set a new default
    if (integration.defaultPageId === pageId) {
      const remainingPage = await db.query.metaAdsPage.findFirst({
        where: (t, { eq: eqOp }) =>
          eqOp(t.metaAdsIntegrationId, integration.id),
      });

      await db
        .update(metaAdsIntegration)
        .set({ defaultPageId: remainingPage?.id || null })
        .where(eq(metaAdsIntegration.id, integration.id));
    }

    return ok({ success: true });
  } catch (error) {
    logError('integrations.removeMetaAdsPage', error, {
      feature: 'integrations',
      extra: { organizationId, pageId },
    });

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to remove Meta Ads page'
      )
    );
  }
};

/**
 * Remove a Meta Ads page from an organization's integration
 */
export const removeMetaAdsPage = (
  db: DbConnection,
  input: RemoveMetaAdsPageInput
) =>
  trackedResult(
    'integrations.removeMetaAdsPage',
    () => withOrgScope((tx) => removeMetaAdsPageImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        pageId: input.pageId,
      },
    }
  );

export type RemoveMetaAdsPageResult = Awaited<
  ReturnType<typeof removeMetaAdsPage>
>;
