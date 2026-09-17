import { metaAd } from '@borradh-workspace/database';
import { MetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import { trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { getMetaCredentials, mapMetaAdStatus } from '../_shared/index.js';
import {
  type ImportAdByIdData,
  type ImportAdByIdInput,
  importAdByIdSchema,
} from './import-ad-by-id.schema.js';

/**
 * Lazily import a single ad from Meta into `meta_ad` on a CTM/CTWA referral
 * miss (PRD-1 follow-up). Resolves `adInternalId` + campaign attribution for
 * ads created in Meta Ads Manager that were never synced into Borradh.
 *
 * Best-effort: returns `err(...)` on any failure (the caller treats that as
 * "couldn't resolve" and proceeds with `adMetaId` only — message handling is
 * never blocked). See docs/implementations/ctm-ad-lazy-import.md.
 */
const importAdByIdImpl = async (
  db: DbConnection,
  input: ImportAdByIdInput
): Promise<Result<ImportAdByIdData>> => {
  const parsed = importAdByIdSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, metaAdId } = parsed.data;

  try {
    // 1. Dedup re-check — covers the race where a concurrent message imported
    //    this ad first. No Graph call needed when it already exists.
    const existing = await db.query.metaAd.findFirst({
      where: eq(metaAd.metaAdId, metaAdId),
      columns: { id: true, metaCampaignId: true },
    });
    if (existing) {
      return ok({
        internalAdId: existing.id,
        metaCampaignId: existing.metaCampaignId ?? null,
        imported: false,
      });
    }

    // 2. Resolve Meta credentials for the org.
    const credResult = await getMetaCredentials(db, { organizationId });
    if (!credResult.success) {
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'Meta credentials unavailable for ad import'
        )
      );
    }

    // 3. Fetch the ad's import fields (incl. campaign id) from Meta.
    const metaService = new MetaAdsService(credResult.data.credentials);
    const ad = await metaService.getAdForImport(metaAdId);

    // 4. Insert one imported `meta_ad` row (mirrors import-meta-ads mapping).
    const [inserted] = await db
      .insert(metaAd)
      .values({
        organizationId,
        videoId: null,
        name: ad.name,
        callToAction: 'LEARN_MORE',
        status: mapMetaAdStatus(ad.effectiveStatus),
        isImported: true,
        metaAdId: ad.id,
        metaCampaignId: ad.campaignId ?? null,
        metaAdSetId: ad.adSetId ?? null,
        metaStatus: ad.effectiveStatus,
        lastSyncAt: new Date(),
      })
      .returning({ id: metaAd.id });

    if (!inserted) {
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'Failed to insert imported ad'
        )
      );
    }

    return ok({
      internalAdId: inserted.id,
      metaCampaignId: ad.campaignId ?? null,
      imported: true,
    });
  } catch {
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to import ad by id')
    );
  }
};

export const importAdById = (db: DbConnection, input: ImportAdByIdInput) =>
  trackedResult('metaAds.importAdById', () => importAdByIdImpl(db, input), {
    properties: {
      organizationId: input.organizationId,
      metaAdId: input.metaAdId,
    },
    internalErrorsOnly: true,
  });

export type ImportAdByIdResult = Awaited<ReturnType<typeof importAdById>>;
