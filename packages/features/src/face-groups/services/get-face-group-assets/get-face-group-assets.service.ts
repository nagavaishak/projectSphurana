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
  type GetFaceGroupAssetsInput,
  getFaceGroupAssetsSchema,
} from './get-face-group-assets.schema.js';

export interface FaceGroupAssetItem {
  id: string;
  assetId: string;
  role: 'before' | 'after' | 'untagged';
  asset: {
    id: string;
    name: string;
    blobUrl: string;
    type: string;
    duration: number | null;
    width: number | null;
    height: number | null;
    createdAt: string;
  };
}

export interface GetFaceGroupAssetsResponse {
  faceGroup: {
    id: string;
    clientName: string | null;
    serviceId: string | null;
  };
  assets: FaceGroupAssetItem[];
}

const ROLE_ORDER: Record<string, number> = {
  before: 0,
  after: 1,
  untagged: 2,
};

const getFaceGroupAssetsImpl = async (
  db: DbConnection,
  input: GetFaceGroupAssetsInput
): Promise<Result<GetFaceGroupAssetsResponse>> => {
  const parsed = getFaceGroupAssetsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { faceGroupId, organizationId } = parsed.data;

  return withOrgScope(
    async (tx) => {
      // Verify face group exists and belongs to the organization
      const fg = await tx.query.faceGroup.findFirst({
        where: (f, { eq: e, and: a }) =>
          a(e(f.id, faceGroupId), e(f.organizationId, organizationId)),
      });

      if (!fg) {
        return err(
          new FeatureError(ErrorCodes.NOT_FOUND, 'Face group not found')
        );
      }

      // Fetch all face group assets with joined asset data
      const faceGroupAssets = await tx.query.faceGroupAsset.findMany({
        where: (fga, { eq: e }) => e(fga.faceGroupId, faceGroupId),
        with: {
          asset: true,
        },
      });

      // Map and sort results
      const assets: FaceGroupAssetItem[] = faceGroupAssets
        .filter((fga) => fga.asset != null && !fga.asset.deletedAt)
        .map((fga) => ({
          id: fga.id,
          assetId: fga.assetId,
          role: fga.role,
          asset: {
            id: fga.asset.id,
            name: fga.asset.name,
            blobUrl: fga.asset.blobUrl,
            type: fga.asset.type,
            duration: fga.asset.duration,
            width: fga.asset.width,
            height: fga.asset.height,
            createdAt: fga.asset.createdAt.toISOString(),
          },
        }))
        .sort((a, b) => {
          const roleA = ROLE_ORDER[a.role] ?? 2;
          const roleB = ROLE_ORDER[b.role] ?? 2;
          if (roleA !== roleB) return roleA - roleB;
          return a.asset.createdAt.localeCompare(b.asset.createdAt);
        });

      return ok({
        faceGroup: {
          id: fg.id,
          clientName: fg.clientName,
          serviceId: fg.serviceId,
        },
        assets,
      });
    },
    { db }
  );
};

export const getFaceGroupAssets = (
  db: DbConnection,
  input: GetFaceGroupAssetsInput
) =>
  trackedResult(
    'faceGroups.getFaceGroupAssets',
    () => getFaceGroupAssetsImpl(db, input),
    {
      properties: {
        faceGroupId: input.faceGroupId,
        organizationId: input.organizationId,
      },
      internalErrorsOnly: true,
    }
  );

export type GetFaceGroupAssetsResult = Awaited<
  ReturnType<typeof getFaceGroupAssets>
>;
