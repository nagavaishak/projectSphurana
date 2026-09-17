import type { BatchItemClip } from '@borradh-workspace/api-client/types';
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Check,
  GripVertical,
  Loader2,
  Pencil,
  Play,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ClipPickerDialog } from '@/features/assistant/_components/rich/clip-picker-dialog';
import { apiClient } from '@borradh-workspace/api-client';
import { useQuery } from '@tanstack/react-query';

import { useArtifactPanel } from '@/features/assistant/_components/artifact-panel-context';
import { ArtifactRow } from '@/features/assistant/_components/artifact-row';
import { VideoPreviewDialog } from '@/features/assistant/_components/rich/video-preview-dialog';
import {
  useApplyVideoEdits,
  useBatchItemClips,
  useDiscardVideoEdits,
  useStageItemClips,
} from '@/features/content-batches/api';
import { queryKeys } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import { VideoThumbnail } from '@/routes/_authed/create-video/$templateId/-components/shared/video-thumbnail';

interface ClipListEditorProps {
  /**
   * The CONTENT ITEM, not the video.
   *
   * Everything this card writes goes to the item, because the item is what
   * survives the fork an approved edit causes. Addressing the video instead is
   * the mistake five earlier attempts made: the fork's id ended up somewhere
   * only the browser could see, so "render it now" found the cut the owner had
   * already replaced and truthfully reported nothing to do.
   */
  itemId: string;
  /**
   * The cut this card was emitted against, and the render tally at that moment.
   *
   * A card is a record of a decision offered at a point in time, but every card
   * for an item reads the same LIVE state — so an older one saw a newly staged
   * edit and offered to approve it, and after a reload an already-accepted card
   * came back with live buttons, because "accepted" was only browser state.
   *
   * When the item has moved past this stamp — a fork from an edit, a regenerate,
   * or a render this card did not start — the card is history and shows no
   * actions. Absent means unstamped (an older transcript), and those stay live
   * rather than being retired on a guess.
   */
  attemptId?: string;
  title?: string;
  serviceId?: string | null;
  minClipCount?: number;
  /**
   * Re-renders this post's edits had cost when this card was emitted.
   *
   * Two jobs, one number, and they agree: it is displayed (shown, never capped
   * — a considered edit is not indecision, but the cost should not be
   * invisible), and it is half the stamp that tells the card whether a render
   * has happened since it was offered.
   */
  renderCount?: number;
  /** Called after an approved edit is queued, so the host can react. */
  onApplied?: () => void;
}

