import {
  metaAd,
  metaCampaignConfig,
  withOrgScope,
} from '@borradh-workspace/database';
import { MetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import { trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { logMetaErrorIfUnknown } from '../../../meta-ads/services/_shared/handle-meta-error.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { getMetaCredentials } from '../_shared/index.js';
import {
  type DeleteCampaignInput,
  deleteCampaignSchema,
} from './delete-campaign.schema.js';

/**
 * Internal implementation
 */
const deleteCampaignImpl = async (
  db: DbConnection,
  input: DeleteCampaignInput
): Promise<Result<{ deleted: true }>> => {
  const parsed = deleteCampaignSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { metaCampaignId, organizationId } = parsed.data;

  // Look up campaign config for page + ad account resolution
  const campaignConfig = await db.query.metaCampaignConfig.findFirst({
    where: eq(metaCampaignConfig.metaCampaignId, metaCampaignId),
  });

  const credResult = await getMetaCredentials(db, {
    organizationId,
    metaAdsPageId: campaignConfig?.metaAdsPageId ?? undefined,
    adAccountId: campaignConfig?.adAccountId ?? undefined,
  });
  if (!credResult.success) return credResult;

  const metaService = new MetaAdsService(credResult.data.credentials);

  try {
    // Delete campaign from Meta (cascades to ad sets and ads on Meta side)
    await metaService.deleteCampaign(metaCampaignId);
  } catch (error) {
    // Continue with local cleanup even if Meta deletion fails
    logMetaErrorIfUnknown('metaCampaigns.deleteCampaign', error, {
      metaCampaignId,
      organizationId,
    });
  }

  // Delete local ads associated with this Meta campaign ID
  await db.delete(metaAd).where(eq(metaAd.metaCampaignId, metaCampaignId));

  return ok({ deleted: true });
};

/**
 * Delete a Meta campaign and its local ads.
 * Calls Meta API to delete the campaign, then removes local ad records.
 */
export const deleteCampaign = (db: DbConnection, input: DeleteCampaignInput) =>
  trackedResult(
    'metaCampaigns.deleteCampaign',
    () => withOrgScope((tx) => deleteCampaignImpl(tx, input), { db }),
    {
      properties: { metaCampaignId: input.metaCampaignId },
    }
  );

export type DeleteCampaignResult = Awaited<ReturnType<typeof deleteCampaign>>;
