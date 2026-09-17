import { type StockClip, stockClip } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type UpsertStockClipInput,
  upsertStockClipSchema,
} from './upsert-stock-clip.schema.js';

/**
 * Upsert a curated stock clip catalog row, keyed on `blobUrl` (the content
 * address). Idempotent: re-seeding the same bytes updates metadata in place
 * rather than duplicating. Runs as a system/seed operation — stock_clip is a
 * global, un-scoped reference table.
 */
const upsertStockClipImpl = async (
  db: DbConnection,
  input: UpsertStockClipInput
): Promise<Result<StockClip>> => {
  const parsed = upsertStockClipSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const values = {
    ...parsed.data,
    transcodedBlobUrl: parsed.data.transcodedBlobUrl ?? parsed.data.blobUrl,
  };

  try {
    // Dedupe on `externalAssetId` first, falling back to the content address.
    //
    // `blobUrl` is per-ENVIRONMENT — the bucket differs between staging and
    // prod — so it identifies an object, not a clip. `externalAssetId` is
    // stable across environments and carries a unique index, so keying on
    // blobUrl alone would raise a constraint violation the moment the same
    // clip is seeded into a second environment.
    const existing = await db.query.stockClip.findFirst({
      where: values.externalAssetId
        ? eq(stockClip.externalAssetId, values.externalAssetId)
        : eq(stockClip.blobUrl, values.blobUrl),
      columns: { id: true },
    });

    if (existing) {
      const [updated] = await db
        .update(stockClip)
        .set(values)
        .where(eq(stockClip.id, existing.id))
        .returning();
      return ok(updated);
    }

    const [created] = await db.insert(stockClip).values(values).returning();
    return ok(created);
  } catch (error) {
    logError('stockFootage.upsertStockClip', error, {
      feature: 'stock-footage',
      extra: {
        externalAssetId: values.externalAssetId,
        blobUrl: values.blobUrl,
      },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to upsert stock clip')
    );
  }
};

export const upsertStockClip = (
  db: DbConnection,
  input: UpsertStockClipInput
) =>
  trackedResult(
    'stockFootage.upsertStockClip',
    () => upsertStockClipImpl(db, input),
    {
      properties: {
        externalAssetId: input.externalAssetId,
        techniqueSlug: input.techniqueSlug,
        contentType: input.contentType,
      },
    }
  );

export type UpsertStockClipResult = Awaited<ReturnType<typeof upsertStockClip>>;
