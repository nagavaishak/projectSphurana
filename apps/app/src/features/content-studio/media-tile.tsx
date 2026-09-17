import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  Image as ImageIcon,
  MoreVertical,
  Play,
  SendIcon,
  Sparkles,
  Trash2,
  Upload,
  Video as VideoIcon,
} from 'lucide-react';

interface MediaTileProps {
  /** Image/poster URL shown in the grid (rendered at its natural ratio). */
  thumbnailUrl: string | null;
  alt: string;
  /**
   * Width/height ratio (e.g. 4 / 5) used to reserve the tile's height before
   * the image file loads, so the masonry layout doesn't collapse to a thin
   * line and "pop" open once the media downloads.
   */
  aspectRatio?: number;
  /** Show a play affordance over the poster. */
  isVideo?: boolean;
  /** Origin badge shown bottom-left. */
  source: 'uploaded' | 'generated';
  /** Assigned service name, shown as a badge above the origin badge. */
  serviceName?: string | null;
  onClick: () => void;
  /** When provided, shows the primary "Post" button on hover. */
  onPost?: () => void;
  onDelete: () => void;
}

/**
 * Minimal gallery tile: the media at its natural aspect ratio with rounded
 * borders, designed to pack into a masonry column layout. On hover it reveals a
 * primary "Post" button and a three-dots menu (Delete). A persistent badge in
 * the bottom-left marks the media as Uploaded or Generated.
 */
export function MediaTile({
  thumbnailUrl,
  alt,
  aspectRatio,
  isVideo = false,
  source,
  serviceName,
  onClick,
  onPost,
  onDelete,
}: MediaTileProps) {
  // Reserve the tile's box before the image downloads. Fall back to 4:5 so
  // tiles with unknown dimensions still hold their space instead of collapsing.
  const ratioStyle = { aspectRatio: String(aspectRatio ?? 4 / 5) };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        'group relative block w-full cursor-pointer overflow-hidden rounded-xl border bg-muted/40 transition-shadow duration-200 hover:shadow-lg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
      )}
    >
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt={alt}
          loading="lazy"
          decoding="async"
          style={ratioStyle}
          className="w-full object-cover transition-opacity duration-200 group-hover:opacity-90"
        />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center text-muted-foreground">
          {isVideo ? (
            <VideoIcon className="size-8" />
          ) : (
            <ImageIcon className="size-8" />
          )}
        </div>
      )}

      {isVideo && thumbnailUrl && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
          <div className="rounded-full bg-white/90 p-3">
            <Play className="size-6 text-black" />
          </div>
        </div>
      )}

      {/* Hover actions: Post + three-dots menu */}
      <div
        className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {onPost && (
          <Button size="sm" onClick={onPost}>
            <SendIcon className="size-4" />
            Post
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="icon" className="size-8">
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="size-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Service badge (above) + origin badge (below) */}
      <div className="absolute bottom-2 left-2 flex flex-col items-start gap-1">
        {serviceName && (
          <Badge className="max-w-[12rem] gap-1 truncate">
            <span className="truncate">{serviceName}</span>
          </Badge>
        )}
        <Badge variant="secondary" className="gap-1">
          {source === 'uploaded' ? (
            <Upload className="size-3" />
          ) : (
            <Sparkles className="size-3" />
          )}
          {source === 'uploaded' ? 'Uploaded' : 'Generated'}
        </Badge>
      </div>
    </div>
  );
}
