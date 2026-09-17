import { Film, Play } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import { VideoPreviewDialog } from './video-preview-dialog';

interface VideoThumbnailCardProps {
  videoId: string;
  title: string;
  thumbnailUrl?: string;
  blobUrl?: string;
  durationMs?: number;
  status: string;
  /**
   * Media-only mode: render just a square thumbnail (play-on-click) with no
   * title, duration, or status badge — the clean "box with the media" look
   * used by the assistant chat cards. Defaults to the row layout for other
   * callers.
   */
  mediaOnly?: boolean;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function VideoThumbnailCard({
  title,
  thumbnailUrl,
  blobUrl,
  durationMs,
  status,
  mediaOnly = false,
}: VideoThumbnailCardProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const isReady = status === 'ready' && blobUrl;

  if (mediaOnly) {
    return (
      <>
        <button
          type="button"
          onClick={() => isReady && setPreviewOpen(true)}
          disabled={!isReady}
          aria-label={title}
          className={cn(
            'relative block aspect-square w-full overflow-hidden rounded-lg border bg-muted sm:max-w-sm',
            isReady && 'cursor-pointer'
          )}
        >
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={title}
              className="size-full object-cover"
            />
          ) : (
            <Film className="absolute inset-0 m-auto size-8 text-muted-foreground" />
          )}
          {isReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors hover:bg-black/30">
              <Play className="size-10 fill-white text-white drop-shadow" />
            </div>
          )}
        </button>

        {isReady && (
          <VideoPreviewDialog
            open={previewOpen}
            onOpenChange={setPreviewOpen}
            videoUrl={blobUrl}
            thumbnailUrl={thumbnailUrl}
            title={title}
          />
        )}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => isReady && setPreviewOpen(true)}
        disabled={!isReady}
        className={cn(
          'flex items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors w-full sm:max-w-xs',
          isReady && 'hover:bg-accent cursor-pointer'
        )}
      >
        {/* Thumbnail */}
        <div className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
          {thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnailUrl}
              alt={title}
              className="size-full object-cover"
            />
          ) : (
            <Film className="size-6 text-muted-foreground" />
          )}
          {isReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <Play className="size-5 fill-white text-white" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{title}</p>
          <div className="mt-0.5 flex items-center gap-2">
            {durationMs != null && (
              <span className="text-xs text-muted-foreground">
                {formatDuration(durationMs)}
              </span>
            )}
            <Badge
              variant={status === 'ready' ? 'default' : 'secondary'}
              className="text-[10px] px-1.5 py-0"
            >
              {status}
            </Badge>
          </div>
        </div>
      </button>

      {isReady && (
        <VideoPreviewDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          videoUrl={blobUrl}
          thumbnailUrl={thumbnailUrl}
          title={title}
        />
      )}
    </>
  );
}
