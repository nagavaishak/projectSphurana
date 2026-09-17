import { apiClient } from '@borradh-workspace/api-client';
import type { PendingRegenerateEdit } from '@borradh-workspace/contracts';
import { useQuery } from '@tanstack/react-query';
import { Check, RefreshCw, X } from 'lucide-react';
import { useRef } from 'react';

import { Button } from '@/components/ui/button';
import { useDiscardVideoEdits } from '@/features/content-batches/api';
import { useRegenerateGraphic } from '@/features/graphics/api/regenerate-graphic';
import { queryKeys } from '@/lib/query-keys';

/**
 * A re-roll Claire has PROPOSED, and the button that pays for it.
 *
 * A re-roll costs a render and replaces what is on screen, so the review turn
 * stages it rather than firing it — the proposal lands on the slot and the
 * owner presses the button the reply points at. That button only ever existed
 * on the review page. In chat the proposal was staged, invisible, and reported
 * as finished: "Done — slide 6 has been refreshed", over a slide that had not
 * changed. The owner had no way to know.
 *
 * This is the graphic's half of what the clip list editor does for video, where
 * Accept is what spends the render. Same rule, both kinds — the asymmetry is
 * the whole reason it went missing.
 *
 * Read from the SERVER, not from the turn that proposed it. The proposal is
 * persisted on the item, so this survives a reload and a remount; a card that
 * held it in React would offer to spend a render the owner had already
 * declined, or lose one they had not answered yet.
 */
export function PendingReRoll({
  itemId,
  graphicId,
  onReRolled,
}: {
  itemId: string;
  graphicId: string;
  /**
   * The re-roll renders into a NEW graphic row. Without this the card keeps
   * polling the id it was born with — the request succeeds, a fresh graphic
   * renders, and the owner watches the old one sit there unchanged.
   */
  onReRolled: (graphicId: string) => void;
}) {
  const { data: state } = useQuery({
    queryKey: queryKeys.contentBatches.itemState(itemId),
    queryFn: () =>
      apiClient.get<{
        pendingRegenerate: PendingRegenerateEdit[] | null;
        assetId: string | null;
      }>(`content-batches/items/${itemId}/state`),
    enabled: Boolean(itemId),
    staleTime: 5_000,
  });

  // The GRAPHIC path, not the batch one.
  //
  // `regenerateBatchItem` re-plans an item inside a monthly plan — it calls
  // `planVideoDetail` with a batchId, a periodMonth and a position, and refuses
  // outright when those are null. A post made in conversation is standalone by
  // construction, so every chat re-roll came back "This post is not part of a
  // monthly plan". Videos never hit it because their chat path is
  // `applyBatchItemVideoEdits`, which is batch-agnostic; graphics had no
  // equivalent and were routed to the planner.
  //
  // `POST /graphics/:id/regenerate` goes through `reviseContent`, which records
  // the new cut on the item whether or not a batch exists.
  const { regenerateGraphic, isRegenerating } = useRegenerateGraphic({
    onSuccess: (graphic) => onReRolled(graphic.id),
  });
  // SPENT ONCE. The button fired twice 165ms apart in testing — faster than the
  // pending flag propagates — and each press starts a render. A ref settles it
  // before React re-renders, which `isRegenerating` cannot.
  const firedRef = useRef(false);
  const { discardVideoEdits, isDiscarding } = useDiscardVideoEdits();

  const pending = state?.pendingRegenerate ?? null;
  if (!pending?.length) return null;

  // ONLY THE LIVE CARD OFFERS THE BUTTON.
  //
  // A card in the transcript is a historical object reading live state, so
  // every graphic card for this item saw the same pending proposal and every
  // one of them lit up — a column of identical approvals, all but the last of
  // them stale. The clip list editor solves this with an attempt stamp; here
  // the graphic id IS the stamp, because a re-roll renders into a new row and
  // the live cut is whichever one the item points at now.
  if (state?.assetId && state.assetId !== graphicId) return null;

  const describe = (edit: PendingRegenerateEdit) => {
    const where =
      edit.slideIndex === null
        ? 'the whole thing'
        : `slide ${edit.slideIndex + 1}`;
    if (edit.op === 'remove') return `Remove ${where}`;
    return edit.note ? `${where} — ${edit.note}` : `Redo ${where}`;
  };

  return (
    <div className="mt-2 w-full rounded-lg border bg-card p-3 sm:max-w-sm">
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <RefreshCw className="size-3.5 text-muted-foreground" />
        Ready to redo
      </p>
      <ul className="mt-1.5 space-y-1">
        {pending.map((edit, index) => (
          <li
            // Position IS the identity here — the list is short, ordered, and
            // has no ids of its own.
            key={`${edit.slideIndex ?? 'all'}-${index}`}
            className="text-xs text-muted-foreground"
          >
            {describe(edit)}
          </li>
        ))}
      </ul>
      {/* The cost, stated where the money is spent. */}
      <p className="mt-2 text-[11px] text-muted-foreground">
        One render. The current version stays recoverable.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          disabled={isRegenerating || isDiscarding}
          onClick={() => {
            if (firedRef.current) return;
            firedRef.current = true;
            // One entry for the WHOLE asset is `scope: 'all'`; named slides are
            // `slideEdits`, which re-renders those and carries the rest across
            // verbatim. The two shapes say the same thing for one slide.
            const wholeAsset = pending.find((e) => e.slideIndex === null);
            regenerateGraphic(
              wholeAsset
                ? {
                    graphicId,
                    scope: 'all',
                    ...(wholeAsset.note
                      ? { refinementInstruction: wholeAsset.note }
                      : {}),
                    ...(wholeAsset.intent
                      ? { regenerationIntent: wholeAsset.intent }
                      : {}),
                  }
                : {
                    graphicId,
                    slideEdits: pending.map((edit) => ({
                      slideIndex: edit.slideIndex as number,
                      op: edit.op,
                      ...(edit.note ? { note: edit.note } : {}),
                    })),
                  }
            );
          }}
        >
          <Check className="size-3.5" />
          {isRegenerating ? 'Starting…' : 'Redo it'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs"
          disabled={isRegenerating || isDiscarding}
          // Discard CLEARS the proposal server-side. It used to clear only
          // React state, so a declined re-roll came back on the next load still
          // offering to spend the render.
          onClick={() => discardVideoEdits(itemId)}
        >
          <X className="size-3.5" />
          Leave it
        </Button>
      </div>
    </div>
  );
}
