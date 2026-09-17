/**
 * `claimRotatedAsset` — take the least-recently-used asset for a service and
 * stamp it as used, in ONE statement.
 *
 * WHY ATOMIC
 * ----------
 * The obvious implementation — read usage history, pick an asset, generate,
 * then record what was used — has a race the width of the whole generation.
 * The graphic worker runs jobs concurrently, so two graphics for the same
 * service both read the same history and both pick the same photo. That is
 * exactly the case that matters: a monthly batch producing several pieces for
 * one treatment.
 *
 * `UPDATE ... WHERE id = (SELECT ... ORDER BY last_used_at LIMIT 1 FOR UPDATE
 * SKIP LOCKED) RETURNING` claims and stamps together. A concurrent caller
 * skips the locked row and takes the next one, so two simultaneous jobs get
 * two different assets by construction rather than by luck.
 *
 * WHY THIS GIVES SPACING FOR FREE
 * -------------------------------
 * Always taking the least-recently-used and immediately stamping it means
 * consecutive generations walk the pool in order before wrapping. Spacing
 * equals pool size: three eligible photos and the same one cannot reappear
 * until three generations later. No window to tune, and it behaves identically
 * for a 12-item batch and for one-off manual generation — the requirement was
 * to cycle across generations, whichever path produced them.
 *
 * WHY STOCK IS IN THIS POOL, NOT BELOW IT
 * ---------------------------------------
 * Stock used to be a tier tried only after this claim returned nothing, which
 * meant it was unreachable for any service that had media — so a service with
 * ONE eligible clip opened on that clip forever. Rotation was working exactly
 * as designed and the owner still saw the same footage every time.
 *
 * Minted stock assets are ordinary org-owned `asset` rows, so linking them into
 * `asset_service` puts them in this same LRU queue and the repetition resolves
 * itself: the own clip is never-used and wins first, and on the next generation
 * it carries a timestamp while the stock clip does not. Own footage keeps
 * precedence through a tie-break, not through a separate tier.
 *
 * It still cannot manufacture variety that doesn't exist: one eligible asset
 * and no matched stock means every generation returns that asset. That is a
 * content-mix problem (prefer text-led formats when a service has thin media),
 * not a rotation problem.
 */

import {
  asset,
  assetAnalysis,
  assetService,
} from '@borradh-workspace/database';
import { createLogger, trackedResult } from '@borradh-workspace/observability';
import { sql } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ClaimRotatedAssetInput,
  claimRotatedAssetSchema,
} from './claim-rotated-asset.schema.js';

const logger = createLogger('AssetRotation');

/**
 * Minimum `qualityScore` for an asset to illustrate a service.
 *
 * Vision already scores every asset 0..1 and flags shaky / blurry / poorly-lit
 * / equipment-only content, and selection has never consulted any of it. Under
 * strict rotation a dark shaky clip gets equal airtime with a good one, which
 * is worse than repeating the good one — the owner would rather see their best
 * photo twice than their worst photo once.
 *
 * The threshold is deliberately low. This is a floor that removes content
 * nobody would knowingly publish, NOT a ranking: `qualityScore` is a
 * self-reported model number of the same species as the service-match
 * confidences that turned out to be uninformative, so it earns a binary veto
 * and nothing more. If real accept/reject data later shows good assets are
 * under-used, that is when a weighting has something to be tuned against.
 *
 * Assets with no analysis are NOT excluded — absence of a score is not
 * evidence of poor quality.
 */
const MIN_QUALITY_SCORE = 0.4;

export interface ClaimRotatedAssetOutput {
  /** The claimed asset, or null when the service has no eligible media. */
  assetId: string | null;
  /** How many times this link had been used BEFORE this claim. */
  previousUseCount: number;
  /** Eligible assets for this service — 1 means repetition is unavoidable. */
  poolSize: number;
  /** Assets excluded by the quality floor. */
  excludedForQuality: number;
}

