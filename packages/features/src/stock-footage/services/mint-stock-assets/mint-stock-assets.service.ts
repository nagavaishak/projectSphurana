import { randomUUID } from 'node:crypto';
import { asset, stockClip } from '@borradh-workspace/database';
import { contentTypeToTagMap } from '@borradh-workspace/labels';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type MintStockAssetsInput,
  mintStockAssetsSchema,
} from './mint-stock-assets.schema.js';

/**
 * Ensure an org-owned `asset` row exists for each requested stock clip, reusing
 * any already minted for this org. Returns a map of stockClipId → assetId.
 *
 * Minted rows are pre-transcoded (transcodeStatus='ready', transcodedBlobUrl
 * set) so they pass the queueVideoExport transcode gate immediately, and tagged
 * with the clip's content-type tag so the render compiler treats them exactly
 * like an analyzed upload.
 */
const mintStockAssetsImpl = async (
  db: DbConnection,
  input: MintStockAssetsInput
): Promise<Result<Record<string, string>>> => {
  const parsed = mintStockAssetsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { organizationId, uploadedById, stockClipIds } = parsed.data;
  if (stockClipIds.length === 0) return ok({});

  try {
    const existing = await db.query.asset.findMany({
      where: and(
        eq(asset.organizationId, organizationId),
        inArray(asset.stockClipId, stockClipIds)
      ),
      columns: { id: true, stockClipId: true },
    });

    const map: Record<string, string> = {};
    for (const a of existing) {
      if (a.stockClipId) map[a.stockClipId] = a.id;
    }

    const missing = stockClipIds.filter((id) => !map[id]);
    if (missing.length > 0) {
      const clips = await db.query.stockClip.findMany({
        where: inArray(stockClip.id, missing),
      });
      const now = new Date();
      const rows = clips.map((c) => {
        const id = randomUUID();
        map[c.id] = id;
        const tag = contentTypeToTagMap[c.contentType];
        return {
          id,
          name: `Stock: ${c.description}`.slice(0, 200),
          blobUrl: c.blobUrl,
          transcodedBlobUrl: c.transcodedBlobUrl ?? c.blobUrl,
          transcodeStatus: 'ready' as const,
          transcodedAt: now,
          probeStatus: 'ready' as const,
          probedAt: now,
          type: c.mediaType,
          source: 'stock' as const,
          stockClipId: c.id,
          tags: tag ? [tag] : [],
          duration: c.durationSec ?? null,
          width: c.width ?? null,
          height: c.height ?? null,
          organizationId,
          uploadedById,
          createdAt: now,
          updatedAt: now,
        };
      });
      if (rows.length > 0) {
        await db.insert(asset).values(rows);
      }
    }

    return ok(map);
  } catch (error) {
    logError('stockFootage.mintStockAssets', error, {
      feature: 'stock-footage',
      extra: { organizationId, count: stockClipIds.length },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to mint stock assets')
    );
  }
};

export const mintStockAssets = (
  db: DbConnection,
  input: MintStockAssetsInput
) =>
  trackedResult(
    'stockFootage.mintStockAssets',
    () => mintStockAssetsImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

export type MintStockAssetsResult = Awaited<ReturnType<typeof mintStockAssets>>;
