import { describe, expect, it, vi } from 'vitest';
import { pollAnalysisBatch } from './poll-analysis-batch';

type Row = {
  id: string;
  analysisStatus: string | null;
  tags?: string[];
};

/** Minimal stand-in for the `GET /assets/bulk-status` payload. */
const response = (rows: Row[]) =>
  ({
    assets: rows.map((row) => ({
      id: row.id,
      name: row.id,
      type: 'video',
      blobUrl: '',
      tags: row.tags ?? [],
      analysisStatus: row.analysisStatus,
      analysisId: null,
    })),
    summary: {
      total: rows.length,
      videosTotal: rows.length,
      analysisQueued: 0,
      analysisProcessing: 0,
      analysisCompleted: 0,
      analysisFailed: 0,
      analysisPending: 0,
    },
    // biome-ignore lint/suspicious/noExplicitAny: test fixture, narrowed by use
  }) as any;

/**
 * Drives the loop the way the provider does: a pending set the poller reads
 * fresh each tick, drained by whatever `onSettled` reports.
 */
function trackerHarness(assetIds: string[]) {
  const pending = new Set(assetIds);
  return {
    getPendingAssetIds: () => [...pending],
    onSettled: (settled: Array<{ assetId: string }>) => {
      for (const { assetId } of settled) pending.delete(assetId);
    },
    pending,
  };
}

