import { useNavigate } from '@tanstack/react-router';
import { Loader2, PlusIcon, RotateCcw, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  CreateBatchDialog,
  useGenerateContentBatch,
  useGetCurrentBatch,
} from '@/features/content-batches';

/**
 * The review workspace is a full-screen ROUTE outside the dashboard shell:
 * the queue, the post and Claire's thread need the whole viewport, and a
 * nav sidebar beside a queue rail reads as two competing lists.
 */
const REVIEW_ROUTE = '/review-content';

/** Only the fields the gating reads — so a test can state a case in a line. */
type GatingBatch = { status: string } | null;
type GatingItem = {
  reviewStatus: string;
  kind: string;
  graphic?: { status?: string | null } | null;
  video?: { status?: string | null } | null;
};

export interface BulkCreateState {
  /** Pending items in the current cut — the review queue's size. */
  total: number;
  /** How many of those have finished rendering. */
  createdCount: number;
  disabled: boolean;
  failed: boolean;
  generating: boolean;
  readyForReview: boolean;
  /** Batch exists and holds nothing left to review. */
  complete: boolean;
}

/**
 * Derive the button's whole state from the polled batch. Pure and exported so
 * the gating — the part that decides whether an owner can ask for content at
 * all — is asserted directly rather than through a rendered button.
 *
 * `isSubmitting` is the POST mutation's own pending flag: it covers the moment
 * between the click and the server accepting the job, before any status change
 * is visible on the batch.
 */
export function deriveBulkCreateState(
  batch: GatingBatch,
  items: GatingItem[],
  isSubmitting: boolean
): BulkCreateState {
  // No supersession filter: the server returns one row per post, already
  // resolved to the current cut.
  const pending = batch
    ? items.filter((i) => i.reviewStatus === 'pending')
    : [];
  let createdCount = 0;
  let rendering = 0;
  for (const i of pending) {
    const status = i.kind === 'graphic' ? i.graphic?.status : i.video?.status;
    if (status === 'ready') createdCount += 1;
    else if (status !== 'failed') rendering += 1;
  }

  // 'planning' is the seed window: the batch has been asked for and has no
  // items yet, on a fresh batch, a replace AND a top-up. It closes the gap
  // where a finished batch would otherwise flash "Create another batch" again
  // before the new slots land.
  //
  // 'generating' is NOT that window. Nothing ever moves a batch off it — the
  // statuses past it ('review', 'completed') have no writer — so reading it as
  // "still seeding" pinned the button on "Generating…" for the life of the
  // batch, long after every asset had rendered. Whether work is outstanding is
  // the ITEMS' question, and `rendering` already asks it, which is why the
  // review banner and the poll interval never had this bug.
  const failed = batch?.status === 'failed';
  const seeding = batch?.status === 'planning';
  const generating = isSubmitting || seeding || rendering > 0;

  return {
    total: pending.length,
    createdCount,
    disabled: generating,
    failed,
    generating,
    readyForReview: !!batch && !failed && !generating && pending.length > 0,
    complete: !!batch && !failed && !generating && pending.length === 0,
  };
}

/**
 * Planner header action: kicks off a full content batch in one click.
 *
 * Gated entirely on the current month's batch:
 *   - no batch yet            → enabled, "Bulk create"
 *   - batch still producing   → disabled, "{ready}/{total} created" live count
 *   - ready items             → "Review batch"
 *   - fully reviewed          → enabled, "Create another batch"
 *   - failed                  → retry dialog
 *
 * A finished batch is NOT a dead end: owners come back for more content well
 * inside the same month (support was being asked to reset the batch by hand),
 * so reviewing everything re-arms the button instead of parking it on a
 * disabled "Batch complete". Only an in-flight batch disables it — two
 * concurrent seeds into one batch would fight over slot positions.
 *
 * The progress count comes from the polled current-batch query, not the brief
 * POST mutation, so it tracks the background render through to completion.
 */
export function BulkCreateButton() {
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const { generateBatch, isGenerating } = useGenerateContentBatch();
  const { batch, items } = useGetCurrentBatch();

  // Mirrors socials-page-content's progress derivation so the button agrees
  // with the review banner on what counts as rendering vs ready.
  const {
    total,
    createdCount,
    disabled,
    failed,
    generating,
    readyForReview,
    complete,
  } = useMemo(
    () => deriveBulkCreateState(batch, items, isGenerating),
    [batch, items, isGenerating]
  );

  const handleClick = () => {
    if (disabled) return;
    if (readyForReview) void navigate({ to: REVIEW_ROUTE });
    else setCreateOpen(true);
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={handleClick}
        disabled={disabled}
        title="Generate a full batch of content at once."
      >
        {generating ? (
          <Loader2 className="animate-spin" />
        ) : failed ? (
          <RotateCcw />
        ) : readyForReview ? (
          <Sparkles />
        ) : (
          <PlusIcon />
        )}
        {generating
          ? total > 0
            ? `${createdCount}/${total} created`
            : 'Generating…'
          : failed
            ? 'Try bulk create again'
            : readyForReview
              ? 'Review batch'
              : complete
                ? 'Create another batch'
                : 'Bulk create'}
      </Button>

      <CreateBatchDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        isSubmitting={isGenerating}
        onConfirm={({ serviceIds, graphicCount, videoCount }) => {
          generateBatch({
            graphicCount,
            videoCount,
            // `replace` WIPES every item in the month's batch and deletes the
            // videos/graphics they point at. That is right while a queue is
            // still pending review (a re-click means "not these, try again"),
            // and destructive once the batch is reviewed — accepted items are
            // scheduled posts by then, and their assets would go with them.
            // So a finished batch is topped up instead.
            ...(complete ? { append: true } : { replace: true }),
            serviceIds,
            // Selecting a service IS the consent to fill its gaps. Uploaded
            // media takes precedence wherever it exists, so this only ever
            // decides what happens where the org has nothing.
            allowStockFootage: true,
          });
          setCreateOpen(false);
        }}
      />
    </>
  );
}
