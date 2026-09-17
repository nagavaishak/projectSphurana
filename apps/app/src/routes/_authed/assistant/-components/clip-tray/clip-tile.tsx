import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { DraftClip } from '@/features/assistant';
import { cn } from '@/lib/utils';
import {
  AlertCircleIcon,
  Film,
  Loader2Icon,
  Sparkles,
  XIcon,
} from 'lucide-react';

export interface ClipTileProps {
  clip: DraftClip;
  /** Called when the operator clicks the ✕ button on the tile. */
  onRemove: (clipId: string) => void;
  /** Disable interactions while a parent mutation is in flight. */
  disabled?: boolean;
}

function formatDuration(duration: number | null): string | null {
  if (duration == null) return null;
  const mins = Math.floor(duration / 60);
  const secs = Math.round(duration % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Single tile in the chat-native clip tray (W-C10-clip-tray).
 *
 * Renders the clip's thumbnail (or a placeholder), source pill (uploaded /
 * library / suggested), processing status overlay, and a ✕ button. The
 * `suggested` source draws a dashed border so operators see at a glance
 * which clips Claire picked vs which they brought.
 */
export function ClipTile({ clip, onRemove, disabled }: ClipTileProps) {
  const dur = formatDuration(clip.asset?.duration ?? null);
  const isSuggested = clip.source === 'suggested';
  const inFlight =
    clip.processingStatus === 'uploading' ||
    clip.processingStatus === 'processing';
  const failed = clip.processingStatus === 'failed';

  return (
    <div
      className={cn(
        'group relative aspect-square w-20 shrink-0 overflow-hidden rounded-md border-2 bg-muted',
        isSuggested
          ? 'border-dashed border-muted-foreground/40'
          : 'border-transparent'
      )}
      data-source={clip.source}
      data-status={clip.processingStatus}
    >
      {clip.asset?.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={clip.asset.thumbnailUrl}
          alt={clip.asset.name}
          className="size-full object-cover"
        />
      ) : (
        <div className="flex size-full items-center justify-center">
          <Film className="size-5 text-muted-foreground" />
        </div>
      )}

      {/* Source pill — only render for suggested rows; uploaded/library tiles
          stay clean unless the operator hovers. */}
      {isSuggested && (
        <span className="absolute top-1 left-1 inline-flex items-center gap-1 rounded bg-background/85 px-1 py-0.5 text-[10px] font-medium text-foreground/80">
          <Sparkles className="size-2.5 text-amber-500" />
          Suggested
        </span>
      )}

      {/* Duration badge */}
      {dur && !inFlight && !failed && (
        <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 py-0.5 text-[10px] text-white">
          {dur}
        </span>
      )}

      {/* In-flight overlay */}
      {inFlight && (
        <div
          aria-label={
            clip.processingStatus === 'uploading' ? 'Uploading' : 'Processing'
          }
          className="absolute inset-0 flex items-center justify-center bg-background/60"
        >
          <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Failed overlay */}
      {failed && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="absolute inset-0 flex items-center justify-center bg-destructive/15">
              <AlertCircleIcon className="size-5 text-destructive" />
            </div>
          </TooltipTrigger>
          <TooltipContent>Upload failed — remove and try again</TooltipContent>
        </Tooltip>
      )}

      {/* Remove button — hover-revealed; tooltip clarifies asset stays in
          library (operators have complained in the past about losing assets
          when removing from drafts). */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onRemove(clip.id)}
            aria-label="Remove from this draft"
            className="absolute top-0.5 right-0.5 hidden size-5 items-center justify-center rounded-full bg-background/85 text-foreground/70 transition-colors hover:bg-background hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40 group-hover:flex"
          >
            <XIcon className="size-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          Remove from this draft (your asset library keeps the file)
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
