import { Loader2 } from 'lucide-react';
import {
  selectPendingAssetIds,
  useAnalysisTrackerStore,
} from './analysis-tracker.store';

/**
 * Explains an under-populated review step.
 *
 * Content type is assigned by the AI analysis, so a user who moves on before
 * tagging finishes sees their clips sitting under "Other Assets" rather than in
 * the category sections. That is correct behaviour — they can classify by hand,
 * and the sections fill themselves in as tagging lands — but without this it
 * reads as the classifier having failed.
 */
export function PendingTaggingNotice() {
  const pendingCount = useAnalysisTrackerStore(
    (state) => selectPendingAssetIds(state).length
  );

  if (pendingCount === 0) return null;

  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 shrink-0 animate-spin" />
      <span>
        Still tagging {pendingCount} {pendingCount === 1 ? 'clip' : 'clips'} in
        the background — they will move into the right category on their own.
        You can carry on without waiting.
      </span>
    </div>
  );
}
