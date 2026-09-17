import { apiClient } from '@borradh-workspace/api-client';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import {
  useAcceptBatchItem,
  useRejectBatchItem,
} from '@/features/content-batches/api';
import { ScheduleControls } from '@/features/content-batches/components/review-workspace/schedule-controls';
import { useListMetaAdsPages } from '@/features/integrations';
import { queryKeys } from '@/lib/query-keys';
import { Check, Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

interface ContentPanelActionsProps {
  /** The content item this panel is showing. */
  itemId: string;
  /**
   * Pre-selected pages, when the caller already has them. Otherwise they are
   * read from the item — the planner picks pages when it seeds a post, and
   * starting the toggles empty would turn "deselect Beta" into "also post to
   * Beta".
   */
  defaultPageIds?: string[];
  /** Called after a decision lands, so a host can advance its queue. */
  onDecided?: () => void;
}

/**
 * Save / Schedule / Reject, on whatever the panel is showing.
 *
 * ONE COMPONENT for the review page and the assistant chat, because it is one
 * decision. The review queue and a graphic someone asked Claire for in passing
 * are the same object underneath — a content item awaiting a verdict — and the
 * three answers are the same three. Two implementations would drift, which is
 * the failure this whole area has been paying for.
 *
 * All three go through the item layer:
 *
 *   Save     — accept with `scheduledAt: null`. The contract already spells
 *              this as "draft the post instead of scheduling it", so keeping
 *              something without committing to a time needed no new endpoint.
 *   Schedule — accept with a date and the chosen pages.
 *   Reject   — the slot is decided against; no post is created.
 *
 * Save and Schedule are therefore the SAME call with one field different,
 * which is worth keeping visible: they are not two features, they are one
 * decision with an optional time on it.
 */
export function ContentPanelActions({
  itemId,
  defaultPageIds,
  onDecided,
}: ContentPanelActionsProps) {
  const { pages } = useListMetaAdsPages();

  const { data: itemState } = useQuery({
    queryKey: queryKeys.contentBatches.itemState(itemId),
    queryFn: () =>
      apiClient.get<{
        targetPageIds: string[];
        caption: string | null;
        reviewStatus: string;
      }>(`content-batches/items/${itemId}/state`),
    // Always enabled: the seeded pages are only half of what this answers. The
    // other half is whether the post has already been DECIDED, which the panel
    // needs whether or not the caller supplied pages.
    enabled: Boolean(itemId),
    staleTime: 30_000,
  });

  const seededPageIds = defaultPageIds ?? itemState?.targetPageIds;
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>(
    defaultPageIds ?? []
  );
  // Seed once the item answers. `touched` keeps a later refetch from undoing a
  // choice the owner has already made.
  const [touchedPages, setTouchedPages] = useState(false);
  useEffect(() => {
    if (!touchedPages && seededPageIds) setSelectedPageIds(seededPageIds);
  }, [seededPageIds, touchedPages]);
  const [scheduleAt, setScheduleAt] = useState<Date | undefined>(undefined);
  const [decision, setDecision] = useState<
    'saved' | 'scheduled' | 'rejected'
  >();

  const { acceptBatchItem, isAccepting } = useAcceptBatchItem({
    // Accept never set this — only reject did, so approving a post left the
    // buttons exactly as they were and the owner had no way to tell the click
    // had registered. Every post in the queue kept saying Approve.
    onSuccess: (item) => {
      setDecision(item.scheduledAt ? 'scheduled' : 'saved');
      onDecided?.();
    },
  });
  const { rejectBatchItem, isRejecting } = useRejectBatchItem({
    onSuccess: () => {
      setDecision('rejected');
      onDecided?.();
    },
  });

  const busy = isAccepting || isRejecting;

  // A decision belongs to the POST it was made about. This panel does not
  // remount when the queue moves on, so a rejection made on one post stayed in
  // state and every post clicked after it read as rejected.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on item identity only
  useEffect(() => {
    setDecision(undefined);
  }, [itemId]);

  // The decision is a FACT ABOUT THE POST, not about this mount. Read back from
  // the server so it survives a reload and a panel reopening — local state
  // alone would offer the buttons again over a post already decided.
  const settled =
    decision ??
    (itemState?.reviewStatus === 'accepted'
      ? 'saved'
      : itemState?.reviewStatus === 'rejected'
        ? 'rejected'
        : undefined);

  // Spent, not hidden. A decision that removes its own buttons leaves the owner
  // unsure whether the click registered — the same reason the approval cards
  // keep their spent state on screen.
  if (settled) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {settled === 'rejected' ? (
          <X className="size-3" />
        ) : (
          <Check className="size-3 text-primary" />
        )}
        {settled === 'rejected'
          ? 'Rejected.'
          : settled === 'scheduled'
            ? 'Scheduled.'
            : 'Saved as a draft post.'}
      </p>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-destructive"
        disabled={busy}
        onClick={() => rejectBatchItem(itemId)}
      >
        <X className="size-3.5" />
        Reject
      </Button>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 text-xs"
        disabled={busy}
        onClick={() => {
          // `scheduledAt: null` is the contract's own way of saying "keep it,
          // draft the post, do not commit to a time".
          //
          // NO PAGES. Saving keeps the post and puts the asset in the
          // library; it does not commit to publishing anywhere, so asking
          // which page would be asking about a decision that has not been
          // made. Schedule is where pages belong.
          acceptBatchItem({ itemId, scheduledAt: null });
          // No optimistic decision here. It used to be set on CLICK, so a
          // refusal still printed "Saved as a draft post" over an item that
          // stayed pending. `onSuccess` sets it, and only a real one arrives.
        }}
      >
        {isAccepting ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Check className="size-3.5" />
        )}
        Save
      </Button>

      <ScheduleControls
        isMobile={false}
        // Same height as Reject and Save beside it. Three buttons in one row
        // reading as three different sizes is the row telling you they are
        // three different kinds of thing, which they are not.
        triggerClassName="h-7 px-3 text-xs"
        pages={pages}
        selectedPageIds={selectedPageIds}
        onTogglePage={(pageId) => {
          setTouchedPages(true);
          setSelectedPageIds((prev) =>
            prev.includes(pageId)
              ? prev.filter((id) => id !== pageId)
              : [...prev, pageId]
          );
        }}
        scheduleAt={scheduleAt}
        onDateChange={setScheduleAt}
        onTimeChange={(value) => {
          // The date picker owns the day; this owns the clock on it. Without a
          // day chosen there is nothing to set a time on yet.
          const [hours, minutes] = value.split(':').map(Number);
          setScheduleAt((current) => {
            if (!current || Number.isNaN(hours) || Number.isNaN(minutes)) {
              return current;
            }
            const next = new Date(current);
            next.setHours(hours, minutes, 0, 0);
            return next;
          });
        }}
        canConfirm={Boolean(scheduleAt) && selectedPageIds.length > 0}
        isConfirming={isAccepting}
        onConfirm={() => {
          if (!scheduleAt) return;
          acceptBatchItem({
            itemId,
            // ISO on the wire; the contract coerces it back to a Date.
            scheduledAt: scheduleAt.toISOString(),
            targetPageIds: selectedPageIds,
          });
          setDecision('scheduled');
        }}
      />
    </div>
  );
}
