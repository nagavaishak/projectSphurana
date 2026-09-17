import { asset, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  type DbConnection,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListServiceStockClipsInput,
  listServiceStockClips,
} from '../list-service-stock-clips/index.js';

/**
 * One curated stock clip as the generate dialogs consume it: the picker only
 * needs an identity, a label and ONE playable URL, so the transcoded rendition
 * wins over the original when it exists.
 *
 * `previewUrl` is the STORED url — it is signed on the way out by
 * `MediaUrlInterceptor` (`@MediaUrls({ strategy: 'video', alwaysPresigned })`).
 */
export interface StockClipPreview {
  stockClipId: string;
  mediaType: 'video' | 'image';
  description: string | null;
  isGeneric: boolean;
  durationSec: number | null;
  previewUrl: string;
  /**
   * The org's own asset for this clip, when it has already minted one.
   *
   * Stock is copy-on-attach: picking a clip mints an org-owned `asset`, and it
   * is that ASSET id which ends up in `bRollClips`. So a picker handed the
   * current clip list gets asset ids and has no way to tell they came from
   * these tiles — the stock grid keys on `stockClipId`, and minted assets are
   * `source: 'stock'` so they are excluded from the uploads grid too. A video
   * built entirely from stock therefore opened the picker showing nothing
   * selected, over the clips it was made of.
   *
   * Null when this org has never minted the clip, which is the common case.
   */
  mintedAssetId: string | null;
}

const listStockClipPreviewsImpl = async (
  db: DbConnection,
  input: ListServiceStockClipsInput
): Promise<Result<{ items: StockClipPreview[] }>> => {
  const result = await listServiceStockClips(db, input);
  if (!result.success) {
    return err(
      new FeatureError(
        result.error.code,
        result.error.message,
        result.error.details
      )
    );
  }

  const stockClipIds = result.data.items.map((clip) => clip.stockClipId);

  // One indexed read (`idx_asset_stock_clip_id`) rather than a lookup per tile.
  const mintedByStockClipId = new Map<string, string>();
  if (stockClipIds.length > 0) {
    const minted = await withOrgScope(
      (tx) =>
        tx
          .select({ id: asset.id, stockClipId: asset.stockClipId })
          .from(asset)
          .where(
            and(
              isNotNull(asset.stockClipId),
              inArray(asset.stockClipId, stockClipIds),
              eq(asset.organizationId, input.organizationId)
            )
          ),
      { db }
    );
    for (const row of minted) {
      if (row.stockClipId && !mintedByStockClipId.has(row.stockClipId)) {
        mintedByStockClipId.set(row.stockClipId, row.id);
      }
    }
  }

  return ok({
    items: result.data.items.map((clip) => ({
      stockClipId: clip.stockClipId,
      mediaType: clip.mediaType,
      description: clip.description,
      isGeneric: clip.isGeneric,
      durationSec: clip.durationSec,
      previewUrl: clip.transcodedBlobUrl ?? clip.blobUrl,
      mintedAssetId: mintedByStockClipId.get(clip.stockClipId) ?? null,
    })),
  });
};

export const listStockClipPreviews = (
  db: DbConnection,
  input: ListServiceStockClipsInput
) =>
  trackedResult(
    'stockFootage.listStockClipPreviews',
    () => listStockClipPreviewsImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

export type ListStockClipPreviewsResult = Awaited<
  ReturnType<typeof listStockClipPreviews>
>;
