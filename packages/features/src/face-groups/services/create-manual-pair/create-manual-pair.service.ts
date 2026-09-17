import { randomUUID } from 'node:crypto';
import {
  asset,
  faceGroup,
  faceGroupAsset,
  isUniqueViolation,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type CreateManualPairInput,
  createManualPairSchema,
} from './create-manual-pair.schema.js';

const createManualPairImpl = async (
  db: DbConnection,
  input: CreateManualPairInput
) => {
  const parsed = createManualPairSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationId,
    batchId,
    beforeAssetId,
    afterAssetId,
    clientName,
    serviceId,
  } = parsed.data;

  if (beforeAssetId === afterAssetId) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Before and after assets must be different'
      )
    );
  }

  return withOrgScope(
    async (tx) => {
      // Verify both assets belong to the org
      const assets = await tx
        .select({ id: asset.id })
        .from(asset)
        .where(
          and(
            inArray(asset.id, [beforeAssetId, afterAssetId]),
            eq(asset.organizationId, organizationId),
            notDeleted(asset)
          )
        );

      if (assets.length !== 2) {
        return err(
          new FeatureError(
            ErrorCodes.NOT_FOUND,
            'One or both assets not found in this organization'
          )
        );
      }

      try {
        const groupId = randomUUID();

        // Create face group
        const [group] = await tx
          .insert(faceGroup)
          .values({
            id: groupId,
            organizationId,
            clientName: clientName ?? null,
            serviceId: serviceId ?? null,
          })
          .returning();

        // Create the two face_group_asset junction records
        const junctionRecords = await tx
          .insert(faceGroupAsset)
          .values([
            {
              id: randomUUID(),
              faceGroupId: groupId,
              assetId: beforeAssetId,
              batchId,
              role: 'before' as const,
            },
            {
              id: randomUUID(),
              faceGroupId: groupId,
              assetId: afterAssetId,
              batchId,
              role: 'after' as const,
            },
          ])
          .returning();

        return ok({
          faceGroup: group,
          assets: junctionRecords,
        });
      } catch (error) {
        // drizzle wraps the postgres.js error — the constraint lives on the
        // `.cause` chain, not `error.message` (see isUniqueViolation).
        if (
          isUniqueViolation(
            error,
            'face_group_asset_face_group_id_asset_id_unique'
          )
        ) {
          return err(
            new FeatureError(
              ErrorCodes.ALREADY_EXISTS,
              'One of these assets is already paired in a face group'
            )
          );
        }

        logError('faceGroups.createManualPair', error, {
          feature: 'face-groups',
          extra: { organizationId, beforeAssetId, afterAssetId },
        });
        return err(
          new FeatureError(
            ErrorCodes.INTERNAL_ERROR,
            'Failed to create manual pair'
          )
        );
      }
    },
    { db }
  );
};

export const createManualPair = (
  db: DbConnection,
  input: CreateManualPairInput
) =>
  trackedResult(
    'faceGroups.createManualPair',
    () => createManualPairImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        beforeAssetId: input.beforeAssetId,
        afterAssetId: input.afterAssetId,
      },
    }
  );

export type CreateManualPairResult = Awaited<
  ReturnType<typeof createManualPair>
>;
