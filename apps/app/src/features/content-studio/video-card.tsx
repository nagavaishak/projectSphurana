import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import type { Video, VideoStatus } from '@/features/videos';
import { videoStatusLabels } from '@/features/videos';
import { formatDistanceToNow } from 'date-fns';
import { Download, Loader2, MoreVertical, Play, Trash2 } from 'lucide-react';

function getStatusVariant(
  status: VideoStatus
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'ready':
      return 'default';
    case 'processing':
    case 'queued':
      return 'secondary';
    case 'failed':
      return 'destructive';
    default:
      return 'outline';
  }
}

interface VideoCardProps {
  video: Video;
  onClick?: () => void;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}

export function VideoCard({
  video,
  onClick,
  onDelete,
  isDeleting,
}: VideoCardProps) {
  const handleDownload = () => {
    if (video.blobUrl) {
      window.open(video.blobUrl, '_blank');
    }
  };

  const handleDelete = () => {
    if (confirm('Are you sure you want to delete this video?')) {
      onDelete(video.id);
    }
  };

  return (
    <div
      className="group relative rounded-xl border bg-card overflow-hidden cursor-pointer"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      {/* Thumbnail */}
      <div className="aspect-[9/16] bg-muted relative">
        {video.thumbnailUrl ? (
          <img
            src={video.thumbnailUrl}
            alt={video.title || 'Video thumbnail'}
            className="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <Skeleton className="w-full h-full rounded-none" />
        )}

        {/* Status badge overlay */}
        <div className="absolute top-2 left-2">
          <Badge variant={getStatusVariant(video.status)}>
            {videoStatusLabels[video.status]}
          </Badge>
        </div>

        {/* Processing indicator */}
        {(video.status === 'processing' || video.status === 'queued') && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className="text-center text-white">
              <Loader2 className="size-8 animate-spin mx-auto mb-2" />
              <p className="text-sm">{video.progress || 0}%</p>
            </div>
          </div>
        )}

        {/* Play button for ready videos */}
        {video.status === 'ready' && video.blobUrl && (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 pointer-events-none">
            <div className="rounded-full bg-white/90 p-3">
              <Play className="size-8 text-black" />
            </div>
          </div>
        )}

        {/* Actions dropdown */}
        <div
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="icon" className="size-8">
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {video.status === 'ready' && video.blobUrl && (
                <DropdownMenuItem onClick={handleDownload}>
                  <Download className="size-4 mr-2" />
                  Download
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={handleDelete}
                disabled={isDeleting}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="size-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <p className="font-medium truncate">{video.title || 'Untitled'}</p>
        <p className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(video.createdAt), { addSuffix: true })}
        </p>
        {video.durationMs && (
          <p className="text-xs text-muted-foreground">
            {Math.round(Number(video.durationMs) / 1000)}s
          </p>
        )}
      </div>
    </div>
  );
}
