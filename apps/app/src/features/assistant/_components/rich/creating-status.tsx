import { Loader2 } from 'lucide-react';

interface CreatingStatusProps {
  /** Headline label, e.g. "Creating ad..." */
  label: string;
  /** Optional sub-text, e.g. campaign name or short context */
  detail?: string;
}

/**
 * Indeterminate "kick-off" status tile rendered while a tool is starting
 * something that has no measurable progress (no progress bar). Matches the
 * visual style of `ProcessingStatus` minus the progress bar.
 *
 * Tools opt in by returning `{ uiState: 'creating', label, detail? }` from
 * their server-side implementation. See `tool-renderer.tsx` for dispatch.
 */
export function CreatingStatus({ label, detail }: CreatingStatusProps) {
  return (
    <div className="w-full rounded-lg border bg-card p-4 sm:max-w-xs">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Loader2 className="size-4 animate-spin" />
        {label}
      </div>

      {detail && (
        <p className="mt-2 truncate text-xs text-muted-foreground">{detail}</p>
      )}
    </div>
  );
}
