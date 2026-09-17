import {
  asset,
  assetAnalysis,
  assetService,
  user,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  type SQL,
  and,
  desc,
  eq,
  inArray,
  isNull,
  notInArray,
  or,
} from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type ListBatchAssetsInput,
  listBatchAssetsSchema,
} from './list-batch-assets.schema.js';

const listBatchAssetsImpl = async (
  db: DbConnection,
  input: ListBatchAssetsInput
) => {
  const parsed = listBatchAssetsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    batchId,
    organizationId,
    contentType,
    contentTypeIn,
    contentTypeNotIn,
    limit,
    offset,
  } = parsed.data;

  const conditions = [
    eq(asset.batchId, batchId),
    eq(asset.organizationId, organizationId),
    notDeleted(asset),
  ];

  if (contentType) {
    conditions.push(eq(assetAnalysis.contentType, contentType));
  }

  if (contentTypeIn && contentTypeIn.length > 0) {
    conditions.push(inArray(assetAnalysis.contentType, contentTypeIn));
  }

  if (contentTypeNotIn && contentTypeNotIn.length > 0) {
    // Match assets where contentType is NOT in the list OR is NULL
    // SQL NOT IN doesn't match NULLs, so we need the OR isNull() branch
    conditions.push(
      or(
        notInArray(assetAnalysis.contentType, contentTypeNotIn),
        isNull(assetAnalysis.contentType)
      ) as SQL
    );
  }

  return withOrgScope(
    async (tx) => {
      const items = await tx
        .select({
          id: asset.id,
          name: asset.name,
          blobUrl: asset.blobUrl,
          sourceFileName: asset.sourceFileName,
          tags: asset.tags,
          clientName: asset.clientName,
          type: asset.type,
          duration: asset.duration,
          width: asset.width,
          height: asset.height,
          organizationId: asset.organizationId,
          createdAt: asset.createdAt,
          updatedAt: asset.updatedAt,
          analysis: {
            id: assetAnalysis.id,
            status: assetAnalysis.status,
            contentType: assetAnalysis.contentType,
            analysisResult: assetAnalysis.analysisResult,
          },
          uploader: {
            id: user.id,
            name: user.name,
            image: user.image,
          },
        })
        .from(asset)
        .leftJoin(assetAnalysis, eq(assetAnalysis.assetId, asset.id))
        .leftJoin(user, eq(asset.uploadedById, user.id))
        .where(and(...conditions))
        .orderBy(desc(asset.createdAt))
        .limit(limit)
        .offset(offset);

      // Batch-fetch linked serviceIds for all returned assets
      const assetIds = items.map((i) => i.id);
      let serviceLinks: { assetId: string; serviceId: string }[] = [];
      if (assetIds.length > 0) {
        serviceLinks = await tx
          .select({
            assetId: assetService.assetId,
            serviceId: assetService.serviceId,
          })
          .from(assetService)
          .where(inArray(assetService.assetId, assetIds));
      }

      // Group serviceIds by assetId
      const serviceIdsByAsset = new Map<string, string[]>();
      for (const link of serviceLinks) {
        const existing = serviceIdsByAsset.get(link.assetId);
        if (existing) {
          existing.push(link.serviceId);
        } else {
          serviceIdsByAsset.set(link.assetId, [link.serviceId]);
        }
      }

      const itemsWithServices = items.map((item) => ({
        ...item,
        serviceIds: serviceIdsByAsset.get(item.id) ?? [],
      }));

      return ok({
        items: itemsWithServices,
        total: items.length,
        limit,
        offset,
      });
    },
    { db }
  );
};

export const listBatchAssets = (
  db: DbConnection,
  input: ListBatchAssetsInput
) =>
  trackedResult(
    'assets.listBatchAssets',
    () => listBatchAssetsImpl(db, input),
    {
      properties: {
        batchId: input.batchId,
        organizationId: input.organizationId,
        contentType: input.contentType,
      },
    }
  );

export type ListBatchAssetsResult = Awaited<ReturnType<typeof listBatchAssets>>;
