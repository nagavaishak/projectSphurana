import { asset, assetService, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, desc, eq, ne } from 'drizzle-orm';
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
  type ListAssetsByServiceInput,
  listAssetsByServiceSchema,
} from './list-assets-by-service.schema.js';

/**
 * List assets of the requested media type linked to a specific service,
 * ordered by confidence. Video remains the default for existing callers.
 */
const listAssetsByServiceImpl = async (
  db: DbConnection,
  input: ListAssetsByServiceInput
): Promise<Result<(typeof asset.$inferSelect)[]>> => {
  const parsed = listAssetsByServiceSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { serviceId, organizationId, type } = parsed.data;

  return withOrgScope(
    async (tx) => {
      const rows = await tx
        .select({
          asset: asset,
          confidence: assetService.confidence,
        })
        .from(assetService)
        .innerJoin(asset, eq(assetService.assetId, asset.id))
        .where(
          and(
            eq(assetService.serviceId, serviceId),
            eq(asset.organizationId, organizationId),
            eq(asset.type, type),
            ne(asset.source, 'stock'),
            notDeleted(asset)
          )
        )
        .orderBy(desc(assetService.confidence));

      return ok(rows.map((r) => r.asset));
    },
    { db }
  );
};

export const listAssetsByService = (
  db: DbConnection,
  input: ListAssetsByServiceInput
) =>
  trackedResult(
    'assets.listAssetsByService',
    () => listAssetsByServiceImpl(db, input),
    {
      properties: {
        serviceId: input.serviceId,
        organizationId: input.organizationId,
      },
      internalErrorsOnly: true,
    }
  );

export type ListAssetsByServiceResult = Awaited<
  ReturnType<typeof listAssetsByService>
>;
