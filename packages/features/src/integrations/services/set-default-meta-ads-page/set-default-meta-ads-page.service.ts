import {
  type MetaAdsIntegration,
  metaAdsIntegration,
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
  ok,
} from '../../../shared/index.js';
import {
  type SetDefaultMetaAdsPageInput,
  setDefaultMetaAdsPageSchema,
} from './set-default-meta-ads-page.schema.js';

/**
 * Internal implementation of set default Meta Ads page
 */
const setDefaultMetaAdsPageImpl = async (
  db: DbConnection,
  input: SetDefaultMetaAdsPageInput
): Promise<Result<MetaAdsIntegration>> => {
  const parsed = setDefaultMetaAdsPageSchema.safeParse(input);
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

    // Verify the page exists and belongs to this integration
    const page = await db.query.metaAdsPage.findFirst({
      where: (t, { and: andOp, eq: eqOp }) =>
        andOp(eqOp(t.id, pageId), eqOp(t.metaAdsIntegrationId, integration.id)),
    });

    if (!page) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Page not found'));
    }

    // Update the default page
    const [updated] = await db
      .update(metaAdsIntegration)
      .set({ defaultPageId: pageId })
      .where(eq(metaAdsIntegration.id, integration.id))
      .returning();

    return ok(updated);
  } catch (error) {
    logError('integrations.setDefaultMetaAdsPage', error, {
      feature: 'integrations',
      extra: { organizationId, pageId },
    });

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to set default Meta Ads page'
      )
    );
  }
};

/**
 * Set the default Meta Ads page for an organization's integration
 */
export const setDefaultMetaAdsPage = (
  db: DbConnection,
  input: SetDefaultMetaAdsPageInput
) =>
  trackedResult(
    'integrations.setDefaultMetaAdsPage',
    () => withOrgScope((tx) => setDefaultMetaAdsPageImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        pageId: input.pageId,
      },
    }
  );

export type SetDefaultMetaAdsPageResult = Awaited<
  ReturnType<typeof setDefaultMetaAdsPage>
>;
