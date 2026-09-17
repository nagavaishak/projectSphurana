import { CircleAlert } from 'lucide-react';

export interface StopAndAskCardProps {
  /** The repeatedly-failing tool, in friendly form. */
  label: string;
  /** How many times it failed identically this turn. */
  failureCount?: number;
  /** The underlying error it kept hitting. */
  reason?: string;
}

/**
 * Circuit-breaker card (Phase 4 #9 #37). Rendered when the factory stopped a
 * tool that failed the same way repeatedly in one turn, rather than letting
 * Claire keep retrying it. The operator sees why it stopped instead of a third
 * identical red error.
 */
export function StopAndAskCard({
  label,
  failureCount,
  reason,
}: StopAndAskCardProps) {
  return (
    <div className="w-full rounded-lg border border-amber-300 bg-amber-50 p-4 text-xs dark:border-amber-900/60 dark:bg-amber-950/30 sm:max-w-sm">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
        <CircleAlert className="size-4" />
        Stopped retrying {label}
      </div>
      <p className="mt-2 text-muted-foreground">
        {`This kept failing${
          failureCount ? ` (${failureCount} times)` : ''
        }, so I stopped rather than trying again. `}
        {reason ? `Reason: ${reason}` : ''}
      </p>
    </div>
  );
}
