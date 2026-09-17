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
  type ResumeCampaignInput,
  resumeCampaignSchema,
} from './resume-campaign.schema.js';

/**
 * Internal implementation
 */
const resumeCampaignImpl = async (
  db: DbConnection,
  input: ResumeCampaignInput
): Promise<
  Result<{
    metaCampaignId: string;
    /**
     * Campaign `effective_status` READ BACK from Meta after the resume
     * (ADR-005) — 'UNVERIFIED' when the read-back failed. Never a hardcoded
     * 'ACTIVE': callers must not report delivery that was not verified.
     */
    status: string;
    campaignEffectiveStatus: string | null;
    verified: boolean;
  }>
> => {
  const parsed = resumeCampaignSchema.safeParse(input);
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
    await metaService.updateCampaign(metaCampaignId, { status: 'ACTIVE' });

    // Read back the campaign state (ADR-005) — report what Meta says the
    // campaign IS, never the 'ACTIVE' we requested.
    let campaignEffectiveStatus: string | null = null;
    try {
      const campaign = await metaService.getCampaign(metaCampaignId);
      campaignEffectiveStatus =
        campaign.effectiveStatus ?? campaign.status ?? null;
    } catch (readBackError) {
      // Non-fatal — the resume request itself succeeded; status is unverified.
      // Log it: an unverifiable resume is a spend-relevant blind spot.
      logError('metaCampaigns.resumeCampaign.readBack', readBackError, {
        feature: 'meta-campaigns',
        extra: { metaCampaignId, organizationId },
      });
    }
    return ok({
      metaCampaignId,
      status: campaignEffectiveStatus ?? 'UNVERIFIED',
      campaignEffectiveStatus,
      verified: campaignEffectiveStatus !== null,
    });
  } catch (error) {
    return handleMetaError(error, {
      operationName: 'metaCampaigns.resumeCampaign',
      defaultErrorCode: CampaignErrorCodes.META_SYNC_FAILED,
      defaultUserTitle: 'Failed to Resume Campaign',
      extra: { metaCampaignId, organizationId },
      db,
      organizationId,
    });
  }
};

/**
 * Resume (activate) a paused Meta campaign via the API.
 */
export const resumeCampaign = (db: DbConnection, input: ResumeCampaignInput) =>
  trackedResult(
    'metaCampaigns.resumeCampaign',
    () => withOrgScope((tx) => resumeCampaignImpl(tx, input), { db }),
    {
      properties: { metaCampaignId: input.metaCampaignId },
    }
  );

export type ResumeCampaignResult = Awaited<ReturnType<typeof resumeCampaign>>;
