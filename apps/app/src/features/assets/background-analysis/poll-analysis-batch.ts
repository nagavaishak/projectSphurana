import type { GetBulkAssetsStatusResponse } from '@borradh-workspace/api-client/types';

export type BatchAnalysisOutcome = 'completed' | 'failed' | 'abandoned';

export interface SettledAnalysis {
  assetId: string;
  status: BatchAnalysisOutcome;
  tags: string[];
}

/**
 * A flat interval would issue ~540 requests over the ceiling below. Backing off
 * keeps the first poll prompt — the median analysis finishes in about 8s — while
 * a full-ceiling wait costs well under a hundred requests.
 */
const POLL_BACKOFF_FACTOR = 1.5;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const MAX_POLL_INTERVAL_MS = 30_000;

/**
 * Far above any legitimate analysis. The worker's own lock is 5 minutes
 * (`asset-analysis-processor.ts`) and a busy queue can hold a job well beyond
 * that — production has completed analyses 84 minutes after they were queued,
 * almost all of it queue wait. This ceiling therefore is NOT a deadline on the
 * work; it only stops the client watching rows that can no longer reach a
 * terminal state (never enqueued, lost from Redis, orphaned by a dead worker).
 * Production currently holds eleven such rows, all stuck in `processing`.
 *
 * Nothing user-visible depends on this any more: analysis runs in the
 * background, and the tags land on the asset row regardless of whether anyone
 * is watching.
 */
const DEFAULT_MAX_WAIT_MS = 90 * 60 * 1000;

interface PollAnalysisBatchOptions {
  /** Read fresh each tick, so assets uploaded mid-flight join the same loop. */
  getPendingAssetIds: () => string[];
  fetchStatus: (assetIds: string[]) => Promise<GetBulkAssetsStatusResponse>;
  /** Called once per tick with whatever reached a terminal state that tick. */
  onSettled: (settled: SettledAnalysis[]) => void;
  signal: AbortSignal;
  pollIntervalMs?: number;
  maxWaitMs?: number;
  maxPollIntervalMs?: number;
  /** Injectable so tests need no real timers. */
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}

function waitForNextPoll(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    const abort = () => {
      window.clearTimeout(timer);
      cleanup();
      reject(
        signal.reason ?? new DOMException('Polling cancelled', 'AbortError')
      );
    };

    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

export function isPollingCancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Watch every in-flight analysis in ONE request per tick.
 *
 * The previous per-asset loops meant a twenty-video upload opened twenty
 * independent polling chains; this asks `GET /assets/bulk-status` once for all
 * of them. The loop runs until nothing is pending, so assets added part-way
 * through an upload are picked up by the next tick rather than starting a
 * second poller.
 */
export async function pollAnalysisBatch({
  getPendingAssetIds,
  fetchStatus,
  onSettled,
  signal,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  maxWaitMs = DEFAULT_MAX_WAIT_MS,
  maxPollIntervalMs = MAX_POLL_INTERVAL_MS,
  wait = waitForNextPoll,
}: PollAnalysisBatchOptions): Promise<void> {
  const firstInterval = Math.max(1, pollIntervalMs);
  let interval = firstInterval;
  let budgetRemainingMs = Math.max(firstInterval, maxWaitMs);
  const seen = new Set<string>();

  while (!signal.aborted) {
    const pending = getPendingAssetIds();
    if (pending.length === 0) return;

    // A newly registered asset restarts the cadence: it deserves a prompt first
    // poll and its own full budget, rather than inheriting the backed-off
    // interval and spent ceiling of a row that has been stuck for an hour.
    const hasNewAsset = pending.some((assetId) => !seen.has(assetId));
    if (hasNewAsset) {
      interval = firstInterval;
      budgetRemainingMs = Math.max(firstInterval, maxWaitMs);
      for (const assetId of pending) seen.add(assetId);
    }

    const data = await fetchStatus(pending);
    if (signal.aborted) return;

    const settled: SettledAnalysis[] = [];
    for (const row of data.assets) {
      if (row.analysisStatus === 'completed') {
        settled.push({ assetId: row.id, status: 'completed', tags: row.tags });
      } else if (row.analysisStatus === 'failed') {
        settled.push({ assetId: row.id, status: 'failed', tags: row.tags });
      }
    }

    // Rows the server did not return at all (deleted between ticks) are dropped
    // rather than left pending forever, which would pin the loop open.
    const returned = new Set(data.assets.map((row) => row.id));
    for (const assetId of pending) {
      if (!returned.has(assetId)) {
        settled.push({ assetId, status: 'abandoned', tags: [] });
      }
    }

    if (settled.length > 0) onSettled(settled);

    const stillPending = getPendingAssetIds();
    if (stillPending.length === 0) return;

    if (budgetRemainingMs < interval) {
      onSettled(
        stillPending.map((assetId) => ({
          assetId,
          status: 'abandoned' as const,
          tags: [],
        }))
      );
      return;
    }
    budgetRemainingMs -= interval;

    await wait(interval, signal);
    interval = Math.min(
      maxPollIntervalMs,
      Math.round(interval * POLL_BACKOFF_FACTOR)
    );
  }
}
