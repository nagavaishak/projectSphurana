import { format } from 'date-fns';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import {
  acceptBatchItemForm,
  useAcceptBatchItem,
} from '@/features/content-batches/api/accept-batch-item';
import { useGetCurrentBatch } from '@/features/content-batches/api/get-current-batch';
import { useRegenerateBatchItem } from '@/features/content-batches/api/regenerate-batch-item';
import { useRejectBatchItem } from '@/features/content-batches/api/reject-batch-item';
import type { ContentItemWithAsset } from '@/features/content-batches/types';

import { ShimmerCard, SlideShell } from '../components/index';
import type { OnboardingSession, OnboardingSlide } from '../types';

/**
 * The caption label comes from the accept-batch-item form declaration — this
 * slide OWNS only `caption` (schedule + pages stay planner-seeded), and the
 * contract locates the control by this same string.
 */
const L = acceptBatchItemForm.labels;
const D = acceptBatchItemForm.defaults;

export interface ContentApprovalSlideProps {
  session: OnboardingSession;
  onAdvance: (next: OnboardingSlide, answer?: unknown) => void;
}

/**
 * Latest item per slot — anything superseded by a regenerated row is hidden.
 * (Mirrors the batch-review dialog's supersession walk.)
 */
/** Still rendering (non-terminal). `failed` is terminal — no endless shimmer. */
function assetIsRendering(item: ContentItemWithAsset): boolean {
  const status =
    item.kind === 'graphic' ? item.graphic?.status : item.video?.status;
  if (!status) return true;
  return status !== 'ready' && status !== 'failed';
}

function assetFailed(item: ContentItemWithAsset): boolean {
  const status =
    item.kind === 'graphic' ? item.graphic?.status : item.video?.status;
  return status === 'failed';
}

function ItemPreview({ item }: { item: ContentItemWithAsset }) {
  if (assetFailed(item)) {
    return (
      <div className="border-destructive/40 bg-destructive/5 text-destructive flex aspect-square w-full items-center justify-center rounded-lg border px-4 text-center">
        <div className="space-y-1">
          <AlertTriangle className="mx-auto size-6" />
          <p className="text-sm">
            This one failed to render — regenerate or reject it.
          </p>
        </div>
      </div>
    );
  }

  if (assetIsRendering(item)) {
    return <ShimmerCard label="still creating…" className="aspect-square" />;
  }

  if (item.kind === 'graphic') {
    const output = item.graphic?.outputs?.find(
      (o) => o.status !== 'failed' && o.url
    );
    if (!output) {
      return <ShimmerCard label="still creating…" className="aspect-square" />;
    }
    return (
      <img
        src={output.url}
        alt="Post preview"
        className="aspect-square w-full rounded-lg border object-cover"
      />
    );
  }

  if (item.video?.blobUrl) {
    return (
      <div className="overflow-hidden rounded-lg border bg-black">
        {/* biome-ignore lint/a11y/useMediaCaption: user content preview */}
        <video
          src={item.video.blobUrl}
          poster={item.video.thumbnailUrl ?? undefined}
          className="aspect-square w-full object-cover"
          controls
          playsInline
        />
      </div>
    );
  }

  if (item.video?.thumbnailUrl) {
    return (
      <img
        src={item.video.thumbnailUrl}
        alt="Video preview"
        className="aspect-square w-full rounded-lg border object-cover"
      />
    );
  }

  return <ShimmerCard label="still creating…" className="aspect-square" />;
}

/**
 * Slide 14 — `content_approval`. Inline (non-dialog) version of the monthly
 * batch review: one item at a time — media, editable caption, the pre-filled
 * schedule date — with accept / regenerate / reject and a "3 of 8" progress
 * readout. The batch may still be generating (shimmer + skip allowed); the
 * seeded `scheduledAt` rides along server-side when accepting.
 */
