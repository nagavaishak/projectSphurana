import type { GraphicOutput } from '@borradh-workspace/database';
import { getSignedCdnUrl, isCdnEnabled } from '@borradh-workspace/storage';

/**
 * Private-CloudFront re-signing primitives.
 *
 * These three functions were written out THREE separate times — once on
 * `GraphicsController` (`extractCdnKey` + `signGraphicOutputs`), once on
 * `ContentBatchesController` (`extractCdnKey` + `signCdnUrl` +
 * `signBatchItemMedia`) and once, in a slightly different dialect, on
 * `V1AssetsController` (`extractS3Key`). The graphics and content-batches
 * copies were character-for-character identical, so they are now ONE
 * implementation; the v1-assets copy is gone entirely, replaced by the
 * `asset` strategy of `@MediaUrls` / `MediaUrlInterceptor`.
 *
 * These are deliberately NOT folded into `media-url.resolver.ts`: that module
 * holds the ASYNC resolution rules (presign against a bucket, honour
 * `forcePresigned`, keep fbcdn URLs verbatim) driven by the `@MediaUrls`
 * interceptor. The rules here are the SYNCHRONOUS "re-sign a private CDN URL"
 * rule, applied to nested payload shapes (`graphic.outputs[]`) that the
 * interceptor's dot-path walker cannot express.
 *
 * BEHAVIOUR PRESERVED VERBATIM:
 *  - CDN disabled  → every value passes through untouched;
 *  - unparseable / empty-path URL → passes through untouched (never throws);
 *  - a persisted `objectKey` always beats parsing the stored URL.
 */

/**
 * Extract the CloudFront/S3 object key from a stored URL — the pathname minus
 * its leading slash. CDN URLs are `{cdnUrl}/{objectKey}`, so the path IS the
 * key regardless of which host the URL names. Returns null when the value is
 * not a parseable URL.
 */
export function extractCdnKey(url: string): string | null {
  try {
    const { pathname } = new URL(url);
    return pathname.startsWith('/') ? pathname.slice(1) : pathname;
  } catch {
    return null;
  }
}

/** Re-sign a single stored private-CDN URL; pass through on no-op. */
export function signCdnUrl<T extends string | null | undefined>(url: T): T {
  if (!isCdnEnabled() || !url) return url;
  const key = extractCdnKey(url);
  return (key ? getSignedCdnUrl(key) : url) as T;
}

/**
 * Re-sign every rendered output of a graphic so the browser can load private
 * CDN images directly in `<img>`/carousels (it carries no CloudFront signed
 * cookies). Prefers the persisted `objectKey`; falls back to parsing the URL.
 */
export function signGraphicOutputList(
  outputs: GraphicOutput[]
): GraphicOutput[] {
  return outputs.map((output) => {
    const key = output.objectKey ?? extractCdnKey(output.url);
    return {
      ...output,
      url: isCdnEnabled() && key ? getSignedCdnUrl(key) : output.url,
      thumbnailUrl: signCdnUrl(output.thumbnailUrl),
    };
  });
}

/**
 * Re-sign the `outputs` of a graphic-shaped record in place on the response.
 * No-op (returns the SAME object) when CDN is disabled or there is nothing to
 * sign — exactly as `GraphicsController.signGraphicOutputs` did.
 */
export function signGraphicOutputs<
  T extends { outputs?: GraphicOutput[] | null },
>(graphic: T): T {
  if (!isCdnEnabled() || !graphic.outputs?.length) return graphic;
  return { ...graphic, outputs: signGraphicOutputList(graphic.outputs) };
}
