import { Skeleton } from '@/components/ui/skeleton';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Film } from 'lucide-react';
import { useCallback } from 'react';

import { ClipTile } from './clip-tile';
import { useClipTrayState } from './use-clip-tray-state';

export interface ClipTrayProps {
  /** Active video draft id; tray hides when null. */
  videoId: string | null;
  /** Callback fired when the operator drops video files onto the tray. */
  onDropFiles?: (files: File[]) => void;
  className?: string;
}

/**
 * Persistent chat-native clip tray (W-C10-clip-tray).
 *
 * Mounted by the composer when an active video draft id is detected from
 * the message stream. Renders the tray strip above the textarea showing
 * uploaded / library-picked / Claire-suggested clips. Operators drop files
 * here to upload (or onto the composer wrapper — both targets route the
 * same way via the composer's MIME switch).
 *
 * Hidden entirely when there's no active draft so non-video conversations
 * see an unchanged composer.
 */
export function ClipTray({ videoId, onDropFiles, className }: ClipTrayProps) {
  const { clips, isLoading, removeClip, isUpdating } = useClipTrayState({
    videoId,
  });

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!videoId || !onDropFiles) return;
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith('video/')
      );
      if (files.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        onDropFiles(files);
      }
    },
    [videoId, onDropFiles]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!videoId) return;
      // Only accept drags carrying files.
      if (!e.dataTransfer.types?.includes('Files')) return;
      e.preventDefault();
      e.stopPropagation();
    },
    [videoId]
  );

  if (!videoId) return null;

  return (
    <TooltipProvider>
      <div
        className={cn(
          'rounded-md border border-dashed border-muted-foreground/25 bg-muted/20 p-2',
          className
        )}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        role="region"
        aria-label="Clips for this video"
      >
        <div className="mb-1.5 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Film className="size-3.5" />
            Clips for this video
            {clips.length > 0 && (
              <span className="text-muted-foreground/70">({clips.length})</span>
            )}
          </span>
        </div>

        {isLoading ? (
          <div className="flex gap-2">
            <Skeleton className="size-20 rounded-md" />
            <Skeleton className="size-20 rounded-md" />
          </div>
        ) : clips.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">
            Drop a clip here, or ask Claire to pick from your library.
          </p>
        ) : (
          <div className="flex gap-2 overflow-x-auto">
            {clips.map((clip) => (
              <ClipTile
                key={clip.id}
                clip={clip}
                onRemove={removeClip}
                disabled={isUpdating}
              />
            ))}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
