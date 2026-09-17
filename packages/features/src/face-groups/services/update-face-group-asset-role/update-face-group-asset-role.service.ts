import {
  type FaceGroupAsset,
  asset,
  faceGroupAsset,
  withOrgScope,
} from '@borradh-workspace/database';
import type { AssetContentTypeTag } from '@borradh-workspace/database';
import { assetContentTypeTagValues } from '@borradh-workspace/labels';
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
  type UpdateFaceGroupAssetRoleInput,
  updateFaceGroupAssetRoleSchema,
} from './update-face-group-asset-role.schema.js';

const updateFaceGroupAssetRoleImpl = async (
  db: DbConnection,
  input: UpdateFaceGroupAssetRoleInput
): Promise<Result<FaceGroupAsset>> => {
  const parsed = updateFaceGroupAssetRoleSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { faceGroupId, assetId, organizationId, role } = parsed.data;

  return withOrgScope(
    async (tx) => {
      // Verify the face group belongs to the org
      const group = await tx.query.faceGroup.findFirst({
        where: (fg, { eq: e, and: a }) =>
          a(e(fg.id, faceGroupId), e(fg.organizationId, organizationId)),
      });

      if (!group) {
        return err(
          new FeatureError(ErrorCodes.NOT_FOUND, 'Face group not found')
        );
      }

      // Update the role on the junction record
      const [updated] = await tx
        .update(faceGroupAsset)
        .set({ role })
        .where(
          and(
            eq(faceGroupAsset.faceGroupId, faceGroupId),
            eq(faceGroupAsset.assetId, assetId)
          )
        )
        .returning();

      if (!updated) {
        return err(
          new FeatureError(
            ErrorCodes.NOT_FOUND,
            'Face group asset association not found'
          )
        );
      }

      // Sync asset.tags based on role assignment
      const existingAsset = await tx.query.asset.findFirst({
        where: and(eq(asset.id, assetId), notDeleted(asset)),
        columns: { tags: true },
      });

      const currentTags = existingAsset?.tags ?? [];
      const tagSet = new Set<string>(
        assetContentTypeTagValues as readonly string[]
      );
      const nonContentTypeTags = currentTags.filter(
        (t: string) => !tagSet.has(t)
      );

      const roleToTag: Record<string, AssetContentTypeTag> = {
        before: 'before',
        after: 'after',
        untagged: 'pending-result',
      };
      const newTag = roleToTag[role];
      const updatedTags = newTag
        ? [newTag, ...nonContentTypeTags]
        : nonContentTypeTags;

      await tx
        .update(asset)
        .set({ tags: updatedTags })
        .where(and(eq(asset.id, assetId), notDeleted(asset)));

      return ok(updated);
    },
    { db }
  );
};

export const updateFaceGroupAssetRole = (
  db: DbConnection,
  input: UpdateFaceGroupAssetRoleInput
) =>
  trackedResult(
    'faceGroups.updateFaceGroupAssetRole',
    () => updateFaceGroupAssetRoleImpl(db, input),
    {
      properties: {
        faceGroupId: input.faceGroupId,
        assetId: input.assetId,
        role: input.role,
      },
    }
  );

export type UpdateFaceGroupAssetRoleResult = Awaited<
  ReturnType<typeof updateFaceGroupAssetRole>
>;
