/**
 * `listServiceIdsWithMedia` — which services have graphic-eligible media?
 *
 * A graphic's image slots are filled from a service's uploaded media (see the
 * tier-1/tier-2 chain in `image-generation/.../resolve-slot-image`). A service
 * is "graphic-eligible" when it has at least one linked asset that the resolver
 * can actually use:
 *   - any `image` asset, OR
 *   - a `video` asset with a non-null `thumbnailUrl` (the screenshot we render).
 *
 * Everything keys off the `asset_service` many-to-many junction, so a single
 * asset linked to multiple services makes every one of those services eligible.
 *
 * Used by:
 *   - the manual generate-graphic picker (via `listServices` → `hasGraphicMedia`)
 *   - the monthly batch planner, to restrict GRAPHIC items to media-backed
 *     services (videos are planned independently and are not gated here).
 *
 * Returns a deduped array of service IDs; callers typically wrap it in a `Set`.
 */

import { asset, assetService, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type ListServicesWithMediaInput,
  listServicesWithMediaSchema,
} from './list-services-with-media.schema.js';

const listServicesWithMediaImpl = async (
  db: DbConnection,
  input: ListServicesWithMediaInput
): Promise<Result<string[]>> => {
  const parsed = listServicesWithMediaSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  const rows = await db
    .selectDistinct({ serviceId: assetService.serviceId })
    .from(assetService)
    .innerJoin(asset, eq(assetService.assetId, asset.id))
    .where(
      and(
        eq(asset.organizationId, organizationId),
        notDeleted(asset),
        or(
          eq(asset.type, 'image'),
          and(
            eq(asset.type, 'video'),
            isNotNull(asset.thumbnailUrl),
            inArray(asset.transcodeStatus, ['ready', 'skipped'])
          )
        )
      )
    );

  return ok(rows.map((r) => r.serviceId));
};

export const listServiceIdsWithMedia = (
  db: DbConnection,
  input: ListServicesWithMediaInput
) =>
  trackedResult(
    'organizationServices.listServiceIdsWithMedia',
    () => withOrgScope((tx) => listServicesWithMediaImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type ListServicesWithMediaResult = Awaited<
  ReturnType<typeof listServiceIdsWithMedia>
>;

/**
 * `listServiceIdsWithVideoFootage` — which services have their OWN uploaded
 * VIDEO clips?
 *
 * Distinct from {@link listServiceIdsWithMedia} (graphic-eligibility, which
 * also counts images and uses a video's thumbnail). An organic video is built
 * from the target service's video clips and must NOT borrow another service's
 * footage, so the monthly planner uses this set to restrict VIDEO items to
 * services that can actually back them — mirroring how graphics are gated on
 * graphic media. Requires a real `video` asset linked via `asset_service`; no
 * thumbnail needed (the clip itself is the footage).
 *
 * Returns a deduped array of service IDs; callers typically wrap it in a `Set`.
 */
const listServiceIdsWithVideoFootageImpl = async (
  db: DbConnection,
  input: ListServicesWithMediaInput
): Promise<Result<string[]>> => {
  const parsed = listServicesWithMediaSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  const rows = await db
    .selectDistinct({ serviceId: assetService.serviceId })
    .from(assetService)
    .innerJoin(asset, eq(assetService.assetId, asset.id))
    .where(
      and(
        eq(asset.organizationId, organizationId),
        eq(asset.type, 'video'),
        notDeleted(asset),
        inArray(asset.transcodeStatus, ['ready', 'skipped'])
      )
    );

  return ok(rows.map((r) => r.serviceId));
};

export const listServiceIdsWithVideoFootage = (
  db: DbConnection,
  input: ListServicesWithMediaInput
) =>
  trackedResult(
    'organizationServices.listServiceIdsWithVideoFootage',
    () =>
      withOrgScope((tx) => listServiceIdsWithVideoFootageImpl(tx, input), {
        db,
      }),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type ListServicesWithVideoFootageResult = Awaited<
  ReturnType<typeof listServiceIdsWithVideoFootage>
>;
