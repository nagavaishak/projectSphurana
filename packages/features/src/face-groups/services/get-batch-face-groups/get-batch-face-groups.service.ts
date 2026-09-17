import { withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type GetBatchFaceGroupsInput,
  getBatchFaceGroupsSchema,
} from './get-batch-face-groups.schema.js';

export interface FaceGroupWithAssets {
  id: string;
  organizationId: string;
  clientName: string | null;
  serviceId: string | null;
  assets: Array<{
    id: string;
    assetId: string;
    role: 'before' | 'after' | 'untagged';
    asset: {
      id: string;
      name: string;
      blobUrl: string;
      type: string;
    };
  }>;
}

export interface BatchFaceGroupsResponse {
  faceGroups: FaceGroupWithAssets[];
  status: 'complete';
}

const getBatchFaceGroupsImpl = async (
  db: DbConnection,
  input: GetBatchFaceGroupsInput
): Promise<Result<BatchFaceGroupsResponse>> => {
  const parsed = getBatchFaceGroupsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { batchId, organizationId } = parsed.data;

  return withOrgScope(
    async (tx) => {
      // Check batch status for face detection completion
      const batch = await tx.query.assetUploadBatch.findFirst({
        where: (b, { eq: e, and: a }) =>
          a(e(b.id, batchId), e(b.organizationId, organizationId)),
      });

      if (!batch) {
        return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Batch not found'));
      }

      // Get all face group assets for this batch with their groups and assets
      const batchFaceGroupAssets = await tx.query.faceGroupAsset.findMany({
        where: (fga, { eq: e }) => e(fga.batchId, batchId),
        with: {
          faceGroup: true,
          asset: true,
        },
      });

      // Group by faceGroupId
      const groupMap = new Map<string, FaceGroupWithAssets>();

      for (const fga of batchFaceGroupAssets) {
        const fg = fga.faceGroup;
        if (!fg) continue;

        if (!groupMap.has(fg.id)) {
          groupMap.set(fg.id, {
            id: fg.id,
            organizationId: fg.organizationId,
            clientName: fg.clientName,
            serviceId: fg.serviceId,
            assets: [],
          });
        }

        const group = groupMap.get(fg.id);
        if (!group) continue;
        if (fga.asset && !fga.asset.deletedAt) {
          group.assets.push({
            id: fga.id,
            assetId: fga.assetId,
            role: fga.role,
            asset: {
              id: fga.asset.id,
              name: fga.asset.name,
              blobUrl: fga.asset.blobUrl,
              type: fga.asset.type,
            },
          });
        }
      }

      return ok({
        faceGroups: Array.from(groupMap.values()),
        status: 'complete' as const,
      });
    },
    { db }
  );
};

export const getBatchFaceGroups = (
  db: DbConnection,
  input: GetBatchFaceGroupsInput
) =>
  trackedResult(
    'faceGroups.getBatchFaceGroups',
    () => getBatchFaceGroupsImpl(db, input),
    {
      properties: {
        batchId: input.batchId,
        organizationId: input.organizationId,
      },
      internalErrorsOnly: true,
    }
  );

export type GetBatchFaceGroupsResult = Awaited<
  ReturnType<typeof getBatchFaceGroups>
>;