describe('pollAnalysisBatch', () => {
  it('watches every pending asset in ONE request per tick', async () => {
    const harness = trackerHarness(['a', 'b', 'c']);
    const fetchStatus = vi.fn(async (ids: string[]) =>
      response(ids.map((id) => ({ id, analysisStatus: 'completed' })))
    );

    await pollAnalysisBatch({
      ...harness,
      fetchStatus,
      signal: new AbortController().signal,
      wait: async () => undefined,
    });

    // Three assets, one request — not one loop each, which is what the
    // per-asset polling this replaced would have opened.
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(fetchStatus).toHaveBeenCalledWith(['a', 'b', 'c']);
    expect(harness.pending.size).toBe(0);
  });

  it('waits far past the former five-minute client deadline', async () => {
    // Production completes ~5% of analyses after five minutes, almost all of it
    // queue wait. The client must not invent a deadline shorter than the work.
    const harness = trackerHarness(['a']);
    let requests = 0;
    const fetchStatus = vi.fn(async (ids: string[]) => {
      requests++;
      return response(
        ids.map((id) => ({
          id,
          analysisStatus: requests < 40 ? 'processing' : 'completed',
          tags: requests < 40 ? [] : ['facial'],
        }))
      );
    });
    const wait = vi.fn(async () => undefined);

    await pollAnalysisBatch({
      ...harness,
      fetchStatus,
      signal: new AbortController().signal,
      wait,
    });

    expect(requests).toBe(40);
    // Forty polls is already well past the five-minute, sixty-poll deadline
    // this replaced — and the loop was still going when the worker answered.
    const waitedMs = wait.mock.calls.reduce((sum, [ms]) => sum + ms, 0);
    expect(waitedMs).toBeGreaterThan(15 * 60 * 1000);
    expect(harness.pending.size).toBe(0);
  });

  it('reports completed tags from the same poll, with no follow-up request', async () => {
    const harness = trackerHarness(['a']);
    const settled: Array<{ assetId: string; tags: string[] }> = [];

    await pollAnalysisBatch({
      getPendingAssetIds: harness.getPendingAssetIds,
      onSettled: (rows) => {
        settled.push(...rows);
        harness.onSettled(rows);
      },
      fetchStatus: async (ids) =>
        response(
          ids.map((id) => ({
            id,
            analysisStatus: 'completed',
            tags: ['botox', 'clinic'],
          }))
        ),
      signal: new AbortController().signal,
      wait: async () => undefined,
    });

    expect(settled).toEqual([
      { assetId: 'a', status: 'completed', tags: ['botox', 'clinic'] },
    ]);
  });

  it('separates a worker failure from giving up', async () => {
    const harness = trackerHarness(['failed-row', 'stuck-row']);
    const settled: Array<{ assetId: string; status: string }> = [];

    await pollAnalysisBatch({
      getPendingAssetIds: harness.getPendingAssetIds,
      onSettled: (rows) => {
        settled.push(...rows);
        harness.onSettled(rows);
      },
      fetchStatus: async (ids) =>
        response(
          ids.map((id) => ({
            id,
            analysisStatus: id === 'failed-row' ? 'failed' : 'queued',
          }))
        ),
      signal: new AbortController().signal,
      maxWaitMs: 20_000,
      wait: async () => undefined,
    });

    const byId = Object.fromEntries(settled.map((s) => [s.assetId, s.status]));
    // A worker fault the user should hear about…
    expect(byId['failed-row']).toBe('failed');
    // …versus a row nothing will ever move (never enqueued, lost from Redis).
    // Production holds eleven of these, all stuck in `processing`.
    expect(byId['stuck-row']).toBe('abandoned');
  });

  it('picks up an asset registered mid-flight without a second loop', async () => {
    const harness = trackerHarness(['a']);
    const seenBatches: string[][] = [];

    const fetchStatus = vi.fn(async (ids: string[]) => {
      seenBatches.push([...ids]);
      // A second upload finishes while the first is still being watched.
      if (seenBatches.length === 1) harness.pending.add('b');
      return response(ids.map((id) => ({ id, analysisStatus: 'completed' })));
    });

    await pollAnalysisBatch({
      ...harness,
      fetchStatus,
      signal: new AbortController().signal,
      wait: async () => undefined,
    });

    expect(seenBatches).toEqual([['a'], ['b']]);
    expect(harness.pending.size).toBe(0);
  });

  it('drops a row the server stops returning, rather than pinning the loop open', async () => {
    // The user deleted the asset between ticks. Left pending it would hold the
    // poller open for the whole ceiling.
    const harness = trackerHarness(['deleted']);
    const settled: Array<{ assetId: string; status: string }> = [];

    await pollAnalysisBatch({
      getPendingAssetIds: harness.getPendingAssetIds,
      onSettled: (rows) => {
        settled.push(...rows);
        harness.onSettled(rows);
      },
      fetchStatus: async () => response([]),
      signal: new AbortController().signal,
      wait: async () => undefined,
    });

    expect(settled).toEqual([
      { assetId: 'deleted', status: 'abandoned', tags: [] },
    ]);
  });

  it('backs off from a prompt first poll up to the interval ceiling', async () => {
    // The median analysis finishes in about 8s, so the first poll must be fast;
    // only a genuinely long wait should slow down.
    const harness = trackerHarness(['a']);
    const wait = vi.fn(async () => undefined);

    await pollAnalysisBatch({
      ...harness,
      fetchStatus: async (ids) =>
        response(ids.map((id) => ({ id, analysisStatus: 'processing' }))),
      signal: new AbortController().signal,
      wait,
    });

    const delays = wait.mock.calls.map(([ms]) => ms);
    expect(delays[0]).toBe(5_000);
    expect(delays[1]).toBe(7_500);
    expect(Math.max(...delays)).toBe(30_000);
    // A flat 5s interval would issue ~1080 requests over the same 90-minute
    // budget. Backing off spends under a fifth of that — per batch, not per
    // asset, so a twenty-video upload pays this once.
    expect(delays.length).toBeLessThan(200);
  });

  it('stops immediately when aborted', async () => {
    const harness = trackerHarness(['a']);
    const controller = new AbortController();
    const fetchStatus = vi.fn(async (ids: string[]) => {
      controller.abort();
      return response(ids.map((id) => ({ id, analysisStatus: 'processing' })));
    });

    await pollAnalysisBatch({
      ...harness,
      fetchStatus,
      signal: controller.signal,
      wait: async () => undefined,
    });

    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });
});
