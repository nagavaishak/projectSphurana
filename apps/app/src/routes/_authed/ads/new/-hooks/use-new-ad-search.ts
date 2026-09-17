import { useSearch } from '@tanstack/react-router';

/**
 * Reads the `?videoId` preselect from the URL. Used by the full-page wizard
 * route AND by the desktop dialog (which renders on a different route), so it
 * must not be bound to `/_authed/ads/new/` — `strict: false` reads whatever
 * route is active without throwing when the param isn't present.
 */
export function useNewAdSearch(): { videoId?: string } {
  const search = useSearch({ strict: false }) as { videoId?: string };
  return { videoId: search.videoId };
}
