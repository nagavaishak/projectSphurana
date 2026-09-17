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
  buildMetaTargeting,
  err,
  ok,
} from '../../../shared/index.js';
import { CampaignErrorCodes } from '../../models/index.js';
import {
  buildTargetingForLocation,
  getMetaCredentials,
  resolveCampaignLocation,
} from '../_shared/index.js';
import {
  type UpdateCampaignInput,
  updateCampaignSchema,
} from './update-campaign.schema.js';

/**
 * Internal implementation
 */
const updateCampaignImpl = async (
  db: DbConnection,
  input: UpdateCampaignInput
): Promise<Result<{ updated: true }>> => {
  const parsed = updateCampaignSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    metaCampaignId,
    organizationId,
    name,
    dailyBudget,
    locationId,
    targeting: targetingKnobs,
  } = parsed.data;

  if (!name && dailyBudget === undefined && !targetingKnobs && !locationId) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'At least one field to update is required'
      )
    );
  }

  // Look up campaign config for page + ad account resolution
  const campaignConfigRecord = await db.query.metaCampaignConfig.findFirst({
    where: eq(metaCampaignConfig.metaCampaignId, metaCampaignId),
  });

  const credResult = await getMetaCredentials(db, {
    organizationId,
    metaAdsPageId: campaignConfigRecord?.metaAdsPageId ?? undefined,
    adAccountId: campaignConfigRecord?.adAccountId ?? undefined,
  });
  if (!credResult.success) return credResult;

  const metaService = new MetaAdsService(credResult.data.credentials);

  try {
    // Update campaign on Meta (name/budget)
    if (name || dailyBudget !== undefined) {
      await metaService.updateCampaign(metaCampaignId, {
        ...(name && { name }),
        ...(dailyBudget !== undefined && { dailyBudget }),
      });
    }

    // Update targeting on Meta ad set + local config.
    //
    // Geo is always RE-DERIVED, never carried over from the stored targeting:
    // an update that only changes the radius still re-reads the branch, so a
    // campaign whose branch has since moved address gets the corrected
    // coordinates instead of the stale snapshot.
    if (targetingKnobs || locationId) {
      const config = await db.query.metaCampaignConfig.findFirst({
        where: eq(metaCampaignConfig.metaCampaignId, metaCampaignId),
      });

      const stored = (config?.targeting ?? {}) as Record<string, unknown>;
      const countries = (targetingKnobs?.countries ??
        (stored.countries as string[] | undefined)) as string[] | undefined;

      const locationResult = await resolveCampaignLocation(db, {
        organizationId,
        locationId: locationId ?? config?.locationId ?? undefined,
        requireCoordinates: (countries?.length ?? 0) === 0,
      });
      if (!locationResult.success) return locationResult;

      // Unspecified knobs keep their stored value — an update that names only
      // `distanceKm` must not silently reset the age range.
      const targeting = buildTargetingForLocation(locationResult.data, {
        distanceKm:
          targetingKnobs?.distanceKm ??
          (stored.distanceKm as number | undefined),
        ageMin: targetingKnobs?.ageMin ?? (stored.ageMin as number | undefined),
        ageMax: targetingKnobs?.ageMax ?? (stored.ageMax as number | undefined),
        genders:
          targetingKnobs?.genders ?? (stored.genders as number[] | undefined),
        countries,
      });

      if (config?.metaAdSetId) {
        await metaService.updateAdSet(config.metaAdSetId, {
          targeting: buildMetaTargeting(targeting),
        });
      }

      await db
        .update(metaCampaignConfig)
        .set({ targeting, locationId: locationResult.data.id })
        .where(eq(metaCampaignConfig.metaCampaignId, metaCampaignId));
    }

    // Read back the campaign state (ADR-005) so callers report what Meta
    // says after the mutation, not what was requested. Null when the
    // read-back fails — callers must then say "submitted, unverified".
    let campaignEffectiveStatus: string | null = null;
    try {
      const campaign = await metaService.getCampaign(metaCampaignId);
      campaignEffectiveStatus =
        campaign.effectiveStatus ?? campaign.status ?? null;
    } catch (readBackError) {
      // Non-fatal — the update itself succeeded — but log it so an
      // unverifiable budget/targeting change is visible.
      logError('metaCampaigns.updateCampaign.readBack', readBackError, {
        feature: 'meta-campaigns',
        extra: { metaCampaignId, organizationId },
      });
    }

    return ok({
      updated: true,
      campaignEffectiveStatus,
      verified: campaignEffectiveStatus !== null,
    });
  } catch (error) {
    return handleMetaError(error, {
      operationName: 'metaCampaigns.updateCampaign',
      defaultErrorCode: CampaignErrorCodes.META_SYNC_FAILED,
      defaultUserTitle: 'Failed to Update Campaign',
      extra: { metaCampaignId, organizationId },
      db,
      organizationId,
    });
  }
};

/**
 * Update a Meta campaign (name and/or daily budget).
 */
export const updateCampaign = (db: DbConnection, input: UpdateCampaignInput) =>
  trackedResult(
    'metaCampaigns.updateCampaign',
    () => withOrgScope((tx) => updateCampaignImpl(tx, input), { db }),
    {
      properties: { metaCampaignId: input.metaCampaignId },
    }
  );

export type UpdateCampaignResult = Awaited<ReturnType<typeof updateCampaign>>;
