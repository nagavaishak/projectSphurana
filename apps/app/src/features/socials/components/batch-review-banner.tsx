import { useNavigate } from '@tanstack/react-router';
import { AlertTriangle, Loader2, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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

/**
 * Translate a batch `errorMessage` (written by the planner for developers)
 * into something the owner can act on. Unknown messages fall back to a
 * generic retry line — never show nothing (a failed batch that renders no
 * banner reads as "the button did nothing", which is how this bug shipped).
 */
export function humanizeBatchError(errorMessage: string | null): string {
  const msg = errorMessage ?? '';
  if (msg.includes('No services with usable media or video footage')) {
    return 'None of your services have photos or videos yet. Upload some media to a service, then try again.';
  }
  if (msg.includes('No active services')) {
    return 'You have no active services. Add or activate a service, then try again.';
  }
  if (msg.toLowerCase().includes('rate limit')) {
    return 'Our content planner is briefly overloaded. Try again in a few minutes.';
  }
  return 'Something went wrong while planning your content. Try again — if it keeps failing, contact support.';
}

/**
 * Planner banner for the current month's content batch.
 *
 * Polls the current batch and surfaces one of three states (or nothing):
 *   - still rendering → a "creating content" progress banner
 *   - planning failed → an error card with the reason and a retry button
 *   - all rendered, items pending review → a "review now" call-to-action that
 *     opens the BatchReviewDialog
 *
 * Mirrors the progress derivation in socials-page-content / BulkCreateButton so
 * all three agree on what counts as rendering vs ready.
 */
export function BatchReviewBanner() {
  const navigate = useNavigate();
  const { batch, items } = useGetCurrentBatch();
  const [retryOpen, setRetryOpen] = useState(false);
  const { generateBatch, isGenerating: isRetrying } = useGenerateContentBatch();

  const { pendingReviewCount, pendingRenderingCount, failedAssetCount } =
    useMemo(() => {
      if (!batch) {
        return {
          pendingReviewCount: 0,
          pendingRenderingCount: 0,
          failedAssetCount: 0,
        };
      }
      // No supersession filter: the server returns one row per post, already
      // resolved to the current cut.
      const pending = items.filter((i) => i.reviewStatus === 'pending');
      const rendering = pending.filter((i) => {
        const status =
          i.kind === 'graphic' ? i.graphic?.status : i.video?.status;
        return !status || (status !== 'ready' && status !== 'failed');
      }).length;
      const failed = pending.filter((i) => {
        const status =
          i.kind === 'graphic' ? i.graphic?.status : i.video?.status;
        return status === 'failed';
      }).length;
      return {
        pendingReviewCount: pending.length,
        pendingRenderingCount: rendering,
        failedAssetCount: failed,
      };
    }, [batch, items]);

  // Items that failed at seed time never got a row at all — the only trace is
  // the summary the seeder persists on the batch (e.g. "2 of 12 planned items
  // couldn't be generated"). Failed batches are a whole-banner state of their
  // own, so only surface the summary for live/finished batches.
  const seedFailureSummary =
    batch && batch.status !== 'failed' ? batch.errorMessage : null;

  const isSeeding = batch?.status === 'planning';
  const isGenerating = isSeeding || pendingRenderingCount > 0;
  const readyForReview = pendingReviewCount > 0 && pendingRenderingCount === 0;

  if (batch?.status === 'failed') {
    return (
      <>
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-destructive/10 p-2 text-destructive">
                <AlertTriangle className="size-4" />
              </div>
              <div>
                <p className="text-sm font-medium">
                  This month&apos;s content couldn&apos;t be created
                </p>
                {/* Raw planner string stays on `title` so support can recover it
                    from a customer's screen without it reaching the card. */}
                <p
                  className="text-xs text-destructive"
                  title={batch.errorMessage ?? undefined}
                >
                  {humanizeBatchError(batch.errorMessage)}
                </p>
              </div>
            </div>
            <Button onClick={() => setRetryOpen(true)} variant="outline">
              Try again
            </Button>
          </CardContent>
        </Card>
        <CreateBatchDialog
          open={retryOpen}
          onOpenChange={setRetryOpen}
          isSubmitting={isRetrying}
          onConfirm={({ serviceIds, graphicCount, videoCount }) => {
            generateBatch({
              graphicCount,
              videoCount,
              replace: true,
              serviceIds,
              // Selecting a service IS the consent to fill its gaps. Uploaded
              // media takes precedence wherever it exists, so this only ever
              // decides what happens where the org has nothing.
              allowStockFootage: true,
            });
            setRetryOpen(false);
          }}
        />
      </>
    );
  }

  if (isGenerating) {
    const ready = pendingReviewCount - pendingRenderingCount;
    const label =
      pendingReviewCount === 0
        ? 'Creating this month’s content…'
        : `Creating this month’s content — ${ready} of ${pendingReviewCount} ready`;
    return (
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex items-center gap-3 p-4">
          <div className="rounded-md bg-primary/10 p-2 text-primary">
            <Loader2 className="size-4 animate-spin" />
          </div>
          <div>
            <p className="text-sm font-medium">{label}</p>
            <p className="text-xs text-muted-foreground">
              We’ll let you know when it’s ready to review.
            </p>
            {seedFailureSummary && (
              <p className="text-xs text-destructive">{seedFailureSummary}</p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!readyForReview) return null;

  return (
    <>
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-destructive/10 p-2 text-destructive">
              <AlertTriangle className="size-4" />
            </div>
            <div>
              <p className="text-sm font-medium">
                {pendingReviewCount}{' '}
                {pendingReviewCount === 1 ? 'item needs' : 'items need'}{' '}
                reviewing before they can be published
              </p>
              <p className="text-xs text-muted-foreground">
                Approve or regenerate this month&apos;s suggested content.
              </p>
              {(failedAssetCount > 0 || seedFailureSummary) && (
                <p className="text-xs text-destructive">
                  {[
                    failedAssetCount > 0
                      ? `${failedAssetCount} ${failedAssetCount === 1 ? 'item' : 'items'} failed to render — regenerate or reject ${failedAssetCount === 1 ? 'it' : 'them'} during review.`
                      : null,
                    seedFailureSummary,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                </p>
              )}
            </div>
          </div>
          <Button
            onClick={() => void navigate({ to: REVIEW_ROUTE })}
            variant="default"
            className="gap-2"
          >
            <Sparkles className="size-4" />
            Review now
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
