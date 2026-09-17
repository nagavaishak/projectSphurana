/**
 * `primeStockRotation` — admit a service's matched stock clips to its rotation
 * pool, so stock competes with the org's own media instead of waiting below it.
 *
 * WHY THIS EXISTS
 * ---------------
 * Stock was a FALLBACK: selection asked for the org's own media, and only when
 * that returned nothing did it reach for the bank. That is unreachable for any
 * service that has media at all — which is why a service with one eligible clip
 * opened on that clip forever. Rotation was working as designed and the owner
 * still saw the same footage in every video.
 *
 * `mintStockAssets` already creates ordinary org-owned `asset` rows for stock
 * (pre-transcoded, so they clear the export gate immediately). The only thing
 * missing was the `asset_service` link. With it, stock lands in the same LRU
 * queue `claimRotatedAsset` walks, and the repetition resolves without any
 * ranking logic: the own clip is never-used and wins first, then carries a
 * timestamp the stock clip doesn't.
 *
 * WHY PRIMING IS A SEPARATE STEP
 * ------------------------------
 * A candidate has to be IN the pool before it can be chosen, and minting only
 * on selection is the chicken-and-egg version of the same fallback bug — stock
 * that has never been picked looks like it doesn't exist. So the pool is primed
 * before the claim.
 *
 * It runs at generation time for the one service being generated for, never as
 * a sweep across the org's catalogue: on production's 1,629 active services
 * that would mint tens of thousands of asset rows for services nobody has
 * generated content for.
 *
 * Idempotent by construction. `mintStockAssets` reuses any row already minted
 * for the org, and the link insert conflicts on `asset_service_unique`, so
 * re-priming an already-primed service is a no-op that costs two queries.
 * Priming NEVER stamps `last_used_at` — a freshly admitted stock clip must look
 * never-used, or it would sort behind the owner's media it was admitted to
 * relieve.
 */

import {
  assetService,
  isForeignKeyViolation,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { resolveStockClipRefs } from '../_shared/resolve-stock-clip-refs.js';
import { mintStockAssets } from '../mint-stock-assets/index.js';
import {
  type PrimeStockRotationInput,
  primeStockRotationSchema,
} from './prime-stock-rotation.schema.js';

export interface PrimeStockRotationOutput {
  /** Asset ids now linked to this service, whether newly minted or reused. */
  assetIds: string[];
  /** Links created by THIS call — 0 when the pool was already primed. */
  linksCreated: number;
}

const primeStockRotationImpl = async (
  db: DbConnection,
  input: PrimeStockRotationInput
): Promise<Result<PrimeStockRotationOutput>> => {
  const parsed = primeStockRotationSchema.safeParse(input);
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
    uploadedById,
    count,
    mediaType,
    vertical,
  } = parsed.data;

  const resolved = await resolveStockClipRefs(db, {
    organizationId,
    serviceId,
    count,
    vertical,
    // `mediaType` is a STRICT filter here rather than a preference: a still
    // admitted to a video pool would be claimed for a clip slot it cannot fill.
    mediaType,
  });

  // SERVICE-MATCHED CLIPS ONLY — never the generic/ambient pool.
  //
  // `resolveStockClipRefs` returns the matcher's picks for this service first
  // and then tops up from the vertical's generic pool. That top-up is a
  // reasonable LAST RESORT for one render, but admitting it here would be
  // different in kind: a link is PERMANENT, so a generic clip borrowed once to
  // fill a gap would join this service's rotation for good and keep coming
  // back on its own merit.
  //
  // That is not hypothetical. In the STAGING bank (which local dev also reads)
  // the generic video pool is five clips and every one of them is a facial, so
  // priming from it would enrol facials into the permanent rotation of every
  // service short of matches — turning a one-render filler into a standing
  // "wrong treatment" complaint, and doing it under the banner of fixing
  // repetition. A real report of exactly that shape ("body contouring video,
  // last clip is a facial") is what surfaced this.
  //
  // Rotation's job is to stop the same RIGHT clip repeating. It must not widen
  // the pool with clips that are merely available.
  const refs = resolved.filter((r) => !r.isGeneric);
  if (refs.length === 0) return ok({ assetIds: [], linksCreated: 0 });

  const minted = await mintStockAssets(db, {
    organizationId,
    uploadedById,
    stockClipIds: refs.map((r) => r.id),
  });
  if (!minted.success) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to mint stock assets for rotation'
      )
    );
  }

  const assetIds = refs
    .map((ref) => minted.data[ref.id])
    .filter((id): id is string => Boolean(id));
  if (assetIds.length === 0) return ok({ assetIds: [], linksCreated: 0 });

  try {
    const created = await db
      .insert(assetService)
      .values(
        assetIds.map((assetId) => ({
          assetId,
          serviceId,
          // Stock is matched to a service by the matcher, not chosen by a human.
          isAutoGenerated: true,
          // No `confidence`: the matcher's score lives on `service_stock_clip`
          // and means something different from a vision link confidence. Writing
          // it here would put two incomparable numbers in one column.
        }))
      )
      .onConflictDoNothing({
        target: [assetService.assetId, assetService.serviceId],
      })
      .returning({ id: assetService.id });

    return ok({ assetIds, linksCreated: created.length });
  } catch (error) {
    // The service (or the minted asset) was deleted between resolving the
    // stock refs above and this insert. drizzle wraps the postgres.js error —
    // the constraint lives on the `.cause` chain, not `error.message` (see
    // isForeignKeyViolation).
    if (
      isForeignKeyViolation(error, 'asset_service_asset_id_asset_id_fk') ||
      isForeignKeyViolation(
        error,
        'asset_service_service_id_organization_service_id_fk'
      )
    ) {
      return err(
        new FeatureError(
          ErrorCodes.NOT_FOUND,
          'The service or minted stock asset no longer exists'
        )
      );
    }
    throw error;
  }
};

export const primeStockRotation = (
  db: DbConnection,
  input: PrimeStockRotationInput
) =>
  trackedResult(
    'stockFootage.primeStockRotation',
    () => primeStockRotationImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        serviceId: input.serviceId,
      },
      // Priming is an improvement, never a gate — a service with no matched
      // stock is an ordinary outcome, not a failure worth alerting on.
      internalErrorsOnly: true,
    }
  );

export type PrimeStockRotationResult = Awaited<
  ReturnType<typeof primeStockRotation>
>;