const claimRotatedAssetImpl = async (
  db: DbConnection,
  input: ClaimRotatedAssetInput
): Promise<Result<ClaimRotatedAssetOutput>> => {
  const parsed = claimRotatedAssetSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationId,
    serviceId,
    excludeAssetIds,
    requireThumbnail,
    mediaType,
    requireTranscodeReady,
  } = parsed.data;

  // Assets already consumed by an earlier slot on the same template.
  const exclusion =
    excludeAssetIds.length > 0
      ? sql`AND a.id NOT IN (${sql.join(
          excludeAssetIds.map((id) => sql`${id}`),
          sql`, `
        )})`
      : sql``;

  // A video is only usable as a still if it has a generated thumbnail.
  const usable = requireThumbnail
    ? sql`AND (a.type = 'image' OR (a.type = 'video' AND a.thumbnail_url IS NOT NULL))`
    : sql``;

  // Video b-roll cannot be filled by a still, and a graphic slot asking for a
  // photo should not receive an untranscoded clip. Unset means either will do.
  const typeFilter = mediaType ? sql`AND a.type = ${mediaType}` : sql``;

  // Matches queueVideoExport's render gate. Stock is minted pre-transcoded, so
  // this excludes only genuinely unready uploads.
  const transcodeFilter = requireTranscodeReady
    ? sql`AND (a.type <> 'video' OR a.transcode_status IN ('ready', 'skipped'))`
    : sql``;

  // Own footage before stock, but ONLY as a tie-break — `false` sorts before
  // `true` in Postgres, so an own asset wins when both are equally fresh and
  // loses once it carries a `last_used_at` the stock asset doesn't. That one
  // line is the whole "second ask goes to stock" rule: it needs no special
  // case because a never-used stock clip simply outranks a just-used own one.
  const ownBeforeStock = sql`(a.source = 'stock') ASC`;

  // Quality floor. LEFT JOIN so an unanalysed asset stays eligible — a missing
  // score is not evidence of poor quality. Only an explicit low score or a
  // raised defect flag excludes.
  const analysisJoin = sql`
    LEFT JOIN ${assetAnalysis} an ON an.asset_id = a.id
  `;
  const qualityFloor = sql`
    AND COALESCE((an.analysis_result->>'qualityScore')::float, 1) >= ${MIN_QUALITY_SCORE}
    AND COALESCE((an.analysis_result->'qualityFlags'->>'isBlurry')::boolean, false) = false
    AND COALESCE((an.analysis_result->'qualityFlags'->>'isShaky')::boolean, false) = false
    AND COALESCE((an.analysis_result->'qualityFlags'->>'showsOnlyEquipment')::boolean, false) = false
  `;

  try {
    const poolRows = await db.execute<{ total: number; eligible: number }>(sql`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (
          WHERE COALESCE((an.analysis_result->>'qualityScore')::float, 1) >= ${MIN_QUALITY_SCORE}
            AND COALESCE((an.analysis_result->'qualityFlags'->>'isBlurry')::boolean, false) = false
            AND COALESCE((an.analysis_result->'qualityFlags'->>'isShaky')::boolean, false) = false
            AND COALESCE((an.analysis_result->'qualityFlags'->>'showsOnlyEquipment')::boolean, false) = false
        )::int AS eligible
      FROM ${assetService} asvc
      JOIN ${asset} a ON a.id = asvc.asset_id
      ${analysisJoin}
      WHERE asvc.service_id = ${serviceId}
        AND a.organization_id = ${organizationId}
        AND a.deleted_at IS NULL
        ${usable}
        ${typeFilter}
        ${transcodeFilter}
    `);
    const totalPool = Number(poolRows[0]?.total ?? 0);
    const poolSize = Number(poolRows[0]?.eligible ?? 0);
    const excludedForQuality = Math.max(0, totalPool - poolSize);

    // The service HAS media but every piece of it failed the floor, so this
    // silently becomes all-stock. Worth knowing: the fix is to ask the owner
    // for better footage, not to loosen the threshold.
    if (totalPool > 0 && poolSize === 0) {
      logger.warn('All service media excluded by the quality floor', {
        organizationId,
        serviceId,
        totalPool,
        minQualityScore: MIN_QUALITY_SCORE,
      });
    }

    const claimed = await db.execute<{
      asset_id: string;
      use_count: number;
    }>(sql`
      UPDATE ${assetService}
      SET last_used_at = now(), use_count = use_count + 1
      WHERE id = (
        SELECT asvc.id
        FROM ${assetService} asvc
        JOIN ${asset} a ON a.id = asvc.asset_id
        ${analysisJoin}
        WHERE asvc.service_id = ${serviceId}
          AND a.organization_id = ${organizationId}
          AND a.deleted_at IS NULL
          ${usable}
          ${typeFilter}
          ${transcodeFilter}
          ${qualityFloor}
          ${exclusion}
        -- Never-used first, then longest-ago. Own footage outranks stock only
        -- at equal freshness. captured_at breaks the remaining ties so a cold
        -- pool still starts on the org's most recent upload.
        ORDER BY asvc.last_used_at ASC NULLS FIRST,
                 ${ownBeforeStock},
                 a.captured_at DESC NULLS LAST,
                 a.created_at DESC
        LIMIT 1
        FOR UPDATE OF asvc SKIP LOCKED
      )
      RETURNING asset_id, use_count
    `);

    const row = claimed[0];
    if (!row) {
      // No eligible media, or every candidate is locked by a concurrent claim.
      return ok({
        assetId: null,
        previousUseCount: 0,
        poolSize,
        excludedForQuality,
      });
    }

    return ok({
      assetId: row.asset_id,
      previousUseCount: Math.max(0, Number(row.use_count) - 1),
      poolSize,
      excludedForQuality,
    });
  } catch (error) {
    // Rotation is an improvement, never a gate — the caller falls back to its
    // own ordering rather than failing to produce content.
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to claim a rotated asset',
        undefined,
        error instanceof Error ? error : new Error(String(error))
      )
    );
  }
};

export const claimRotatedAsset = (
  db: DbConnection,
  input: ClaimRotatedAssetInput
) =>
  trackedResult(
    'assets.claimRotatedAsset',
    () => claimRotatedAssetImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        serviceId: input.serviceId,
      },
      internalErrorsOnly: true,
    }
  );

export type ClaimRotatedAssetResult = Awaited<
  ReturnType<typeof claimRotatedAsset>
>;

/**
 * Stamp an asset as used for a service WITHOUT letting rotation choose it.
 *
 * `claimRotatedAsset` both picks and stamps, but not every path lets it pick:
 *   - the create-post dialog can pass explicit `sourceAssetIds`, which is an
 *     instruction we must honour rather than override
 *   - a failed claim still falls through to the default ordering and renders
 *
 * Without this, media used through those paths looks NEVER USED to the next
 * generation and gets picked first — so a photo the owner deliberately chose
 * yesterday is the one the next batch reaches for. Rotation memory has to
 * cover every generation, not just the ones it steered.
 *
 * Fire-and-forget: never throws, never blocks a render.
 */
export const markAssetUsed = async (
  db: DbConnection,
  input: { serviceId: string; assetId: string }
): Promise<void> => {
  if (!input.serviceId || !input.assetId) return;
  try {
    await db.execute(sql`
      UPDATE ${assetService}
      SET last_used_at = now(), use_count = use_count + 1
      WHERE service_id = ${input.serviceId}
        AND asset_id = ${input.assetId}
    `);
  } catch {
    // Rotation memory is an improvement, never a gate.
  }
};
