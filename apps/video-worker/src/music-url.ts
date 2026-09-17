import { getPrivateCdnUrl } from '@borradh-workspace/storage';

/**
 * Absolutize a music URL. The frontend's create-video forms do
 * `${cdnBase}${track.path}` when picking a music track, but if the CDN base
 * isn't loaded yet, `cdnBase` is empty and the bare `/public/audio/x.mp3`
 * path gets persisted on `draftConfig.musicUrl`. Remotion's <Audio> can't
 * resolve that path (relative URLs are resolved against the bundle origin and
 * 404). This helper rebuilds the absolute URL using the worker's CDN
 * configuration. Idempotent — pass-through if the URL is already absolute.
 */
export function absolutizeMusicUrl(
  url: string | undefined
): string | undefined {
  if (!url) return url;
  if (/^https?:\/\//.test(url)) return url;
  try {
    return getPrivateCdnUrl(url);
  } catch {
    // CDN_URL not configured locally — leave as-is and let the render fail
    // with the original error rather than a confusing one from this helper.
    return url;
  }
}

/**
 * Resolve the final music URL for a v1 render, with a registry fallback.
 *
 * The frontend builds `draftConfig.musicUrl` as `${cdnUrl}${track.path}` from
 * `useRuntimeConfig()`, which is a React-Query-backed hook — on a fast submit
 * right after mount, `cdnUrl` can still be loading and resolve to `''`/falsy,
 * so `musicUrl` ends up `undefined` even though `musicTrackId` was set
 * correctly. Previously, the caller required BOTH `musicUrl` and
 * `musicTrackId` to be present before building a `music` config at all, so
 * this race silently dropped music from the render (organic videos have no
 * other narration/audio track, so the result was a fully silent video).
 *
 * `trackPath` is the registry-resolved track's `path` (looked up server-side
 * by `musicTrackId`, same registry the v2 `compileRenderDoc` /
 * `resolveRegistryMusicUrl` path uses), so we can rebuild an absolute URL
 * from that whenever the frontend-provided `musicUrl` is missing — instead of
 * silently muting the render.
 */
export function resolveMusicUrl(
  musicUrl: string | undefined,
  trackPath: string | undefined
): string | undefined {
  if (musicUrl) return absolutizeMusicUrl(musicUrl) ?? musicUrl;
  return absolutizeMusicUrl(trackPath);
}
