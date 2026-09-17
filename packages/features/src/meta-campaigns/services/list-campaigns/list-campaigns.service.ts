import {
  metaAd,
  metaCampaignConfig,
  video,
  withOrgScope,
} from '@borradh-workspace/database';
import type { MetaCampaignData } from '@borradh-workspace/integrations/meta-ads';
import { MetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import { trackedResult } from '@borradh-workspace/observability';
import { eq, sql } from 'drizzle-orm';
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
  type ListCampaignsInput,
  listCampaignsSchema,
} from './list-campaigns.schema.js';

export interface CampaignListEntry extends MetaCampaignData {
  adCount: number;
  /**
   * A representative ad-creative thumbnail for the campaign (first ad with one),
   * read from our own DB — no extra Meta API calls. `null` when none is stored.
   */
  previewImageUrl: string | null;
  followUpType?: string;
  conversionDestination?: string | null;
  locationId?: string | null;
  targeting?: Record<string, unknown> | null;
  metaAdSetId?: string | null;
}

/**
 * Internal implementation
 */
const listCampaignsImpl = async (
  db: DbConnection,
  input: ListCampaignsInput
): Promise<Result<{ campaigns: CampaignListEntry[] }>> => {
  const parsed = listCampaignsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  // Get Meta credentials
  const credResult = await getMetaCredentials(db, { organizationId });
  if (!credResult.success) return credResult;

  const metaService = new MetaAdsService(credResult.data.credentials);

  try {
    // Fetch campaigns from Meta API
    const metaCampaigns = await metaService.listCampaigns(100);

    // Get ad counts per Meta campaign ID from local DB
    const adCounts = await db
      .select({
        metaCampaignId: metaAd.metaCampaignId,
        count: sql<number>`count(*)`.as('count'),
      })
      .from(metaAd)
      .where(eq(metaAd.organizationId, organizationId))
      .groupBy(metaAd.metaCampaignId);

    const adCountMap = new Map(
      adCounts
        .filter((r) => r.metaCampaignId !== null)
        // biome-ignore lint/style/noNonNullAssertion: filtered out nulls on previous line
        .map((r) => [r.metaCampaignId!, Number(r.count)])
    );

    // Pick a representative ad-creative thumbnail per campaign from our own DB
    // (local video thumbnail, else the stored Meta creative thumbnail). One
    // query for the whole list — no per-ad Meta API calls.
    const thumbRows = await db
      .select({
        metaCampaignId: metaAd.metaCampaignId,
        metaThumbnailUrl: metaAd.metaThumbnailUrl,
        videoThumbnailUrl: video.thumbnailUrl,
      })
      .from(metaAd)
      .leftJoin(video, eq(metaAd.videoId, video.id))
      .where(eq(metaAd.organizationId, organizationId))
      .orderBy(metaAd.createdAt);

    const thumbMap = new Map<string, string>();
    for (const row of thumbRows) {
      if (!row.metaCampaignId || thumbMap.has(row.metaCampaignId)) continue;
      const url = row.videoThumbnailUrl ?? row.metaThumbnailUrl;
      if (url) thumbMap.set(row.metaCampaignId, url);
    }

    // Get campaign configs from local DB
    const configs = await db
      .select()
      .from(metaCampaignConfig)
      .where(eq(metaCampaignConfig.organizationId, organizationId));

    const configMap = new Map(configs.map((c) => [c.metaCampaignId, c]));

    // Merge ad counts and config with Meta campaign data
    const campaigns: CampaignListEntry[] = metaCampaigns.map((campaign) => {
      const config = configMap.get(campaign.id);
      return {
        ...campaign,
        adCount: adCountMap.get(campaign.id) || 0,
        previewImageUrl: thumbMap.get(campaign.id) ?? null,
        followUpType: config?.followUpType,
        conversionDestination: config?.conversionDestination,
        locationId: config?.locationId,
        targeting: config?.targeting as
          | Record<string, unknown>
          | null
          | undefined,
        metaAdSetId: config?.metaAdSetId,
      };
    });

    return ok({ campaigns });
  } catch (error) {
    return handleMetaError(error, {
      operationName: 'metaCampaigns.listCampaigns',
      defaultErrorCode: CampaignErrorCodes.META_SYNC_FAILED,
      defaultUserTitle: 'Failed to Fetch Campaigns',
      extra: { organizationId },
      db,
      organizationId,
    });
  }
};

/**
 * List Meta campaigns for an organization.
 * Fetches live from Meta API and enriches with local ad counts.
 */
export const listCampaigns = (db: DbConnection, input: ListCampaignsInput) =>
  trackedResult(
    'metaCampaigns.listCampaigns',
    () => withOrgScope((tx) => listCampaignsImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type ListCampaignsResult = Awaited<ReturnType<typeof listCampaigns>>;
