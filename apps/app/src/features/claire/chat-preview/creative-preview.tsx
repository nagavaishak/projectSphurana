'use client';

import { isApiClientError } from '@borradh-workspace/api-client';
import { useQuery } from '@tanstack/react-query';

import { getVideoQueryOptions } from '@/features/videos/api/get-video/get-video.hook';

interface CreativePreviewProps {
  videoId: string | null;
}

/**
 * Maps a failed video fetch to a short, actionable message. A 403 means the
 * video belongs to an organization other than the one currently active
 * (e.g. the user switched active org while this conversation was open) — a
 * 404 means the video was deleted or never existed. Both are terminal: they
 * won't resolve by polling again.
 */
function getErrorMessage(error: unknown): string {
  if (isApiClientError(error)) {
    if (error.status === 403) {
      return 'This video belongs to a different workspace.';
    }
    if (error.status === 404) {
      return 'This video no longer exists.';
    }
  }
  return "Couldn't load this video.";
}

/**
 * Renders the generated creative for a chat-owned draft ad. Chat
 * drafts today only support video creatives; if the underlying video
 * is still rendering, falls back to a "Generating creative..."
 * placeholder and polls until ready. Window 6's `show_ad_preview`
 * tool can fire before the video is ready (Decision #14 placeholder).
 *
 * Stops polling and surfaces a clear message on a terminal error (404/403/etc)
 * instead of refetching forever — those never resolve on their own, and
 * silently pretending the video is "still generating" hides the real problem
 * from the user.
 */
export function CreativePreview({ videoId }: CreativePreviewProps) {
  const query = useQuery({
    ...getVideoQueryOptions(videoId ?? ''),
    enabled: Boolean(videoId),
    refetchInterval: (q) => {
      const hasBlobUrl = Boolean(
        (q.state.data as { blobUrl?: string | null } | undefined)?.blobUrl
      );
      // Stop polling once the video is ready OR the fetch hit a terminal
      // error (404/403/etc) — neither case resolves by refetching again.
      return q.state.error || hasBlobUrl ? false : 5_000;
    },
  });

  const video = query.data ?? null;

  if (query.isError) {
    return (
      <div className="aspect-square w-full rounded bg-muted flex items-center justify-center px-4">
        <p className="text-sm text-muted-foreground text-center">
          {getErrorMessage(query.error)}
        </p>
      </div>
    );
  }

  if (!videoId || query.isLoading || !video?.blobUrl) {
    return (
      <div className="aspect-square w-full rounded bg-muted flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Generating creative...</p>
      </div>
    );
  }

  return (
    // biome-ignore lint/a11y/useMediaCaption: ad creative previews have no dialogue
    <video
      src={video.blobUrl}
      poster={video.thumbnailUrl ?? undefined}
      controls
      className="w-full aspect-square rounded bg-black object-contain"
    />
  );
}
