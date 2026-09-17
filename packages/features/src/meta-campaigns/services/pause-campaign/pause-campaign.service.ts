import { metaCampaignConfig, withOrgScope } from '@borradh-workspace/database';
import { MetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { handleMetaError } from '../../../meta-ads/services/_shared/handle-meta-error.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { CampaignErrorCodes } from '../../models/index.js';
import { getMetaCredentials } from '../_shared/index.js';
import {
  type PauseCampaignInput,
  pauseCampaignSchema,
} from './pause-campaign.schema.js';

/**
 * Internal implementation
 */
const pauseCampaignImpl = async (
  db: DbConnection,
  input: PauseCampaignInput
): Promise<
  Result<{
    paused: true;
    /**
     * Campaign `effective_status` read back from Meta AFTER the pause
     * (ADR-005). `null` when the read-back failed — callers must report the
     * pause as submitted-but-unverified in that case, not as done.
     */
    campaignEffectiveStatus: string | null;
    verified: boolean;
  }>
> => {
  const parsed = pauseCampaignSchema.safeParse(input);
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
    await metaService.updateCampaign(metaCampaignId, { status: 'PAUSED' });

    // Read back the campaign state (ADR-005) — report what Meta says, not
    // what we asked for. A failed read-back degrades to unverified.
    let campaignEffectiveStatus: string | null = null;
    try {
      const campaign = await metaService.getCampaign(metaCampaignId);
      campaignEffectiveStatus =
        campaign.effectiveStatus ?? campaign.status ?? null;
    } catch (readBackError) {
      // Non-fatal — the pause request itself succeeded — but never silent:
      // an unverifiable pause is exactly the case operators need to see.
      logError('metaCampaigns.pauseCampaign.readBack', readBackError, {
        feature: 'meta-campaigns',
        extra: { metaCampaignId, organizationId },
      });
    }
    return ok({
      paused: true,
      campaignEffectiveStatus,
      verified: campaignEffectiveStatus !== null,
    });
  } catch (error) {
    return handleMetaError(error, {
      operationName: 'metaCampaigns.pauseCampaign',
      defaultErrorCode: CampaignErrorCodes.META_SYNC_FAILED,
      defaultUserTitle: 'Failed to Pause Campaign',
      extra: { metaCampaignId, organizationId },
      db,
      organizationId,
    });
  }
};

/**
 * Pause a Meta campaign directly via the API.
 */
export const pauseCampaign = (db: DbConnection, input: PauseCampaignInput) =>
  trackedResult(
    'metaCampaigns.pauseCampaign',
    () => withOrgScope((tx) => pauseCampaignImpl(tx, input), { db }),
    {
      properties: { metaCampaignId: input.metaCampaignId },
    }
  );

export type PauseCampaignResult = Awaited<ReturnType<typeof pauseCampaign>>;
