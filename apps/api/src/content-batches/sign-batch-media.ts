import type { GraphicOutput } from '@borradh-workspace/database';
import type {
  ContentItemWithAsset,
  GetBatchResponse,
} from '@borradh-workspace/features/content-batches';
import { signCdnUrl, signGraphicOutputList } from '../common/media/index.js';

/**
 * Re-sign batch-item media so the review modal can load private CDN assets
 * directly in `<video>`/`<img>`. The hydrated `video.blobUrl`/`thumbnailUrl`
 * and `graphic.outputs[].url`/`thumbnailUrl` are stored UNSIGNED, so without
 * this they 403 in the browser (which carries no CloudFront signed cookies).
 * No-op when CDN is disabled.
 *
 * Was `ContentBatchesController.signBatchItemMedia` / `signBatchMedia` /
 * `signCdnUrl` / `extractCdnKey`. Response shaping is not a controller's job
 * (Gate 5); the two lowest layers now live in `common/media/cdn-signing.ts`,
 * shared with `GraphicsController`, and only the batch-item SHAPE is local.
 *
 * `@MediaUrls` cannot express this: its dot-path walker has no array segment,
 * and `graphic.outputs` is an array.
 */
export function signBatchItemMedia(
  item: ContentItemWithAsset
): ContentItemWithAsset {
  const video = item.video
    ? {
        ...item.video,
        blobUrl: signCdnUrl(item.video.blobUrl),
        thumbnailUrl: signCdnUrl(item.video.thumbnailUrl),
      }
    : item.video;

  const outputs = item.graphic?.outputs as GraphicOutput[] | null | undefined;
  const graphic =
    item.graphic && outputs?.length
      ? { ...item.graphic, outputs: signGraphicOutputList(outputs) }
      : item.graphic;

  return { ...item, video, graphic };
}

/** Sign media on every item of a batch response. */
export function signBatchMedia(data: GetBatchResponse): GetBatchResponse {
  return { ...data, items: data.items.map(signBatchItemMedia) };
}
