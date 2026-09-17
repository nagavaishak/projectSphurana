import { logError } from '@/lib/log-error';
import { invalidateKeys, queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import type { GetBulkAssetsStatusResponse } from '@borradh-workspace/api-client/types';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  selectPendingAssetIds,
  useAnalysisTrackerStore,
} from './analysis-tracker.store';
import {
  type SettledAnalysis,
  isPollingCancelled,
  pollAnalysisBatch,
} from './poll-analysis-batch';

/** Delay before retrying after a failed poll, so an outage cannot spin. */
const ERROR_RETRY_MS = 30_000;

const fetchBulkStatus = (assetIds: string[]) =>
  apiClient.get<GetBulkAssetsStatusResponse>(
    `assets/bulk-status?assetIds=${encodeURIComponent(assetIds.join(','))}`
  );

/**
 * Runs the AI-analysis watch for the whole app.
 *
 * Mounted once under `_authed`, so tagging keeps being tracked while the user
 * navigates, closes the upload dialog, or moves to another feature entirely.
 * Upload screens register asset ids with the tracker store and render from it;
 * none of them owns a polling loop any more.
 *
 * This is a REPORTING layer. The worker persists analysis status and the
 * resulting tags server-side, so if this component never ran at all the only
 * loss would be the live update and the toast.
 */
export function BackgroundAnalysisProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const runningRef = useRef(false);

  // Deliberately mount-once. Tying this to a reactive `pendingCount` would
  // re-run the effect on every settle, and its cleanup would abort the poller
  // that just produced the settle. The store is read imperatively instead, and
  // a subscription starts a run whenever work appears.
  useEffect(() => {
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const run = () => {
      if (runningRef.current || controller.signal.aborted) return;
      if (
        selectPendingAssetIds(useAnalysisTrackerStore.getState()).length === 0
      )
        return;

      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
      }

      runningRef.current = true;
      const completedLabels: string[] = [];
      let failedCount = 0;
      let erroredOut = false;

      const applySettled = (settled: SettledAnalysis[]) => {
        const { tracked, settle } = useAnalysisTrackerStore.getState();

        for (const result of settled) {
          const label = tracked[result.assetId]?.label ?? 'video';
          settle(result.assetId, { status: result.status, tags: result.tags });

          if (result.status === 'completed') completedLabels.push(label);
          else if (result.status === 'failed') failedCount++;
        }

        // The tags now live on the asset row, so any library listing is stale.
        invalidateKeys(queryClient, queryKeys.assets.all());
      };

      void pollAnalysisBatch({
        signal: controller.signal,
        getPendingAssetIds: () =>
          selectPendingAssetIds(useAnalysisTrackerStore.getState()),
        fetchStatus: fetchBulkStatus,
        onSettled: applySettled,
      })
        .then(() => {
          if (controller.signal.aborted) return;

          if (completedLabels.length === 1) {
            toast.success(`Tagging finished for ${completedLabels[0]}`);
          } else if (completedLabels.length > 1) {
            toast.success(
              `Tagging finished for ${completedLabels.length} videos`
            );
          }

          if (failedCount > 0) {
            // The worker already reported the real cause to Sentry; this is
            // the user-facing half only.
            toast.warning(
              failedCount === 1
                ? 'Tagging failed for 1 video. It is still in your library.'
                : `Tagging failed for ${failedCount} videos. They are still in your library.`
            );
          }
        })
        .catch((error) => {
          if (isPollingCancelled(error)) return;
          erroredOut = true;
          logError('assets.backgroundAnalysis', error, { feature: 'assets' });
          // Rows stay pending on a transient network failure — that is not an
          // analysis outcome.
        })
        .finally(() => {
          runningRef.current = false;
          if (controller.signal.aborted) return;

          if (erroredOut) {
            // Restarting immediately would spin: the rows are still pending, so
            // `run()` would re-enter and fail again with no delay between
            // attempts. Back off instead, and let a store change pre-empt it.
            retryTimer = setTimeout(run, ERROR_RETRY_MS);
            return;
          }

          // Assets registered while this run was draining need a fresh run.
          run();
        });
    };

    const unsubscribe = useAnalysisTrackerStore.subscribe(run);
    run();

    return () => {
      controller.abort();
      unsubscribe();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [queryClient]);

  return <>{children}</>;
}
