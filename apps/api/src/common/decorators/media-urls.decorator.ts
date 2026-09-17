import { SetMetadata } from '@nestjs/common';

/**
 * How a single media URL is turned into something a browser (or Meta) can load.
 *
 * These are the THREE distinct rules that used to be private helpers on three
 * different controllers. They are genuinely different — collapsing them would
 * change behaviour — so the strategy is named per field rather than inferred.
 *
 *  - `asset`   (was `AssetsController.getAssetUrl` + `extractS3Key`)
 *              Take the URL PATH as the object key REGARDLESS of the host, then
 *              sign it against the org-assets bucket / CDN. An unparseable URL
 *              is returned verbatim.
 *  - `media`   (was `MetaAdsController.resolveMediaUrl`)
 *              Re-sign only URLs under our CDN base or parseable as S3; keep the
 *              ORIGINATING bucket when presigning. Anything else (notably Meta's
 *              own `fbcdn.net` URLs, which Meta has already signed) passes
 *              through byte-for-byte, query string included.
 *  - `graphic` (was `MetaAdsController.resolveGraphicUrl`)
 *              Prefer signing the stored object key (`keyField`); fall back to
 *              `media` on the stored URL; null when neither is present.
 *  - `cdn`     (was `SocialPostsController.resignCdnUrl`)
 *              Re-sign ONLY URLs whose origin is our CDN. Everything else —
 *              including unparseable strings — passes through untouched.
 *  - `video`   (was `VideosController.getVideoUrl`)
 *              An S3 URL keeps its ORIGINATING bucket when presigned (rendered
 *              videos live in the Remotion output bucket, not org-assets), and
 *              only reaches the CDN when it is already in the org-assets
 *              bucket. Anything else is treated like `asset` (URL path is the
 *              key). An unparseable URL is returned verbatim.
 *  - `blank`   Always writes `null`. Not a URL rule — it is how the video LIST
 *              route deliberately withholds `blobUrl` so browsers do not
 *              preload full video files (`GET /videos/:id` serves the real one).
 */
export type MediaUrlStrategy =
  | 'asset'
  | 'media'
  | 'graphic'
  | 'cdn'
  | 'video'
  | 'blank';

export interface MediaFieldSpec {
  /**
   * Dot path to the URL, relative to each item (e.g. `blobUrl`,
   * `video.thumbnailUrl`). A missing intermediate object is skipped, so a route
   * whose payload sometimes omits `video` is safe.
   */
  path: string;
  strategy: MediaUrlStrategy;
  /** `graphic` only: sibling field holding the stored S3 object key. */
  keyField?: string;
}

export interface MediaUrlsSpec {
  /**
   * Key of the array to map over (`items`, `ads`). Omit to treat the response
   * body itself as the single item.
   */
  collection?: string;
  fields: MediaFieldSpec[];
  /**
   * Fields deleted from every item before it goes on the wire — internal object
   * keys that must never leak (`graphicImageKey`).
   */
  strip?: string[];
  /**
   * `asset` only: when true, `?urlFormat=presigned` on the request forces a
   * presigned S3 URL instead of a CDN one (native players cannot use
   * CloudFront signed cookies). Declared per-route because only the asset LIST
   * route accepts that query parameter today.
   */
  honorUrlFormatQuery?: boolean;
  /**
   * Force presigned S3 URLs for this route regardless of the request. The stock
   * clip picker previews inline in the browser and never carries CloudFront
   * signed cookies, so it always presigned.
   */
  alwaysPresigned?: boolean;
}

export const MEDIA_URLS_KEY = 'response:media-urls';

/**
 * Declare which fields of this route's response carry media URLs, so
 * `MediaUrlInterceptor` can resolve/sign them on the way out.
 *
 * Response shaping is an Interceptor's job (Gate 5): the handler returns the
 * domain object and says nothing about signing.
 *
 * @example
 * ```ts
 * @Get()
 * @MediaUrls({
 *   collection: 'items',
 *   fields: [
 *     { path: 'blobUrl', strategy: 'asset' },
 *     { path: 'thumbnailUrl', strategy: 'asset' },
 *   ],
 *   honorUrlFormatQuery: true,
 * })
 * async findAll() { ... }
 * ```
 */
export const MediaUrls = (spec: MediaUrlsSpec) =>
  SetMetadata(MEDIA_URLS_KEY, spec);
