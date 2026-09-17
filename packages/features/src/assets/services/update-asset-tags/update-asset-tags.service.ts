import { asset, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
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
  type AddAssetTagsInput,
  type RemoveAssetTagsInput,
  type UpdateAssetTagsInput,
  addAssetTagsSchema,
  removeAssetTagsSchema,
  updateAssetTagsSchema,
} from './update-asset-tags.schema.js';

/**
 * Internal implementation of update asset tags
 */
const updateAssetTagsImpl = async (
  db: DbConnection,
  input: UpdateAssetTagsInput
): Promise<Result<typeof asset.$inferSelect>> => {
  // Validate input
  const parsed = updateAssetTagsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { assetId, organizationId, tags } = parsed.data;

  return withOrgScope(
    async (tx) => {
      // Verify asset exists and belongs to the organization
      const existingAsset = await tx.query.asset.findFirst({
        where: (a, { eq, and, isNull }) =>
          and(
            eq(a.id, assetId),
            eq(a.organizationId, organizationId),
            isNull(a.deletedAt)
          ),
      });

      if (!existingAsset) {
        return err(
          new FeatureError(ErrorCodes.NOT_FOUND, 'Asset not found', { assetId })
        );
      }

      // Normalize and dedupe tags
      const normalizedTags = [
        ...new Set(tags.map((t) => t.trim().toLowerCase())),
      ];

      // Update the tags
      const [updated] = await tx
        .update(asset)
        .set({ tags: normalizedTags })
        .where(and(eq(asset.id, assetId), notDeleted(asset)))
        .returning();

      return ok(updated);
    },
    { db }
  );
};

/**
 * Update asset tags (replace all tags)
 *
 * @param db - Database connection
 * @param input - Update asset tags input
 * @returns Result with updated asset or error
 */
export const updateAssetTags = (
  db: DbConnection,
  input: UpdateAssetTagsInput
) =>
  trackedResult(
    'assets.updateAssetTags',
    () => updateAssetTagsImpl(db, input),
    {
      properties: {
        assetId: input.assetId,
        organizationId: input.organizationId,
        tagCount: input.tags.length,
      },
    }
  );

/**
 * Result type for updateAssetTags
 */
export type UpdateAssetTagsResult = Awaited<ReturnType<typeof updateAssetTags>>;

/**
 * Internal implementation of add asset tags
 */
const addAssetTagsImpl = async (
  db: DbConnection,
  input: AddAssetTagsInput
): Promise<Result<typeof asset.$inferSelect>> => {
  // Validate input
  const parsed = addAssetTagsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { assetId, organizationId, tags } = parsed.data;

  return withOrgScope(
    async (tx) => {
      // Verify asset exists and belongs to the organization
      const existingAsset = await tx.query.asset.findFirst({
        where: (a, { eq, and, isNull }) =>
          and(
            eq(a.id, assetId),
            eq(a.organizationId, organizationId),
            isNull(a.deletedAt)
          ),
      });

      if (!existingAsset) {
        return err(
          new FeatureError(ErrorCodes.NOT_FOUND, 'Asset not found', { assetId })
        );
      }

      // Normalize new tags
      const normalizedNewTags = tags.map((t) => t.trim().toLowerCase());

      // Merge with existing tags, dedupe
      const mergedTags = [
        ...new Set([...existingAsset.tags, ...normalizedNewTags]),
      ];

      // Limit to 20 tags
      if (mergedTags.length > 20) {
        return err(
          new FeatureError(
            ErrorCodes.VALIDATION_ERROR,
            'Maximum 20 tags allowed per asset',
            { currentCount: mergedTags.length }
          )
        );
      }

      // Update the tags
      const [updated] = await tx
        .update(asset)
        .set({ tags: mergedTags })
        .where(and(eq(asset.id, assetId), notDeleted(asset)))
        .returning();

      return ok(updated);
    },
    { db }
  );
};

/**
 * Add tags to an asset (merge with existing)
 *
 * @param db - Database connection
 * @param input - Add asset tags input
 * @returns Result with updated asset or error
 */
export const addAssetTags = (db: DbConnection, input: AddAssetTagsInput) =>
  trackedResult('assets.addAssetTags', () => addAssetTagsImpl(db, input), {
    properties: {
      assetId: input.assetId,
      organizationId: input.organizationId,
      newTagCount: input.tags.length,
    },
  });

/**
 * Result type for addAssetTags
 */
export type AddAssetTagsResult = Awaited<ReturnType<typeof addAssetTags>>;

/**
 * Internal implementation of remove asset tags
 */
const removeAssetTagsImpl = async (
  db: DbConnection,
  input: RemoveAssetTagsInput
): Promise<Result<typeof asset.$inferSelect>> => {
  // Validate input
  const parsed = removeAssetTagsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { assetId, organizationId, tags } = parsed.data;

  return withOrgScope(
    async (tx) => {
      // Verify asset exists and belongs to the organization
      const existingAsset = await tx.query.asset.findFirst({
        where: (a, { eq, and, isNull }) =>
          and(
            eq(a.id, assetId),
            eq(a.organizationId, organizationId),
            isNull(a.deletedAt)
          ),
      });

      if (!existingAsset) {
        return err(
          new FeatureError(ErrorCodes.NOT_FOUND, 'Asset not found', { assetId })
        );
      }

      // Normalize tags to remove
      const tagsToRemove = new Set(tags.map((t) => t.trim().toLowerCase()));

      // Filter out the tags to remove
      const remainingTags = existingAsset.tags.filter(
        (t) => !tagsToRemove.has(t.toLowerCase())
      );

      // Update the tags
      const [updated] = await tx
        .update(asset)
        .set({ tags: remainingTags })
        .where(and(eq(asset.id, assetId), notDeleted(asset)))
        .returning();

      return ok(updated);
    },
    { db }
  );
};

/**
 * Remove tags from an asset
 *
 * @param db - Database connection
 * @param input - Remove asset tags input
 * @returns Result with updated asset or error
 */
export const removeAssetTags = (
  db: DbConnection,
  input: RemoveAssetTagsInput
) =>
  trackedResult(
    'assets.removeAssetTags',
    () => removeAssetTagsImpl(db, input),
    {
      properties: {
        assetId: input.assetId,
        organizationId: input.organizationId,
        removeTagCount: input.tags.length,
      },
    }
  );

/**
 * Result type for removeAssetTags
 */
export type RemoveAssetTagsResult = Awaited<ReturnType<typeof removeAssetTags>>;
