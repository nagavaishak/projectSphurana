import { Film } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { apiClient } from '@borradh-workspace/api-client';
import type { Video, VideoStatus } from '@borradh-workspace/api-client/types';
import { useQueryClient } from '@tanstack/react-query';

import { VideoThumbnailCard } from './video-thumbnail-card';

interface VideoStatusResult {
  videoId: string;
  status: string;
  progress?: number;
  processingStage?: string;
  title?: string;
  blobUrl?: string;
  thumbnailUrl?: string;
  durationMs?: number;
  errorMessage?: string | null;
}

interface ProcessingStatusProps {
  /** Initial tool output from getVideoStatus */
  data: VideoStatusResult;
  /**
   * Forwarded from `tool-renderer.tsx`. Wired up to re-prompt Claire with the
   * iteration text when the user clicks an action on the ready-state card.
   * Optional — when missing the iterate buttons are hidden (read-only view).
   */
  onPrompt?: (text: string) => void;
}

const POLL_INTERVAL = 5_000; // 5 seconds

export function ProcessingStatus({ data: initialData }: ProcessingStatusProps) {
  const queryClient = useQueryClient();
  const [data, setData] = useState(initialData);
  const isProcessing = data.status === 'queued' || data.status === 'processing';

  // Lock any draft preview for this video as soon as export is queued. Both
  // Claire surfaces share this query cache, so there is no editable gap while
  // the next status poll is pending.
  useEffect(() => {
    queryClient.setQueryData<Video>(['video', data.videoId], (video) =>
      video
        ? {
            ...video,
            status: data.status as VideoStatus,
            progress: data.progress ?? video.progress,
            title: data.title ?? video.title,
            blobUrl: data.blobUrl ?? video.blobUrl,
            thumbnailUrl: data.thumbnailUrl ?? video.thumbnailUrl,
            durationMs: data.durationMs ?? video.durationMs,
          }
        : video
    );
  }, [data, queryClient]);

  // Auto-poll while processing
  useEffect(() => {
    if (!isProcessing) return;

    const interval = setInterval(async () => {
      try {
        // GET /videos/:id returns the full video record with status, blobUrl, etc.
        const video = await apiClient.get<{
          id: string;
          status: string;
          progress?: number;
          title?: string;
          blobUrl?: string;
          thumbnailUrl?: string;
          durationMs?: number;
          errorMessage?: string | null;
        }>(`videos/${data.videoId}`);
        setData({
          videoId: video.id,
          status: video.status,
          progress: video.progress,
          title: video.title,
          blobUrl: video.blobUrl,
          thumbnailUrl: video.thumbnailUrl,
          durationMs: video.durationMs,
          errorMessage: video.errorMessage,
        });
      } catch {
        // Silently ignore poll errors — will retry next interval
      }
    }, POLL_INTERVAL);

    return () => clearInterval(interval);
  }, [isProcessing, data.videoId]);

  // Once ready, show just the video as a clean square box (play-on-click) —
  // no title, badge, or iterate buttons (per user directive 2026-06-04).
  if (data.status === 'ready') {
    return (
      <VideoThumbnailCard
        videoId={data.videoId}
        title={data.title ?? 'Video'}
        thumbnailUrl={data.thumbnailUrl}
        blobUrl={data.blobUrl}
        durationMs={data.durationMs}
        status="ready"
        mediaOnly
      />
    );
  }

  // Failed state — wider than the default xs because errorMessage is often a
  // full sentence ("text_only mode requires at least one b-roll clip…").
  if (data.status === 'failed') {
    return (
      <div className="w-full rounded-lg border border-destructive/30 bg-card p-4 sm:max-w-sm">
        <div className="flex items-center gap-2 text-sm font-medium text-destructive">
          <Film className="size-4" />
          Video rendering failed
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {data.title ?? 'The video'} could not be rendered.
        </p>
        {data.errorMessage && (
          <p className="mt-2 break-words rounded bg-destructive/5 p-2 text-[11px] text-destructive">
            {data.errorMessage}
          </p>
        )}
      </div>
    );
  }

  // Processing / queued state — a single pulsing skeleton square that swaps to
  // the playable video the instant the render finishes. No progress bar / stage
  // text (per user directive 2026-06-04): just the radiating placeholder.
  return <Skeleton className="aspect-square w-full rounded-lg sm:max-w-sm" />;
}
