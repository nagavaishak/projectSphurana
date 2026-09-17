import { randomUUID } from 'node:crypto';
import {
  type AssetUploadBatch,
  assetUploadBatch,
  withOrgScope,
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
import {
  type CreateUploadBatchInput,
  createUploadBatchSchema,
} from './create-upload-batch.schema.js';

const createUploadBatchImpl = async (
  db: DbConnection,
  input: CreateUploadBatchInput
): Promise<Result<AssetUploadBatch>> => {
  const parsed = createUploadBatchSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const [result] = await withOrgScope(
    (tx) =>
      tx
        .insert(assetUploadBatch)
        .values({
          id: randomUUID(),
          totalAssets: parsed.data.totalAssets,
          status: 'processing',
          organizationId: parsed.data.organizationId,
          createdById: parsed.data.createdById,
        })
        .returning(),
    { db }
  );

  return ok(result);
};

export const createUploadBatch = (
  db: DbConnection,
  input: CreateUploadBatchInput
) =>
  trackedResult(
    'assets.createUploadBatch',
    () => createUploadBatchImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        totalAssets: input.totalAssets,
      },
    }
  );

export type CreateUploadBatchResult = Awaited<
  ReturnType<typeof createUploadBatch>
>;
