import { FileVideo, ImageIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { OpenArtifact } from './artifact-panel-context';
import { useArtifactPanel } from './artifact-panel-context';

interface ArtifactRowProps {
  /**
   * What this row points at. Taken whole rather than as `onOpen`, because the
   * row needs the identity for TWO things — opening the panel and knowing
   * whether it is the one currently open — and a callback only covers the
   * first. Every caller would otherwise have to compare ids itself and get the
   * highlight subtly wrong in a different way.
   */
  artifact: OpenArtifact;
  title: string;
  /** "Video · MP4", "Graphic · PNG" — what it is, then the format. */
  subtitle: string;
  /** Still frame, when there is one. Falls back to the kind's icon. */
  thumbnailUrl?: string | null;
  /**
   * Still being made. Pulses the thumbnail so the row reads as in-flight
   * without repeating the progress the panel is already showing at full size.
   */
  pending?: boolean;
  /** Right-hand action, e.g. a download. Optional. */
  action?: React.ReactNode;
  className?: string;
}

/**
 * A finished render, as a row in the conversation.
 *
 * The chat is a transcript, and a video player embedded in one is a poor
 * citizen of it: it is the tallest thing on the page, it scrolls away, and
 * every earlier render stays mounted and playable above the current one. A row
 * is a REFERENCE — it says the thing exists, names it, and opens it.
 *
 * The whole row is the target rather than a "View" button. The row is a single
 * object and there is one thing to do with it; a button would be a smaller
 * target making the same claim, and the rest of the row would look inert while
 * being the obvious place to click.
 */
export function ArtifactRow({
  artifact,
  title,
  subtitle,
  thumbnailUrl,
  pending,
  action,
  className,
}: ArtifactRowProps) {
  const { artifact: open, openArtifact } = useArtifactPanel();
  const Icon = artifact.kind === 'video' ? FileVideo : ImageIcon;
  // Which one am I looking at. A transcript accumulates rows — every edit adds
  // one — and without this the panel shows a video with no way to tell which
  // of five rows produced it.
  const isOpen = open?.kind === artifact.kind && open.id === artifact.id;

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border bg-card p-2.5 transition-colors hover:bg-accent/50',
        isOpen && 'border-primary bg-accent/40 ring-1 ring-primary/40',
        className
      )}
    >
      <button
        type="button"
        onClick={() => openArtifact(artifact)}
        aria-current={isOpen ? 'true' : undefined}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span
          className={cn(
            'grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg border bg-muted',
            pending && 'animate-pulse'
          )}
        >
          {thumbnailUrl ? (
            <img src={thumbnailUrl} alt="" className="size-full object-cover" />
          ) : (
            <Icon className="size-5 text-muted-foreground" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {subtitle}
          </span>
        </span>
      </button>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
