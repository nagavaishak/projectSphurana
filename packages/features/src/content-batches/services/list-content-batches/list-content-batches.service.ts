import { contentBatch, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, desc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListContentBatchesInput,
  listContentBatchesSchema,
} from './list-content-batches.schema.js';

export interface ListContentBatchesResponse {
  items: (typeof contentBatch.$inferSelect)[];
  limit: number;
  offset: number;
}

const listContentBatchesImpl = async (
  db: DbConnection,
  input: ListContentBatchesInput
): Promise<Result<ListContentBatchesResponse>> => {
  const parsed = listContentBatchesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, status, limit, offset } = parsed.data;

  const conditions = [eq(contentBatch.organizationId, organizationId)];
  if (status) conditions.push(eq(contentBatch.status, status));

  const items = await withOrgScope(
    (tx) =>
      tx.query.contentBatch.findMany({
        where: and(...conditions),
        limit,
        offset,
        orderBy: [desc(contentBatch.createdAt)],
      }),
    { db }
  );

  return ok({ items, limit, offset });
};

export const listContentBatches = (
  db: DbConnection,
  input: ListContentBatchesInput
) =>
  trackedResult(
    'contentBatches.listContentBatches',
    () => listContentBatchesImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

export type ListContentBatchesResult = Awaited<
  ReturnType<typeof listContentBatches>
>;
