/**
 * Resolve the org's Meta pixel — ADOPT first, create only as a last resort.
 *
 * THE RULE, and why it is this way round:
 *
 *   `GET /act_{ad_account_id}/adspixels` → non-empty → ADOPT that pixel.
 *
 * Ad accounts are CAPPED on how many pixels they may create, and any org that
 * has ever advertised already has one carrying its entire conversion history.
 * Creating a second one burns a capped resource, splits history across two
 * datasets, and leaves the account permanently unable to create another later.
 * Adopt is the COMMON path; create is the exception for an account that has
 * never run an ad.
 *
 * Creation happens inside THEIR business/ad account, on their token — never a
 * Borradh-owned pixel shared inward. Their account, their asset; we operate it.
 * An org that leaves takes its conversion history with it.
 *
 * NAMING: Meta's Events Manager UI calls these "Datasets" now. Same object,
 * same endpoint — `adspixels`. There is no new endpoint to find.
 */

import { metaAdsPage } from '@borradh-workspace/database';
import { MetaPixelsService } from '@borradh-workspace/integrations/meta-capi';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
// Through the meta-ads context's PUBLIC barrel, not a deep path into its
// internals — the cross-context gate enforces this.
import { getMetaCredentials } from '../../../meta-ads/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ResolveOrgPixelInput,
  resolveOrgPixelSchema,
} from './resolve-org-pixel.schema.js';

export interface ResolvedOrgPixel {
  pixelId: string;
  pixelName: string | null;
  /** Internal `metaAdsPage.id` the pixel is recorded against. */
  metaAdsPageId: string;
  /**
   * `stored`  — already on our row, no Meta call made.
   * `adopted` — the ad account already had one; we took it.
   * `created` — the ad account had none.
   */
  source: 'stored' | 'adopted' | 'created';
}

const DEFAULT_PIXEL_NAME = 'Website Pixel';

const resolveOrgPixelImpl = async (
  db: DbConnection,
  input: ResolveOrgPixelInput
): Promise<Result<ResolvedOrgPixel>> => {
  const parsed = resolveOrgPixelSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, metaAdsPageId, pixelName, forceRefresh } =
    parsed.data;

  // ONE credential path for the whole repo — the same resolver the campaign
  // services use, including its ad-account resolution chain. A second path
  // here would drift the moment that chain changes.
  const credResult = await getMetaCredentials(db, {
    organizationId,
    metaAdsPageId,
    requireConfigured: false,
    operationName: 'microsites.resolveOrgPixel',
  });
  if (!credResult.success) return credResult;

  const { credentials, resolvedPage } = credResult.data;

  const pageRow = await db.query.metaAdsPage.findFirst({
    where: eq(metaAdsPage.id, resolvedPage.id),
  });

  if (!forceRefresh && pageRow?.pixelId) {
    return ok({
      pixelId: pageRow.pixelId,
      pixelName: pageRow.pixelName ?? null,
      metaAdsPageId: resolvedPage.id,
      source: 'stored',
    });
  }

  const pixels = new MetaPixelsService({
    accessToken: credentials.accessToken,
    adAccountId: credentials.adAccountId,
    appSecret: credentials.appSecret,
  });

  try {
    const existing = await pixels.listPixels();

    // ADOPT. Never create alongside an existing pixel.
    const adopted = existing[0];
    if (adopted) {
      await db
        .update(metaAdsPage)
        .set({ pixelId: adopted.id, pixelName: adopted.name ?? null })
        .where(eq(metaAdsPage.id, resolvedPage.id));

      return ok({
        pixelId: adopted.id,
        pixelName: adopted.name ?? null,
        metaAdsPageId: resolvedPage.id,
        source: 'adopted',
      });
    }

    const name = pixelName ?? resolvedPage.pageName ?? DEFAULT_PIXEL_NAME;
    const created = await pixels.createPixel(name);

    await db
      .update(metaAdsPage)
      .set({ pixelId: created.id, pixelName: created.name ?? name })
      .where(eq(metaAdsPage.id, resolvedPage.id));

    return ok({
      pixelId: created.id,
      pixelName: created.name ?? name,
      metaAdsPageId: resolvedPage.id,
      source: 'created',
    });
  } catch (error) {
    // No PII here by construction — an org id and an ad account id, never a
    // customer identifier alongside a pixel id.
    logError('microsites.resolveOrgPixel', error, {
      feature: 'microsites',
      extra: { organizationId, adAccountId: credentials.adAccountId },
    });
    return err(
      new FeatureError(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        'Could not read or create the Meta pixel for this ad account.'
      )
    );
  }
};

export const resolveOrgPixel = (
  db: DbConnection,
  input: ResolveOrgPixelInput
) =>
  trackedResult(
    'microsites.resolveOrgPixel',
    () => resolveOrgPixelImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

export type ResolveOrgPixelResult = Awaited<ReturnType<typeof resolveOrgPixel>>;
