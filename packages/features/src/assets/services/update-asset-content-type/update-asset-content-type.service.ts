import {
  asset,
  assetAnalysis,
  withOrgScope,
} from '@borradh-workspace/database';
import {
  assetContentTypeTagValues,
  contentTypeToTagMap,
} from '@borradh-workspace/labels';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type UpdateAssetContentTypeInput,
  updateAssetContentTypeSchema,
} from './update-asset-content-type.schema.js';

const updateAssetContentTypeImpl = async (
  db: DbConnection,
  input: UpdateAssetContentTypeInput
) => {
  const parsed = updateAssetContentTypeSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { assetId, organizationId, contentType } = parsed.data;

  return withOrgScope(
    async (tx) => {
      // Verify asset belongs to org
      const existingAsset = await tx.query.asset.findFirst({
        where: (a, { eq: e, and: a2, isNull }) =>
          a2(
            e(a.id, assetId),
            e(a.organizationId, organizationId),
            isNull(a.deletedAt)
          ),
      });

      if (!existingAsset) {
        return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Asset not found'));
      }

      try {
        const [updated] = await tx
          .update(assetAnalysis)
          .set({ contentType })
          .where(eq(assetAnalysis.assetId, assetId))
          .returning();

        if (!updated) {
          return err(
            new FeatureError(
              ErrorCodes.NOT_FOUND,
              'Asset analysis not found — asset may not have been analyzed yet'
            )
          );
        }

        // Sync asset.tags: remove old content type tag, add new one
        const currentTags = existingAsset.tags ?? [];
        const tagSet = new Set<string>(
          assetContentTypeTagValues as readonly string[]
        );
        const nonContentTypeTags = currentTags.filter(
          (t: string) => !tagSet.has(t)
        );
        const newTag = contentTypeToTagMap[contentType];
        const updatedTags = newTag
          ? [newTag, ...nonContentTypeTags]
          : nonContentTypeTags;

        await tx
          .update(asset)
          .set({ tags: updatedTags })
          .where(and(eq(asset.id, assetId), notDeleted(asset)));

        return ok(updated);
      } catch (error) {
        logError('assets.updateAssetContentType', error, {
          feature: 'assets',
          extra: { assetId, contentType },
        });
        return err(
          new FeatureError(
            ErrorCodes.INTERNAL_ERROR,
            'Failed to update content type'
          )
        );
      }
    },
    { db }
  );
};

export const updateAssetContentType = (
  db: DbConnection,
  input: UpdateAssetContentTypeInput
) =>
  trackedResult(
    'assets.updateAssetContentType',
    () => updateAssetContentTypeImpl(db, input),
    {
      properties: {
        assetId: input.assetId,
        contentType: input.contentType,
      },
    }
  );

export type UpdateAssetContentTypeResult = Awaited<
  ReturnType<typeof updateAssetContentType>
>;