function formatDuration(seconds: number | null): string | null {
  if (seconds === null || Number.isNaN(seconds) || seconds <= 0) return null;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function SortableClip({
  clip,
  index,
  onPlay,
  onRemove,
  canRemove,
  disabled,
}: {
  clip: BatchItemClip;
  index: number;
  onPlay: () => void;
  onRemove: () => void;
  canRemove: boolean;
  disabled: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: clip.assetId, disabled });

  const duration = formatDuration(clip.duration);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-2 rounded-lg border bg-card p-2',
        isDragging && 'z-10 shadow-lg',
        clip.staged === 'remove' && 'opacity-50'
      )}
    >
      <button
        type="button"
        // The handle, not the row: the row itself has a play target and a
        // remove button on it, and making the whole thing draggable turns
        // every intended tap into a two-pixel drag.
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${clip.name}`}
        disabled={disabled}
        className="cursor-grab touch-none text-muted-foreground disabled:cursor-not-allowed active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>

      <span className="w-4 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
        {index + 1}
      </span>

      <button
        type="button"
        onClick={onPlay}
        // No playable file yet means the footage is still transcoding. A play
        // button that opens an empty player is worse than one that is plainly
        // not ready.
        disabled={!clip.blobUrl}
        aria-label={`Play ${clip.name}`}
        className="group relative size-12 shrink-0 overflow-hidden rounded bg-muted disabled:cursor-not-allowed"
      >
        {/* `VideoThumbnail`, not a bare <img>, and not a <video preload>.
            A stock clip usually has no `thumbnailUrl`, so an <img> alone
            painted an empty grey square for the whole list — and reaching for
            `preload="metadata"` instead would paint nothing in SAFARI, which is
            the documented reason that component exists: only autoPlay+muted
            then pause-on-first-play is reliable across browsers. */}
        {clip.thumbnailUrl ? (
          <img
            src={clip.thumbnailUrl}
            alt=""
            className="size-full object-cover"
          />
        ) : clip.blobUrl ? (
          <VideoThumbnail src={clip.blobUrl} className="size-full" />
        ) : null}
        {clip.blobUrl ? (
          <span className="absolute inset-0 grid place-items-center bg-black/30 text-white opacity-0 transition-opacity group-hover:opacity-100">
            <Play className="size-4 fill-current" />
          </span>
        ) : null}
      </button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{clip.name}</p>
        <p className="text-[11px] text-muted-foreground">
          {duration ?? (clip.blobUrl ? '—' : 'Still processing')}
        </p>
      </div>

      {clip.staged === 'added' ? (
        <Badge variant="secondary" className="shrink-0 text-[10px]">
          New
        </Badge>
      ) : null}

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
        // A render needs at least one clip, and the server refuses to remove the
        // last. Blocking it here means the owner never arrives at a confirm that
        // can only fail.
        disabled={disabled || !canRemove}
        title={
          canRemove ? 'Remove this clip' : 'A video needs at least one clip'
        }
        aria-label={`Remove ${clip.name}`}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </li>
  );
}

/**
 * The clips in a video, editable, with the approval that renders them.
 *
 * ONE CARD, not a list card plus a confirmation card beneath it. The thing
 * being approved is the list directly above the buttons — separating them puts
 * a boundary through the middle of a single decision, and the owner has to hold
 * "what I just arranged" in their head while looking at a summary of it.
 *
 * WHAT EACH BUTTON DOES
 *  - **Change Clips** opens the picker: the org's own uploads alongside the
 *    curated stock bank. Add and remove in bulk, by eye.
 *  - **Accept** renders. It is LIVE from the moment the card appears, because
 *    the clips arrive already assembled and approving them unchanged is the
 *    ordinary answer. Gating it behind "edit something first" is the shape of
 *    the original bug — being shown a finished video and made to fiddle with it
 *    before you are allowed to say yes. When edits ARE staged it commits all of
 *    them as ONE render: three changes cost one render, not three superseding
 *    each other mid-flight.
 *  - **Reject** discards the staged edits. The video is untouched.
 *
 * Editing the list never renders on its own. That decision is the owner's and it
 * is spent money; four of the five failed attempts at this feature rendered on
 * save, and one announced a render the server had declined to start.
 *
 * The list is read from the server rather than held here, so a reload shows the
 * same pending edit and Claire reads the same list the owner is looking at.
 * Local order is kept only for the moment between a drag finishing and the
 * refetch landing — without it the tiles snap back to the old order for a beat
 * and the drag reads as rejected.
 */
export function ClipListEditor({
  itemId,
  attemptId,
  title,
  serviceId,
  minClipCount = 1,
  renderCount: emittedRenderCount,
  onApplied,
}: ClipListEditorProps) {
  const {
    clips,
    pendingRelist,
    hasStagedEdits,
    textChanges,
    isLoading,
    attemptId: currentAttemptId,
    renderCount: currentRenderCount,
  } = useBatchItemClips(itemId);

  // Superseded: the item has a different cut now, or a render has been paid for
  // that this card did not start. Either way its offer is stale.
  //
  // Deliberately NOT keyed on `decision`, which is per-mount and vanishes on
  // reload. This is read from the server, so it survives one.
  const isHistorical =
    attemptId !== undefined &&
    currentAttemptId !== undefined &&
    (attemptId !== currentAttemptId ||
      (emittedRenderCount !== undefined &&
        currentRenderCount > emittedRenderCount));

  // What to SHOW. The live number is the truth about the item; the stamp is
  // only for deciding whether this card is stale.
  const renderCount = currentRenderCount;
  const { stageClips, isStaging } = useStageItemClips();
  const { discardVideoEdits, isDiscarding } = useDiscardVideoEdits();
  const { openArtifact } = useArtifactPanel();
  const { applyVideoEdits, isApplying } = useApplyVideoEdits({
    onSuccess: (result) => {
      // `no_changes` means nothing was edited AND a cut already exists, so no
      // render ran. Spending the card's one decision on it would claim work
      // that never started; say so and leave Accept live.
      setOutcome(result.outcome);
      if (result.applied) {
        setDecision('accepted');
        // The id the SERVER started, which is the fork when an edit forked the
        // previous cut. Following the id we happened to be holding is how an
        // approved edit ends up watching a video that finished rendering
        // yesterday.
        setRenderingVideoId(result.videoId);
        onApplied?.();
      }
    },
  });

  const [pickerOpen, setPickerOpen] = useState(false);
  const [playing, setPlaying] = useState<BatchItemClip | null>(null);
  // The order as the owner last left it, held only until the refetch catches
  // up. Null means "whatever the server says", which is the normal state.
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  // Spent, not unmounted. A card that vanishes on click takes the only
  // acknowledgement of the click with it, which reads as "did that register?"
  const [decision, setDecision] = useState<'accepted' | 'rejected' | null>(
    null
  );
  // What the server said actually happened, so the card reports that rather
  // than what the click hoped for.
  const [outcome, setOutcome] = useState<
    'edits' | 'as_is' | 'no_changes' | null
  >(null);
  // The render this card started, so it can report the OUTCOME rather than the
  // request. "Re-rendering now" is a claim about the future; a card that says
  // it and then goes quiet leaves the owner watching a sentence.
  const [renderingVideoId, setRenderingVideoId] = useState<string | null>(null);

  // Shares the panel's query key on purpose: one poll feeds both, and the card
  // and the panel can never disagree about whether the render has finished.
  const { data: renderedVideo } = useQuery({
    queryKey: queryKeys.content.video(renderingVideoId ?? ''),
    queryFn: () =>
      apiClient.get<{
        status: string;
        title?: string | null;
        thumbnailUrl?: string | null;
      }>(`videos/${renderingVideoId}`),
    enabled: renderingVideoId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'queued' || status === 'processing' ? 5_000 : false;
    },
  });
  const renderStatus = renderedVideo?.status;
  const renderDone = renderStatus === 'ready';
  const renderFailed = renderStatus === 'failed';

  // Open the panel when the render LANDS, not when it was requested.
  //
  // Half the screen taken to show a pulsing rectangle is half the screen taken
  // to say "not yet", at the moment the owner is most likely to still be
  // typing. The artifact row in the chat already reports that it is rendering,
  // and it is small. Opening once, on completion, is the only moment the panel
  // has something to show.
  //
  // Once, via the ref: reopening a panel the owner deliberately closed is the
  // kind of helpfulness that has to be fought.
  const openedRef = useRef(false);
  useEffect(() => {
    if (renderDone && renderingVideoId && !openedRef.current) {
      openedRef.current = true;
      openArtifact({ kind: 'video', id: renderingVideoId, itemId });
    }
  }, [renderDone, renderingVideoId, openArtifact, itemId]);

  // The server is the authority the moment it answers. Dropping the local
  // order on every fresh list is what keeps a stale drag from outliving the
  // edit that superseded it — including one made in another tab.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sync to server list identity
  useEffect(() => {
    setLocalOrder(null);
  }, [clips.map((clip) => clip.assetId).join(',')]);

  const ordered = useMemo(() => {
    if (!localOrder) return clips;
    const byId = new Map(clips.map((clip) => [clip.assetId, clip]));
    return localOrder
      .map((assetId) => byId.get(assetId))
      .filter((clip): clip is BatchItemClip => Boolean(clip));
  }, [clips, localOrder]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Without a distance threshold a tap on the handle registers as a
      // zero-length drag and swallows the click.
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const busy = isStaging || isApplying || isDiscarding;

  const stage = (assetIds: string[]) => {
    setLocalOrder(assetIds);
    // A fresh edit supersedes a spent decision — the buttons go live again
    // rather than staying on "Rejected" over a list that has since changed,
    // and "already the current cut" stops being true the moment it changes.
    setDecision(null);
    setOutcome(null);
    stageClips({ itemId, assetIds });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = ordered.map((clip) => clip.assetId);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    stage(arrayMove(ids, from, to));
  };

  const handleRemove = (assetId: string) => {
    stage(ordered.map((clip) => clip.assetId).filter((id) => id !== assetId));
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Loading the clips…
      </div>
    );
  }

  return (
    <div className="w-full rounded-xl border bg-background p-3 sm:max-w-lg">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium">{title ?? 'Clips'}</p>
        <p className="shrink-0 text-[11px] text-muted-foreground">
          {ordered.length} clip{ordered.length === 1 ? '' : 's'}
          {pendingRelist ? ' · edited' : ''}
        </p>
      </div>

      {/* Not "nothing here yet" — a statement about the footage bank.
          Nothing matched this service, and the alternative was to fill the list
          from the vertical's ambient pool to reach a count, which is how a
          dentist in red scrubs ended up presented as clip 3 of a microneedling
          video. An empty list plus the picker is the honest version. */}
      {ordered.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
          No footage matched this service yet — pick some with Change Clips.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={ordered.map((clip) => clip.assetId)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="flex flex-col gap-1.5">
              {ordered.map((clip, index) => (
                <SortableClip
                  key={clip.assetId}
                  clip={clip}
                  index={index}
                  onPlay={() => setPlaying(clip)}
                  onRemove={() => handleRemove(clip.assetId)}
                  canRemove={ordered.length > minClipCount}
                  disabled={busy || decision !== null || isHistorical}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {textChanges.length > 0 ? (
        <ul className="mt-2 space-y-0.5">
          {textChanges.map((change) => (
            <li key={change} className="text-[11px] text-muted-foreground">
              · {change}
            </li>
          ))}
        </ul>
      ) : null}

      {isHistorical && decision === null ? (
        <p className="mt-3 text-[11px] text-muted-foreground">
          This version has been superseded.
        </p>
      ) : decision === null ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => discardVideoEdits(itemId)}
            // Nothing staged means there is nothing to reject. The button stays
            // visible so the three actions do not reflow under the owner's
            // cursor between renders of the same card.
            disabled={busy || !hasStagedEdits}
          >
            <X className="size-3.5" />
            Reject
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setPickerOpen(true)}
            disabled={busy}
          >
            <Pencil className="size-3.5" />
            Change Clips
          </Button>
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            onClick={() => applyVideoEdits(itemId)}
            // An empty list cannot render, and letting Accept through would
            // hand it to the export-time fill — which DOES draw on the ambient
            // pool, quietly reintroducing the footage this path just refused to
            // choose. Blocking here keeps that decision the owner's.
            disabled={busy || ordered.length < minClipCount}
            title={
              ordered.length < minClipCount
                ? 'Add at least one clip first'
                : hasStagedEdits
                  ? 'Render this version'
                  : 'Render these clips as they are'
            }
          >
            {isApplying ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Check className="size-3.5" />
            )}
            Accept
          </Button>
          {/* Accept was pressed, nothing was edited, and a cut already exists —
              so no render ran. Saying that beats spending a render to reproduce
              the frames already on screen, and beats a button that looks
              broken. */}
          {outcome === 'no_changes' ? (
            <span className="w-full text-[11px] text-muted-foreground">
              This is already the current cut — change something to get a new
              one.
            </span>
          ) : null}
        </div>
      ) : renderingVideoId ? (
        /* The artifact, from the moment it is accepted.
           It appears straight away rather than on completion, because the thing
           the owner just approved should be present in the transcript at the
           point they approved it — that is where they will look for it later.
           It carries its own state in the subtitle; the actual WAITING is shown
           in the panel, at the size the video will be, so the chat does not
           have to host a progress indicator at all. */
        <ArtifactRow
          className="mt-3"
          artifact={{ kind: 'video', id: renderingVideoId, itemId }}
          title={renderedVideo?.title ?? title ?? 'Video'}
          subtitle={
            renderFailed
              ? 'Render failed'
              : renderDone
                ? 'Video · MP4'
                : 'Rendering…'
          }
          thumbnailUrl={renderedVideo?.thumbnailUrl}
          pending={!renderDone && !renderFailed}
        />
      ) : (
        /* Accepted / rejected, and nothing else.
           Progress used to be narrated here too, which put the same fact in
           three places — this line, the artifact row, and the panel. The card's
           job ends at recording the decision. */
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {decision === 'rejected' ? (
            'Discarded. The video is unchanged.'
          ) : (
            <>
              <Check className="size-3 text-primary" />
              {outcome === 'as_is'
                ? 'Accepted these clips.'
                : 'Accepted your changes.'}
            </>
          )}
        </p>
      )}

      {renderCount > 0 ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {renderCount} render{renderCount === 1 ? '' : 's'} used so far.
        </p>
      ) : null}

      <ClipPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        selectedIds={ordered.map((clip) => clip.assetId)}
        // The picker hands back the whole selection, which is exactly what gets
        // staged. It does not preserve the order of the list it was opened with
        // for clips it did not touch, so the tiles are the owner's last word on
        // membership and the drag handles remain their last word on order.
        onConfirm={stage}
        serviceId={serviceId ?? null}
        minCount={minClipCount}
      />

      <VideoPreviewDialog
        open={playing !== null}
        onOpenChange={(next) => {
          if (!next) setPlaying(null);
        }}
        videoUrl={playing?.blobUrl ?? ''}
        thumbnailUrl={playing?.thumbnailUrl ?? undefined}
        title={playing?.name ?? 'Clip'}
      />
    </div>
  );
}