export function ContentApprovalSlide({
  session: _session,
  onAdvance,
}: ContentApprovalSlideProps) {
  const { batch, items, isLoading, refetch } = useGetCurrentBatch();

  const currentItems = useMemo(
    () => ((x: ContentItemWithAsset[]) => x)(items),
    [items]
  );
  const pendingItems = useMemo(
    () => currentItems.filter((i) => i.reviewStatus === 'pending'),
    [currentItems]
  );
  // Always review the FIRST pending item — accepting/rejecting drops it from
  // the list on refetch and the next one slides into place (no cursor).
  const currentItem = pendingItems[0];

  const isAssetPending = currentItem ? assetIsRendering(currentItem) : false;
  useEffect(() => {
    if (!isAssetPending) return;
    const interval = setInterval(() => void refetch(), 2500);
    return () => clearInterval(interval);
  }, [isAssetPending, refetch]);

  const [caption, setCaption] = useState(D.caption);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on item identity change only
  useEffect(() => {
    setCaption(currentItem?.caption ?? D.caption);
  }, [currentItem?.id]);

  const { acceptBatchItemAsync, isAccepting } = useAcceptBatchItem({});
  const { rejectBatchItemAsync, isRejecting } = useRejectBatchItem({});
  const { regenerateBatchItemAsync, isRegenerating } = useRegenerateBatchItem(
    {}
  );
  const isBusy = isAccepting || isRejecting || isRegenerating;

  const handleAccept = async () => {
    if (!currentItem) return;
    try {
      // scheduledAt omitted on purpose — the server keeps the planner-seeded
      // date shown below.
      await acceptBatchItemAsync({
        itemId: currentItem.id,
        caption: caption.trim() || undefined,
      });
    } catch {
      // toast surfaced in hook
    }
  };

  const handleReject = async () => {
    if (!currentItem) return;
    try {
      await rejectBatchItemAsync(currentItem.id);
    } catch {
      // toast surfaced in hook
    }
  };

  const handleRegenerate = async () => {
    if (!currentItem) return;
    try {
      await regenerateBatchItemAsync({ itemId: currentItem.id });
    } catch {
      // toast surfaced in hook
    }
  };

  const total = currentItems.length;
  const reviewedCount = total - pendingItems.length;
  const position = Math.min(reviewedCount + 1, total);
  const allReviewed = total > 0 && pendingItems.length === 0;
  const stillGenerating =
    isLoading || total === 0 || batch?.status === 'planning';

  const scheduledLabel = currentItem?.scheduledAt
    ? format(new Date(currentItem.scheduledAt), 'EEE d MMM, HH:mm')
    : null;

  return (
    <SlideShell
      step={14}
      headline="Your **month of content** is ready — accept or reject each one."
      description="Every post is already scheduled for you. Approve the ones you like; anything you skip now can be reviewed later from the dashboard."
      onSubmit={() => onAdvance('mobile_app')}
      submitLabel={allReviewed ? 'Continue' : 'Continue anyway'}
    >
      {stillGenerating ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <ShimmerCard label="still creating…" className="aspect-square" />
            <ShimmerCard label="still creating…" className="aspect-square" />
            <ShimmerCard label="still creating…" className="aspect-square" />
          </div>
          <p className="text-muted-foreground text-sm">
            I'm still creating your month of content — it'll be waiting in your
            dashboard. You can carry on.
          </p>
        </div>
      ) : allReviewed ? (
        <div className="flex items-center gap-3 rounded-lg border p-4">
          <CheckCircle2 className="size-6 text-emerald-600 dark:text-emerald-400" />
          <div>
            <p className="text-sm font-medium">All reviewed</p>
            <p className="text-muted-foreground text-sm">
              Your approved posts are scheduled and ready to go.
            </p>
          </div>
        </div>
      ) : currentItem ? (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">
                {position} of {total}
              </span>
              <span className="text-muted-foreground capitalize">
                {currentItem.kind}
              </span>
            </div>
            <Progress value={(position / total) * 100} />
          </div>

          <div className="grid gap-4 sm:grid-cols-[220px_minmax(0,1fr)]">
            <div className="mx-auto w-full max-w-[220px]">
              <ItemPreview item={currentItem} />
            </div>

            <div className="flex min-w-0 flex-col gap-3">
              <Textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={4}
                placeholder="Caption for this post…"
                aria-label={L.caption}
              />
              {scheduledLabel && (
                <p className="text-muted-foreground text-sm">
                  Scheduled for{' '}
                  <span className="text-foreground font-medium">
                    {scheduledLabel}
                  </span>
                </p>
              )}

              <div className="mt-auto flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleReject}
                  disabled={isBusy}
                  className="text-destructive hover:text-destructive gap-2"
                >
                  {isRejecting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <XCircle className="size-4" />
                  )}
                  Reject
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRegenerate}
                  disabled={isBusy || isAssetPending}
                  className="gap-2"
                >
                  {isRegenerating ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                  Regenerate
                </Button>
                <Button
                  type="button"
                  onClick={handleAccept}
                  disabled={isBusy || isAssetPending}
                  className="gap-2"
                >
                  {isAccepting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-4" />
                  )}
                  Accept
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </SlideShell>
  );
}
